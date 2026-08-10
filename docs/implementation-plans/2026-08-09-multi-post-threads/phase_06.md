# Multi-Post Threads Implementation Plan — Phase 6: Partial-Failure UX

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** A Mastodon mid-thread failure leaves the composer open and resumable: posted segments lock, Post becomes "Retry remaining", retry completes the chain without duplicates.

**Architecture:** A `threadPublishState` piece of component state records posted statuses / failure index / last posted id across attempts within one composer session. Submit consults it to call `publishThread` with `startAt` + `resumeInReplyToId` (Phase 4 semantics, already unit-tested). Bluesky targets are atomic, so this state only ever advances on Mastodon-primary targets — but the code is network-agnostic.

**Tech Stack:** Preact state, Phase 4 `publishThread`, Lingui strings.

**Scope:** Phase 6 of 7 from `docs/design-plans/2026-08-09-multi-post-threads.md`.

**Codebase verified:** 2026-08-10.

---

### Task 1: Track publish progress across attempts

**Files:**
- Modify: `src/components/compose.jsx`

**Step 1: Add state**

```js
// Survives a failed publish attempt so retry can resume mid-thread.
// Non-null ONLY for genuine partial threads: { postedStatuses: [...], lastPostedId }
const [threadPublishState, setThreadPublishState] = useState(null);
const [publishProgress, setPublishProgress] = useState(null); // 'n/N' string
```

