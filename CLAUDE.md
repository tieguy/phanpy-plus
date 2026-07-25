# fleeting-social — developer notes

Last verified: 2026-07-25

fleeting-social is a fork of [Phanpy](https://github.com/cheeaun/phanpy) (a Mastodon web client) that adds native Bluesky (AT Protocol) support and interweaves the two networks. Most of the codebase is stock Phanpy; the fork-specific machinery lives under `src/utils/bluesky/` plus a handful of merge/filter helpers.

For the product goal and the user-facing feature list, see [`README.md`](README.md). This file is for how the Bluesky half is built.

## Bluesky support architecture

A small adapter layer (`src/utils/bluesky/`) wraps [`@atproto/api`](https://github.com/bluesky-social/atproto/tree/main/packages/api) and converts Bluesky posts/profiles/notifications into Mastodon-shaped objects, exposing a **masto.js-compatible facade**. The rest of the app doesn't know the difference — which is exactly why a Bluesky account can be merged in as an equal peer rather than living in a separate mode.

- `src/utils/bluesky/convert.js` — pure converters from AT Protocol shapes to Mastodon shapes (`postToStatus`, `profileToAccount`, `notificationToMasto`, `textToHTML`, etc.).
- `src/utils/bluesky/client.js` — the `masto`-compatible facade: `masto.v1.*` / `masto.v2.*` methods backed by an `@atproto/api` agent.
- `src/utils/bluesky/index.js` — account plumbing: `blueskyApi(account)`, `getOtherNetworkAccounts()`, `getBlueskyAccounts()`, `hasMultipleNetworks()`.
- `src/utils/bluesky/link-card.js` — outgoing **link cards**. Bluesky (unlike Mastodon) unfurls links client-side, so `createStatus` builds the `app.bsky.embed.external` embed itself: `firstLinkFacetUri` finds the first link facet, `buildExternalEmbed` unfurls it via Bluesky's hosted CardyB service (`cardyb.bsky.app`) and uploads the thumbnail blob. It's **best-effort** (any failure just posts without a card) and only fires when the post has no other embed — an external card can't coexist with images/quote in the same slot.
- `src/utils/api.js` — `api()` resolves the current account to either the Bluesky facade or a real Mastodon client. Passing `api({ account })` yields a per-account client, which is what the merge paths use.

`@atproto/api` is **lazy-loaded**, so Mastodon-only users don't pay the bundle cost.

The facade deliberately over-loads some Mastodon concepts. `v1.lists.list()` returns not only the user's Bluesky lists but also their subscribed **feed generators**, shaped as lists and tagged `_feed`. Per-list metadata and timeline calls branch on the AT-URI collection (`app.bsky.feed.generator` → `getFeedGenerator`/`getFeed`; `app.bsky.graph.list` → `getList`/`getListFeed`). Consumers must treat `_feed` entries as read-only — no edit / manage-members — see `src/pages/lists.jsx` and `src/pages/list.jsx`.

### Interweaving (merged timeline + notifications)

The "one home" experience is a chronological k-way merge across the current account plus every logged-in account on the *other* network, gated on the `settings.mergedTimeline` setting (default on).

- `src/utils/merged-timeline.js` — `createMergedTimelineIterator(sources)` merges multiple paginators by `createdAt`, stamping each item with `_instance`.
- `src/pages/following.jsx` — merged **home timeline**; the `states.reloadFollowing` counter is a bump-to-refetch signal (consumed as its `refresh` prop) that forces a reload, e.g. after the main-character mute in `src/components/main-character-banner.jsx`.
- `src/pages/notifications.jsx` — merged **notifications** page.
- `src/pages/home.jsx` (`NotificationsMenu`) — the bell-dropdown, which uses the same merge.

**Notification filtering.** `settings.notificationsResponsesOnly` (default on) trims notifications to "direct responses" — replies and mentions only. `src/utils/notification-filter.js`'s `isDirectResponse` (keeps the Mastodon-shaped `mention` type) is applied at all three surfaces: the page, the bell-dropdown, and the bell **badge** in `src/components/background-service.jsx` (which fetches a batch and filters, rather than reacting to the single latest notification). For this to distinguish quotes from replies, `notificationToMasto` maps a Bluesky `quote` reason to the native `quote` type (not `mention`). Caveat: the badge check is single-account (current account only), a pre-existing limitation.

When adding a feature that fetches per-account data, remember that the current account may be Bluesky *or* Mastodon, and that merged views fan out over both — thread per-account clients through `api({ account })` and label results with `_instance`. This fan-out already backs timelines, notifications, DMs, lists, and search.

The same routing rule applies to **per-profile actions** (follow / mute / block, and the relationship load that gates their UI): send them to a client on the *target profile's* network — detected via the converter's `info._bluesky` flag — not the currently-active account, which may be on the other network. See `src/components/related-actions.jsx`, which resolves an acting client by the profile's network rather than by instance-string matching. Correspondingly, the Bluesky facade's account actions return a *full* relationship object (they re-read the profile and apply the change), because callers replace their entire relationship state with the return value — a partial object would wipe the other flags.

**Mentions follow the same network rule.** A @-mention only links and notifies when posted from an account on the *mentioned profile's* network — a Bluesky handle is inert in a Mastodon post and vice-versa. `src/utils/mention-network.js`'s `getMentionInstance` picks an account on the target's network (or `null` if there is none), which the mention entry points (`related-actions.jsx`, `account-statuses.jsx`) pass into the composer as `draftStatus._instance`; `compose.jsx` posts from that instance. When it returns `null`, the mention affordance is hidden rather than producing a dead mention.

## Naming

The project was renamed from `phanpy-plus` to `fleeting-social`. As of this rename the change is **README + docs only** — `package.json`, the git repo/remote, deploy config, and in-code strings still say `phanpy`/`phanpy-plus` and are a separate pass.
