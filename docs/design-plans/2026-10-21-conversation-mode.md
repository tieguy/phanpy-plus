# Conversation Mode Design

## Summary

For most of the day, the app shows only conversations: threads where
someone replied to the user or mentioned the user. The full app, with its
timelines, search, profiles and settings, opens only during fixed daily
windows. Outside those windows, a route guard sends every path to a
conversation list. The list and the thread view have very little chrome:
no navigation menu, no shortcuts bar, no search, and no links out of the
thread. The aim is to make the general feed unreachable for most of the
day, so that the app serves replies to people instead of browsing.

The schedule is a constant in the source code, not a setting. A setting
that the user can turn off is not a restriction, so the only way to change
the schedule is a deploy. This makes the mode useful to one user only. A
separate plan covers taking the deploy off the public internet.

A conversation comes from one source only: reply and mention
notifications. The user's own replies are not a source. So a thread that
the user joined appears only after someone answers the user. DMs are
out of scope for this round.

## Definition of Done

- Outside the full-app windows, every route except the conversation routes
  and the composer redirects to `/conversations`. This includes deep links
  and PWA last-path restore. The `compose/` pop-out entry and the share
  target open only a composer.
- `/conversations` lists recent threads that contain a direct response to
  the user, from the current account plus every merged other-network
  account. The list is sorted by the time of the newest direct response,
  one row per thread.
- Selecting a row opens a thread view. In the thread view, posts show their
  text and media. Profile names, avatars, hashtags, mentions and quoted
  posts are inert. Links to web pages in post text open in a new tab.
  The only actions are reply, like and share link.
- Reply opens the existing composer, which posts from the account that
  received the notification.
- During a full-app window, the app works as it does today, and the
  conversation routes stay available.
- Unit tests cover the schedule predicate and the grouping of
  notifications into conversations.
- A browser check confirms the redirect, the list and a reply on one
  account per network.

## Glossary

- **Full-app window**: A time range, in the device's local time, during
  which the whole app is available. Weekdays and weekends have separate
  windows. The values are a hardcoded constant.
- **Conversation mode**: The app state outside every full-app window.
- **Direct response**: A notification of type `mention`, as decided by
  `isDirectResponse` in `src/utils/notification-filter.js`. On both
  networks this covers replies and @-mentions and excludes quotes.
- **Conversation**: A group of direct responses that belong to the same
  thread, identified by the thread root.
- **Thread root**: The first post of a reply chain. Bluesky records carry
  it as `record.reply.root`. Mastodon statuses do not carry it.
- **Merged sources**: The current account plus every logged-in account on
  the other network, as used by the merged notifications page.
- **Inert**: Rendered as text, with no navigation on click, tap or
  keyboard activation.

## Architecture

Three parts: a schedule predicate, a route guard, and a conversation
surface (list plus thread view).

### Schedule

`src/utils/conversation-schedule.js` (pure) exports:

- `FULL_APP_WINDOWS`: `{ weekday, weekend }`, each an array of
  `[startMinute, endMinute)` pairs in local time. Monday to Friday use
  `weekday`. Saturday and Sunday use `weekend`.
  - `weekday`: 08:00–09:00, 12:00–13:00, 21:00–21:30.
  - `weekend`: 08:00–09:00, 21:00–21:30. The weekend has no midday
    window.
- `isFullAppOpen(date)`: true when `date` falls inside a window for the
  day of the week of `date`. No window crosses midnight, so the predicate
  checks one day only.
- `nextChange(date)`: the next time the answer changes. The answer can
  change at a weekday/weekend boundary too. The guard uses it to set one
  timer, instead of polling.

The device clock decides. A user who changes the device clock can bypass
the schedule. The plan accepts this, because the aim is friction for one
user, not enforcement.

### Route guard

`src/app.jsx` renders three route trees (`PrimaryRoutes`,
`SecondaryRoutes`, and the status route) plus app-wide chrome
(`ComposeButton`, `Shortcuts`, `NavigationCommand`, `SearchCommand`,
`KeyboardShortcutsHelp`, `NotificationService`). In conversation mode,
`App` renders a separate tree instead of all of them:

- `/conversations`: the list.
- `/conversations/:instance/:id`: the thread view.
- Every other path: `<Navigate to="/conversations" replace />`.
- `<Modals />` stays, because the composer is a modal.
- `/` and `/welcome` show the welcome page to a device with no account.
- `/login` stays, so that a device with no account can log in. The
  Accounts sheet is not reachable, so an account flagged `authExpired` is
  renewed during a full-app window.

The hook `useConversationMode()` in `src/utils/useConversationMode.js`
holds the predicate in state. It sets one timer for `nextChange()`, and it
re-checks when the page becomes visible, because timers do not fire on a
sleeping device. When a window closes while the composer is open, the hook
stays in full-app mode until the composer closes. On entry to conversation
mode, `App` calls `hideAllModals()`, because a sheet left open from the
full app (settings, accounts, media) has links back into it.

Dev builds show the full app at any time, so that local work and the
existing Playwright specs do not depend on the clock. The localStorage key
`conversationModeOverride` set to `on` forces conversation mode, and
`schedule` follows `FULL_APP_WINDOWS`. Production builds ignore the key,
and the production bundle does not contain it.

The `compose/` pop-out entry uses its own HTML page and does not pass
through `App`. It needs no check: it renders only a composer, and its one
link goes to `/`, which passes through the guard. The share target
redirects to `/`, and the app then opens the composer with the shared
data. Neither path reaches the feed.

### Conversation list

