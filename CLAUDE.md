# fleeting-social — developer notes

Last verified: 2026-09-10

fleeting-social is a fork of [Phanpy](https://github.com/cheeaun/phanpy) (a Mastodon web client) that adds native Bluesky (AT Protocol) support and interweaves the two networks. Most of the codebase is stock Phanpy; the fork-specific machinery lives under `src/utils/bluesky/` plus a handful of merge/filter helpers.

For the product goal and the user-facing feature list, see [`README.md`](README.md). This file is for how the Bluesky half is built.

## Bluesky support architecture

A small adapter layer (`src/utils/bluesky/`) wraps [`@atproto/api`](https://github.com/bluesky-social/atproto/tree/main/packages/api) and converts Bluesky posts/profiles/notifications into Mastodon-shaped objects, exposing a **masto.js-compatible facade**. The rest of the app doesn't know the difference — which is exactly why a Bluesky account can be merged in as an equal peer rather than living in a separate mode.

- `src/utils/bluesky/convert.js` — pure converters from AT Protocol shapes to Mastodon shapes (`postToStatus`, `profileToAccount`, `notificationToMasto`, `textToHTML`, etc.).
- `src/utils/bluesky/client.js` — the `masto`-compatible facade: `masto.v1.*` / `masto.v2.*` methods backed by an `@atproto/api` agent.
- `src/utils/bluesky/index.js` — account plumbing: `blueskyApi(account)`, `getOtherNetworkAccounts()`, `getBlueskyAccounts()`, `hasMultipleNetworks()`.
- `src/utils/bluesky/link-card.js` — outgoing **link cards**. Bluesky (unlike Mastodon) unfurls links client-side, so `createStatus` builds the `app.bsky.embed.external` embed itself: `linkFacetUris` lists the post's link facets, `buildExternalEmbed` unfurls one via Bluesky's hosted CardyB service (`cardyb.bsky.app`) and uploads the thumbnail blob. It's **best-effort** (any failure just posts without a card) and only fires when the post has no other embed — an external card can't coexist with images/quote in the same slot.
- `src/utils/bluesky/quote-link.js` — a pasted **bsky.app post URL becomes a native quote**, not a link card. `parseBskyPostUrl` / `firstQuotedPostLink` recognise the URL in the facets; `quoteEmbedFromLinks` in `client.js` resolves it to an AT-URI + CID and emits `app.bsky.embed.record`, which takes the embed slot before the link-card path sees it. This distinction is load-bearing: only a `record` embed increments the target's `quoteCount` and puts the post in its quote list, so a post URL sent as an external card is a quote that renders like one and that the network cannot see. Resolution is best-effort — an unresolvable URL falls through to the link card. The URL stays in the post text, matching the link-card path.
- `src/utils/api.js` — `api()` resolves the current account to either the Bluesky facade or a real Mastodon client. Passing `api({ account })` yields a per-account client, which is what the merge paths use.

`@atproto/api` is **lazy-loaded**, so Mastodon-only users don't pay the bundle cost.

The facade deliberately over-loads some Mastodon concepts. `v1.statuses.$select(id).quotes.list()` — Mastodon's own quotes endpoint, API v7+ — is backed by `app.bsky.feed.getQuotes` and, like masto.js, yields **statuses** rather than accounts (unlike the sibling `favouritedBy` / `rebloggedBy` listings). `v1.lists.list()` returns not only the user's Bluesky lists but also their subscribed **feed generators**, shaped as lists and tagged `_feed`. Per-list metadata and timeline calls branch on the AT-URI collection (`app.bsky.feed.generator` → `getFeedGenerator`/`getFeed`; `app.bsky.graph.list` → `getList`/`getListFeed`). Consumers must treat `_feed` entries as read-only — no edit / manage-members — see `src/pages/lists.jsx` and `src/pages/list.jsx`.

### Publishing and threading

**Single publish path:** `src/utils/publish.js` — `publishThread({ account, segments, shared, ... })` is the unified entry point for posts, replies, threads, and cross-posts (it absorbed and replaced the old `bluesky/cross-post.js`). A single-segment thread is a post; multi-segment is a thread. `canCrossPost({ poll, scheduledAt, visibility })` is the sole eligibility predicate (no polls, no scheduling, no visibility beyond public/unlisted). Cross-post targets re-upload media from `mediaAttachments.fileData`; the primary post's own media is already uploaded by the composer, but segments 2+ of a primary thread also re-upload via `resolveMediaIds`.

**Atomic Bluesky threads:** the facade's `masto.v1.statuses.createThread(paramsList)` (`src/utils/bluesky/client.js`) commits a whole thread in one `applyWrites` — all-or-nothing, so failure needs no resume bookkeeping (zero statuses, `failedAtIndex` = `startAt`). It builds each post's URI/CID client-side via `src/utils/bluesky/thread-writes.js` (`prepareForHashing`, `computeCid`, `nextTid`, `buildThreadWrites`; lazy-loaded) so later posts can reference earlier ones before the server replies. Silent-failure gotchas: `$type` must be set before hashing and undefined properties stripped, or the computed CID diverges from the server's; `nextTid()` chains from the previous TID so ordering holds **even for same-millisecond calls**; and `createdAt` advances +1ms per post because identical timestamps give undefined feed ordering (atproto issue #3027).

**Sequential Mastodon chains:** each segment posts as a reply to the previous, with per-segment idempotency keys (`prefix`, `prefix-1`, …) that stay index-stable across retries. On partial failure `publishThread` returns `{ statuses, failedAtIndex, error, skippedMedia }`; `compose.jsx` records the posted statuses in `threadPublishState`, locks them in the UI, and offers "Retry remaining", resuming via the `startAt` / `resumeInReplyToId` **inputs**. It also deletes the on-disk draft at that moment — the draft has no record of which segments posted, so restoring it after a reload would republish the thread from zero.

**Contract detail — do not revert:** `visibility` and `sensitiveMedia` are read from React state in `compose.jsx`, never from FormData. Their controls are `disabled` while retrying a partially-posted thread, and disabled controls drop out of FormData, which silently changed the remaining segments' visibility mid-thread. `src/utils/compose-counting.js` holds the pure counting/validation helpers (`countableText`, `segmentCharCount`, `shouldEnforceCharLimit`, `getSegmentCharCount`, `validateSegments`); `compose.jsx` calls `shouldEnforceCharLimit` to decide whether client-side limits apply at all — single posts within the primary instance's own limit deliberately let the backend validate.

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

## Quote without attribution

A third quote action in both boost/quote menus (action bar and kebab, `src/components/status.jsx`) shares a post's text as a PNG card with the author redacted, attached to a new post with alt text prefilled. Three layers under `src/utils/`:

- `post-card-model.js` (pure) — `buildCardModel(status)` turns a Mastodon-shaped status (Bluesky posts already arrive in this shape) into card content: content warning, plain-text paragraphs via `getHTMLText`, an omitted-content note (`[2 images not shown]`, `[poll not shown]`, `[quoted post not shown]`, `[link preview not shown]`), and alt text capped at the composer's 1500-char `descriptionLimit`. Its test runs under `// @vitest-environment happy-dom` because `getHTMLText` needs a DOM.
- `post-card-layout.js` (pure) — `layoutCard(model, measureText, opts)` wraps the content into positioned lines (word wrap, hard break for over-wide tokens, paragraph gaps, a line cap with a trailing `[…]` line). The measurer is injected so the layout is unit-tested in Node.
- `post-card-render.js` (browser only, lazy-imported) — `renderCardBlob(status)` draws the layout on a 2x Canvas 2D surface and resolves `{ blob, altText, truncated }`. `post-card-attachment.js` wraps that blob in the composer's attachment shape; the composer's existing `draftStatus` restore path attaches it.

Two invariants, both load-bearing:

- **No remote resources.** Avatar and name are gray placeholders, post media is omitted, and custom emoji stay as `:shortcode:` text, so the canvas never loads a cross-origin image and never taints; `toBlob` keeps working and the strict CSP needs no allowance. A DOM screenshot (html2canvas and kin) was rejected for exactly those two failures.
- **No original-post identifiers.** Nothing derived from the original's URL, ID, handle, display name, avatar, or timestamp is drawn or attached, so the new post cannot be traced through the network and does not notify the author. @-mentions inside the body are kept verbatim by decision.

On a post the user cannot boost (`!canBoost`), the action is unreachable on both surfaces, by code reading on 2026-09-10 (not yet checked in a browser): the action-bar rocket `StatusButton` itself carries `disabled={!canBoost}` and is the menu's trigger, so the menu never opens; the kebab's Boost entry is a `SubMenu` with `disabled` forwarded, so its submenu does not open.

## Service worker: stale app shell recovery

`public/sw.js` is otherwise upstream Phanpy's file verbatim; the one fork
addition is a recovery path for a cached app shell that outlived its bundles.
The failure it removes: `pageCache()` is NetworkFirst, so a slow navigation is
answered from the `pages` cache; the host serves only the newest deploy, so a
hashed bundle named by an older cached `index.html` 404s as `text/html`; and a
browser silently refuses to run a `type="module"` script with that content
type. The page goes blank and cannot repair itself, because its own scripts are
what failed to load — and the strict CSP rules out an inline bootstrap script.

So the repair lives in the worker. `StaleShellRecoveryPlugin` on the assets
route calls into `src/utils/sw-shell-recovery.js`, which deletes the `pages`
cache and reloads the window clients via `client.navigate()`.

Three invariants, all load-bearing:

- **Only a 404/410 triggers a repair, never a network error.** Offline is the
  case the cache exists to serve; repairing on any failed request would delete
  the app shell every time the user loses signal.
- **Only a cache *miss* triggers a repair.** StaleWhileRevalidate reaches the
  network twice over — to fill a miss, and to revalidate a hit in the
  background. A 404 on the revalidation of a bundle still held locally is
  expected once its deploy is gone, and the page is running fine off that
  cached copy; reloading there would interrupt for nothing and discard an
  in-progress compose draft. This case gets commoner as `maxHashes` rises.
- **A repair timestamp is persisted in the Cache API**, not in memory. A worker
  has no localStorage and can be terminated between events, and a repair
  triggers a reload — so without a durable cooldown a repair that does not fix
  the page would reload forever.

Unit tests cover the decision logic, but the failure itself lives in service
worker state, so it is verified in a browser instead:
`node scripts/verify-sw-recovery.mjs` against a production build drives the real
worker through the whole sequence. Run it after changing either file.

`maxHashes` on the `assets` cache and that cache's `maxEntries` move together:
a build emits ~24 hashed JS and CSS files, so an entry cap below roughly
`maxHashes × 24` lets LRU eviction discard old hashes before `AssetHashPlugin`
counts them, and `maxHashes` stops meaning anything.

## Naming

The project was renamed from `phanpy-plus` to `fleeting-social`. As of this rename the change is **README + docs only** — `package.json`, the git repo/remote, deploy config, and in-code strings still say `phanpy`/`phanpy-plus` and are a separate pass.
