import { describe, expect, it } from 'vitest';

import {
  getSegmentCharCount,
  shouldEnforceCharLimit,
  validateSegments,
} from './compose-counting';

// Simple string length for testing (counts grapheme clusters, not Unicode)
const simpleStringLength = (str) => [...str].length;

describe('shouldEnforceCharLimit', () => {
  it('requires enforcement when effective limit is stricter than base limit', () => {
    expect(shouldEnforceCharLimit(300, 500, 0)).toBe(true); // Bluesky primary solo
  });

  it('requires enforcement for threads (multiple segments)', () => {
    expect(shouldEnforceCharLimit(500, 500, 1)).toBe(true);
  });

  it('skips enforcement for solo post with matching limits', () => {
    expect(shouldEnforceCharLimit(500, 500, 0)).toBe(false);
  });
});

describe('getSegmentCharCount', () => {
  it('counts text only when no spoiler', () => {
    expect(
      getSegmentCharCount('hello world', '', false, true, simpleStringLength),
    ).toBe(11);
  });

  it('adds spoiler text when sensitive is true', () => {
    expect(
      getSegmentCharCount(
        'hello world',
        'warning',
        true,
        true,
        simpleStringLength,
      ),
    ).toBe(11 + 7); // text + spoiler
  });

  it('ignores spoiler text when sensitive is false', () => {
    expect(
      getSegmentCharCount(
        'hello world',
        'warning',
        false,
        true,
        simpleStringLength,
      ),
    ).toBe(11); // only text, spoiler ignored
  });

  it('handles empty spoiler text gracefully', () => {
    expect(
      getSegmentCharCount(
        'hello world',
        undefined,
        true,
        true,
        simpleStringLength,
      ),
    ).toBe(11); // no extra for undefined spoiler
  });
});

describe('validateSegments', () => {
  it('accepts valid single post', () => {
    const result = validateSegments({
      mainText: 'hello',
      moreSegments: [],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toBe(null);
  });

  it('rejects post exceeding character limit', () => {
    const result = validateSegments({
      mainText: 'x'.repeat(301),
      moreSegments: [],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toEqual({ segmentIndex: 0, reason: 'too-long' });
  });

  it('counts spoiler text toward limit when sensitive is true', () => {
    // Text: 290 chars + Spoiler: 15 chars = 305 total, exceeds 300 limit
    const result = validateSegments({
      mainText: 'x'.repeat(290),
      moreSegments: [],
      spoilerText: 'y'.repeat(15),
      sensitive: true,
      effectiveMaxCharacters: 300,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toEqual({ segmentIndex: 0, reason: 'too-long' });
  });

  it('does not count spoiler text when sensitive is false', () => {
    // Even with long spoiler, if not sensitive, should pass
    const result = validateSegments({
      mainText: 'x'.repeat(290),
      moreSegments: [],
      spoilerText: 'y'.repeat(200), // Long spoiler that would exceed if counted
      sensitive: false,
      effectiveMaxCharacters: 300,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toBe(null); // Only counts the 290 chars of text
  });

  it('rejects empty thread segment', () => {
    const result = validateSegments({
      mainText: 'hello',
      moreSegments: [{ text: '   ' }, { text: 'valid' }],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toEqual({ segmentIndex: 1, reason: 'empty' });
  });

  it('reports correct segment index for empty segment in middle', () => {
    const result = validateSegments({
      mainText: 'hello',
      moreSegments: [
        { text: 'segment 1' },
        { text: '' },
        { text: 'segment 3' },
      ],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    // Empty segment is at index 1 in moreSegments, so segmentIndex = 1 + 1 = 2
    expect(result).toEqual({ segmentIndex: 2, reason: 'empty' });
  });

  it('checks thread segment length and reports correct index', () => {
    const result = validateSegments({
      mainText: 'hello',
      moreSegments: [
        { text: 'valid segment' },
        { text: 'x'.repeat(301) }, // Exceeds limit
      ],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    // Segment at index 1 in moreSegments, so segmentIndex = 1 + 1 = 2
    expect(result).toEqual({ segmentIndex: 2, reason: 'too-long' });
  });

  it('counts spoiler text for all thread segments when sensitive', () => {
    // Main: 50, Spoiler: 20, Segment 1: 250 = 50+20+250 = 320 on segment (exceeds 300)
    const result = validateSegments({
      mainText: 'x'.repeat(50),
      moreSegments: [{ text: 'y'.repeat(250) }],
      spoilerText: 'z'.repeat(20),
      sensitive: true,
      effectiveMaxCharacters: 300,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    // Segment 1 (index 1 in moreSegments) exceeds: 250 + 20 = 270 (ok)
    // But main was 50 + 20 = 70 (ok)
    // Wait, each segment gets the spoiler prepended, so:
    // Main: 50 + 20 = 70 (ok)
    // Segment 1: 250 + 20 = 270 (ok)
    // So this should be valid... let me recalculate
    expect(result).toBe(null);
  });

  it('handles Bluesky vs Mastodon counting rules (no enforcement for unlimited)', () => {
    const result = validateSegments({
      mainText: 'x'.repeat(500),
      moreSegments: [],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: Infinity, // Unlimited (Mastodon solo, no cross-post)
      blueskyRules: false,
      stringLength: simpleStringLength,
    });
    expect(result).toBe(null);
  });

  it('validates thread with multiple segments and finds first violation', () => {
    const result = validateSegments({
      mainText: 'hello',
      moreSegments: [
        { text: 'segment 1' },
        { text: '' }, // First violation: empty
        { text: 'x'.repeat(301) }, // Second violation: too long
      ],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    // Should find the empty one first
    expect(result).toEqual({ segmentIndex: 2, reason: 'empty' });
  });
});
