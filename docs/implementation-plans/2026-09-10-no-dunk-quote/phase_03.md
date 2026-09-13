# Quote Without Attribution Implementation Plan — Phase 3: Canvas renderer

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Add a "Quote without attribution" action that renders a post's text as a PNG card with the author redacted and hands it to the composer as an image attachment.

**Architecture:** This phase adds the browser-only renderer `src/utils/post-card-render.js`. It builds the model (Phase 1), lays it out with the canvas context's own `measureText` (Phase 2), paints the card on a 2x canvas, and resolves `{ blob, altText, truncated }` (a PNG `Blob` plus the alt text and truncation flag). It is lazy-imported by the menu in Phase 4, matching how `thread-writes.js` and `@atproto/api` are loaded.

**Tech Stack:** Canvas 2D API (`document.createElement('canvas')`, `getContext('2d')`, `toBlob`). No new dependency.

**Scope:** 5 phases from original design (`docs/design-plans/2026-09-10-no-dunk-quote.md`).

**Codebase verified:** 2026-09-10

---

See `phase_01.md` "Conventions for every phase" for commit and staging rules.

## Phase 3 context

This is an infrastructure-style task per the design: "Done when: manual browser check renders a card for a long post, a CW post, and a media-only post, with no console errors and no network requests." No unit test is written for the renderer; the two pure layers below it are already tested.

Existing canvas code in the app (`src/components/status-card.jsx` around line 139, `src/components/avatar.jsx` line 17) uses `document.createElement('canvas')` with `getContext('2d')`; this renderer does the same. `toBlob` is only on `HTMLCanvasElement`, so do not use `OffscreenCanvas` here.

The app's body font is the system stack. Use `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.

---

### Task 1: Renderer — `renderCardBlob`

**Files:**
- Create: `src/utils/post-card-render.js`

**Step 1: Create the file**

```js
// Browser-only: draws the "quote without attribution" card with Canvas 2D
// and returns a PNG Blob plus metadata. Lazy-import this module from UI code.
//
// The card contains no remote resources on purpose: avatar and name are
// gray placeholders, post media is omitted, custom emoji stay as
// :shortcode: text. That keeps it free of CORS and CSP concerns.

import { layoutCard, DEFAULT_WIDTH } from './post-card-layout';
import { buildCardModel } from './post-card-model';

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const FONTS = {
  spoiler: `bold 17px ${FONT_FAMILY}`,
  body: `17px ${FONT_FAMILY}`,
  note: `italic 15px ${FONT_FAMILY}`,
};
const COLORS = {
  background: '#ffffff',
  border: '#e2e2e2',
  placeholder: '#c8c8c8',
  placeholderLight: '#e0e0e0',
  text: '#1a1a1a',
  note: '#6b6b6b',
};
const CORNER_RADIUS = 16;
const MIN_WIDTH = 240; // Guard against degenerate card widths

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function draw(ctx, layout) {
  const { width, height, header, lines } = layout;
  // Clamp corner radius to prevent it from exceeding half the card dimensions
  const r = Math.min(CORNER_RADIUS, width / 2, height / 2);

  // Card background with rounded corners and a subtle border. The corners
  // outside the rounded path stay transparent in the PNG.
  ctx.fillStyle = COLORS.background;
  roundedRect(ctx, 0, 0, width, height, r);
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  roundedRect(ctx, 0.5, 0.5, width - 1, height - 1, r);
  ctx.stroke();

  // Header placeholders: avatar circle, name bar, handle bar.
  ctx.fillStyle = COLORS.placeholder;
  ctx.beginPath();
  ctx.arc(header.avatar.x, header.avatar.y, header.avatar.r, 0, Math.PI * 2);
  ctx.fill();
  const { nameBar, handleBar } = header;
  roundedRect(ctx, nameBar.x, nameBar.y, nameBar.w, nameBar.h, nameBar.h / 2);
  ctx.fill();
  ctx.fillStyle = COLORS.placeholderLight;
  roundedRect(
    ctx,
    handleBar.x,
    handleBar.y,
    handleBar.w,
    handleBar.h,
    handleBar.h / 2,
  );
  ctx.fill();

  // Text lines. Layout y is the top of each line.
  ctx.textBaseline = 'top';
  for (const line of lines) {
    ctx.font = FONTS[line.style];
    ctx.fillStyle = line.style === 'note' ? COLORS.note : COLORS.text;
    ctx.fillText(line.text, line.x, line.y);
  }
}

// Resolves { blob, altText, truncated } for the card of `status`.
// Rejects when the canvas cannot produce a blob (e.g. a tainted or
// zero-size canvas).
export async function renderCardBlob(status, opts = {}) {
  const scale = Math.max(2, window.devicePixelRatio || 1);
  const model = buildCardModel(status);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const measureText = (text, style) => {
    ctx.font = FONTS[style];
    return ctx.measureText(text).width;
  };
  // Guard against degenerate widths by enforcing a minimum
  // Anything but a number counts as "not given".
  const requested = typeof opts.width === 'number' ? opts.width : NaN;
  const guardedOpts = {
    ...opts,
    width: Number.isFinite(requested)
      ? Math.max(MIN_WIDTH, requested)
      : DEFAULT_WIDTH,
  };
  const layout = layoutCard(model, measureText, guardedOpts);

  canvas.width = Math.ceil(layout.width * scale);
  canvas.height = Math.ceil(layout.height * scale);
  // Setting width/height resets the context state, so scale after sizing.
  ctx.scale(scale, scale);
  draw(ctx, layout);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob)
        resolve({ blob, altText: model.altText, truncated: layout.truncated });
      else reject(new Error('Canvas produced no image'));
    }, 'image/png');
  });
}
```

