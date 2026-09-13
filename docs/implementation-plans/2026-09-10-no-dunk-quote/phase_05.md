# Quote Without Attribution Implementation Plan — Phase 5: Documentation

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Add a "Quote without attribution" action that renders a post's text as a PNG card with the author redacted and hands it to the composer as an image attachment.

**Architecture:** Documentation only. A feature bullet in `README.md` and a short developer section in `CLAUDE.md` describing the three-layer split and the "no remote resources, no original-post identifiers" invariant.

**Tech Stack:** Markdown.

**Scope:** 5 phases from original design (`docs/design-plans/2026-09-10-no-dunk-quote.md`).

**Codebase verified:** 2026-09-10

---

See `phase_01.md` "Conventions for every phase" for commit and staging rules. Docs describe the present state only: no "previously", "used to", or "now supports" phrasing.

## Phase 5 context (verified)

- `README.md` has a `## What works today` section starting at line 35; its bullets run to the `🙈 **Filters**` bullet at line 45, followed by a `<sub>` note at line 47.
- `CLAUDE.md` sections: `## Bluesky support architecture` (line 9) with subsections `### Publishing and threading` (line 24) and `### Interweaving (merged timeline + notifications)` (line 34); then `## Service worker: stale app shell recovery` (line 51) and `## Naming` (line 92). The file's `Last verified:` line is line 3.

---

### Task 1: README feature bullet

**Files:**
- Modify: `README.md` (after the `🙈 **Filters**` bullet, line 45)

**Step 1: Add the bullet**

Directly after the `🙈 **Filters**` bullet, add:

```markdown
- 🫥 **Quote without attribution** — the boost menu offers a third quote option that shares a post's text as an image with the author redacted: a card with a gray avatar circle and name bar, the text verbatim, and a note for any omitted media, poll, or link preview. Alt text is prefilled from the post. The new post carries no link, ID, or handle of the original, so it cannot be traced back and does not notify the author. Works on posts from either network.
```

**Step 2: Verify**

Run: `sed -n 35,50p README.md`
Expected: the new bullet appears between the Filters bullet and the `<sub>` note.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe quote without attribution in the README"
git show HEAD --stat
```

---

### Task 2: CLAUDE.md developer section

**Files:**
- Modify: `CLAUDE.md` (insert before `## Service worker: stale app shell recovery`, line 51; update `Last verified:` on line 3)

**Step 1: Update the date**

Change line 3 to:

```markdown
Last verified: 2026-09-10
```

(Use the actual date the task is executed.)

**Step 2: Add the section**

Insert the following immediately before the line `## Service worker: stale app shell recovery` (keep one blank line on each side):

```markdown
## Quote without attribution

A third quote action in both boost/quote menus (action bar and kebab, `src/components/status.jsx`) shares a post's text as a PNG card with the author redacted, attached to a new post with alt text prefilled. Three layers under `src/utils/`:

- `post-card-model.js` (pure) — `buildCardModel(status)` turns a Mastodon-shaped status (Bluesky posts already arrive in this shape) into card content: content warning, plain-text paragraphs via `getHTMLText`, an omitted-content note (`[2 images not shown]`, `[poll not shown]`, `[quoted post not shown]`, `[link preview not shown]`), and alt text capped at the composer's 1500-char `descriptionLimit`. Its test runs under `// @vitest-environment happy-dom` because `getHTMLText` needs a DOM.
- `post-card-layout.js` (pure) — `layoutCard(model, measureText, opts)` wraps the content into positioned lines (word wrap, hard break for over-wide tokens, paragraph gaps, a line cap with a trailing `[…]` line). The measurer is injected so the layout is unit-tested in Node.
- `post-card-render.js` (browser only, lazy-imported) — `renderCardBlob(status)` draws the layout on a 2x Canvas 2D surface and resolves `{ blob, altText, truncated }`. `post-card-attachment.js` wraps that blob in the composer's attachment shape; the composer's existing `draftStatus` restore path attaches it.

Two invariants, both load-bearing:

- **No remote resources.** Avatar and name are gray placeholders, post media is omitted, and custom emoji stay as `:shortcode:` text, so the canvas never loads a cross-origin image and never taints; `toBlob` keeps working and the strict CSP needs no allowance. A DOM screenshot (html2canvas and kin) was rejected for exactly those two failures.
- **No original-post identifiers.** Nothing derived from the original's URL, ID, handle, display name, avatar, or timestamp is drawn or attached, so the new post cannot be traced through the network and does not notify the author. @-mentions inside the body are kept verbatim by decision.

On a post the user cannot boost (`!canBoost`): <replace with the Phase 4 Step 6.8 observation, one sentence per surface, e.g. "the kebab Boost submenu is disabled, so the action is unreachable there; the action-bar menu still opens and the action works">.
```

Replace the angle-bracket placeholder with the actual observation from Phase 4 Step 6.8 before committing. Do not commit the placeholder.

**Step 3: Verify**

Run: `grep -n "^## " CLAUDE.md`
Expected: `## Quote without attribution` appears between `## Bluesky support architecture` and `## Service worker: stale app shell recovery`.

Run: `grep -nE "used to|previously|no longer|now supports" CLAUDE.md README.md`
Expected: no hits in the text you added.

Run: `grep -n "<replace" CLAUDE.md`
Expected: no hits (the placeholder was replaced with the observation).

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: developer notes for quote without attribution

Records the model/layout/render split and the two invariants: the card
loads no remote resources, and nothing identifying the original post is
drawn or attached."
git show HEAD --stat
```
