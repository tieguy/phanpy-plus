# Multi-Post Threads Implementation Plan — Phase 5: Composer Thread UI

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Compose and post threads from the UI: "+" adds segments, one Post action publishes the whole thread.

**Architecture:** The existing editor remains segment #1 (minimal churn in the 2400-line component); additional segments live in a `moreSegments` array state rendered as lighter-weight editors below the main one. Submit builds the segments array and calls Phase 4's `publishThread`. Draft persistence carries `moreSegments`.

**Design deviation (flagged for user review):** the design says "per-segment media/poll"; this phase gives extra segments **text + media + counter** but keeps **polls on segment #1 only** — replicating the full poll editor per segment is large-surface UI work with near-zero real-world use (YAGNI). Recorded in the morning report for sign-off.

**Tech Stack:** Preact hooks, `uid/single`, existing `processFiles` (compose.jsx:312–360), `CharCountMeter`, IndexedDB drafts (`db.drafts`).

**Scope:** Phase 5 of 7 from `docs/design-plans/2026-08-09-multi-post-threads.md`.

**Codebase verified:** 2026-08-10. Key anchors in `src/components/compose.jsx`: state block ~265–275 (`visibility`, `mediaAttachments`, `poll`, `scheduledAt`), `crossPostAccounts` memo 225–234, config destructure 236–257, draftStatus unpack 627–662, `saveUnsavedDraft` 853–916, submit handler 1322–1597, cross-post toggle 1849–1872, `CharCountMeter` render 2084–2087.

**Read before editing:** the whole render section of compose.jsx between the main textarea and the actions toolbar, plus `compose.css`, to place new UI consistently with existing idioms (classes like `toolbar`, `with-text-icon`; `<Icon>` usage; Lingui `t`/`<Trans>` for all user-facing strings).

---

### Task 1: Segment state, effective character limit, and helpers

**Files:**
- Modify: `src/components/compose.jsx`

**Step 1: Add state and constants**

Near the existing media/poll state (~line 273):

```js
const MAX_THREAD_SEGMENTS = 25;
// Additional thread segments beyond the main editor (segment #1).
// [{ uid, text, mediaAttachments: [] }]
const [moreSegments, setMoreSegments] = useState([]);
```

**Step 2: Effective character limit**

Near the `configuration` destructure (~236–257), add a memo. `getCurrentAccount`/network detection: `blueskyInstanceInfo` already reports `maxCharacters: 300` when the *primary* account is Bluesky, so only cross-post targets need checking. Import `isBlueskyAccount` from `../utils/bluesky` (check its export in `src/utils/bluesky/index.js` first):

```js
const BLUESKY_MAX_CHARACTERS = 300;
// When cross-posting to a Bluesky account, the strictest limit binds.
const crossPostToBluesky =
  crossPost && crossPostAccounts.some((a) => isBlueskyAccount(a));
const effectiveMaxCharacters =
  crossPostToBluesky && maxCharacters > BLUESKY_MAX_CHARACTERS
    ? BLUESKY_MAX_CHARACTERS
    : maxCharacters;
const charLimitBoundByBluesky =
  effectiveMaxCharacters === BLUESKY_MAX_CHARACTERS &&
  maxCharacters !== BLUESKY_MAX_CHARACTERS;
```

Note: `crossPost`/`crossPostAccounts` are declared at 225–234, *before* this region — verify ordering; if the config destructure precedes them, move this memo below both.

**Step 3: Point the existing counter at the effective limit**

At the `CharCountMeter` render (2084–2087), pass `maxCharacters={effectiveMaxCharacters}`; when `charLimitBoundByBluesky`, render a small adjacent hint (`<span class="ib insignificant">Bluesky</span>` styled like neighboring hints, with a `title` explaining the limit). Also update any submit-validation that compares text length against `maxCharacters` to use `effectiveMaxCharacters` (search the handler for `maxCharacters` uses).

**Step 4: Verify build, commit**

Run: `npm run build` — expected: success.

```bash
npx oxfmt src/components/compose.jsx
git add src/components/compose.jsx
git commit -m "feat: thread segment state + strictest-network character limit"
git push
```

---

### Task 2: Segment editors and "+" button

**Files:**
- Modify: `src/components/compose.jsx`
- Modify: `src/components/compose.css`

**Step 1: Render extra segments**

Directly after the main editor block (textarea + its media list), before the actions toolbar, render:

```jsx
{moreSegments.map((segment, i) => (
  <ThreadSegmentEditor
    key={segment.uid}
    index={i}
    segment={segment}
    maxCharacters={effectiveMaxCharacters}
    maxMediaAttachments={maxMediaAttachments}
    disabled={uiState === 'loading'}
    onChange={(patch) =>
      setMoreSegments((segs) =>
        segs.map((s) => (s.uid === segment.uid ? { ...s, ...patch } : s)),
      )
    }
    onRemove={() =>
      setMoreSegments((segs) => segs.filter((s) => s.uid !== segment.uid))
    }
  />
))}
```

