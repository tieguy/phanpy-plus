# Multi-Post Threads Implementation Plan — Phase 2: Bluesky Record Builder Extraction

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Extract record-building from `createStatus` so single posts and threads share one code path — no behavior change.

**Architecture:** `src/utils/bluesky/client.js`'s `createStatus` (lines 692–816, verified 2026-08-10) is split into `buildPostRecord(params)` (text/CW → facets → embeds → link card) and `buildReplyRefs(inReplyToId)`, with `createStatus` recomposed on top.

**Tech Stack:** `@atproto/api` (lazy-loaded via `loadAtproto()`, client.js:37–40).

**Scope:** Phase 2 of 7 from `docs/design-plans/2026-08-09-multi-post-threads.md`.

**Codebase verified:** 2026-08-10.

---

### Task 1: Extract `buildReplyRefs` and `buildPostRecord` in client.js

**Files:**
- Modify: `src/utils/bluesky/client.js:692–816` (`createStatus`)

**Step 1: Read the current `createStatus`**

Read `src/utils/bluesky/client.js` lines 685–820 in full before editing. Its verified internal order (line refs ±2 — trust the file):
1. ~693: `await ready()`; validation rejecting `poll` and `scheduled_at` (throws)
2. ~712–726: fullText with CW/spoiler prefix; `RichText` from `loadAtproto()` (~717); `detectFacets(agent)`; record `{ text, facets, createdAt, langs, labels }`
3. ~733–741: reply refs from `in_reply_to_id` (idToAtUri → fetchPost → `{ root, parent }`)
4. ~743–777: embeds — images from `pendingMedia` by `media_ids`; quote record embed from `quoted_status_id`
5. ~783–789: link card — `firstLinkFacetUri(rt.facets)` → `buildExternalEmbed(agent, url)` → `record.embed` (only when no other embed; best-effort)
6. ~792: `await agent.post(record)`; `pendingMedia.delete(...)` cleanup for consumed media ids; `cids.set(res.uri, res.cid)` (~795, `cids` map declared ~192)
7. ~797–815: return Mastodon-shaped status (refresh from server; local fallback passes `cid: res.cid` into `postToStatus`)

**Step 2: Perform the extraction**

This is a *move*, not a rewrite — lift the existing statements into two new functions placed directly above `createStatus`, preserving every behavior detail (CW prefix format, embed precedence, best-effort try/catch around the link card):

```js
// Builds the reply refs for a post replying to inReplyToId (a masto-shaped
// bluesky id). Used by createStatus and (Phase 3) createThread.
async function buildReplyRefs(inReplyToId) {
  // ← move the existing lines 734–740 body here, returning the
  //   { root: rootRef, parent: parentRef } object instead of assigning
  //   record.reply
}

// Builds a complete app.bsky.feed.post record from masto-shaped params —
// everything EXCEPT reply refs (callers attach those). Shared by
// createStatus and (Phase 3) createThread.
async function buildPostRecord(params) {
  // ← move steps 1, 2, 4, 5 here (validation, text/facets, media & quote
  //   embeds, link card). Return the record object.
  // Add `$type: 'app.bsky.feed.post'` as the record's first property:
  // agent.post() tolerates it, and Phase 3's CID computation REQUIRES it.
}

async function createStatus(params) {
  const record = await buildPostRecord(params);
  if (params.in_reply_to_id) {
    record.reply = await buildReplyRefs(params.in_reply_to_id);
  }
  // ← existing steps 6–7 unchanged (agent.post + Mastodon-shaped return)
}
```

Watch for closures: the moved code references `agent`, `pendingMedia`, `idToAtUri`, `fetchPost`, `firstLinkFacetUri`, `buildExternalEmbed`, and `loadAtproto` — all already module-scope in client.js, so the move is safe. If the existing code computes `rt` (RichText) and later uses `rt.facets` for the link card, keep that flow inside `buildPostRecord`.

While extracting step 7, extract the Mastodon-shaped return logic as `async function toReturnedStatus(uri, cid, record)` — the **cid parameter is required**: the current local-fallback branch passes `cid: res.cid` into `postToStatus`, and Phase 3's `createThread` will pass its locally/server-computed CID per post. The helper must also perform the bookkeeping the current success path does: `cids.set(uri, cid)` and (if currently inside this region) the `pendingMedia.delete(...)` cleanup for consumed media ids — if `pendingMedia.delete` happens outside the extracted region, leave it in `createStatus` and note that `createThread` (Phase 3) must replicate it. `createStatus` calls `toReturnedStatus(res.uri, res.cid, record)` with the values from `agent.post`'s response. Match whatever the current code actually does; do not invent a new shape.

**Step 3: Verify**

Run: `npm run build`
Expected: success.

Run: `npm run test:unit`
Expected: all pass.

Run: `git diff --stat` and re-read the new `createStatus` — confirm it is a pure recomposition (no dropped validation, no reordered embed precedence, `$type` added).

**Step 4: Commit**

```bash
npx oxfmt src/utils/bluesky/client.js
git add src/utils/bluesky/client.js
git commit -m "refactor: extract buildPostRecord/buildReplyRefs from createStatus"
git push
```

**Phase done when:** build + unit tests pass and `createStatus` is recomposed from the two new helpers with `$type` on the record. Live smoke (single Bluesky post with media + link card + reply) DEFERRED to morning checklist.

---

### Accepted deviation (review cycle 1)

Reply-ref resolution (`buildReplyRefs`' parent post fetch) now executes *after* embed and link-card construction — the recomposed `createStatus` runs `buildPostRecord` (which includes quote-CID resolution and the CardyB unfurl + thumbnail `uploadBlob`) before attaching reply refs. In the original code, reply refs were resolved *before* the embed block, so a failed parent fetch aborted early.

**Success path:** Bit-identical. Reply refs and embeds/link-card are independent keys; ordering has zero impact on the posted record's shape or content.

**Failure path (the actual delta):** A reply whose parent fetch fails (deleted/blocked parent) now throws *after* the link-card unfurl and thumbnail blob upload have already run — costing extra round trips and leaving an orphaned (PDS-garbage-collected) thumbnail blob, where the old order failed fast before any of that.

**Justification for accepting:** Restoring the original order isn't free — hoisting `buildReplyRefs` above `buildPostRecord` in `createStatus` would move the `poll`/`scheduled_at` validation throws *after* a network fetch, trading one ordering fidelity for another. Failed-parent replies are rare, the orphaned blob is server-GC'd, and keeping validation-first inside `buildPostRecord` is the more valuable property. Consciously accepted.
