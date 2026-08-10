# Multi-Post Threads Implementation Plan — Phase 7: Cross-Posted Threads + Docs

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Full threads cross-post to other-network accounts with per-target failure isolation; docs updated.

**Architecture:** The Phase 1 cross-post loop already calls `publishThread` per target; this phase passes the *full* segments array (removing Phase 5's skip-guard) and adds per-target progress + result toasts with thread counts. Cross-post failures never block or roll back other targets (toast-and-continue, as today).

**Design deviation (flagged for user review):** the design asked for "per-target retry tracking". In practice it's unreachable: cross-posting only runs after the primary thread fully succeeds, at which point the composer closes — there is no surface left to retry from. A cross-post thread that partially fails therefore reports what posted and what didn't via toast, exactly like today's single-post cross-post failures. Building a retry surface would mean keeping the composer open after primary success — a UX change needing user sign-off. Recorded in the morning report.

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

**Step 2: Per-target progress and results**

Rework the loop body (no retry bookkeeping — see the flagged deviation above; the loop only ever runs once per submit because cross-posting happens strictly after primary success):

```js
for (const account of crossPostAccounts) {
  const acctName = account.info.acct || account.info.username;
  try {
    const { statuses: crossStatuses, failedAtIndex: crossFailedAt, error: crossError, skippedMedia } =
      await publishThread({
        account,
        segments: crossSegments,
        shared: {
          spoilerText,
          sensitive: sensitive || sensitiveMedia,
          language,
          visibility: visibility || 'public',
        },
        onProgress: (i, state) => {
          if (state === 'posting' && crossSegments.length > 1) {
            states.composerState.publishingProgress = `@${acctName} ${i + 1}/${crossSegments.length}`;
          }
        },
      });
    if (crossFailedAt !== null) {
      // Partial cross-post: report precisely what made it up
      showToast(
        t`Cross-posted ${crossStatuses.length} of ${crossSegments.length} posts to @${acctName} — the rest failed: ${crossError?.message || crossError}`,
      );
      continue;
    }
    showToast(
      (crossSegments.length > 1
        ? t`Cross-posted thread (${crossStatuses.length} posts) to @${acctName}`
        : t`Cross-posted to @${acctName}`) +
        (skippedMedia?.length ? ` (${t`some attachments skipped`})` : ''),
    );
  } catch (e) {
    console.error(e);
    showToast(t`Unable to cross-post to @${acctName}: ${e?.message || e}`);
  }
}
states.composerState.publishingProgress = null;
```

Semantics to preserve: a cross-post failure is toast-only — it must NOT throw out of the submit handler, NOT keep the composer open, and NOT affect other targets. Bluesky targets are atomic (all posts or none); Mastodon targets can partially fail, which the first toast branch reports honestly.

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