Do NOT reset `threadPublishState` on segment structure changes. (An earlier revision of this plan mandated a reset on "+"/remove because "a structural edit invalidates resume indexes" — review showed that rationale doesn't hold: posted segments have their remove buttons hidden and "+" appends at the end, so every reachable structural edit touches only indexes after the posted prefix, leaving `startAt`/`resumeInReplyToId` valid. Worse, the reset re-armed the from-zero duplicate-posting path it existed to prevent.) Text edits to *unposted* segments also must not reset it.

**Drafts during partial failure:** `saveUnsavedDraft` keeps running while the composer sits errored; a browser reload would restore all segments with no record that some posted, making the Post button a from-zero duplicate trap. Skip `saveUnsavedDraft` entirely while `threadPublishState` is set (session-scoped resume state stays session-scoped; the pre-failure draft copy remains).

**Shared-field locking:** visibility, CW, and language feed `shared` and apply to the *remaining* segments on resume — a mid-retry visibility change would produce a mixed public/private thread (privacy surprise). Lock (readOnly/disable-with-title) visibility, CW, and language pickers on the same `!!threadPublishState` condition as the main textarea. Note: the main textarea must use `readOnly`, not `disabled` — disabled controls drop out of FormData, and the user should be able to select/copy posted text. Disable (don't hide) the main media controls, so `sensitiveMedia` stays in FormData.

**Bluesky atomic failure warning:** the atomic path has no idempotency (TID rkeys are time-based). When a Bluesky-primary thread fails with nothing posted (`isBlueskyTarget && segments.length > 1`), the failure alert must warn the user to check their profile before retrying — a network timeout on a server-side-successful `applyWrites` reports as failure, and a blind retry duplicates the whole thread.

**Orphan-root guard:** never call `publishThread` with `startAt > 0` and a falsy `resumeInReplyToId` (the chain would silently restart as a detached root). If `threadPublishState.lastPostedId` is ever falsy, clear the state and start over from 0.

**Step 2: Wire progress + resume into submit**

In the create branch, derive resume args and pass `onProgress`:

```js
// Resume state exists ONLY for genuine partial threads (some posts up,
// some not). Plain single-post failures and index-0 thread failures keep
// today's behavior exactly — no "Retry remaining", no locking.
const resume = threadPublishState != null;
const startAt = resume ? threadPublishState.postedStatuses.length : 0;
const { statuses, failedAtIndex, error } = await publishThread({
  masto,
  instance,
  segments,
  shared,
  idempotencyPrefix: UID.current,
  startAt,
  resumeInReplyToId: resume ? threadPublishState.lastPostedId : undefined,
  onProgress: (i, state) => {
    if (state === 'posting' && segments.length > 1) {
      const progress = `${i + 1}/${segments.length}`;
      setPublishProgress(progress);
      // Mirror into global composer state so the minimized-composer
      // indicator can show it too (design asked for composerState here;
      // the resume bookkeeping itself stays component-local — recorded
      // as a minor deviation).
      states.composerState.publishingProgress = progress;
    }
  },
});
const allStatuses = [...(threadPublishState?.postedStatuses || []), ...statuses];
if (failedAtIndex !== null) {
  // Clear transient progress on every failure path too — leaving it
  // stale would show "Posting 2/3…" on an idle errored composer
  setPublishProgress(null);
  states.composerState.publishingProgress = null;
  if (segments.length > 1 && allStatuses.length > 0) {
    // Genuine partial thread → enable resume UX
    setThreadPublishState({
      postedStatuses: allStatuses,
      lastPostedId: allStatuses.at(-1)?.id || null,
    });
    throw Object.assign(error || new Error('thread failed'), {
      _threadPartial: {
        posted: allStatuses.length,
        total: segments.length,
      },
    });
  }
  // Nothing posted (or not a thread): behave exactly like today
  setThreadPublishState(null);
  throw error;
}
setThreadPublishState(null);
setPublishProgress(null);
states.composerState.publishingProgress = null;
newStatus = allStatuses[0];
```

Replace Phase 5's interim alert-on-partial with this. In the surrounding `catch`, when `e._threadPartial` is present, use a clearer message: `alert(t`Posted ${posted} of ${total} thread posts. The rest failed (${msg}). Your remaining posts are still here — press "Retry remaining".`)` (compose the string with the file's Lingui idiom).

Also: on failure, do NOT clear `moreSegments`; the existing catch already keeps the composer open (`setUIState('error')`).

**Step 3: Verify + commit**

Run: `npm run build` && `npm run test:unit` — green.

```bash
npx oxfmt src/components/compose.jsx
git add src/components/compose.jsx
git commit -m "feat: resumable thread publishing state"
git push
```

---

### Task 2: Locked segments, progress indicator, Retry button

**Files:**
- Modify: `src/components/compose.jsx`
- Modify: `src/components/compose.css`

**Step 1: Lock posted segments**

`threadPublishState` now exists *only* when at least one thread post is up (Task 1's gating), so: a segment is *posted* when its overall index `< threadPublishState.postedStatuses.length`. Overall index: main editor = 0, `moreSegments[i]` = i + 1. (The main editor is therefore always locked whenever the state exists.)

- Main editor: set the textarea `readOnly` + a `✓ Posted` chip; disable its media/poll controls.
- `ThreadSegmentEditor`: add a `posted` prop → `readOnly` textarea, hide remove/media buttons, `✓` chip.

**Step 2: Post button + progress**

Where the submit button renders (search for the button with the publish label/icon near the toolbar): when `threadPublishState`, label it `<Trans>Retry remaining</Trans>`; while `uiState === 'loading'` and `publishProgress`, show `Posting {publishProgress}…` (in or beside the button, matching existing loading affordances).

**Step 3: Idempotency-stability check (already unit-tested)**

No new test needed: `publish.test.js` (Phase 4) already asserts resumed segments keep their original `UID-i` keys — the property that makes an accidental double-tap of "Retry remaining" safe on Mastodon within the idempotency window.

**Step 4: Verify + commit**

Run: `npm run build` && `npm run test:unit` — green.

```bash
npx oxfmt src/components/compose.jsx
git add src/components/compose.jsx src/components/compose.css
git commit -m "feat: partial-failure UX — locked segments and Retry remaining"
git push
```

**Phase done when:** build + tests green; UI states implemented. LIVE verification deferred to morning checklist: compose a 3-post thread, kill network after post #1 (devtools offline), confirm composer shows ✓/Retry, restore network, Retry completes the chain, and the resulting thread is correctly chained with no duplicates.