**Step 2: Verify operationally in a browser**

1. Start the dev server: `npm run dev` (note the printed URL, normally `http://localhost:5173`).
2. Open the app in a browser, open DevTools, and clear the Network panel.
3. In the Console, run:

```js
const { renderCardBlob } = await import('/src/utils/post-card-render.js');
const base = { spoilerText: '', mediaAttachments: [], poll: null, card: null, quote: null };
const long = { ...base, content: '<p>' + 'A fairly long sentence that should wrap across several lines. '.repeat(12) + '</p><p>Second paragraph with :blobcat: emoji and a ' + 'verylongtokenwithoutspaces'.repeat(4) + '</p>' };
const cw = { ...base, spoilerText: 'spoilers ahead', content: '<p>Hidden body</p>' };
const mediaOnly = { ...base, content: '', mediaAttachments: [{ type: 'image' }, { type: 'image' }] };
for (const s of [long, cw, mediaOnly]) {
  const { blob } = await renderCardBlob(s);
  window.open(URL.createObjectURL(blob));
}
```

Expected:
- Three PNG tabs open (allow pop-ups if the browser blocks them, or view one at a time).
- Every card has rounded corners (transparent outside the curve).
- The long post shows a gray circle, a gray name bar and lighter handle bar, wrapped body text, `:blobcat:` as literal text, and the long token hard-broken across lines. Text is crisp (2x scale).
- The CW post shows the warning in bold above the body.
- The media-only post shows only the header and the italic muted note `[2 images not shown]`.
- The Console shows no errors.
- The Network panel shows no requests other than the module load of `post-card-render.js` and its two imports. No image, font, or API requests.

**Step 3: Commit**

```bash
git add src/utils/post-card-render.js
git commit -m "feat: canvas renderer for the no-attribution quote card

renderCardBlob draws the redacted card (placeholder avatar and name,
content warning, wrapped body, omitted-content note) on a 2x Canvas 2D
surface and resolves the PNG Blob with its alt text and
truncation flag. Nothing is fetched: no avatar, media,
emoji images, or web fonts, so the render needs no CORS or CSP
allowances. Verified by hand in the browser."
git show HEAD --stat
```
