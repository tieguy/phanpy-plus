# Multi-Post Threads Implementation Plan — Phase 1: Publish Layer Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** One posting path for primary and cross-post targets (single posts only) — no behavior change.

**Architecture:** New `src/utils/publish.js` exposes `publishThread` (a single post = one-segment thread) and `canCrossPost`. compose.jsx's submit handler calls it for the primary post and each cross-post account; `src/utils/bluesky/cross-post.js` is deleted.

**Tech Stack:** Preact, masto.js-compatible facade (`src/utils/bluesky/client.js`), Vite, Vitest.

**Scope:** Phase 1 of 7 from `docs/design-plans/2026-08-09-multi-post-threads.md`.

**Codebase verified:** 2026-08-10 (post PR #3 line numbers).

**Conventions:** Commit directly to `main` and push after each task. Run `npx oxfmt` on touched files before committing (repo uses oxfmt, no eslint/prettier). All code is ESM (`"type": "module"`).

---

### Task 1: Create `src/utils/publish.js`

**Files:**
- Create: `src/utils/publish.js`

**Step 1: Create the file with this exact content**

Note the *lazy* imports of `./api` and `./bluesky` inside `publishThread` — deliberate, so Phase 4's Vitest unit tests can import this module under Node without pulling the app's heavy import graph (states, storage). Do not hoist them to top-level imports.

```js
// Network-agnostic thread publishing: posts 1..N segments to ONE target
// account/instance, chaining each segment as a reply to the previous.
// Absorbs the old bluesky/cross-post.js — a single post is a one-segment
// thread, and the primary post and cross-posts go through the same path.

// Cross-post eligibility for a draft. Single source of truth for the rules
// previously inlined twice in compose.jsx.
export function canCrossPost({ poll, scheduledAt, visibility }) {
  return (
    !poll &&
    !scheduledAt &&
    (visibility === 'public' || visibility === 'unlisted')
  );
}

function removeNullUndefined(obj) {
  for (const key in obj) {
    if (obj[key] === null || obj[key] === undefined) {
      delete obj[key];
    }
  }
  return obj;
}

async function createWithIdempotency(client, params, key) {
  if (!key) return await client.v1.statuses.create(params);
  try {
    return await client.v1.statuses.create(params, {
      requestInit: {
        headers: { 'Idempotency-Key': key },
      },
    });
  } catch (_) {
    // If idempotency key fails, try again without it (pre-existing
    // fallback behavior from compose.jsx)
    return await client.v1.statuses.create(params);
  }
}

// Upload a segment's media to the target when the composer hasn't already
// (cross-post targets, and later non-first thread segments).
async function resolveMediaIds({ client, isBluesky, segment }) {
  if (segment.mediaIds) {
    return { mediaIds: segment.mediaIds, skippedMedia: [] };
  }
  const mediaIds = [];
  const skippedMedia = [];
  for (const attachment of segment.mediaAttachments || []) {
    const { fileData, fileName, type, description } = attachment;
    if (!fileData) {
      skippedMedia.push(fileName);
      continue;
    }
    if (isBluesky && !/^image\//.test(type)) {
      // Only images can cross-post to Bluesky for now
      skippedMedia.push(fileName);
      continue;
    }
    const file = new File([fileData], fileName || 'media', { type });
    const res = await client.v2.media.create({
      file,
      description: description || undefined,
    });
    if (res?.id) mediaIds.push(res.id);
  }
  return { mediaIds, skippedMedia };
}

export async function publishThread({
  account, // cross-post target account (other network) — omit for primary
  instance, // primary target instance string (used when no client given)
  masto, // pre-resolved client for the primary path (optional)
  isBluesky, // explicit network flag; derived from account/instance if omitted
  segments, // [{ text, mediaIds?, mediaAttachments?, poll? }]
  shared = {}, // { visibility, language, spoilerText, sensitive, inReplyToId, quotedStatusId, quoteApprovalPolicy, scheduledAt }
  idempotencyPrefix, // per-segment Idempotency-Key: prefix, prefix-1, prefix-2…
  startAt = 0, // resume support: first segment index to post
  resumeInReplyToId, // when resuming, id of the last successfully-posted status
  onProgress, // (segmentIndex, 'posting' | 'done' | 'failed') => void
}) {
  let client = masto;
  if (!client) {
    const { api } = await import('./api');
    client = (account ? api({ account }) : api({ instance })).masto;
  }
  // Network detection must be EXPLICIT — never duck-type the client:
  // masto.js v7 is Proxy-based, so `typeof client.v1.statuses.anything
  // === 'function'` is true on real Mastodon clients. Callers pass
  // isBluesky when they know it (compose.jsx knows its primary target);
  // otherwise derive from the account/instance via the real predicates.
  if (isBluesky === undefined) {
    if (account || instance) {
      const { isBlueskyAccount, isBlueskyInstance } = await import('./bluesky');
      isBluesky = account
        ? isBlueskyAccount(account)
        : isBlueskyInstance(instance);
    } else {
      isBluesky = false;
    }
  }

  const statuses = [];
  const skippedMedia = [];
  let inReplyToId = startAt > 0 ? resumeInReplyToId : shared.inReplyToId;
  for (let i = startAt; i < segments.length; i++) {
    const segment = segments[i];
    onProgress?.(i, 'posting');
    try {
      const { mediaIds, skippedMedia: skipped } = await resolveMediaIds({
        client,
        isBluesky,
        segment,
      });
      skippedMedia.push(...skipped);
      const params = removeNullUndefined({
        status: segment.text,
        spoiler_text: shared.spoilerText || undefined,
        language: shared.language,
        sensitive: !!shared.sensitive,
        poll: segment.poll,
        media_ids: mediaIds.length ? mediaIds : undefined,
        // Bluesky cross-post targets don't take visibility (pre-existing rule)
        visibility: account && isBluesky ? undefined : shared.visibility,
        in_reply_to_id: inReplyToId || undefined,
        // These only make sense on the first post of a thread
        scheduled_at: i === startAt && startAt === 0 ? shared.scheduledAt : undefined,
        quoted_status_id: i === 0 ? shared.quotedStatusId : undefined,
        quote_approval_policy: shared.quoteApprovalPolicy,
      });
      const key =
        idempotencyPrefix &&
        (i === 0 ? idempotencyPrefix : `${idempotencyPrefix}-${i}`);
      const newStatus = await createWithIdempotency(client, params, key);
      statuses.push(newStatus);
      inReplyToId = newStatus.id;
      onProgress?.(i, 'done');
    } catch (error) {
      onProgress?.(i, 'failed');
      return { statuses, failedAtIndex: i, error, skippedMedia };
    }
  }
  return { statuses, failedAtIndex: null, error: null, skippedMedia };
}
```

**Step 2: Verify it parses**

Run: `node --input-type=module -e "import('./src/utils/publish.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'canCrossPost', 'publishThread' ]`

