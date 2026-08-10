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
// { postedStatuses: [], failedAtIndex: null, lastPostedId: null }
const [threadPublishState, setThreadPublishState] = useState(null);
const [publishProgress, setPublishProgress] = useState(null); // 'n/N' string
```

Reset `threadPublishState` to `null` whenever the draft meaningfully changes segment structure (the "+"/remove handlers from Phase 5) — a structural edit invalidates resume indexes. Text edits to *unposted* segments are fine and must NOT reset it.

**Step 2: Wire progress + resume into submit**

In the create branch, derive resume args and pass `onProgress`:

```js
const resume = threadPublishState?.failedAtIndex != null;
const { statuses, failedAtIndex, error } = await publishThread({
  masto,
  instance,
  segments,
  shared,
  idempotencyPrefix: UID.current,
  startAt: resume ? threadPublishState.failedAtIndex : 0,
  resumeInReplyToId: resume ? threadPublishState.lastPostedId : undefined,
  onProgress: (i, state) => {
    if (state === 'posting' && segments.length > 1) {
      setPublishProgress(`${i + 1}/${segments.length}`);
    }
  },
});
const allStatuses = [...(threadPublishState?.postedStatuses || []), ...statuses];
if (failedAtIndex !== null) {
  setThreadPublishState({
    postedStatuses: allStatuses,
    failedAtIndex,
    lastPostedId: allStatuses.at(-1)?.id || null,
  });
  throw Object.assign(
    error || new Error('thread failed'),
    {
      _threadPartial: {
        posted: allStatuses.length,
        total: segments.length,
      },
    },
  );
}
setThreadPublishState(null);
setPublishProgress(null);
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

A segment is *posted* when `threadPublishState` exists and its overall index `< threadPublishState.failedAtIndex`. Overall index: main editor = 0, `moreSegments[i]` = i + 1.

- Main editor (only lockable if `failedAtIndex > 0`... which always holds when state exists and index 0 posted): set the textarea `readOnly` + a `✓ Posted` chip; disable its media/poll controls.
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