`ThreadSegmentEditor` is a new component in the same file (below `Compose`, alongside the file's other internal components): a bordered container with (a) a plain `<textarea>` (reuse the main textarea's styling class; simple `onInput` into `onChange({ text })` — no autocomplete/custom-text-area integration needed for v1), (b) a media button (`<Icon icon="attachment" />`) triggering a hidden `<input type="file" multiple accept="image/*,video/*">` whose files run through `processFiles`-equivalent logic into `onChange({ mediaAttachments })` (respect `maxMediaAttachments`; reuse the existing attachment-preview rendering if cheaply reusable — otherwise filename chips with a remove button suffice for v1), (c) its own `CharCountMeter` fed by `countableText(segment.text)`, and (d) a remove "×" button (`onRemove` — deleting a middle segment just closes the gap).

**Step 2: The "+" button**

After the segments list, render an add button — visible only when `!editStatus` (threads don't apply to edits):

```jsx
{!editStatus && moreSegments.length < MAX_THREAD_SEGMENTS - 1 && (
  <button
    type="button"
    class="light add-thread-segment"
    disabled={uiState === 'loading'}
    onClick={() =>
      setMoreSegments((segs) => [
        ...segs,
        { uid: uid(), text: '', mediaAttachments: [] },
      ])
    }
  >
    <Icon icon="plus" /> <Trans>Add to thread</Trans>
  </button>
)}
```

(Verify `plus` exists in the project's icon set — grep `icon="plus"`; substitute the idiomatic equivalent if not.)

**Step 3: Disable scheduling for threads**

Where the schedule UI renders (search `scheduledAt` setter UI): disable it (with a title/tooltip "Threads can't be scheduled") when `moreSegments.length > 0`, and disable the "+" button when `scheduledAt` is set. One of the two must yield; never allow both simultaneously.

**Step 4: CSS**

In `compose.css`, add modest styles: `.thread-segment` container (top border or indent rail echoing the app's thread rendering), `.add-thread-segment` (subtle, full-width). Match existing variable usage (`var(--bg-color)` etc. — read neighboring rules first).

**Step 5: Verify + commit**

Run: `npm run build` — success. Run `npm run dev` briefly and load http://localhost:5173 to confirm the composer renders (no interaction needed beyond opening the compose box if achievable without login; otherwise build-check suffices tonight).

```bash
npx oxfmt src/components/compose.jsx
git add src/components/compose.jsx src/components/compose.css
git commit -m "feat: thread segment editors and add-to-thread button"
git push
```

---

### Task 3: Submit wiring

**Files:**
- Modify: `src/components/compose.jsx` (submit handler, Phase 1's rewired region)

**Step 1: Validation**

In the submit handler's validation section (~1338–1373), add: every `moreSegments` entry must have non-empty trimmed `text` and `countableText(text).length <= effectiveMaxCharacters`; on violation, `alert` (matching the file's existing validation idiom) and return.

**Step 2: Build segments and publish**

In the Phase 1 create branch, replace the single-segment `segments` array with:

```js
const segments = [
  {
    text: status,
    mediaIds: mediaAttachments.map((attachment) => attachment.id),
    poll,
  },
  ...moreSegments.map((segment) => ({
    text: segment.text,
    // publishThread uploads these to the target (fileData path)
    mediaAttachments: segment.mediaAttachments,
  })),
];
```

Interim failure behavior (Phase 6 replaces this): if `failedAtIndex !== null && statuses.length > 0`, `alert` "Posted ${statuses.length} of ${segments.length} posts — the rest failed: ${error?.message}" then `throw error`; if no statuses, just `throw error` (existing catch handles it). On full success with `moreSegments.length`, clear `setMoreSegments([])` before `onClose`.

Cross-post note: leave the cross-post loop passing only the single first segment for now — Phase 7 makes cross-posted threads whole. Guard it: when `moreSegments.length > 0`, skip the cross-post loop entirely and `showToast(t`Cross-posting threads coming soon — posted to primary account only`)`. (Prevents shipping a misleading half-thread cross-post between phases.)

**Step 3: Verify + commit**

Run: `npm run build` && `npm run test:unit` — both green.

```bash
npx oxfmt src/components/compose.jsx
git add src/components/compose.jsx
git commit -m "feat: post multi-segment threads from the composer"
git push
```

---

### Task 4: Draft persistence

**Files:**
- Modify: `src/components/compose.jsx`

**Step 1: Save**

In `saveUnsavedDraft` (853–916), add `moreSegments` into the persisted `draftStatus` object (sibling of `mediaAttachments`; ArrayBuffer `fileData` in segment media persists fine in IndexedDB, same as main attachments). Also include `moreSegments` in the draft-dirtiness comparison so a thread-only change marks the draft unsaved (find the `deepEqual`/comparison guard in that function and add the field).

**Step 2: Restore**

In the `draftStatus` unpack (627–662), read `moreSegments` and `setMoreSegments(moreSegments || [])`. Old drafts lack the field → `[]` → exact pre-thread behavior. Check other `draftStatus` consumers (`grep -n "draftStatus" src/ -r`): the drafts list page renders a preview from `draftStatus.status` — if trivial, append segment texts to the preview; otherwise leave (old previews remain accurate for segment #1).

**Step 3: Verify + commit**

Run: `npm run build` && `npm run test:unit` — green.

```bash
npx oxfmt src/components/compose.jsx
git add src/components/compose.jsx
git commit -m "feat: persist thread segments in drafts"
git push
```

**Phase done when:** build + tests green; composer renders segment editors; a thread posts via `publishThread` on the primary account (LIVE verification deferred to morning checklist: 3-post thread on each network, draft save/restore of a multi-segment draft, old draft still loads).
