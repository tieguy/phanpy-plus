# Multi-Post Thread Composer Design

## Summary

This design extends the composer so a single post becomes one segment in an optional multi-post thread: a "+" button appends further segments, and hitting Post publishes the whole thread in one action instead of requiring the user to manually reply-chain posts themselves. Because the app can post from either a Mastodon or a Bluesky account (and can cross-post a thread to accounts on the other network), the thread must be built correctly under two very different posting models rather than one.

The core of the approach is a new network-agnostic entry point, `publishThread`, that each protocol implements according to its own capabilities: Bluesky supports atomic multi-record writes, so the client builds every post record locally (resolving text links, media, and per-segment link-card previews first), computes the content hashes and ordering IDs each record needs, and submits the entire thread as one all-or-nothing batch call. Mastodon has no such batch primitive, so segments are posted one at a time, each chained as a reply to the previous, with a retry-safe key attached to each so a network retry can't create a duplicate post. This same `publishThread` function backs both the primary post and cross-posting, replacing today's separate, duplicated cross-post code path. The implementation is staged bottom-up — unify the publish layer with no behavior change, extract shared Bluesky post-building logic, add Bluesky's atomic thread path, add Mastodon's chained path, then build the composer's thread UI, its partial-failure/retry UX, and finally thread-aware cross-posting.

## Definition of Done

From the composer, the user can tap a "+" button to add post segments, compose an N-post thread, and hit Post once. The result is a correctly-chained thread (each post a reply to the previous) on the active account's network, and — when cross-posting is enabled — the same thread rebuilt on the other network's account(s). Character counters respect the strictest limit across all target networks and show which network is the binding constraint. Partial failures (possible on Mastodon only) leave the composer open in a resumable state; Bluesky threads post atomically. Posting a single segment behaves exactly as posting does today.

## Glossary

- **AT Protocol (ATProto)**: The underlying decentralized protocol Bluesky is built on; posts, likes, and follows are all records in a user's personal data repository rather than rows in a central database.
- **`applyWrites`**: An AT Protocol API call (`com.atproto.repo.applyWrites`) that writes multiple records to a repository in a single all-or-nothing batch — the mechanism this design uses to post an entire thread atomically.
- **CID (Content Identifier)**: A hash that uniquely identifies a piece of content in AT Protocol (and IPFS-derived systems generally); each post record needs a correctly computed CID before it can be referenced by a reply.
- **TID (Timestamp Identifier)**: The record-key format AT Protocol uses for ordering; TIDs must increase monotonically, which is why thread posts need artificially incrementing timestamps when created in a single batch.
- **DAG-CBOR**: The binary data-encoding format AT Protocol records are serialized into before hashing; encoding quirks (e.g. no `undefined` values) can silently produce a wrong CID if not handled.
- **Facet**: Bluesky's mechanism for rich text — links, mentions, and hashtags are stored as byte-range annotations over plain text rather than inline markup.
- **Reply refs (root / parent)**: The pair of record references every Bluesky reply must carry — `parent` is the immediate post replied to, `root` is the first post in the thread — used to reconstruct correct threading.
- **Idempotency-Key**: An HTTP header Mastodon's API honors for a limited window so that retrying a failed request doesn't create a duplicate post.
- **Facade**: This codebase's adapter layer that exposes Bluesky's API through Mastodon-shaped (`masto.js`-style) method calls, so the rest of the app doesn't need to know which network it's talking to.
- **Cross-posting**: Publishing the same content from a primary account to other logged-in accounts on the other network in the same action.
- **Link card / unfurling**: The preview embed (title, image, description) generated for a URL in a post; on Bluesky this is built client-side by fetching metadata for the link before the post is submitted.
- **Vitest**: The unit-testing framework this design introduces (the repo currently has no test infrastructure).
- **IndexedDB**: The browser-based storage this app uses to persist in-progress drafts locally.

## Architecture

The composer gains a **thread of post segments**: the existing single draft becomes segment #1 of an array, and a "+" button appends additional segments. Each segment owns its text, media, poll, and character counter; thread-level settings (visibility, language, spoiler behavior, reply target) are shared. With one segment, the UI and behavior are unchanged.

On submit, publishing forks by network behind a single network-agnostic entry point (`publishThread`), per each protocol's best practice:

- **Bluesky:** atomic thread creation. A new facade method `masto.v1.statuses.createThread(paramsList)` builds all post records first (facets, media blobs, per-segment link cards — all resolved *before* hashing), computes CIDs and monotonic TIDs client-side, and submits one `com.atproto.repo.applyWrites`. All-or-nothing: the whole thread appears or nothing does. This matches the official Bluesky app's implementation.
- **Mastodon:** sequential chaining, the only mechanism the API offers. Post segment 1, take the returned id, set it as `in_reply_to_id` for segment 2, repeat. Each segment carries its own `Idempotency-Key` (composer UID + segment index) so retries within Mastodon's ~1-hour idempotency window cannot double-post.

