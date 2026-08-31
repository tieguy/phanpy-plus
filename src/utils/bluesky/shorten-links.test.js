import { describe, expect, it } from 'vitest';

import { shortenLinkFacets, toShortUrl } from './shorten-links';

const enc = new TextEncoder();

const linkFacet = (byteStart, byteEnd, uri) => ({
  index: { byteStart, byteEnd },
  features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
});

const mentionFacet = (byteStart, byteEnd, did) => ({
  index: { byteStart, byteEnd },
  features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
});

describe('toShortUrl', () => {
  it('keeps short URLs as host + path', () => {
    expect(toShortUrl('https://lu.is/about')).toBe('lu.is/about');
  });

  it('drops a bare trailing slash', () => {
    expect(toShortUrl('https://lu.is/')).toBe('lu.is');
  });

  it('truncates long paths to 13 chars + ellipsis', () => {
    expect(
      toShortUrl('https://www.sfchronicle.com/politics/article/foo.php?x=1'),
    ).toBe('www.sfchronicle.com/politics/art...');
  });

  it('leaves non-http(s) and unparseable strings alone', () => {
    expect(toShortUrl('ftp://example.com/file')).toBe('ftp://example.com/file');
    expect(toShortUrl('not a url')).toBe('not a url');
  });
});

describe('shortenLinkFacets', () => {
  it('passes through text with no facets', () => {
    const { text, facets } = shortenLinkFacets('hello', undefined);
    expect(text).toBe('hello');
    expect(facets).toBeUndefined();
  });

  it('shortens a long URL and keeps the full uri in the facet', () => {
    const url =
      'https://www.sfchronicle.com/politics/article/tech-worker-22378308.php?utm_source=marketing&hash=aHR0cHM';
    const input = `read this: ${url}`;
    const start = enc.encode('read this: ').length;
    const { text, facets } = shortenLinkFacets(input, [
      linkFacet(start, start + enc.encode(url).length, url),
    ]);
    const short = 'www.sfchronicle.com/politics/art...';
    expect(text).toBe(`read this: ${short}`);
    expect(facets[0].features[0].uri).toBe(url);
    expect(facets[0].index.byteStart).toBe(start);
    expect(facets[0].index.byteEnd).toBe(start + enc.encode(short).length);
  });

  it('shifts later facets after shortening', () => {
    const url = 'https://example.com/a/very/long/path/that/keeps/going';
    const input = `${url} hi @alice.bsky.social`;
    const urlLen = enc.encode(url).length;
    const mStart = urlLen + 4;
    const { text, facets } = shortenLinkFacets(input, [
      linkFacet(0, urlLen, url),
      mentionFacet(mStart, mStart + enc.encode('@alice.bsky.social').length, 'did:plc:x'),
    ]);
    const short = 'example.com/a/very/long/...';
    expect(text).toBe(`${short} hi @alice.bsky.social`);
    const mention = facets[1];
    const sliceBytes = enc.encode(text).slice(
      mention.index.byteStart,
      mention.index.byteEnd,
    );
    expect(new TextDecoder().decode(sliceBytes)).toBe('@alice.bsky.social');
  });

  it('handles multibyte text before the link', () => {
    const url = 'https://example.com/a/very/long/path/that/keeps/going';
    const input = `héllo 🎉 ${url}`;
    const start = enc.encode('héllo 🎉 ').length;
    const { text, facets } = shortenLinkFacets(input, [
      linkFacet(start, start + enc.encode(url).length, url),
    ]);
    expect(text).toBe('héllo 🎉 example.com/a/very/long/...');
    expect(facets[0].index.byteStart).toBe(start);
  });

  it('leaves already-short link text alone', () => {
    const url = 'https://lu.is/about';
    const input = `see ${url}`;
    const facetsIn = [linkFacet(4, 4 + url.length, url)];
    const { text, facets } = shortenLinkFacets(input, facetsIn);
    expect(text).toBe('see lu.is/about');
    expect(facets[0].index.byteEnd).toBe(4 + 'lu.is/about'.length);
  });

  it('does not mutate its inputs', () => {
    const url = 'https://example.com/a/very/long/path/that/keeps/going';
    const facetsIn = [linkFacet(0, enc.encode(url).length, url)];
    const snapshot = JSON.stringify(facetsIn);
    shortenLinkFacets(url, facetsIn);
    expect(JSON.stringify(facetsIn)).toBe(snapshot);
  });
});
