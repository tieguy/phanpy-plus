# Multi-Post Threads Implementation Plan — Phase 3: Bluesky Atomic Thread Creation

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** `masto.v1.statuses.createThread(paramsList)` posts an N-post thread in one atomic `applyWrites`.

**Architecture:** New lazy-loaded `src/utils/bluesky/thread-writes.js` provides client-side CID computation (DAG-CBOR + SHA-256 → CIDv1) and monotonic TIDs, mirroring the official social-app implementation (`src/lib/api/index.ts@51401e4c`). `createThread` in client.js builds records via Phase 2's `buildPostRecord`, chains reply refs with locally-computed CIDs, and submits one `com.atproto.repo.applyWrites` with `validate: true`.

**Tech Stack:** `@ipld/dag-cbor` (new dep), `multiformats` + `@atproto/common-web` (already transitive via `@atproto/api@0.20.27` — verified `npm ls`: common-web@0.5.5, multiformats@13.4.2; promote to direct deps). NOT needed: `js-sha256` (social-app uses it for sync hashing; we use async `multiformats/hashes/sha2` → WebCrypto).

**Scope:** Phase 3 of 7 from `docs/design-plans/2026-08-09-multi-post-threads.md`.

**Codebase verified:** 2026-08-10.

---

### Task 1: Add dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

**Step 1: Install**

```bash
npm install @ipld/dag-cbor@^9.2.7 @atproto/common-web@^0.5.5 multiformats@^13.4.2
```

**Step 2: Verify dedupe**

