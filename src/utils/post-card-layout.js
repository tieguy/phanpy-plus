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
function headerGeometry(width) {
  const cx = PADDING + AVATAR_RADIUS;
  const textX = PADDING + AVATAR_RADIUS * 2 + 12;
  const maxBarWidth = width - PADDING - textX;
  return {
    avatar: { x: cx, y: PADDING + AVATAR_RADIUS, r: AVATAR_RADIUS },
    nameBar: {
      x: textX,
      y: PADDING + 4,
      w: Math.max(0, Math.min(140, maxBarWidth)),
      h: 14,
    },
    handleBar: {
      x: textX,
      y: PADDING + 24,
      w: Math.max(0, Math.min(100, maxBarWidth)),
      h: 12,
    },
  };
}

// Greedy hard break for a single token wider than the line.
// Note: iterates code points, not grapheme clusters (ZWJ sequences may split).
// This is an accepted tradeoff for simplicity; cosmetic artifacts are rare.
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
    // Drop wholly-empty remainder.
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
    if (maxLines > 0) {
      const lastKeptItem = items[maxLines - 1];
      items.length = maxLines - 1;
      items.push({
        text: ELLIPSIS_LINE,
        style: lastKeptItem.style,
        gapBefore: lastKeptItem.gapBefore,
      });
    } else {
      items.length = 0;
    }
  }

  // 3. Assign positions top-down.
  const header = headerGeometry(width);
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
