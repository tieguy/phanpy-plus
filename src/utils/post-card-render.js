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
  name: `bold 15px ${FONT_FAMILY}`,
  handle: `13px ${FONT_FAMILY}`,
  glyph: `22px ${FONT_FAMILY}`,
};
// One palette per theme. The card follows the app: a manual choice is the
// `is-dark` / `is-light` class on <html> (set in app.jsx); otherwise the
// system preference applies.
const PALETTES = {
  light: {
    background: '#ffffff',
    border: '#e2e2e2',
    placeholder: '#c8c8c8',
    text: '#1a1a1a',
    note: '#6b6b6b',
  },
  dark: {
    background: '#1c1c1e',
    border: '#3a3a3c',
    placeholder: '#48484a',
    text: '#f2f2f2',
    note: '#a1a1a6',
  },
};

export function currentTheme() {
  const root = document.documentElement.classList;
  if (root.contains('is-dark')) return 'dark';
  if (root.contains('is-light')) return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

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

function draw(ctx, layout, COLORS) {
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

  // Header: gray avatar circle with a mask glyph, then the explanatory
  // name and handle text where the author's would be.
  const { avatar, name, handle } = header;
  ctx.fillStyle = COLORS.placeholder;
  ctx.beginPath();
  ctx.arc(avatar.x, avatar.y, avatar.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = FONTS.glyph;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.text;
  ctx.fillText(avatar.glyph, avatar.x, avatar.y + 1);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'top';
  ctx.font = FONTS[name.style];
  ctx.fillStyle = COLORS.text;
  ctx.fillText(name.text, name.x, name.y);
  ctx.font = FONTS[handle.style];
  ctx.fillStyle = COLORS.note;
  ctx.fillText(handle.text, handle.x, handle.y);

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
  draw(ctx, layout, PALETTES[opts.theme] || PALETTES[currentTheme()]);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob)
        resolve({ blob, altText: model.altText, truncated: layout.truncated });
      else reject(new Error('Canvas produced no image'));
    }, 'image/png');
  });
}
