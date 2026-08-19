import { describe, expect, it, vi } from 'vitest';

import { repairMentionFacets, resolveHandleDid } from './facets';

const encoder = new TextEncoder();

// Build the facet list detectFacets would produce for `text`, marking each
// @handle as a mention with the given did.
const mentionFacet = (text, handle, did) => {
  const at = text.indexOf(`@${handle}`);
  const byteStart = encoder.encode(text.slice(0, at)).length;
  return {
    index: {
      byteStart,
      byteEnd: byteStart + encoder.encode(`@${handle}`).length,
    },
    features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
  };
};

const linkFacet = () => ({
  index: { byteStart: 0, byteEnd: 0 },
  features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://lu.is/' }],
});

describe('repairMentionFacets', () => {
  it('passes through when there are no facets', async () => {
    expect(await repairMentionFacets('hi', undefined)).toEqual({
      facets: undefined,
      unresolved: [],
    });
    expect(await repairMentionFacets('hi', [])).toEqual({
      facets: [],
      unresolved: [],
    });
  });

  it('leaves already-resolved mentions untouched without any lookup', async () => {
    const text = '@alex.bsky.social hello';
    const facets = [mentionFacet(text, 'alex.bsky.social', 'did:plc:abc')];
    const resolve = vi.fn();
    const result = await repairMentionFacets(text, facets, { resolve });
    expect(result.facets).toBe(facets);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('re-resolves a mention that detectFacets left with an empty did', async () => {
    const text = '@alex.bsky.social I slammed the buy button';
    const facets = [mentionFacet(text, 'alex.bsky.social', '')];
    const resolve = vi.fn().mockResolvedValue('did:plc:qvhev');
    const { facets: repaired, unresolved } = await repairMentionFacets(
      text,
      facets,
      { resolve },
    );
    expect(resolve).toHaveBeenCalledWith('alex.bsky.social');
    expect(repaired[0].features[0].did).toBe('did:plc:qvhev');
    expect(unresolved).toEqual([]);
  });

  it('drops a mention that still will not resolve, keeping the post sendable', async () => {
    const text = 'mail me @example.com ok';
    const facets = [mentionFacet(text, 'example.com', '')];
    const { facets: repaired, unresolved } = await repairMentionFacets(
      text,
      facets,
      { resolve: async () => null },
    );
    expect(repaired).toEqual([]);
    expect(unresolved).toEqual(['example.com']);
  });

  it('keeps link facets while dropping an unresolvable mention', async () => {
    const text = '@nope.invalid see https://lu.is/';
    const facets = [mentionFacet(text, 'nope.invalid', ''), linkFacet()];
    const { facets: repaired } = await repairMentionFacets(text, facets, {
      resolve: async () => null,
    });
    expect(repaired).toHaveLength(1);
    expect(repaired[0].features[0].$type).toBe('app.bsky.richtext.facet#link');
  });

  it('treats a raw handle left in `did` as unresolved and repairs it', async () => {
    // detectFacetsWithoutResolution leaves the handle itself in `did`.
    const text = '@alex.bsky.social hi';
    const facets = [mentionFacet(text, 'alex.bsky.social', 'alex.bsky.social')];
    const { facets: repaired } = await repairMentionFacets(text, facets, {
      resolve: async () => 'did:plc:qvhev',
    });
    expect(repaired[0].features[0].did).toBe('did:plc:qvhev');
  });

  it('looks a repeated handle up only once', async () => {
    const text = '@alex.bsky.social and @alex.bsky.social again';
    const first = mentionFacet(text, 'alex.bsky.social', '');
    const secondAt = text.lastIndexOf('@alex.bsky.social');
    const second = {
      index: {
        byteStart: secondAt,
        byteEnd: secondAt + '@alex.bsky.social'.length,
      },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did: '' }],
    };
    const resolve = vi.fn().mockResolvedValue('did:plc:qvhev');
    const { facets: repaired } = await repairMentionFacets(
      text,
      [first, second],
      { resolve },
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(repaired.map((f) => f.features[0].did)).toEqual([
      'did:plc:qvhev',
      'did:plc:qvhev',
    ]);
  });

  it('finds the handle when multi-byte characters precede the mention', async () => {
    const text = '🎉 @alex.bsky.social';
    const facets = [mentionFacet(text, 'alex.bsky.social', '')];
    const resolve = vi.fn().mockResolvedValue('did:plc:qvhev');
    await repairMentionFacets(text, facets, { resolve });
    expect(resolve).toHaveBeenCalledWith('alex.bsky.social');
  });
});

describe('resolveHandleDid', () => {
  it('returns the did from the public appview', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ did: 'did:plc:qvhev' }),
    });
    expect(await resolveHandleDid('alex.bsky.social', fetchImpl)).toBe(
      'did:plc:qvhev',
    );
    expect(fetchImpl.mock.calls[0][0]).toContain(
      'com.atproto.identity.resolveHandle?handle=alex.bsky.social',
    );
  });

  it('returns null on an error response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    expect(await resolveHandleDid('nope.invalid', fetchImpl)).toBeNull();
  });

  it('returns null when the request throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await resolveHandleDid('alex.bsky.social', fetchImpl)).toBeNull();
  });
});
