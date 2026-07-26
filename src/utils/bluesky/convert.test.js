import { describe, expect, it } from 'vitest';

import { postToStatus } from './convert';

// Build a minimal Bluesky post view whose record text @-mentions someone.
// Byte offsets index into the UTF-8 encoding of `text`.
function mentionPost({ text, handle, did }) {
  const byteStart = new TextEncoder().encode(
    text.slice(0, text.indexOf(`@${handle}`)),
  ).length;
  const byteEnd = byteStart + new TextEncoder().encode(`@${handle}`).length;
  return {
    uri: 'at://did:plc:author/app.bsky.feed.post/abc',
    cid: 'cid1',
    author: {
      did: 'did:plc:author',
      handle: 'author.bsky.social',
      displayName: 'Author',
    },
    record: {
      text,
      createdAt: '2024-01-01T00:00:00.000Z',
      facets: [
        {
          index: { byteStart, byteEnd },
          features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
        },
      ],
    },
    indexedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('postToStatus mentions', () => {
  it('uses the handle (not the DID) for a mention acct', () => {
    const status = postToStatus(
      mentionPost({
        text: '@adonovan.bsky.social the problem is solvable',
        handle: 'adonovan.bsky.social',
        did: 'did:plc:bjwzrz7adhzwn7bdtvplo4in',
      }),
      'bsky.social',
    );
    expect(status.mentions).toHaveLength(1);
    const [m] = status.mentions;
    // id stays the DID (mention-click matching relies on it)
    expect(m.id).toBe('did:plc:bjwzrz7adhzwn7bdtvplo4in');
    // acct/username should be the human handle
    expect(m.acct).toBe('adonovan.bsky.social');
    expect(m.username).toBe('adonovan.bsky.social');
  });

  it('handles a mention that is not at the start of the text', () => {
    const status = postToStatus(
      mentionPost({
        text: 'hey @bob.bsky.social look',
        handle: 'bob.bsky.social',
        did: 'did:plc:bob',
      }),
      'bsky.social',
    );
    expect(status.mentions[0].acct).toBe('bob.bsky.social');
  });

  it('falls back to the DID when no record text is available', () => {
    const status = postToStatus(
      {
        uri: 'at://did:plc:author/app.bsky.feed.post/abc',
        cid: 'cid1',
        author: { did: 'did:plc:author', handle: 'author.bsky.social' },
        record: {
          // no text, but a mention facet exists
          facets: [
            {
              index: { byteStart: 0, byteEnd: 5 },
              features: [
                { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:x' },
              ],
            },
          ],
        },
        indexedAt: '2024-01-01T00:00:00.000Z',
      },
      'bsky.social',
    );
    expect(status.mentions[0].acct).toBe('did:plc:x');
  });
});

// A post whose embed is a quote of `record`.
function quotePost(record) {
  return {
    uri: 'at://did:plc:author/app.bsky.feed.post/abc',
    cid: 'cid1',
    author: { did: 'did:plc:author', handle: 'author.bsky.social' },
    record: { text: 'check this out', createdAt: '2024-01-01T00:00:00.000Z' },
    indexedAt: '2024-01-01T00:00:00.000Z',
    embed: { $type: 'app.bsky.embed.record#view', record },
  };
}

describe('postToStatus embedded non-post records', () => {
  it('renders a quoted feed generator as a link card', () => {
    const status = postToStatus(
      quotePost({
        $type: 'app.bsky.feed.defs#generatorView',
        uri: 'at://did:plc:c/app.bsky.feed.generator/rkey',
        creator: { did: 'did:plc:c', handle: 'creator.bsky.social' },
        displayName: 'Cool Feed',
        description: 'A feed',
        avatar: 'https://img/avatar.jpg',
      }),
      'bsky.social',
    );
    expect(status.quote).toBeNull();
    expect(status.card).toBeTruthy();
    expect(status.card.title).toBe('Cool Feed');
    expect(status.card.url).toBe(
      'https://bsky.app/profile/creator.bsky.social/feed/rkey',
    );
    expect(status.card.image).toBe('https://img/avatar.jpg');
  });

  it('renders a quoted list as a link card', () => {
    const status = postToStatus(
      quotePost({
        $type: 'app.bsky.graph.defs#listView',
        uri: 'at://did:plc:c/app.bsky.graph.list/rkey',
        creator: { did: 'did:plc:c', handle: 'creator.bsky.social' },
        name: 'My List',
      }),
      'bsky.social',
    );
    expect(status.quote).toBeNull();
    expect(status.card.title).toBe('My List');
    expect(status.card.url).toBe(
      'https://bsky.app/profile/creator.bsky.social/lists/rkey',
    );
  });

  it('renders a quoted starter pack as a link card', () => {
    const status = postToStatus(
      quotePost({
        $type: 'app.bsky.graph.defs#starterPackViewBasic',
        uri: 'at://did:plc:c/app.bsky.graph.starterpack/rkey',
        creator: { did: 'did:plc:c', handle: 'creator.bsky.social' },
        record: { name: 'Starter Pack', description: 'people to follow' },
      }),
      'bsky.social',
    );
    expect(status.quote).toBeNull();
    expect(status.card.title).toBe('Starter Pack');
    expect(status.card.url).toBe(
      'https://bsky.app/starter-pack/creator.bsky.social/rkey',
    );
  });

  it('still renders a quoted post as a native quote (not a card)', () => {
    const status = postToStatus(
      quotePost({
        $type: 'app.bsky.embed.record#viewRecord',
        uri: 'at://did:plc:c/app.bsky.feed.post/rkey',
        cid: 'cid2',
        author: { did: 'did:plc:c', handle: 'other.bsky.social' },
        value: {
          text: 'the quoted post',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        embeds: [],
      }),
      'bsky.social',
    );
    expect(status.card).toBeNull();
    expect(status.quote?.state).toBe('accepted');
    expect(status.quote?.quotedStatus?.text).toBe('the quoted post');
  });
});