Cross-posting reuses the same `publishThread` per target account, absorbing and replacing the current separate `crossPostStatus` path — a deliberate refactor of the current duplicated posting logic (two parallel param-building paths and twice-inlined eligibility rules in a ~270-line submit handler).

Key mechanics confirmed against AT Protocol sources:
- Reply refs: `reply: { root: {uri, cid}, parent: {uri, cid} }`; post #2 has root == parent == post #1; later posts keep root = post #1.
- `applyWrites` limits (200 writes, 1 MB) are far above the UI's 25-segment cap; rate limits (3 points per create, 5,000/hour) are a non-issue at thread scale.
- Silent-failure gotchas in client-side CID computation: `$type` must be present in the record before hashing; `undefined` fields must be stripped (DAG-CBOR has no undefined); TIDs must increment monotonically; `createdAt` must increment ≥1ms per post (identical timestamps cause undefined feed ordering).

### Failure behavior

- **Bluesky target:** one error, one retry, no cleanup (atomic). Link-card unfurling remains best-effort — card failure never blocks the thread.
- **Mastodon target:** partial failure possible. The composer keeps the thread open, marks posted segments locked/done, and Post becomes "Retry remaining", resuming the chain from the first unposted segment.
- **Cross-post targets:** per-target toast-and-continue, as today; a cross-post failure never rolls back networks that succeeded. Retry state is tracked per target so retry only re-attempts what's missing. Networks can be temporarily out of sync after a half-failure; this is surfaced, not hidden.
- **Validation before anything posts:** every segment non-empty and within the strictest active limit (300 when any Bluesky target is active; counter shows e.g. "287/300 · Bluesky").

### Contract: publish layer

```js
// src/utils/publish.js
// Publishes a 1..N-segment thread to ONE target account/instance.
async function publishThread({
  account,          // or instance — resolved via api()
  segments,         // [{ text, mediaAttachments, poll, uid }]
  shared,           // { visibility, language, spoilerText, sensitive,
                    //   inReplyToId, quotedStatusId }
  onProgress,       // (segmentIndex, status: 'posting'|'done'|'failed') => void
}) => {
  statuses,         // Mastodon-shaped statuses actually created, in order
  failedAtIndex,    // null, or index of first unposted segment (Mastodon only)
  skippedMedia,     // media skipped for this target (e.g. video → Bluesky)
}

function canCrossPost(shared) // single eligibility predicate:
                              // no poll, no schedule, public/unlisted only
```

```js
// src/utils/bluesky/client.js (facade addition)
// paramsList: same masto-shaped params as statuses.create, one per segment.
// Returns Mastodon-shaped statuses (locally constructed — applyWrites
// returns no post views). Throws as a unit; never partially posts.
masto.v1.statuses.createThread(paramsList)
```

## Existing Patterns

Investigation (`compose.jsx`, `src/utils/bluesky/`) found:

- **Facade symmetry** — the whole fork rests on Bluesky accounts being reachable through masto-shaped calls (`src/utils/bluesky/client.js`). `createThread` extends the facade rather than letting AT Protocol details leak into the composer. The facade already converts `in_reply_to_id` into correct root/parent reply refs (client.js:729-736); `createThread` computes refs locally instead, per the atomic path.
- **Lazy-loading** — `@atproto/api` is dynamically imported so Mastodon-only users don't pay for it. The new CID/TID dependencies (`@ipld/dag-cbor`, sha256) follow the same pattern in `src/utils/bluesky/thread-writes.js`.
- **Idempotency keys** — compose.jsx:1511-1521 already sends `Idempotency-Key: UID.current` with fallback; the sequential chain extends this to UID + segment index.
- **Divergence (deliberate):** the current cross-post path (`src/utils/bluesky/cross-post.js` + inlined eligibility conditionals at compose.jsx:1523-1569) duplicates the primary posting path. This design deletes `cross-post.js` and unifies both paths in `src/utils/publish.js`; a single post is a one-segment thread.

Test infrastructure: Vitest unit tests exist (`npm run test:unit`, `src/utils/*.test.js` — e.g. `notification-filter.test.js`) alongside Playwright E2E; new unit tests follow the sibling-file `*.test.js` pattern. (An earlier draft of this document incorrectly said no test infrastructure existed. See LUI-149 for the broader coverage effort.)

## Implementation Phases

### Phase 1: Publish layer refactor (no behavior change)
**Goal:** One posting path for primary and cross-post targets, single posts only.

**Components:**
- `src/utils/publish.js` — `publishThread` (single-segment support), `canCrossPost`; absorbs media re-upload / skip rules from `cross-post.js`
- `src/components/compose.jsx` — submit handler slimmed to call `publishThread` for primary target and each cross-post account; delete `src/utils/bluesky/cross-post.js`

**Dependencies:** none.

