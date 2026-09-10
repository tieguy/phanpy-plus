// Browser-only: draws the "quote without attribution" card with Canvas 2D
// and returns a PNG Blob. Lazy-import this module from UI code.
//
// The card contains no remote resources on purpose: avatar and name are
// gray placeholders, post media is omitted, custom emoji stay as
// :shortcode: text. That keeps it free of CORS and CSP concerns.

import { layoutCard } from './post-card-layout';
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

  // Card background with rounded corners and a subtle border. The corners
  // outside the rounded path stay transparent in the PNG.
  ctx.fillStyle = COLORS.background;
  roundedRect(ctx, 0, 0, width, height, CORNER_RADIUS);
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  roundedRect(ctx, 0.5, 0.5, width - 1, height - 1, CORNER_RADIUS);
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

// Resolves a PNG Blob of the card for `status`. Rejects when the canvas
// cannot produce a blob (e.g. a tainted or zero-size canvas).
export async function renderCardBlob(status, opts = {}) {
  const scale = Math.max(2, window.devicePixelRatio || 1);
  const model = buildCardModel(status);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const measureText = (text, style) => {
    ctx.font = FONTS[style];
    return ctx.measureText(text).width;
  };
  const layout = layoutCard(model, measureText, opts);

  canvas.width = Math.ceil(layout.width * scale);
  canvas.height = Math.ceil(layout.height * scale);
  // Setting width/height resets the context state, so scale after sizing.
  ctx.scale(scale, scale);
  draw(ctx, layout);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas produced no image'));
    }, 'image/png');
  });
}
