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
    expect(layout.lines.map((l) => l.text)).toEqual(['aaaa bbbb cccc', 'dddd']);
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
    const layout = layoutCard(
      model({ paragraphs: ['one\ntwo'] }),
      measure,
      NARROW,
    );
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
    const layout = layoutCard(model({ paragraphs: ['a', 'b'] }), measure, {
      width: 600,
    });
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
