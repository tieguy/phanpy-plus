import { describe, expect, it } from 'vitest';

import { firstLinkFacetUri } from './link-card';

const link = (uri) => ({
  index: { byteStart: 0, byteEnd: 1 },
  features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
});
const mention = (did) => ({
  index: { byteStart: 0, byteEnd: 1 },
  features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
});
const tag = (t) => ({
  index: { byteStart: 0, byteEnd: 1 },
  features: [{ $type: 'app.bsky.richtext.facet#tag', tag: t }],
});

describe('firstLinkFacetUri', () => {
  it('returns the uri of the first link facet', () => {
    expect(firstLinkFacetUri([link('https://example.com')])).toBe(
      'https://example.com',
    );
  });

  it('returns the first link when there are several, in facet order', () => {
    expect(
      firstLinkFacetUri([
        mention('did:plc:abc'),
        link('https://first.example'),
        link('https://second.example'),
      ]),
    ).toBe('https://first.example');
  });

  it('ignores mention and tag facets', () => {
    expect(firstLinkFacetUri([mention('did:plc:abc'), tag('hashtag')])).toBe(
      null,
    );
  });

  it('finds a link feature that is not the first feature in a facet', () => {
    expect(
      firstLinkFacetUri([
        {
          index: { byteStart: 0, byteEnd: 1 },
          features: [
            { $type: 'app.bsky.richtext.facet#tag', tag: 'x' },
            { $type: 'app.bsky.richtext.facet#link', uri: 'https://mixed.example' },
          ],
        },
      ]),
    ).toBe('https://mixed.example');
  });

  it('is safe on empty/missing input', () => {
    expect(firstLinkFacetUri([])).toBe(null);
    expect(firstLinkFacetUri(undefined)).toBe(null);
    expect(firstLinkFacetUri(null)).toBe(null);
    expect(firstLinkFacetUri([{ index: {} }])).toBe(null);
  });
});
