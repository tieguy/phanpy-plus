# Multi-post threads — live verification checklist (2026-08-10)

Everything below is deferred-but-required: the pure logic is well unit-tested
(146 tests, mutation-verified), but **the composer wiring has zero automated
coverage** — every defect found in Phases 5–7 lived there. This checklist is
the real gate for the design's behavioral criteria. Test on lookonmy.works
(Netlify auto-deployed from main).

## Sign-off needed: three recorded design deviations

- [ ] **Polls on segment #1 only** (design said per-segment; YAGNI call — phase_05.md)
- [ ] **No per-target cross-post retry** (composer closes after primary success,
      so no retry surface exists; partial cross-posts report via toast — phase_07.md)
- [ ] **Resume state component-local** (`threadPublishState`), with only the
      progress string mirrored into `states.composerState` (phase_06.md)

## Regression — nothing broke (Phases 1–2)

- [ ] 1. Single post, reply, quote, edit on both networks — unchanged
- [ ] 2. Single post cross-posted to the other network — unchanged, incl.
      "some attachments skipped" (video → Bluesky)
- [ ] 3. Single Bluesky post with media + link (card generated) + as a reply

## Core threading (Phases 3–5)

- [ ] 4. 3-post thread, **Bluesky primary**, with media and a link — posts
      atomically, renders correctly chained, link cards on individual segments
- [ ] 5. 3-post thread, **Mastodon primary** — correctly chained
- [ ] 6. Multi-segment draft: save → reload app → restore (segments + media
      come back); an **old pre-thread draft** still opens normally
- [ ] 7. Ctrl/Cmd+Enter from inside a segment textarea posts the thread

## Partial failure and resume (Phase 6)

- [ ] 8. 3-post Mastodon thread, devtools offline after post #1: posted segment
      locked with ✓, button reads "Retry remaining", main editor locked.
      Restore network, retry → chain completes with **no duplicates**
- [ ] 9. **Same-visibility-after-retry**: before retrying in #8, confirm
      visibility/language/CW controls are locked; after retry confirm every
      post carries the **same visibility** (this was a real regression caught
      in review — invisible unless specifically checked)
- [ ] 10. During the failed state, reload the browser: no stale draft reopens
      offering a from-zero republish

## Cross-posted threads (Phase 7)

- [ ] 11. 3-post thread Mastodon-primary → cross-posted whole to Bluesky
- [ ] 12. 3-post thread Bluesky-primary → cross-posted whole to Mastodon
- [ ] 13. Cross-post failure isolation: one target fails, others succeed,
      composer still closes
- [ ] 14. Thread-as-reply (thread started as a reply to an existing post)

## Watch during all of the above

- [ ] 15. **Console open on the first real Bluesky thread**: watch for
      `createThread: computed CID mismatch — reply refs may be broken` (or the
      URI/results-length mismatch warnings). These are the designed early
      warnings for the one failure mode silent in the UI — a thread that posts
      but threads incorrectly. **If it fires, stop posting threads and
      investigate before continuing.**
- [ ] 16. **CW on a Bluesky thread**: content warning on a multi-segment
      Bluesky thread — counter and posted result must agree (the CW is
      prepended to *every* segment and consumes budget in each)

## Standing hazard for future work (from the final review)

Every non-trivial Phase 5–7 defect was correct-intent code defeated by a
platform detail: Preact state bindings don't update mid-handler; disabled
controls drop out of FormData (happy-dom doesn't implement this rule, so no
test here can catch it); unbound identifiers throw at render time, not import
time. Mitigation that worked: extract decisions into pure helpers
(`compose-counting.js`, `buildCrossSegments`) and mutation-test them.
CLAUDE.md's "Contract detail — do not revert" paragraph records the FormData
case.