Run: `npm ls @atproto/common-web multiformats @ipld/dag-cbor`
Expected: single version of each (common-web 0.5.x and multiformats 13.4.x deduped with @atproto/api's copies; dag-cbor 9.2.x new).

**Step 3: Verify build unaffected**

Run: `npm run build`
Expected: success. Then run `npm run build:sizes` (script exists) and note the main-bundle size — it must not grow materially now (nothing imports the new deps yet) and should be re-checked the same way after Task 3 (they must stay behind dynamic `import()`).

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @ipld/dag-cbor; promote common-web + multiformats to direct deps"
git push
```

---

### Task 2: Create `thread-writes.js` with tests

**Files:**
- Create: `src/utils/bluesky/thread-writes.js`
- Test: `src/utils/bluesky/thread-writes.test.js`

**Step 1: Write the failing tests**

Testing gotchas that fail *silently* in production (wrong CID → posts vanish). We use deterministic/differential assertions rather than golden CIDs (no authoritative vector to copy without risking a wrong fixture). Follow the repo's existing sibling-`*.test.js` Vitest pattern (cf. `src/utils/notification-filter.test.js`).

```js
import { describe, expect, it } from 'vitest';

import { computeCid, nextTid, prepareForHashing } from './thread-writes';

const record = {
  $type: 'app.bsky.feed.post',
  text: 'hello world',
  createdAt: '2026-08-10T00:00:00.000Z',
  langs: ['en'],
};

describe('computeCid', () => {
  it('is deterministic', async () => {
    expect(await computeCid(record)).toBe(await computeCid({ ...record }));
  });

  it('produces a CIDv1 dag-cbor string', async () => {
    // base32 CIDv1 + dag-cbor (0x71) + sha2-256 → "bafyrei…"
    expect(await computeCid(record)).toMatch(/^bafyrei[a-z2-7]+$/);
  });

  it('changes when the record changes', async () => {
    expect(await computeCid(record)).not.toBe(
      await computeCid({ ...record, text: 'hello world!' }),
    );
  });

  it('is sensitive to $type presence', async () => {
    const { $type, ...withoutType } = record;
    expect(await computeCid(record)).not.toBe(await computeCid(withoutType));
  });

  it('ignores undefined fields (DAG-CBOR has no undefined)', async () => {
    expect(await computeCid({ ...record, embed: undefined })).toBe(
      await computeCid(record),
    );
  });
});

describe('prepareForHashing', () => {
  it('strips undefined recursively', () => {
    expect(
      prepareForHashing({ a: 1, b: undefined, c: { d: undefined, e: [1] } }),
    ).toEqual({ a: 1, c: { e: [1] } });
  });

  it('converts BlobRef-like objects via ipld()', () => {
    const blobRef = {
      ipld: () => ({ $type: 'blob', mimeType: 'image/jpeg' }),
    };
    expect(prepareForHashing({ image: blobRef })).toEqual({
      image: { $type: 'blob', mimeType: 'image/jpeg' },
    });
  });

  it('passes real multiformats CID instances through untouched', async () => {
    // A real BlobRef.ipld() contains a live CID in its ref field — that
    // instance must survive prepareForHashing so dag-cbor can encode it
    // natively (tag 42), and computeCid must accept records containing it.
    const { CID } = await import('multiformats/cid');
    const { sha256 } = await import('multiformats/hashes/sha2');
    const cid = CID.createV1(0x71, await sha256.digest(new Uint8Array([1])));
    expect(prepareForHashing({ ref: cid }).ref).toBe(cid);
    const withBlob = {
      ...record,
      embed: { $type: 'app.bsky.embed.images', ref: cid },
    };
    expect(await computeCid(withBlob)).toBe(await computeCid({ ...withBlob }));
    expect(await computeCid(withBlob)).not.toBe(await computeCid(record));
  });
});

describe('nextTid', () => {
  it('returns 13-char TIDs that strictly increase', async () => {
    const a = await nextTid();
    const b = await nextTid();
    const c = await nextTid();
    for (const tid of [a, b, c]) {
      expect(tid).toMatch(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
    }
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/bluesky/thread-writes.test.js`
Expected: FAIL — module doesn't exist.

**Step 3: Write the implementation**

```js
// Client-side helpers for atomic Bluesky thread creation via applyWrites.
// Mirrors the official social-app implementation (src/lib/api/index.ts):
// records are DAG-CBOR-encoded, SHA-256-hashed, wrapped as CIDv1 (0x71),
// so reply refs can reference posts that don't exist server-side yet.
//
// Everything here is only ever reached from the lazy-loaded Bluesky path,
// and @ipld/dag-cbor is itself dynamically imported — Mastodon-only users
// pay no bundle cost.
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

const DAG_CBOR_CODE = 0x71;

// Recursively prepare a record for hashing: strip undefined fields
// (DAG-CBOR cannot encode undefined — the server strips them too, so
// hashing them locally would produce a mismatching CID) and convert
// BlobRef instances to their IPLD form. CID instances pass through
// untouched (dag-cbor encodes them natively as tag 42).
export function prepareForHashing(v) {
  if (Array.isArray(v)) return v.map(prepareForHashing);
  if (v && typeof v === 'object') {
    if (v.asCID === v) return v; // multiformats CID instance
    if (typeof v.ipld === 'function') return prepareForHashing(v.ipld());
    const out = {};
    for (const [key, value] of Object.entries(v)) {
      if (value === undefined) continue;
      out[key] = prepareForHashing(value);
    }
    return out;
  }
  return v;
}

// Compute the CID the PDS will assign this record. The record MUST
// already carry $type ('app.bsky.feed.post') — omitting it silently
// yields a different CID and broken reply refs.
export async function computeCid(record) {
  const dcbor = await import('@ipld/dag-cbor');
  const prepared = prepareForHashing(record);
  const encoded = dcbor.encode(prepared);
  const digest = await sha256.digest(encoded);
  return CID.createV1(DAG_CBOR_CODE, digest).toString();
}

// Monotonically-increasing TIDs (record keys). TID.next(prev) guarantees
// strict ordering even for same-millisecond calls — required so thread
// posts sort correctly.
let lastTid;
export async function nextTid() {
  const { TID } = await import('@atproto/common-web');
  lastTid = TID.next(lastTid);
  return lastTid.toString();
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/bluesky/thread-writes.test.js`
Expected: all PASS. If the `nextTid` format assertion fails on length, print an actual TID and check against `@atproto/common-web`'s TID docs — the 13-char base32-sortable format is standard, but fix the *test* only if the library's real output legitimately differs (do not loosen the strictly-increasing assertion).

**Step 5: Full test suite + commit**

Run: `npm run test:unit`
Expected: all pass.

```bash
npx oxfmt src/utils/bluesky/thread-writes.js src/utils/bluesky/thread-writes.test.js
git add src/utils/bluesky/thread-writes.js src/utils/bluesky/thread-writes.test.js
git commit -m "feat: client-side CID/TID computation for atomic thread posting"
git push
```

---

### Task 3: Add `createThread` to the facade

**Files:**
- Modify: `src/utils/bluesky/client.js` (below `createStatus`; expose at the `v1.statuses` object, currently lines 1232–1235)

**Step 1: Implement `createThread`**

Add below `createStatus`. Uses Phase 2's `buildPostRecord`/`buildReplyRefs` and the same Mastodon-shaped return logic (`toReturnedStatus` or equivalent extracted in Phase 2 — adapt the call to whatever Phase 2 actually named it):

```js
// Atomically create an N-post self-thread via com.atproto.repo.applyWrites.
// All-or-nothing: on failure, nothing is posted. paramsList entries are the
// same masto-shaped params accepted by createStatus; only the first may
// carry in_reply_to_id / quoted_status_id.
async function createThread(paramsList) {
  if (!Array.isArray(paramsList) || paramsList.length === 0) {
    throw new Error('createThread: empty paramsList');
  }
  if (paramsList.length === 1) {
    return [await createStatus(paramsList[0])];
  }
  const { computeCid, nextTid } = await import('./thread-writes');
  const did = agentDid(); // file's existing idiom (client.js ~187)

  let reply;
  if (paramsList[0].in_reply_to_id) {
    reply = await buildReplyRefs(paramsList[0].in_reply_to_id);
  }

  const writes = [];
  const posts = [];
  const baseTime = Date.now();
  for (let i = 0; i < paramsList.length; i++) {
    const record = await buildPostRecord(paramsList[i]);
    // Monotonic createdAt (+1ms per post): identical timestamps cause
    // undefined feed ordering (atproto issue #3027).
    record.createdAt = new Date(baseTime + i).toISOString();
    if (reply) record.reply = reply;
    const rkey = await nextTid();
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
    writes.push({
      $type: 'com.atproto.repo.applyWrites#create',
      collection: 'app.bsky.feed.post',
      rkey,
      value: record,
    });
    // Next post replies to this one; root stays the thread's first ref
    const cid = await computeCid(record);
    posts.push({ uri, cid, record });
    const ref = { uri, cid };
    reply = { root: reply?.root ?? ref, parent: ref };
  }

  const res = await agent.com.atproto.repo.applyWrites({
    repo: did,
    writes,
    validate: true,
  });

  // Ground-truth check: the server's applyWrites results carry the real
  // CIDs. A mismatch means our local computeCid is wrong — the thread's
  // internal reply refs are then broken (posts reference nonexistent CIDs)
  // and would silently vanish from thread views. Warn loudly and prefer
  // the server's values for everything downstream.
  const results = res?.data?.results || [];
  for (let i = 0; i < posts.length; i++) {
    const serverCid = results[i]?.cid;
    if (serverCid && serverCid !== posts[i].cid) {
      console.warn(
        'createThread: computed CID mismatch — reply refs may be broken',
        { index: i, computed: posts[i].cid, server: serverCid },
      );
      posts[i].cid = serverCid;
    }
  }

  // Post-success bookkeeping, mirroring createStatus: consumed media ids
  // must leave pendingMedia (replicate whatever cleanup createStatus does
  // after agent.post — see Phase 2 extraction notes).
  for (const params of paramsList) {
    for (const mid of params.media_ids || []) pendingMedia.delete(mid);
  }

  const statuses = [];
  for (const { uri, cid, record } of posts) {
    statuses.push(await toReturnedStatus(uri, cid, record));
  }
  return statuses;
}
```

Implementation notes:
- `agentDid()` is the file's existing idiom (~line 187); use it rather than `agent.assertDid`.
- The server-CID cross-check above substitutes for the design's "known record → known CID" fixture (no authoritative vector exists to hardcode safely) — this gives *ground truth* verification on every real thread post instead. Recorded as a deliberate deviation.
- `buildPostRecord` runs facets + media embeds + link card *before* the batch — required, since CIDs hash the final record. Per-segment link cards remain best-effort inside `buildPostRecord`.
- If `toReturnedStatus` (Phase 2) refreshes from the server, a just-written thread may not be indexed yet — if it has a fetch-with-local-fallback shape, that's already handled; otherwise prefer the local-construction branch for thread posts.

**Step 2: Expose on the facade**

At the `v1.statuses` object (lines 1232–1235):

```js
statuses: {
  create: createStatus,
  createThread,
  $select: statusEndpoints,
},
```

**Step 3: Verify**

Run: `npm run build`
Expected: success.

Run: `npm run test:unit`
Expected: all pass.

**Step 4: Commit**

```bash
npx oxfmt src/utils/bluesky/client.js
git add src/utils/bluesky/client.js
git commit -m "feat: atomic thread creation via applyWrites in Bluesky facade"
git push
```

**Phase done when:** thread-writes unit tests pass; build passes; `createThread` exposed. The design's live criterion (3-post thread with media + link posts atomically to a real Bluesky account and renders as a thread) is DEFERRED to the morning checklist — it requires the UI (Phase 5) or a manual console invocation with a live session.