`src/utils/conversation-group.js` (pure) exports
`groupConversations(sources)`, where each source is
`{ instance, notifications }`. It keeps public direct responses, groups
them by thread key, and returns one entry per thread:
`{ key, instance, threadId, latestAt, latestStatus, responseCount, accounts }`,
sorted by `latestAt` descending. `accounts` lists the people who
responded, newest first, once each. Mastodon delivers private mentions
(DMs) as `mention` notifications, so the grouping drops statuses with
`visibility: 'direct'`.

The thread key differs per network:

- **Bluesky**: the converter in `src/utils/bluesky/convert.js` sets
  `_threadRootId` from `record.reply.root`. A post with no `reply` field
  has no `_threadRootId` and falls through to the Mastodon rule.
- **Mastodon**: no field names the root. The key follows `inReplyToId`
  through the statuses in the batch and stops at the first post outside
  it. That post is usually the user's own post, which never arrives as a
  notification, so replies to the same post share a key. A mention that
  is not a reply is its own thread. Two replies whose chains meet only
  outside the batch appear as two rows. The thread view fetches the full
  context, so both rows open the same thread. To find the true root, the
  list must send one context request per row. Do not add these requests
  unless duplicate rows are common in practice.

`src/pages/conversations.jsx` fetches `types: ['mention']` notifications
from each merged source through `api({ account })`. For each source,
`walkUntilCutoff` from `src/utils/engagement-tally.js` pages back until
`CONVERSATION_DAYS` (7) or `PAGE_CAP` (5 pages of 40). A source that fails
is named in a notice, and the other sources still show. A row shows the
avatar and names of the people who responded, a network badge, the
relative time and up to three lines of the latest response. A row
contains no links.

The list does not apply `settings.notificationsResponsesOnly`. It always
uses direct responses.

### Thread view

`src/pages/conversation-thread.jsx` fetches
`masto.v1.statuses.$select(id).context.fetch()` through the client for the
row's instance. It renders ancestors, the focused post and descendants
with the existing `Status` component in `readOnly` mode, plus its own
reply, like and share-link buttons. Share link uses the system share sheet
(`navigator.share`) where it exists, and copies the post URL elsewhere.

An `InertLinks` wrapper controls every link inside the thread. It
handles `click` and `keydown` in the capture phase. For a link to a web
page in post text, it opens the URL in a new tab. For every other link
(profile, hashtag, mention, quoted post), it calls `preventDefault()`, and
CSS removes the link styling. Quoted posts render as their text only, with
no click target.

A new tab is outside this app. A Mastodon post URL opens that server's own
web interface, which has a feed. The plan accepts this, because leaving
the app is a deliberate act. A link back to this app passes through the
guard again.

### Push notifications

Mastodon accounts already have Web Push: `src/utils/push-notifications.js`
subscribes through the Mastodon push API, and `public/sw.js` shows the
notice. The Bluesky facade returns no push subscription, so Bluesky
accounts get no push notices. A Bluesky push path is not part of this
plan.

When the user taps a notice, the `notificationclick` handler in
`public/sw.js` opens `/#/notifications?id=<notification ID>&access_token=…`.
The worker knows the notification ID, not the post. In conversation mode,
the guard catches this route. It fetches the notification with the
account that matches the access token, then redirects to the conversation
thread of its status. If the fetch fails, it redirects to
`/conversations`. `public/sw.js` does not change.

Which notices arrive is set per subscription on the Mastodon server, in
the existing push settings. Those settings are reachable only during a
full-app window. To receive only conversation notices, set the
subscription to mentions only.

## Existing Patterns

- Merged fan-out, `_instance` labels and per-account clients: the
  notifications page and `src/pages/engagement.jsx`.
- Bounded backward walk with a page cap: `walkUntilCutoff` in
  `src/utils/engagement-tally.js`.
- Direct-response predicate: `isDirectResponse`.
- Pure helpers tested in Node, page verified in a browser: the
  engagement-tab plan.

## Implementation Phases

### Phase 1: Schedule and guard

Add `conversation-schedule.js` with tests, the `useConversationMode()`
hook, and the conversation-mode route tree in `app.jsx` with a placeholder
list page. `tests/conversation-mode.spec.js` checks the redirects, the
missing chrome, the logged-out case and the unchanged full app. Done when
that spec passes.

### Phase 2: List

The Bluesky `_threadRootId` field, `conversation-group.js` with tests, and
`conversations.jsx`. Done when the list shows real threads from both
networks.

### Phase 3: Thread view

Add `conversation-thread.jsx`, `InertLinks`, reply, like and share link.
Add the guard's mapping from `/notifications?id=` to the conversation
thread. Done when these conditions are true:

- A reply posts from the correct account on each network.
- No element in the thread navigates inside the app.
- A web link in post text opens in a new tab.
- A Mastodon mention notice opens its thread.

### Phase 4: Documentation

A "Conversation mode" section in `CLAUDE.md` with the schedule, the guard
and the invariants below. Run `npm run extract` and commit
`src/locales/en.po`.

## Invariants

- **The schedule is not a setting.** No UI changes it. A change is a
  code change and a deploy.
- **No path out.** In conversation mode, no rendered element navigates to
  a route outside the conversation tree, and every other route redirects.
- **No draft loss on the transition.** The guard never redirects while
  the composer is open.

## Open Questions

- **Recency**: is 7 days the right length for the list?
- **Notifications badge**: should conversation mode show a count of new
  direct responses, or should the list refresh only when the user opens
  it?
- **Bluesky push**: no evidence found of a push path that a third-party
  web client can use. Investigate separately if Bluesky notices matter.
- **Muted or blocked authors**: the notification APIs already drop these
  on Mastodon. Check that the Bluesky facade does the same.