**Done when:** build passes; single posts, replies, quotes, edits, and cross-posts verified unchanged on the test deploy (both networks).

### Phase 2: Bluesky record builder extraction
**Goal:** Shared record-building so single posts and threads can never diverge.

**Components:**
- `src/utils/bluesky/client.js` — extract `buildPostRecord()` (text→facets, media embeds, link card via `link-card.js`) from `createStatus`; `createStatus` re-implemented on top of it

**Dependencies:** none (parallel to Phase 1).

**Done when:** build passes; single Bluesky posts with media, links (card generated), and replies verified unchanged.

### Phase 3: Bluesky atomic thread creation
**Goal:** `createThread` posts an N-segment thread in one `applyWrites`.

**Components:**
- `src/utils/bluesky/thread-writes.js` — lazy-loaded CID computation (DAG-CBOR + SHA-256 → CIDv1) and monotonic TID generation; new deps `@ipld/dag-cbor`, sha256 implementation, declared explicitly
- `src/utils/bluesky/client.js` — `masto.v1.statuses.createThread(paramsList)`: build all records via `buildPostRecord`, resolve facets/cards pre-hash, stamp `createdAt` +1ms per segment, chain reply refs, submit `applyWrites`, construct Mastodon-shaped statuses locally
- Unit tests as sibling `*.test.js` files, run with the existing `npm run test:unit` (Vitest)

**Dependencies:** Phase 2.

**Done when:** unit tests pass covering the CID/TID gotchas (known record → known CID; `$type` present; `undefined` stripped; monotonic TIDs; `createdAt` increments); a 3-post thread with media and a link posts atomically to a real Bluesky account and renders as a thread.

### Phase 4: Mastodon sequential chaining
**Goal:** `publishThread` handles N segments on Mastodon with resumable partial failure.

**Components:**
- `src/utils/publish.js` — sequential loop: per-segment `in_reply_to_id` chaining, per-segment idempotency keys, `failedAtIndex` reporting, resume-from-index support; Bluesky branch delegates to `createThread`

**Dependencies:** Phases 1, 3.

**Done when:** unit tests (mocked client) pass for chaining order, idempotency keys, failure index, and resume re-entering the chain correctly; a 3-post thread verified on a real Mastodon account.

### Phase 5: Composer thread UI
**Goal:** Compose and post threads from the UI.

**Components:**
- `src/components/compose.jsx` — `segments[]` state (segment #1 = today's draft), "+" button after last segment, stacked segment editors with per-segment media/poll/counters, strictest-active-limit counter with network indicator, 25-segment cap, middle-segment delete closes the gap, Ctrl/Cmd+Enter still posts the thread, schedule disabled at 2+ segments
- Draft persistence — IndexedDB draft shape gains the segments array; old single-status drafts load as one-segment threads

**Dependencies:** Phase 4.

**Done when:** a thread composed in the UI posts correctly to whichever network the active account is on; saved multi-segment drafts restore; pre-existing single drafts still load.

### Phase 6: Partial-failure UX
**Goal:** Surface and recover from Mastodon mid-thread failures.

**Components:**
- `src/components/compose.jsx` — per-segment progress ("Posting 2/3…"), posted segments locked with ✓, Post → "Retry remaining" resuming from `failedAtIndex`; publishing state kept in `states.composerState`

**Dependencies:** Phase 5.

**Done when:** a simulated mid-thread network failure leaves the composer resumable and retry completes the chain without duplicates (idempotency verified by double-firing a retry).

### Phase 7: Cross-posted threads
**Goal:** Full-thread cross-posting to other-network accounts.

**Components:**
- `src/components/compose.jsx` — cross-post loop calls `publishThread` per target with per-target progress/toasts and per-target retry tracking; `canCrossPost` gates the UI toggle and submit path; counter binds to strictest limit across primary + enabled cross-post targets
- `CLAUDE.md` / `README.md` — document the thread feature and publish-layer refactor

**Dependencies:** Phase 6.

**Done when:** a 3-post thread cross-posts end-to-end (Mastodon-primary → Bluesky and vice versa); a cross-post failure leaves the primary thread intact with a per-target retry; docs updated.

## Additional Considerations

**Out of scope for this pass:** auto-splitting overflowing text into segments; scheduled threads (Mastodon `scheduled_at` cannot chain to an unposted parent); editing a posted thread as a unit; polls in cross-posted threads (polls already block cross-posting).

**Link cards:** applied per-segment (each segment's first link), matching single-post behavior; unfurl failures never block posting. With `applyWrites`, unfurling moves *before* the batch submit, so the whole thread waits on (still best-effort) card fetches.

**Thread rendering:** posted threads are ordinary reply chains; existing self-thread rendering (`_threadifyStatus` in `src/utils/states.js`) displays them with no changes.

**Bundle size:** all new Bluesky-only code and dependencies stay behind dynamic imports, preserving the fork's Mastodon-only zero-cost property.
