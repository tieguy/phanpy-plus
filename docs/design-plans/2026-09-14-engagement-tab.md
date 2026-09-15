# Engagement Tab Design

## Summary

Likes and boosts are currently hidden from notifications altogether by the
"only direct responses" setting. That is too blunt: the user still wants to
know that posts are landing, just not one event at a time. This adds an
**Engagement** tab that treats likes and boosts as numbers rather than
events, in the way social-media dashboards do. It shows, per network, how
many likes and boosts arrived in the last 24 hours, and lists the posts that
received them, ranked by that 24-hour tally, with each post's current
totals alongside for context. It never shows who did the liking.

The window is a fixed "since yesterday", not "since you last looked". A
last-looked marker would live per device and disagree across them; a fixed
window computed from server timestamps gives the same answer everywhere.
Neither network exposes count history, so the 24-hour tally is
reconstructed by walking like and boost notifications back until their
timestamps cross the cutoff. Both networks stamp every such notification,
and the app already fetches them and merely filters them out at render
time, so the tab needs no new API surface. The tally is a pure function of a
notification list and a cutoff, so it is unit tested in Node; the page and
the tab registration are verified in a browser against one account on each
network.

## Definition of Done

A new "Engagement" entry in the shortcuts/tabs registry, reachable at
`/engagement` and usable as a multi-column column. It renders, for the
current account plus every merged other-network account, one summary line
per network ("N likes · M boosts in the last 24h"), followed by a list of
the user's posts that received any like or boost in that window, sorted by
the window tally, each row showing the window tally and the post's current
total likes, boosts, replies and quotes. No avatars or names of the people
who liked or boosted appear anywhere in the tab. When the walk hits its
page cap before crossing the cutoff, the summary line reads "at least N".
Unit tests cover the tally (window cutoff, per-post aggregation, reblog
wrapper look-through, cap flag). The notifications page, bell dropdown and
badge are unchanged.

## Glossary

- **Engagement**: Likes (Mastodon favourites, Bluesky likes) and boosts (Mastodon reblogs, Bluesky reposts) received on the user's own posts.
- **Window**: The last 24 hours, measured from the time the tab is opened, against each notification's server timestamp.
- **Tally**: Per-post count of likes and boosts whose notification falls inside the window.
- **Current totals**: The post's `favouritesCount`, `reblogsCount`, `repliesCount` and `quotesCount` as of the latest fetch; the lifetime numbers, not the window.
- **Mastodon-shaped notification**: The app's internal notification shape, `{ id, type, createdAt, account, status, _instance }`; Bluesky notifications arrive in this shape via `notificationToMasto`.
- **Reblog wrapper**: A Mastodon status whose `reblog` field holds the real post; the wrapper carries zeroed counts.
- **Merged sources**: The current account plus every logged-in account on the other network, as used by the merged home timeline and notifications page.
- **Page cap**: The maximum number of notification pages walked per source before giving up on reaching the cutoff.
- **Responses-only filter**: `settings.notificationsResponsesOnly`, which hides everything except replies and mentions on the notification surfaces. The Engagement tab does not apply it.
- **Shortcuts registry**: `src/components/shortcuts-settings.jsx`, the list of tab types the user can pin, with titles, paths and icons.

## Architecture

The tab is a read-only aggregation over like and boost notifications from
every merged source. It does not touch the notification surfaces or their
filter, and it stores nothing: every open recomputes the window from server
data, which is what keeps devices in agreement.

Data path per source:

1. Fetch notifications with `types: ['favourite', 'reblog']` through
   `api({ account }).masto.v1.notifications.list`. Mastodon honours `types`
   server-side. The Bluesky facade applies the same filter client-side
   after hydrating; see the facade note under Additional Considerations.
2. Walk pages until the oldest item on a page is older than the cutoff, or
   the page cap is reached.
3. Feed every item into the pure tally.

The tally keys by post id. For a Mastodon notification the post is
`notification.status`, looking through `status.reblog` if the notification
somehow arrives on a wrapper. For a Bluesky like or repost the post is the
hydrated `subjectStatus`, which the facade already attaches; a notification
whose subject failed to hydrate is counted in the network total but cannot
be attributed to a row, so the summary can exceed the sum of rows. Current
totals come from the same status objects, so no second fetch is needed;
rows are keyed by `_instance + id` so the two networks never collide.

Three pieces:

- `src/utils/engagement-tally.js` (pure). `tallyEngagement(notifications, { cutoff })`
  returns per-network totals and per-post rows.
- `src/pages/engagement.jsx`. Fans out over merged sources, walks pages,
  calls the tally, renders. Accepts `columnMode` like the other pages.
- Registry entries: route in `src/app.jsx`, `TYPES` / `TYPE_TEXT` /
  `SHORTCUTS_META` in `shortcuts-settings.jsx`, and the type-to-component
  map in `src/components/columns.jsx`.

### Contracts

```ts
// engagement-tally.js
interface EngagementRow {
  key: string;            // `${instance}/${statusId}`
  instance: string;
  status: MastodonStatus; // the real post, never a reblog wrapper
  windowLikes: number;
  windowBoosts: number;
  // current totals are read off status.favouritesCount etc. at render time
}
interface NetworkSummary {
  instance: string;
  likes: number;          // all window likes, attributed or not
  boosts: number;
  capped: boolean;        // page cap hit before crossing the cutoff
}
interface EngagementTally {
  networks: NetworkSummary[];
  rows: EngagementRow[];  // sorted by windowLikes + windowBoosts desc, then createdAt desc
}
function tallyEngagement(
  sources: Array<{ instance: string; notifications: MastodonNotification[]; capped: boolean }>,
  opts: { cutoff: number /* epoch ms */ },
): EngagementTally;

// engagement.jsx page walk, per source
const WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_CAP = 5;      // × limit 80 = at most 400 notifications per source
```

