import { describe, expect, it } from 'vitest';

import {
  countableBlueskyText,
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
  it('accepts valid single post when enforcement is disabled', () => {
    const enforceCharLimit = shouldEnforceCharLimit(300, 300, 0);
    const result = validateSegments({
      mainText: 'hello',
      moreSegments: [],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      enforceCharLimit,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toBe(null);
  });

  it('counts spoiler text toward limit when sensitive is true and enforced', () => {
    // Text: 290 chars + Spoiler: 15 chars = 305 total, exceeds 300 limit
    const result = validateSegments({
      mainText: 'x'.repeat(290),
      moreSegments: [],
      spoilerText: 'y'.repeat(15),
      sensitive: true,
      effectiveMaxCharacters: 300,
      enforceCharLimit: true,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toEqual({ segmentIndex: 0, reason: 'too-long' });
  });

  it('does not count spoiler text when sensitive is false', () => {
    // Even with long spoiler, if not sensitive, should pass (when enforced)
    const result = validateSegments({
      mainText: 'x'.repeat(290),
      moreSegments: [],
      spoilerText: 'y'.repeat(200), // Long spoiler that would exceed if counted
      sensitive: false,
      effectiveMaxCharacters: 300,
      enforceCharLimit: true,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toBe(null); // Only counts the 290 chars of text
  });

  it('rejects empty thread segment (always checked)', () => {
    const result = validateSegments({
      mainText: 'hello',
      moreSegments: [{ text: '   ' }, { text: 'valid' }],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      enforceCharLimit: false,
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
      enforceCharLimit: true,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    // Empty segment is at index 1 in moreSegments, so segmentIndex = 1 + 1 = 2
    expect(result).toEqual({ segmentIndex: 2, reason: 'empty' });
  });

  it('checks thread segment length and reports correct index when enforced', () => {
    const result = validateSegments({
      mainText: 'hello',
      moreSegments: [
        { text: 'valid segment' },
        { text: 'x'.repeat(301) }, // Exceeds limit
      ],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      enforceCharLimit: true,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    // Segment at index 1 in moreSegments, so segmentIndex = 1 + 1 = 2
    expect(result).toEqual({ segmentIndex: 2, reason: 'too-long' });
  });

  it('counts spoiler text for all thread segments when sensitive and enforced', () => {
    // Main: 50 + Spoiler: 20 = 70 (ok)
    // Segment 1: 250 + Spoiler: 20 = 270 (ok, both under 300 limit)
    const result = validateSegments({
      mainText: 'x'.repeat(50),
      moreSegments: [{ text: 'y'.repeat(250) }],
      spoilerText: 'z'.repeat(20),
      sensitive: true,
      effectiveMaxCharacters: 300,
      enforceCharLimit: true,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toBe(null);
  });

  it('production: Mastodon solo (500/500/0) → backend validates, client allows 501-char post', () => {
    // Single Mastodon post that exceeds 500 chars should NOT be rejected by client
    // (backend will catch it for this network's own limit)
    const enforceCharLimit = shouldEnforceCharLimit(500, 500, 0);
    const result = validateSegments({
      mainText: 'x'.repeat(501),
      moreSegments: [],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 500,
      enforceCharLimit,
      blueskyRules: false,
      stringLength: simpleStringLength,
    });
    expect(result).toBe(null); // Passes when gate is false (no client enforcement)
  });

  it('production: Mastodon thread → client enforces 500 char limit', () => {
    // Thread with second segment exceeding 500 chars should be rejected
    const enforceCharLimit = shouldEnforceCharLimit(500, 500, 1);
    const result = validateSegments({
      mainText: 'hello',
      moreSegments: [{ text: 'x'.repeat(501) }],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 500,
      enforceCharLimit,
      blueskyRules: false,
      stringLength: simpleStringLength,
    });
    expect(result).toEqual({ segmentIndex: 1, reason: 'too-long' });
  });

  it('production: Mastodon+Bluesky cross-post solo (300<500) → client enforces 300 limit', () => {
    // Solo post on Mastodon account but also posting to Bluesky, strictest limit is 300
    const enforceCharLimit = shouldEnforceCharLimit(300, 500, 0);
    const result = validateSegments({
      mainText: 'x'.repeat(301),
      moreSegments: [],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      enforceCharLimit,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toEqual({ segmentIndex: 0, reason: 'too-long' });
  });

  it('production: Bluesky solo (300/300/0) → backend validates, client allows over-limit', () => {
    // Bluesky solo post that exceeds 300 chars should NOT be rejected by client
    // (Bluesky backend will catch it)
    const enforceCharLimit = shouldEnforceCharLimit(300, 300, 0);
    const result = validateSegments({
      mainText: 'x'.repeat(301),
      moreSegments: [],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      enforceCharLimit,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toBe(null); // Passes when gate is false (no client enforcement)
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
      enforceCharLimit: true,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    // Should find the empty one first
    expect(result).toEqual({ segmentIndex: 2, reason: 'empty' });
  });
});

describe('countableBlueskyText', () => {

  it('counts long URLs at their shortened display length', () => {
    const url =
      'https://www.sfchronicle.com/politics/article/tech-worker-democrat-republican-22378308.php?utm_source=marketing&utm_medium=copy-url-link';
    expect(countableBlueskyText(`read ${url} now`)).toBe(
      'read www.sfchronicle.com/politics/art... now',
    );
  });

  it('counts short URLs as host + path', () => {
    expect(countableBlueskyText('see https://lu.is/about')).toBe(
      'see lu.is/about',
    );
  });

  it('leaves non-URL text untouched', () => {
    expect(countableBlueskyText('hello @alice.bsky.social')).toBe(
      'hello @alice.bsky.social',
    );
  });

  it('validateSegments passes a long-URL post under bluesky rules', () => {
    const url =
      'https://www.sfchronicle.com/politics/article/tech-worker-democrat-republican-22378308.php?utm_source=marketing&utm_medium=copy-url-link&hash=aHR0cHM6Ly93d3cuc2ZjaHJvbmljbGUuY29tL3BvbGl0aWNzL2FydGljbGUvdGVjaC13b3JrZXItZGVtb2NyYXQtcmVwdWJsaWNhbi0yMjM3ODMwOC5waHA%3D&time=MTc4ODIxMzgwNDIzOA%3D%3D';
    const result = validateSegments({
      mainText: `worth a read: ${url}`,
      moreSegments: [],
      spoilerText: '',
      sensitive: false,
      effectiveMaxCharacters: 300,
      enforceCharLimit: true,
      blueskyRules: true,
      stringLength: simpleStringLength,
    });
    expect(result).toBeNull();
  });
});
