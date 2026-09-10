import { describe, expect, it } from 'vitest';

import {
  AVATAR_RADIUS,
  DEFAULT_MAX_LINES,
  DEFAULT_WIDTH,
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
    // Exact height: PADDING (top) + AVATAR_RADIUS * 2 + PADDING (bottom) = 24 + 40 + 24 = 88
    expect(layout.height).toBe(PADDING * 2 + AVATAR_RADIUS * 2);
  });

  it('uses default width and max lines when no opts provided', () => {
    // Create DEFAULT_MAX_LINES + 1 paragraphs, each wrapped as a separate line
    const paragraphs = Array.from({ length: DEFAULT_MAX_LINES + 1 }, () => 'a');
    const layout = layoutCard(model({ paragraphs }), measure);
    expect(layout.width).toBe(DEFAULT_WIDTH);
    // Should cap at DEFAULT_MAX_LINES with ellipsis on the last line
    expect(layout.lines).toHaveLength(DEFAULT_MAX_LINES);
    expect(layout.lines[DEFAULT_MAX_LINES - 1].text).toBe('[…]');
    expect(layout.truncated).toBe(true);
  });

  it('does not truncate when line count equals maxLines exactly', () => {
    const layout = layoutCard(model({ paragraphs: ['a', 'b', 'c'] }), measure, {
      width: 600,
      maxLines: 3,
    });
    expect(layout.lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
    expect(layout.truncated).toBe(false);
  });

  it('with maxLines 0 produces no lines but sets truncated when there is content', () => {
    const layout = layoutCard(model({ paragraphs: ['a'] }), measure, {
      width: 600,
      maxLines: 0,
    });
    expect(layout.lines).toEqual([]);
    expect(layout.truncated).toBe(true);
  });

  it('ellipsis inherits the style and gap of the truncated item', () => {
    // Body paragraphs, then a note, with maxLines 3
    // The note should be replaced by ellipsis, inheriting note style and gapBefore
    const layout = layoutCard(
      model({ paragraphs: ['a', 'b'], omittedNote: 'n1\nn2' }),
      measure,
      { width: 600, maxLines: 3 },
    );
    expect(layout.lines).toHaveLength(3);
    expect(layout.lines[2]).toMatchObject({
      text: '[…]',
      style: 'note',
    });
    // Ellipsis should inherit the gap that precedes a note line
    expect(layout.lines[2].y - layout.lines[1].y).toBe(
      LINE_HEIGHT.body + PARAGRAPH_GAP,
    );
    expect(layout.truncated).toBe(true);
  });

  it('header bars are clamped to card width at narrow widths', () => {
    const layout = layoutCard(model(), measure, NARROW);
    // textX = PADDING + AVATAR_RADIUS * 2 + 12 = 24 + 40 + 12 = 76
    // maxBarWidth = 200 - 24 - 76 = 100
    // Both bars should fit within 200 - PADDING
    expect(
      layout.header.nameBar.x + layout.header.nameBar.w,
    ).toBeLessThanOrEqual(200 - PADDING);
    expect(
      layout.header.handleBar.x + layout.header.handleBar.w,
    ).toBeLessThanOrEqual(200 - PADDING);
  });

  it('gap and line height are correct when transitioning from body to note', () => {
    const layout = layoutCard(
      model({ paragraphs: ['body text'], omittedNote: 'a note' }),
      measure,
      { width: 600 },
    );
    expect(layout.lines).toHaveLength(2);
    const [bodyLine, noteLine] = layout.lines;
    // The note line should be positioned with a gap after the body line
    expect(noteLine.y - bodyLine.y).toBe(LINE_HEIGHT.body + PARAGRAPH_GAP);
    // Check that the note line's height is accounted for in total height
    expect(layout.height).toBe(noteLine.y + LINE_HEIGHT.note + PADDING);
  });
});