Data flow: merged sources → per-source page walk with `types` filter →
`tallyEngagement` → summary lines + rows.

## Existing Patterns

- **Per-account fan-out** via `api({ account })` over
  `getOtherNetworkAccounts()`, labelled with `_instance`, exactly as
  `src/pages/notifications.jsx` builds `otherSources`. The tab does not need
  the k-way merge iterator, since ordering across sources is irrelevant to
  a tally; it walks each source independently.
- **Client-side cutoff on timestamps**, not `sinceId`, because the Bluesky
  facade ignores `sinceId` (`src/utils/notification-filter.js` explains the
  same constraint for the badge).
- **Pure helper with colocated Vitest test** in `src/utils/`
  (`notification-filter.js`, `compose-counting.js`, `post-card-model.js`).
- **Tab registration** follows `mentions`: a page component taking
  `columnMode`, an `AuthRoute` in `src/app.jsx`, entries in `TYPES`,
  `TYPE_TEXT` and `SHORTCUTS_META`, and the `columns.jsx` map.
- **Status rendering**: rows reuse the existing compact status component
  with actions disabled, so the tab inherits content-warning and media
  handling.
- **UI strings** through lingui macros, then `npm run extract` and commit
  `src/locales/en.po` (see CLAUDE.md, "UI strings").

Prior art outside the app: Buffer, Fedica and Sprout Social all surface
likes and reposts as per-post analytics and reserve their inbox for replies
and mentions. Twitter's quality filter, the "VIP" notification feature, was
a spam filter rather than a volume reducer and is not the model here.

## Implementation Phases

### Phase 1: Tally
**Goal:** Turn notification lists into per-network totals and per-post rows.

**Components:**
- `src/utils/engagement-tally.js` — `tallyEngagement`: cutoff filter on
  `createdAt`, look-through of `status.reblog`, per-post aggregation keyed
  by instance and id, unattributed likes and boosts counted in the network
  total only, `capped` passthrough, sort.
- `src/utils/engagement-tally.test.js`.

**Dependencies:** None.

**Done when:** Tests pass for: items outside the window ignored; two
sources with the same status id kept separate; reblog wrapper resolved to
the inner post; Bluesky notification with null status counted in the
network total but no row; `capped` reflected; sort order.

### Phase 2: Page walk and rendering
**Goal:** A working `/engagement` page.

**Components:**
- `src/pages/engagement.jsx` — builds the source list from the current
  account and `getOtherNetworkAccounts()` (gated on
  `settings.mergedTimeline` like the notifications page); per source,
  requests `types: ['favourite', 'reblog']` with limit 80 and walks up to
  `PAGE_CAP` pages, stopping when a page's oldest `createdAt` is past the
  cutoff; loading, error and empty states; summary lines with the "at
  least" wording when capped; rows with window tally and current totals;
  a manual refresh control. No avatars or names of engagers anywhere.

**Dependencies:** Phase 1.

**Done when:** In the browser, with one Mastodon and one Bluesky account
logged in, the page shows a summary line per network and rows for posts
liked or boosted in the last day on both, with no console errors. A
network with zero engagement shows "0 likes · 0 boosts".

### Phase 3: Tab registration
**Goal:** Reachable as a tab and as a column.

**Components:**
- `src/app.jsx` — `AuthRoute` for `/engagement`.
- `src/components/shortcuts-settings.jsx` — `engagement` in `TYPES`,
  `TYPE_TEXT`, and `SHORTCUTS_META` (path `/engagement`, an existing
  chart-like or heart icon).
- `src/components/columns.jsx` — map entry.
- `src/locales/en.po` regenerated.

**Dependencies:** Phase 2.

**Done when:** The tab can be pinned in shortcuts settings, opens in tab
mode and in multi-column mode, and every string renders as text rather
than a hash in a production build.

### Phase 4: Documentation
**Goal:** Record the feature for readers of the repo.

**Components:**
- `README.md` feature list entry.
- `CLAUDE.md` short section: the tab is a stateless 24-hour tally over
  like and boost notifications, applies no responses-only filter, and
  shows no engager identities.

**Dependencies:** Phase 3.

**Done when:** Docs describe the shipped behavior in the present tense.

## Additional Considerations

**Why notifications rather than a stored count snapshot.** A daily snapshot
of per-post counts would be cheaper to render but lives per browser, so
two devices would show different deltas and a device closed yesterday
would show nothing. Notification timestamps are server truth on both
networks and reproduce the same window everywhere.

**Bluesky facade cost.** The facade's `notifications.list` fetches every
reason and hydrates every subject before filtering by `types`, so a
like-and-repost walk pays for mentions and follows it then discards.
`app.bsky.notification.listNotifications` accepts a `reasons` parameter;
passing `['like', 'repost']` through when `types` maps cleanly is a small
facade change that halves the walk on busy accounts. It is an optimization
inside Phase 2, not a prerequisite.

**Mastodon grouped notifications** (API v2) report one timestamp per group,
not per member, so the walk uses the v1 endpoint on every source, which is
also what merged mode already does on the notifications page.

**Mastodon counts are instance-local.** A home instance only knows about
likes and boosts it has received, so both the window tally and the current
totals undercount relative to the wider fediverse. Accepted; the numbers
are still consistent with themselves.

**Page cap.** Five pages of 80 bounds the walk at 400 notifications per
source. A viral day exceeds that; the summary then says "at least" and the
rows are a lower bound. Raising the cap is a one-line change if this turns
out to bite.

**Time zone.** "Last 24 hours" is a rolling window, not a calendar day, so
it needs no time-zone handling and reads the same in every locale.
