# Multi-Post Threads Implementation Plan — Phase 4: Multi-Segment publishThread

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** `publishThread` handles N segments — atomic `createThread` delegation for Bluesky targets, resumable sequential chaining for Mastodon — with unit tests.

**Architecture:** The Phase 1 loop already chains sequentially; this phase adds the Bluesky atomic branch (detected by the facade-only `createThread` method), and locks behavior in with Vitest tests against a fake client. Tests exercise only the `masto`-provided path so no app modules load (that's why Phase 1 made `./api`/`./bluesky` imports lazy).

**Tech Stack:** Vitest (`npm run test:unit`).

**Scope:** Phase 4 of 7 from `docs/design-plans/2026-08-09-multi-post-threads.md`.

**Codebase verified:** 2026-08-10.

---

### Task 1: Write the failing tests

**Files:**
- Test: `src/utils/publish.test.js`

**Step 1: Write the tests**

```js
import { describe, expect, it } from 'vitest';

import { canCrossPost, publishThread } from './publish';

function fakeClient({ failAtCall } = {}) {
  const calls = [];
  return {
    calls,
    v1: {
      statuses: {
        create: async (params, opts) => {
          if (calls.length === failAtCall) {
            calls.push({ params, opts, failed: true });
            throw new Error('boom');
          }
          calls.push({ params, opts });
          return { id: `id-${calls.length - 1}`, ...params };
        },
      },
    },
    v2: { media: { create: async () => ({ id: 'uploaded-1' }) } },
  };
}

function fakeBlueskyClient() {
  const threadCalls = [];
  return {
    threadCalls,
    v1: {
      statuses: {
        create: async () => {
          throw new Error('should not be called for multi-segment');
        },
        createThread: async (paramsList) => {
          threadCalls.push(paramsList);
          return paramsList.map((p, i) => ({ id: `bsky-${i}`, ...p }));
        },
      },
    },
    v2: { media: { create: async () => ({ id: 'uploaded-1' }) } },
  };
}

const segments3 = [{ text: 'one' }, { text: 'two' }, { text: 'three' }];

describe('canCrossPost', () => {
  it('allows public/unlisted without poll or schedule', () => {
    expect(canCrossPost({ visibility: 'public' })).toBe(true);
    expect(canCrossPost({ visibility: 'unlisted' })).toBe(true);
  });
  it('rejects polls, schedules, and non-public', () => {
    expect(canCrossPost({ poll: {}, visibility: 'public' })).toBe(false);
    expect(canCrossPost({ scheduledAt: 'x', visibility: 'public' })).toBe(false);
    expect(canCrossPost({ visibility: 'private' })).toBe(false);
    expect(canCrossPost({ visibility: 'direct' })).toBe(false);
  });
});

describe('publishThread sequential chaining', () => {
  it('chains each segment as a reply to the previous', async () => {
    const client = fakeClient();
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      segments: segments3,
      shared: { visibility: 'public' },
    });
    expect(failedAtIndex).toBe(null);
    expect(statuses).toHaveLength(3);
    expect(client.calls[0].params.in_reply_to_id).toBe(undefined);
    expect(client.calls[1].params.in_reply_to_id).toBe('id-0');
    expect(client.calls[2].params.in_reply_to_id).toBe('id-1');
  });

  it('starts the chain at shared.inReplyToId (thread-as-reply)', async () => {
    const client = fakeClient();
    await publishThread({
      masto: client,
      segments: segments3,
      shared: { inReplyToId: 'root-99' },
    });
    expect(client.calls[0].params.in_reply_to_id).toBe('root-99');
    expect(client.calls[1].params.in_reply_to_id).toBe('id-0');
  });

  it('sends per-segment idempotency keys (prefix, prefix-1, …)', async () => {
    const client = fakeClient();
    await publishThread({
      masto: client,
      segments: segments3,
      idempotencyPrefix: 'UID',
    });
    const keys = client.calls.map(
      (c) => c.opts?.requestInit?.headers?.['Idempotency-Key'],
    );
    expect(keys).toEqual(['UID', 'UID-1', 'UID-2']);
  });

  it('puts scheduled_at and quoted_status_id only on the first segment', async () => {
    const client = fakeClient();
    await publishThread({
      masto: client,
      segments: segments3,
      shared: { scheduledAt: '2030-01-01', quotedStatusId: 'q1' },
    });
    expect(client.calls[0].params.scheduled_at).toBe('2030-01-01');
    expect(client.calls[0].params.quoted_status_id).toBe('q1');
    expect(client.calls[1].params.scheduled_at).toBe(undefined);
    expect(client.calls[1].params.quoted_status_id).toBe(undefined);
  });
});

describe('publishThread partial failure and resume', () => {
  it('reports failedAtIndex and keeps earlier statuses', async () => {
    const client = fakeClient({ failAtCall: 1 });
    const { statuses, failedAtIndex, error } = await publishThread({
      masto: client,
      segments: segments3,
    });
    expect(statuses).toHaveLength(1);
    expect(failedAtIndex).toBe(1);
    expect(error.message).toBe('boom');
  });

  it('resumes from startAt, chaining to resumeInReplyToId, with stable keys', async () => {
    const client = fakeClient();
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      segments: segments3,
      startAt: 1,
      resumeInReplyToId: 'id-from-before',
      idempotencyPrefix: 'UID',
    });
    expect(failedAtIndex).toBe(null);
    expect(statuses).toHaveLength(2);
    expect(client.calls[0].params.status).toBe('two');
    expect(client.calls[0].params.in_reply_to_id).toBe('id-from-before');
    // Segment 1 keeps ITS key on retry — not renumbered from the resume point
    expect(
      client.calls[0].opts?.requestInit?.headers?.['Idempotency-Key'],
    ).toBe('UID-1');
    // Resumed run must not re-send first-segment-only fields
    expect(client.calls[0].params.scheduled_at).toBe(undefined);
  });

  it('reports progress per segment', async () => {
    const events = [];
    await publishThread({
      masto: fakeClient({ failAtCall: 2 }),
      segments: segments3,
      onProgress: (i, state) => events.push([i, state]),
    });
    expect(events).toEqual([
      [0, 'posting'],
      [0, 'done'],
      [1, 'posting'],
      [1, 'done'],
      [2, 'posting'],
      [2, 'failed'],
    ]);
  });
});

describe('publishThread atomic delegation (Bluesky facade)', () => {
  it('delegates multi-segment to createThread in one call', async () => {
    const client = fakeBlueskyClient();
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      isBluesky: true,
      segments: segments3,
      shared: { inReplyToId: 'root-1' },
    });
    expect(failedAtIndex).toBe(null);
    expect(statuses).toHaveLength(3);
    expect(client.threadCalls).toHaveLength(1);
    const paramsList = client.threadCalls[0];
    expect(paramsList).toHaveLength(3);
    expect(paramsList[0].in_reply_to_id).toBe('root-1');
    expect(paramsList[1].in_reply_to_id).toBe(undefined);
  });

  it('reports atomic failure as failedAtIndex 0 with no statuses', async () => {
    const client = fakeBlueskyClient();
    client.v1.statuses.createThread = async () => {
      throw new Error('applyWrites failed');
    };
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      isBluesky: true,
      segments: segments3,
    });
    expect(statuses).toHaveLength(0);
    expect(failedAtIndex).toBe(0);
  });

  it('NEVER routes Mastodon threads to createThread, even though masto.js proxies make every method look present', async () => {
    // masto.js v7 clients are Proxy-based: unknown properties return a
    // callable proxy, so `typeof client.v1.statuses.createThread ===
    // 'function'` is TRUE on real Mastodon clients. Publishing must gate
    // on the explicit isBluesky flag, not method presence — otherwise
    // Mastodon threads 404 into POST /statuses/create_thread.
    const calls = [];
    const proxyStatuses = new Proxy(
      {},
      {
        get: (_, prop) => {
          if (prop === 'create') {
            return async (params, opts) => {
              calls.push({ params, opts });
              return { id: `id-${calls.length - 1}`, ...params };
            };
          }
          // Everything else "exists" as a callable, like real masto.js
          return async () => {
            throw new Error(`404: unknown endpoint ${String(prop)}`);
          };
        },
      },
    );
    const client = {
      v1: { statuses: proxyStatuses },
      v2: { media: { create: async () => ({ id: 'uploaded-1' }) } },
    };
    // Sanity: the trap this test guards against is real on this fake
    expect(typeof client.v1.statuses.createThread).toBe('function');
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      isBluesky: false,
      segments: segments3,
    });
    expect(failedAtIndex).toBe(null);
    expect(statuses).toHaveLength(3);
    expect(calls).toHaveLength(3); // sequential path, one create per segment
  });
});
```

**Step 2: Run to verify current failures**

Run: `npx vitest run src/utils/publish.test.js`
Expected: chaining/failure/progress tests PASS already (Phase 1 loop); the **atomic delegation tests FAIL** (no delegation logic yet). If any sequential test unexpectedly fails, fix `publish.js` — that's a Phase 1 regression, not a test problem.

---

### Task 2: Add the atomic delegation branch

**Files:**
- Modify: `src/utils/publish.js`

**Step 1: Implement**

In `publishThread`, after `client`/`isBluesky` are resolved and before the sequential loop, add:

```js
  // Atomic path: the Bluesky facade creates whole threads in one
  // applyWrites — all-or-nothing, so failure needs no resume bookkeeping.
  // Gate on the RESOLVED isBluesky flag, never on method presence:
  // masto.js v7 is Proxy-based, so any property duck-types as a function
  // and a presence check would 404 Mastodon threads into /create_thread.
  if (segments.length - startAt > 1 && isBluesky) {
    onProgress?.(startAt, 'posting');
    try {
      const paramsList = [];
      for (let i = startAt; i < segments.length; i++) {
        const segment = segments[i];
        const { mediaIds, skippedMedia: skipped } = await resolveMediaIds({
          client,
          isBluesky,
          segment,
        });
        skippedMedia.push(...skipped);
        paramsList.push(
          removeNullUndefined({
            status: segment.text,
            spoiler_text: shared.spoilerText || undefined,
            language: shared.language,
            sensitive: !!shared.sensitive,
            media_ids: mediaIds.length ? mediaIds : undefined,
            in_reply_to_id:
              i === startAt
                ? (startAt > 0 ? resumeInReplyToId : shared.inReplyToId) ||
                  undefined
                : undefined,
            quoted_status_id: i === 0 ? shared.quotedStatusId : undefined,
          }),
        );
      }
      const created = await client.v1.statuses.createThread(paramsList);
      statuses.push(...created);
      for (let i = startAt; i < segments.length; i++) onProgress?.(i, 'done');
      return { statuses, failedAtIndex: null, error: null, skippedMedia };
    } catch (error) {
      onProgress?.(startAt, 'failed');
      return { statuses, failedAtIndex: startAt, error, skippedMedia };
    }
  }
```

(The `statuses`/`skippedMedia` arrays and `resolveMediaIds` already exist from Phase 1; this block reuses them. Note `poll`/`scheduled_at`/`visibility` are intentionally absent — the facade rejects polls and schedules, and ignores visibility.)

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/utils/publish.test.js`
Expected: ALL pass.

Run: `npm run test:unit`
Expected: all pass.

**Step 3: Verify build**

Run: `npm run build`
Expected: success.

**Step 4: Commit**

```bash
npx oxfmt src/utils/publish.js src/utils/publish.test.js
git add src/utils/publish.js src/utils/publish.test.js
git commit -m "feat: multi-segment publishThread — atomic Bluesky delegation + tests"
git push
```

**Phase done when:** all publish.test.js tests pass, full suite green, build passes. Live 3-post Mastodon thread verification DEFERRED to morning checklist (needs Phase 5 UI).
