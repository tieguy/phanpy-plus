# Quote Without Attribution Implementation Plan — Phase 2: Text layout

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Add a "Quote without attribution" action that renders a post's text as a PNG card with the author redacted and hands it to the composer as an image attachment.

**Architecture:** Three layers under `src/utils/`: a pure model (`post-card-model.js`), a pure layout (`post-card-layout.js`, this phase), and a browser-only Canvas 2D renderer (`post-card-render.js`). The layout takes a `measureText(text, style)` function as an argument so it runs and is tested in Node without a canvas.

**Tech Stack:** Vitest in the default Node environment (no DOM needed in this phase).

**Scope:** 5 phases from original design (`docs/design-plans/2026-09-10-no-dunk-quote.md`).

**Codebase verified:** 2026-09-10

---

See `phase_01.md` "Conventions for every phase" for test, commit, and staging rules.

## Phase 2 context

Input is the `CardModel` from Phase 1: `{ spoilerText, paragraphs, omittedNote, altText }`. Paragraphs may contain `\n` hard breaks. Output is a `CardLayout` the renderer can draw without any further decisions:

```
{
  width, height,                       // css px
  header: { avatar: {x,y,r}, nameBar: {x,y,w,h}, handleBar: {x,y,w,h} },
  lines: [{ text, x, y, style }],      // y = top of the line; renderer uses textBaseline 'top'
  truncated,                           // true when the line cap was hit
}
```

`style` is `'spoiler'`, `'body'`, or `'note'`. The renderer maps each style to a font; the layout only needs each style's line height.

---

### Task 1: Layout — `layoutCard`

**Files:**
- Create: `src/utils/post-card-layout.js`
- Create: `src/utils/post-card-layout.test.js`

**Step 1: Write the failing tests**

Create `src/utils/post-card-layout.test.js`:

```js
import { describe, expect, it } from 'vitest';

import {
  LINE_HEIGHT,
  PADDING,
  PARAGRAPH_GAP,
  layoutCard,
} from './post-card-layout';

// Fake measurer: every character is 10px wide, regardless of style.
const measure = (text) => text.length * 10;

function model(overrides = {}) {
  return {
    spoilerText: null,
    paragraphs: [],
    omittedNote: null,
    altText: '',
    ...overrides,
  };
}

// width 200 - 2*PADDING(24) = 152px of content = 15 characters per line.
const NARROW = { width: 200 };

describe('layoutCard', () => {
  it('wraps words onto new lines at the content width', () => {
    const layout = layoutCard(
      model({ paragraphs: ['aaaa bbbb cccc dddd'] }),
      measure,
      NARROW,
    );
    expect(layout.lines.map((l) => l.text)).toEqual([
      'aaaa bbbb cccc',
      'dddd',
    ]);
    expect(layout.lines.every((l) => l.style === 'body')).toBe(true);
    expect(layout.lines.every((l) => l.x === PADDING)).toBe(true);
    expect(layout.width).toBe(200);
  });

  it('hard-breaks a token wider than the line', () => {
    const layout = layoutCard(
      model({ paragraphs: ['x'.repeat(40)] }),
      measure,
      NARROW,
    );
    expect(layout.lines.map((l) => l.text)).toEqual([
      'x'.repeat(15),
      'x'.repeat(15),
      'x'.repeat(10),
    ]);
  });

  it('honours hard line breaks inside a paragraph', () => {
    const layout = layoutCard(model({ paragraphs: ['one\ntwo'] }), measure, NARROW);
    expect(layout.lines.map((l) => l.text)).toEqual(['one', 'two']);
  });

  it('lays out a note-only card', () => {
    const layout = layoutCard(
      model({ omittedNote: '[poll not shown]' }),
      measure,
      { width: 600 },
    );
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0]).toMatchObject({
      text: '[poll not shown]',
      style: 'note',
    });
    expect(layout.truncated).toBe(false);
  });

  it('draws the content warning first, in spoiler style', () => {
    const layout = layoutCard(
      model({ spoilerText: 'cw', paragraphs: ['body'] }),
      measure,
      { width: 600 },
    );
    expect(layout.lines.map((l) => [l.text, l.style])).toEqual([
      ['cw', 'spoiler'],
      ['body', 'body'],
    ]);
  });

  it('separates paragraphs by a gap and stacks lines by line height', () => {
    const layout = layoutCard(
      model({ paragraphs: ['a', 'b'] }),
      measure,
      { width: 600 },
    );
    const [a, b] = layout.lines;
    expect(b.y - a.y).toBe(LINE_HEIGHT.body + PARAGRAPH_GAP);
    expect(layout.height).toBe(b.y + LINE_HEIGHT.body + PADDING);
  });

  it('caps the line count and ends with an ellipsis line', () => {
    const layout = layoutCard(
      model({ paragraphs: ['a', 'b', 'c', 'd', 'e'] }),
      measure,
      { width: 600, maxLines: 3 },
    );
    expect(layout.lines.map((l) => l.text)).toEqual(['a', 'b', '[…]']);
    expect(layout.truncated).toBe(true);
  });

  it('returns a header-only card for an empty model', () => {
    const layout = layoutCard(model(), measure, { width: 600 });
    expect(layout.lines).toEqual([]);
    expect(layout.header.avatar.r).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(layout.header.avatar.r * 2);
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- src/utils/post-card-layout.test.js`
Expected: FAIL — `Failed to resolve import "./post-card-layout"`.

