# Multi-Post Threads Implementation Plan — Phase 7: Cross-Posted Threads + Docs

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Full threads cross-post to other-network accounts with per-target failure isolation; docs updated.

**Architecture:** The Phase 1 cross-post loop already calls `publishThread` per target; this phase passes the *full* segments array (removing Phase 5's skip-guard), adds per-target result toasts with thread counts, and per-target retry bookkeeping scoped to the current composer session. Cross-post failures never block or roll back other targets (toast-and-continue, as today).

**Tech Stack:** Phase 4 `publishThread`, Lingui, existing toast idiom.

**Scope:** Phase 7 of 7 from `docs/design-plans/2026-08-09-multi-post-threads.md`.

**Codebase verified:** 2026-08-10.

---

### Task 1: Cross-post the whole thread

**Files:**
- Modify: `src/components/compose.jsx` (cross-post loop from Phase 1; Phase 5's thread skip-guard)

**Step 1: Remove the Phase 5 guard** ("Cross-posting threads coming soon" toast) and build cross-post segments from ALL segments. Cross-post targets always re-upload media from `fileData`, including the main segment's:

```js
const crossSegments = [
  { text: status, mediaAttachments, poll: undefined },
  ...moreSegments.map((segment) => ({
    text: segment.text,
    mediaAttachments: segment.mediaAttachments,
  })),
];
```

(`poll` stays undefined: polls block cross-posting entirely via `canCrossPost` — unchanged.)

**Step 2: Per-target results and retry state**

Add alongside Phase 6's state:

```js
// Per-target cross-post retry state for the current composer session:
// Map of account id → { failedAtIndex, lastPostedId, postedCount }
const crossPostStateRef = useRef(new Map());
```

Rework the loop body:

```js
for (const account of crossPostAccounts) {
  const acctKey = account.info.id || account.info.did || account.info.acct;
  const prior = crossPostStateRef.current.get(acctKey);
  if (prior?.done) continue; // already fully cross-posted in this session
  try {
    const { statuses: crossStatuses, failedAtIndex: crossFailedAt, error: crossError, skippedMedia } =
      await publishThread({
        account,
        segments: crossSegments,
        shared: { spoilerText, sensitive: sensitive || sensitiveMedia, language, visibility },
        startAt: prior?.failedAtIndex ?? 0,
        resumeInReplyToId: prior?.lastPostedId,
      });
    const postedCount = (prior?.postedCount || 0) + crossStatuses.length;
    if (crossFailedAt !== null) {
      crossPostStateRef.current.set(acctKey, {
        failedAtIndex: crossFailedAt,
        lastPostedId: crossStatuses.at(-1)?.id || prior?.lastPostedId || null,
        postedCount,
      });
      throw crossError;
    }
    crossPostStateRef.current.set(acctKey, { done: true, postedCount });
    showToast(
      (crossSegments.length > 1
        ? t`Cross-posted thread (${postedCount} posts) to @${account.info.acct || account.info.username}`
        : t`Cross-posted to @${account.info.acct || account.info.username}`) +
        (skippedMedia?.length ? ` (${t`some attachments skipped`})` : ''),
    );
  } catch (e) {
    console.error(e);
    showToast(
      t`Unable to cross-post to @${account.info.acct || account.info.username}: ${e?.message || e}`,
    );
  }
}
```

Semantics to preserve: a cross-post failure is toast-only — it must NOT throw out of the submit handler, NOT keep the composer open by itself, and NOT affect other targets. When the *primary* thread failed (Phase 6 keeps the composer open), the user's "Retry remaining" re-enters this loop; `crossPostStateRef` then resumes each target from where it stopped instead of double-posting (that's why the Map lives in a ref: it must survive the failed attempt but die with the composer session). Reset the Map in the same places Phase 6 resets `threadPublishState` (segment structure changes).

Note for Bluesky targets: resume state is trivially safe — atomic `createThread` means `failedAtIndex` is only ever the start index with nothing posted.

**Step 3: Verify + commit**

Run: `npm run build` && `npm run test:unit` — green.

```bash
npx oxfmt src/components/compose.jsx
git add src/components/compose.jsx
git commit -m "feat: cross-post full threads with per-target resume"
git push
```

---

### Task 2: Documentation

**Files:**
- Modify: `CLAUDE.md` (Bluesky support architecture section)
- Modify: `README.md` (feature list)

**Step 1: CLAUDE.md**

Add a short subsection after the link-card bullet in the architecture list, covering: `src/utils/publish.js` (`publishThread` — the single publish path for primary posts, cross-posts, and threads; `canCrossPost` as the single eligibility predicate; cross-post.js deleted), `src/utils/bluesky/thread-writes.js` (client-side CID/TID, lazy-loaded, silent-failure gotchas: `$type` before hashing, undefined-stripping, monotonic TIDs, +1ms createdAt), and `createThread` (atomic applyWrites; Mastodon chains sequentially with per-segment idempotency keys; partial-failure resume via `startAt`/`resumeInReplyToId`). Match the file's existing terse style; update the "Last verified" date.

**Step 2: README.md**

Add one feature bullet under the appropriate feature list: multi-post thread composer ("+" in the composer; posts atomically on Bluesky, chained on Mastodon; cross-posts whole threads).

**Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document multi-post threads and publish layer"
git push
```

---

### Task 3: Final verification sweep

**Step 1: Full checks**

Run: `npm run test:unit` — all pass.
Run: `npm run build` — success.
Run: `npm run formatting-check` — clean (run `npx oxfmt` on offenders if not).

**Step 2: Confirm working tree clean and pushed**

Run: `git status` (clean) and `git log --oneline origin/main..HEAD` (empty).

**Phase done when:** all checks green, everything pushed. End-to-end LIVE verifications (deferred to morning checklist): 3-post thread Mastodon-primary cross-posted to Bluesky; 3-post thread Bluesky-primary cross-posted to Mastodon; cross-post failure isolation; thread-as-reply; link cards on thread segments.
