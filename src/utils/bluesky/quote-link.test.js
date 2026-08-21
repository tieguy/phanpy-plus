import { describe, expect, it } from 'vitest';

import { firstQuotedPostLink, parseBskyPostUrl } from './quote-link';

const link = (uri) => ({
  index: { byteStart: 0, byteEnd: 1 },
  features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
});
const mention = (did) => ({
  index: { byteStart: 0, byteEnd: 1 },
  features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
});

describe('parseBskyPostUrl', () => {
  it('parses a post URL with a handle', () => {
    expect(
      parseBskyPostUrl('https://bsky.app/profile/lu.is/post/3mtjo55ytif2w'),
    ).toEqual({ actor: 'lu.is', rkey: '3mtjo55ytif2w' });
  });

  it('parses a post URL with a DID', () => {
    expect(
      parseBskyPostUrl(
        'https://bsky.app/profile/did:plc:pza5gx5a26conwupxebwefqq/post/3mtjo55ytif2w',
      ),
    ).toEqual({
      actor: 'did:plc:pza5gx5a26conwupxebwefqq',
      rkey: '3mtjo55ytif2w',
    });
  });

  it('accepts the www host and ignores query/hash', () => {
    expect(
      parseBskyPostUrl('https://www.bsky.app/profile/lu.is/post/abc?x=1#y'),
    ).toEqual({ actor: 'lu.is', rkey: 'abc' });
  });

  it('rejects profile, feed and non-post URLs on the same host', () => {
    expect(parseBskyPostUrl('https://bsky.app/profile/lu.is')).toBe(null);
    expect(
      parseBskyPostUrl('https://bsky.app/profile/lu.is/feed/whats-hot'),
    ).toBe(null);
    expect(
      parseBskyPostUrl('https://bsky.app/profile/lu.is/post/abc/extra'),
    ).toBe(null);
  });

  it('rejects other hosts, including look-alikes', () => {
    expect(parseBskyPostUrl('https://example.com/profile/lu.is/post/abc')).toBe(
      null,
    );
    expect(
      parseBskyPostUrl('https://bsky.app.evil.example/profile/a/post/b'),
    ).toBe(null);
    expect(parseBskyPostUrl('https://notbsky.app/profile/a/post/b')).toBe(null);
  });

  it('rejects non-https URLs and non-strings', () => {
    expect(parseBskyPostUrl('http://bsky.app/profile/lu.is/post/abc')).toBe(
      null,
    );
    expect(parseBskyPostUrl('not a url')).toBe(null);
    expect(parseBskyPostUrl(null)).toBe(null);
    expect(parseBskyPostUrl(undefined)).toBe(null);
  });
});

describe('firstQuotedPostLink', () => {
  it('finds a post link among other facets', () => {
    expect(
      firstQuotedPostLink([
        mention('did:plc:abc'),
        link('https://example.com/article'),
        link('https://bsky.app/profile/lu.is/post/abc'),
      ]),
    ).toEqual({
      actor: 'lu.is',
      rkey: 'abc',
      url: 'https://bsky.app/profile/lu.is/post/abc',
    });
  });

  it('returns the first post link when there are several', () => {
    expect(
      firstQuotedPostLink([
        link('https://bsky.app/profile/one.example/post/aaa'),
        link('https://bsky.app/profile/two.example/post/bbb'),
      ]).rkey,
    ).toBe('aaa');
  });

  it('returns null when no link points at a post', () => {
    expect(firstQuotedPostLink([link('https://example.com')])).toBe(null);
    expect(firstQuotedPostLink([mention('did:plc:abc')])).toBe(null);
    expect(firstQuotedPostLink(undefined)).toBe(null);
  });
});