**Step 3: Write the implementation**

Create `src/utils/post-card-layout.js`:

```js
// Pure layout for the "quote without attribution" card. No DOM: the text
// measurer is injected so this runs under plain Node in tests.

export const DEFAULT_WIDTH = 600;
export const DEFAULT_MAX_LINES = 40;
export const PADDING = 24;
export const AVATAR_RADIUS = 20;
export const HEADER_GAP = 16;
export const PARAGRAPH_GAP = 12;
export const LINE_HEIGHT = { spoiler: 26, body: 26, note: 22 };
export const ELLIPSIS_LINE = '[…]';

// Placeholder geometry: gray circle for the avatar, a bar for the display
// name and a lighter, shorter bar for the handle.
function headerGeometry() {
  const cx = PADDING + AVATAR_RADIUS;
  const textX = PADDING + AVATAR_RADIUS * 2 + 12;
  return {
    avatar: { x: cx, y: PADDING + AVATAR_RADIUS, r: AVATAR_RADIUS },
    nameBar: { x: textX, y: PADDING + 4, w: 140, h: 14 },
    handleBar: { x: textX, y: PADDING + 24, w: 100, h: 12 },
  };
}

// Greedy hard break for a single token wider than the line.
function breakToken(token, maxWidth, measure) {
  const chunks = [];
  let current = '';
  for (const ch of token) {
    if (current && measure(current + ch) > maxWidth) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Word-wrap one paragraph (which may contain '\n' hard breaks) into lines.
function wrap(text, maxWidth, measure) {
  const out = [];
  for (const hardLine of text.split('\n')) {
    if (hardLine === '') {
      out.push('');
      continue;
    }
    let current = '';
    for (const word of hardLine.split(' ')) {
      if (measure(word) > maxWidth) {
        if (current) out.push(current);
        const chunks = breakToken(word, maxWidth, measure);
        current = chunks.pop();
        out.push(...chunks);
        continue;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
      } else {
        out.push(current);
        current = word;
      }
    }
    // Skip the empty remainder left by a trailing or doubled space.
    if (current) out.push(current);
  }
  return out;
}

export function layoutCard(model, measureText, opts = {}) {
  const width = opts.width ?? DEFAULT_WIDTH;
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const contentWidth = width - PADDING * 2;

  // 1. Collect every line with its style and whether a paragraph gap
  //    precedes it, before assigning positions.
  const items = [];
  const addBlock = (text, style) => {
    const measure = (t) => measureText(t, style);
    wrap(text, contentWidth, measure).forEach((line, i) => {
      items.push({ text: line, style, gapBefore: i === 0 && items.length > 0 });
    });
  };
  if (model.spoilerText) addBlock(model.spoilerText, 'spoiler');
  for (const paragraph of model.paragraphs) addBlock(paragraph, 'body');
  if (model.omittedNote) addBlock(model.omittedNote, 'note');

  // 2. Cap the line count; the last kept slot becomes the ellipsis line.
  let truncated = false;
  if (items.length > maxLines) {
    truncated = true;
    items.length = Math.max(maxLines - 1, 0);
    items.push({ text: ELLIPSIS_LINE, style: 'body', gapBefore: false });
  }

  // 3. Assign positions top-down.
  const header = headerGeometry();
  let y = PADDING + AVATAR_RADIUS * 2 + HEADER_GAP;
  const lines = [];
  for (const item of items) {
    if (item.gapBefore) y += PARAGRAPH_GAP;
    lines.push({ text: item.text, x: PADDING, y, style: item.style });
    y += LINE_HEIGHT[item.style];
  }
  const height = (lines.length ? y : PADDING + AVATAR_RADIUS * 2) + PADDING;

  return { width, height, header, lines, truncated };
}
```

**Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- src/utils/post-card-layout.test.js`
Expected: PASS, 8 tests.

Then: `npm run test:unit` — all files pass (26 files).

**Step 5: Commit**

```bash
git add src/utils/post-card-layout.js src/utils/post-card-layout.test.js
git commit -m "feat: pure text layout for the no-attribution quote card

layoutCard wraps the card model into positioned lines for a fixed width,
hard-breaking tokens wider than a line, spacing paragraphs, and capping
the line count with a trailing [...] line. The text measurer is injected
so the layout is unit-tested in Node without a canvas."
git show HEAD --stat
```
