# Quote Without Attribution Implementation Plan — Phase 1: Card model

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Add a "Quote without attribution" action that renders a post's text as a PNG card with the author redacted and hands it to the composer as an image attachment.

**Architecture:** Three layers under `src/utils/`: a pure model (`post-card-model.js`, what the card says plus alt text), a pure layout (`post-card-layout.js`, line wrapping with an injected `measureText`), and a browser-only Canvas 2D renderer (`post-card-render.js`, lazy-imported). A menu item in `src/components/status.jsx` calls the renderer, wraps the PNG in the composer's existing attachment shape, and opens the composer via `showCompose({ draftStatus })`.

**Tech Stack:** Preact, Vite, Vitest (`npm run test:unit`, Node environment by default; `// @vitest-environment happy-dom` per file when a DOM is needed), Canvas 2D API, Lingui macros for strings.

**Scope:** 5 phases from original design (`docs/design-plans/2026-09-10-no-dunk-quote.md`).

**Codebase verified:** 2026-09-10

---

## Conventions for every phase

- Tests live next to the source as `src/**/*.test.js`, use explicit `import { describe, expect, it } from 'vitest'`, and build fixtures by hand as plain objects.
- Run one file: `npm run test:unit -- src/utils/post-card-model.test.js`. Run everything: `npm run test:unit` (24 files / 221 tests pass at the start of this plan, checked 2026-09-10).
- Commit messages: `feat:` / `fix:` / `docs:` prefix, lowercase description. Tests ship in the same commit as the code. This repo commits straight to `main`.
- Stage by explicit path only (`git add <file> <file>`); never `git add -A` or `git add .` — other sessions may have uncommitted edits in this tree. Run `git show HEAD --stat` after each commit.
- End commit messages with the attribution trailer given in the session's system reminder.

## Phase 1 context

`src/utils/getHTMLText.js` (default export `getHTMLText(html, opts)`) converts a status's HTML body to plain text. It creates a `<template>` element at module load, so any test that imports it must run under happy-dom (see `src/components/thread-segment-editor.test.jsx` line 1 for the directive). It returns paragraphs separated by `\n\n` and `<br>` as `\n`.

Raw `status.content` from both Mastodon and the Bluesky converter (`src/utils/bluesky/convert.js`, `baseStatus`) keeps custom emoji as literal `:shortcode:` text; the `<img>` substitution happens only at render time in `enhanceContent`. So `getHTMLText(status.content)` already yields shortcodes as text.

Status fields used (Mastodon shape, also produced by the Bluesky converter): `content` (HTML), `spoilerText` (string, `''` when none), `mediaAttachments` (array; each has `type` of `image` / `video` / `gifv` / `audio` / `unknown`), `poll` (object or `null`), `card` (object or `null`), `quote` (object or `null`).

---

### Task 1: Card model — `buildCardModel`

**Files:**
- Create: `src/utils/post-card-model.js`
- Create: `src/utils/post-card-model.test.js`

**Step 1: Write the failing tests**

Create `src/utils/post-card-model.test.js`:

```js
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { ALT_TEXT_PREFIX, MAX_ALT_TEXT, buildCardModel } from './post-card-model';

function status(overrides = {}) {
  return {
    id: '1',
    url: 'https://example.social/@someone/1',
    account: { acct: 'someone@example.social', displayName: 'Someone' },
    content: '<p>Hello world</p>',
    spoilerText: '',
    mediaAttachments: [],
    poll: null,
    card: null,
    quote: null,
    ...overrides,
  };
}

describe('buildCardModel', () => {
  it('turns a plain post into one paragraph with no note', () => {
    const model = buildCardModel(status());
    expect(model.spoilerText).toBeNull();
    expect(model.paragraphs).toEqual(['Hello world']);
    expect(model.omittedNote).toBeNull();
    expect(model.altText).toBe(`${ALT_TEXT_PREFIX}Hello world`);
  });

  it('splits paragraphs and keeps line breaks inside a paragraph', () => {
    const model = buildCardModel(
      status({ content: '<p>One<br>two</p><p>Three</p>' }),
    );
    expect(model.paragraphs).toEqual(['One\ntwo', 'Three']);
  });

  it('keeps the content warning and prefixes it in the alt text', () => {
    const model = buildCardModel(
      status({ spoilerText: 'spoilers', content: '<p>Body</p>' }),
    );
    expect(model.spoilerText).toBe('spoilers');
    expect(model.altText).toBe(`${ALT_TEXT_PREFIX}CW: spoilers\n\nBody`);
  });

  it('notes omitted images on a media-only post', () => {
    const model = buildCardModel(
      status({
        content: '',
        mediaAttachments: [{ type: 'image' }, { type: 'image' }],
      }),
    );
    expect(model.paragraphs).toEqual([]);
    expect(model.omittedNote).toBe('[2 images not shown]');
    expect(model.altText).toBe(`${ALT_TEXT_PREFIX}[2 images not shown]`);
  });

  it('counts videos separately from images', () => {
    const model = buildCardModel(
      status({
        mediaAttachments: [{ type: 'image' }, { type: 'gifv' }, { type: 'video' }],
      }),
    );
    expect(model.omittedNote).toBe('[1 image, 2 videos not shown]');
  });

  it('notes an omitted poll', () => {
    const model = buildCardModel(status({ poll: { options: [] } }));
    expect(model.omittedNote).toBe('[poll not shown]');
  });

  it('notes an omitted quoted post', () => {
    const model = buildCardModel(status({ quote: { id: '2' } }));
    expect(model.omittedNote).toBe('[quoted post not shown]');
  });

  it('notes an omitted link preview', () => {
    const model = buildCardModel(status({ card: { url: 'https://x' } }));
    expect(model.omittedNote).toBe('[link preview not shown]');
  });

  it('joins several omitted things into one note', () => {
    const model = buildCardModel(
      status({ mediaAttachments: [{ type: 'image' }], poll: {}, card: {} }),
    );
    expect(model.omittedNote).toBe(
      '[1 image not shown] [poll not shown] [link preview not shown]',
    );
  });

  it('keeps custom emoji as their shortcode', () => {
    const model = buildCardModel(
      status({
        content: '<p>hi :blobcat:</p>',
        emojis: [{ shortcode: 'blobcat', url: 'https://x/blobcat.png' }],
      }),
    );
    expect(model.paragraphs).toEqual(['hi :blobcat:']);
    expect(model.altText).toContain(':blobcat:');
  });

  it('truncates alt text to the limit with an ellipsis', () => {
    const long = 'a'.repeat(2000);
    const model = buildCardModel(status({ content: `<p>${long}</p>` }));
    expect(model.altText.length).toBe(MAX_ALT_TEXT);
    expect(model.altText.endsWith('…')).toBe(true);
    expect(model.altText.startsWith(ALT_TEXT_PREFIX)).toBe(true);
  });

  it('carries nothing that identifies the author', () => {
    const model = buildCardModel(status());
    const dump = JSON.stringify(model);
    expect(dump).not.toContain('someone');
    expect(dump).not.toContain('Someone');
    expect(dump).not.toContain('example.social');
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- src/utils/post-card-model.test.js`
Expected: FAIL — `Failed to resolve import "./post-card-model"`.

**Step 3: Write the implementation**

Create `src/utils/post-card-model.js`:

```js
import getHTMLText from './getHTMLText';

// Alt text is capped at 1500 chars: the composer's default descriptionLimit
// (src/components/media-attachment.jsx). Bluesky allows more; an instance
// may configure less, in which case the alt-text field's own maxlength
// clips it further. Accepted by the design.
export const MAX_ALT_TEXT = 1500;
export const ALT_TEXT_PREFIX = 'Screenshot of a post, author hidden: ';

const VIDEO_TYPES = new Set(['video', 'gifv']);

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function mediaNote(mediaAttachments) {
  if (!mediaAttachments?.length) return null;
  let images = 0;
  let videos = 0;
  let others = 0;
  for (const m of mediaAttachments) {
    if (m.type === 'image') images++;
    else if (VIDEO_TYPES.has(m.type)) videos++;
    else others++;
  }
  const parts = [];
  if (images) parts.push(plural(images, 'image'));
  if (videos) parts.push(plural(videos, 'video'));
  if (others) parts.push(plural(others, 'attachment'));
  return `[${parts.join(', ')} not shown]`;
}

// Everything the card draws, plus its alt text. Deliberately derived only
// from the post's own content — never from the author, URL, ID, or time.
export function buildCardModel(status) {
  const spoilerText = status.spoilerText?.trim() || null;

  const text = getHTMLText(status.content);
  const paragraphs = text
    ? text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  const notes = [
    mediaNote(status.mediaAttachments),
    status.poll ? '[poll not shown]' : null,
    status.quote ? '[quoted post not shown]' : null,
    status.card ? '[link preview not shown]' : null,
  ].filter(Boolean);
  const omittedNote = notes.length ? notes.join(' ') : null;

  const altBody = [
    spoilerText ? `CW: ${spoilerText}` : null,
    paragraphs.join('\n\n') || null,
    omittedNote,
  ]
    .filter(Boolean)
    .join('\n\n');
  let altText = ALT_TEXT_PREFIX + altBody;
  if (altText.length > MAX_ALT_TEXT) {
    altText = altText.slice(0, MAX_ALT_TEXT - 1) + '…';
  }

  return { spoilerText, paragraphs, omittedNote, altText };
}
```

**Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- src/utils/post-card-model.test.js`
Expected: PASS, 12 tests.

Then run the full suite: `npm run test:unit`
Expected: all files pass (25 files).

**Step 5: Commit**

```bash
git add src/utils/post-card-model.js src/utils/post-card-model.test.js
git commit -m "feat: card model for quoting a post without attribution

buildCardModel turns a Mastodon-shaped status into redacted card content
(content warning, plain-text paragraphs, a note for omitted media/poll/
quote/link preview) plus alt text capped at the composer's 1500-char
limit. Nothing derived from the author, URL, ID, or timestamp is kept."
git show HEAD --stat
```