**Step 3: Commit**

```bash
npx oxfmt src/utils/publish.js
git add src/utils/publish.js
git commit -m "feat: add network-agnostic publishThread layer"
git push
```

---

### Task 2: Rewire compose.jsx's submit path through publishThread

**Files:**
- Modify: `src/components/compose.jsx` (imports at line 21; submit handler region ~1455–1569)

**Step 1: Swap imports**

Remove line 21 (`import { crossPostStatus } from '../utils/bluesky/cross-post';`) and add (alphabetical position among `../utils/` imports):

```js
import { canCrossPost, publishThread } from '../utils/publish';
```

**Step 2: Restructure the create path**

In the submit handler, the current structure (verified 2026-08-10) is: params build (1455–1498) → `let newStatus` → edit branch (`masto.v1.statuses.$select(editStatus.id).update(params)`) / create branch (statuses.create with Idempotency-Key + fallback, 1510–1521) → cross-post block (1524–1569).

Keep the **edit branch as-is**, but since `params` is now only used by the edit path, move the `let params = {...}` build (and its `removeNullUndefined` call) *inside* the `if (editStatus)` branch, deleting the now-dead non-edit parts of that build (the `else` block that sets `visibility`/`in_reply_to_id`/`scheduled_at`/quote fields) and the `console.log('POST', params)` line. Replace the create branch AND the whole cross-post block with:

```js
} else {
  const shared = {
    visibility,
    language,
    spoilerText,
    sensitive: sensitive || sensitiveMedia,
    inReplyToId: replyToStatus?.id || undefined,
    scheduledAt,
  };
  if (supportsNativeQuote(instance)) {
    shared.quoteApprovalPolicy = quoteApprovalPolicy;
    if (currentQuoteStatus?.id) {
      shared.quotedStatusId = currentQuoteStatus.id;
    }
  }
  const segments = [
    {
      text: status,
      mediaIds: mediaAttachments.map((attachment) => attachment.id),
      poll,
    },
  ];
  const { statuses, failedAtIndex, error } = await publishThread({
    masto,
    instance,
    isBluesky: isBlueskyTarget, // compose.jsx:201 — explicit, never duck-typed
    segments,
    shared,
    idempotencyPrefix: UID.current,
  });
  if (failedAtIndex !== null) throw error;
  newStatus = statuses[0];

  // Cross-post to other-network accounts (e.g. Bluesky)
  if (crossPost && crossPostAccounts.length) {
    if (canCrossPost({ poll, scheduledAt, visibility })) {
      for (const account of crossPostAccounts) {
        try {
          const {
            failedAtIndex: crossFailedAt,
            error: crossError,
            skippedMedia,
          } = await publishThread({
            account,
            segments: [{ text: status, mediaAttachments }],
            shared: {
              spoilerText,
              sensitive: sensitive || sensitiveMedia,
              language,
              visibility: visibility || 'public',
            },
          });
          if (crossFailedAt !== null) throw crossError;
          showToast(
            t`Cross-posted to @${
              account.info.acct || account.info.username
            }` +
              (skippedMedia?.length
                ? ` (${t`some attachments skipped`})`
                : ''),
          );
        } catch (e) {
          console.error(e);
          showToast(
            t`Unable to cross-post to @${
              account.info.acct || account.info.username
            }: ${e?.message || e}`,
          );
        }
      }
    } else {
      showToast(
        t`Cross-posting skipped (not supported for polls, scheduled or non-public posts)`,
      );
    }
  }
}
```

Behavior-preservation notes for this edit:
- The primary path previously always sent `visibility` (even to the Bluesky facade); `publishThread` does the same for primary targets (no `account` arg → `isBluesky` false).
- The old cross-post path omitted the idempotency key, sent `spoiler_text: spoilerText || undefined`, `sensitive: !!sensitive`, and omitted `visibility` for Bluesky targets — all preserved by `publishThread` + this call shape.
- The old skip-toast fired when crossPost was on but scheduled/poll/non-public; `!canCrossPost(...)` is the identical condition.
- `params` for the primary create is now built inside `publishThread`; verify no other code below this region references the removed create-branch variables.

**Step 3: Verify compile**

Run: `npm run build`
Expected: completes without errors.

**Step 4: Commit**

```bash
npx oxfmt src/components/compose.jsx
git add src/components/compose.jsx
git commit -m "refactor: route primary post and cross-posts through publishThread"
git push
```

---

### Task 3: Delete cross-post.js and verify

**Files:**
- Delete: `src/utils/bluesky/cross-post.js`

**Step 1: Verify no remaining importers**

Run: `grep -rn "crossPostStatus\|bluesky/cross-post" src/`
Expected: no matches. (Do NOT grep for bare `cross-post` — user-facing toast strings like "Unable to cross-post to…" legitimately contain it.)

If matches remain, fix them before deleting.

**Step 2: Delete**

```bash
git rm src/utils/bluesky/cross-post.js
```

**Step 3: Full verification**

Run: `npm run build`
Expected: success.

Run: `npm run test:unit`
Expected: all existing tests pass (12 pre-existing test files; none touch posting).

**Step 4: Commit**

```bash
git commit -m "refactor: delete cross-post.js, absorbed into publish.js"
git push
```

**Phase done when:** build + unit tests pass, `cross-post.js` gone, and the diff shows the create/cross-post behavior mapped 1:1 into `publishThread` calls. Live smoke test (single post + cross-post on lookonmy.works) is DEFERRED to the morning checklist.
