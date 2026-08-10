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
Expected: success, and the main bundle does NOT grow materially (these are only imported behind dynamic `import()` added in later tasks; nothing imports them yet).

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
  const did = agent.assertDid;

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
    posts.push({ uri, record });
    // Next post replies to this one; root stays the thread's first ref
    const ref = { uri, cid: await computeCid(record) };
    reply = { root: reply?.root ?? ref, parent: ref };
  }

  await agent.com.atproto.repo.applyWrites({
    repo: did,
    writes,
    validate: true,
  });

  const statuses = [];
  for (const { uri, record } of posts) {
    statuses.push(await toReturnedStatus(uri, record));
  }
  return statuses;
}
```

Implementation notes:
- `agent.assertDid` throws without a session — acceptable (matches social-app); if client.js elsewhere uses `agent.session.did`, match the file's existing idiom instead.
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
