import { describe, expect, it } from 'vitest';

import { computeSyncActions, SYNCED_FILTER_TITLE } from './muted-words-diff';

const NOW = Date.parse('2026-07-10T00:00:00Z');
const PAST = '2026-07-09T00:00:00Z';
const FUTURE = '2026-07-11T00:00:00Z';

// Mastodon filter shape (as returned by masto.js, camelCase)
function mastoFilter({
  title = 'A filter',
  filterAction = 'hide',
  expiresAt = null,
  keywords = [],
} = {}) {
  return {
    id: title,
    title,
    context: ['home'],
    expiresAt,
    filterAction,
    keywords: keywords.map((keyword, i) => ({ id: String(i), keyword })),
  };
}

// The Bluesky facade represents one muted word as one single-keyword
// filter with filterAction 'hide'
function bskyWord(value, expiresAt) {
  return {
    id: value,
    title: value,
    context: ['home'],
    expiresAt: expiresAt || null,
    filterAction: 'hide',
    keywords: [{ id: value, keyword: value }],
  };
}

describe('computeSyncActions', () => {
  it('unions both ways', () => {
    const { toBluesky, toMastodon } = computeSyncActions(
      [mastoFilter({ keywords: ['crypto', 'shared'] })],
      [bskyWord('shared'), bskyWord('spoilers')],
      NOW,
    );
    expect(toBluesky).toEqual(['crypto']);
    expect(toMastodon).toEqual(['spoilers']);
  });

  it('is a no-op once both sides converge', () => {
    const { toBluesky, toMastodon } = computeSyncActions(
      [mastoFilter({ keywords: ['crypto'] })],
      [bskyWord('crypto')],
      NOW,
    );
    expect(toBluesky).toEqual([]);
    expect(toMastodon).toEqual([]);
  });

  it('compares keywords case-insensitively and trimmed', () => {
    const { toBluesky, toMastodon } = computeSyncActions(
      [mastoFilter({ keywords: ['  Crypto '] })],
      [bskyWord('cRYPTO')],
      NOW,
    );
    expect(toBluesky).toEqual([]);
    expect(toMastodon).toEqual([]);
  });

  it('only pushes hide-action filters to Bluesky', () => {
    const { toBluesky } = computeSyncActions(
      [
        mastoFilter({ title: 'Soft', filterAction: 'warn', keywords: ['ai'] }),
        mastoFilter({ title: 'Hard', filterAction: 'hide', keywords: ['nft'] }),
      ],
      [],
      NOW,
    );
    expect(toBluesky).toEqual(['nft']);
  });

  it('does not re-add a word to Mastodon that exists in a warn filter', () => {
    const { toMastodon } = computeSyncActions(
      [mastoFilter({ filterAction: 'warn', keywords: ['ai'] })],
      [bskyWord('ai')],
      NOW,
    );
    expect(toMastodon).toEqual([]);
  });

  it('skips expired entries on both sides', () => {
    const { toBluesky, toMastodon } = computeSyncActions(
      [mastoFilter({ expiresAt: PAST, keywords: ['old-masto'] })],
      [bskyWord('old-bsky', PAST)],
      NOW,
    );
    expect(toBluesky).toEqual([]);
    expect(toMastodon).toEqual([]);
  });

  it('includes unexpired future-dated entries', () => {
    const { toBluesky, toMastodon } = computeSyncActions(
      [mastoFilter({ expiresAt: FUTURE, keywords: ['fresh-masto'] })],
      [bskyWord('fresh-bsky', FUTURE)],
      NOW,
    );
    expect(toBluesky).toEqual(['fresh-masto']);
    expect(toMastodon).toEqual(['fresh-bsky']);
  });

  it('finds the existing synced filter', () => {
    const synced = mastoFilter({
      title: SYNCED_FILTER_TITLE,
      keywords: ['spoilers'],
    });
    const { syncedFilter } = computeSyncActions([synced], [], NOW);
    expect(syncedFilter).toBe(synced);
  });

  it('returns null syncedFilter when absent', () => {
    const { syncedFilter } = computeSyncActions(
      [mastoFilter({ keywords: ['x'] })],
      [],
      NOW,
    );
    expect(syncedFilter).toBeNull();
  });

  it('an expired warn keyword still counts for Mastodon dedupe', () => {
    // Deliberate: the word exists on Mastodon (however inert), so the
    // union never duplicates it into the synced filter
    const { toMastodon } = computeSyncActions(
      [
        mastoFilter({
          filterAction: 'warn',
          expiresAt: PAST,
          keywords: ['ai'],
        }),
      ],
      [bskyWord('ai')],
      NOW,
    );
    expect(toMastodon).toEqual([]);
  });

  it('handles empty inputs', () => {
    expect(computeSyncActions([], [], NOW)).toEqual({
      toBluesky: [],
      toMastodon: [],
      syncedFilter: null,
    });
  });

  it('dedupes the same keyword across multiple Mastodon filters', () => {
    const { toBluesky } = computeSyncActions(
      [
        mastoFilter({ title: 'One', keywords: ['dup'] }),
        mastoFilter({ title: 'Two', keywords: ['DUP'] }),
      ],
      [],
      NOW,
    );
    expect(toBluesky).toEqual(['dup']);
  });
});
