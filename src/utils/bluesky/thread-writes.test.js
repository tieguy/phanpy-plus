import { describe, expect, it } from 'vitest';

import {
  buildThreadWrites,
  computeCid,
  nextTid,
  prepareForHashing,
} from './thread-writes';

const record = {
  $type: 'app.bsky.feed.post',
  text: 'hello world',
  createdAt: '2026-08-10T00:00:00.000Z',
  langs: ['en'],
};

describe('computeCid', () => {
  it('is deterministic', async () => {
    expect(await computeCid(record)).toBe(await computeCid({ ...record }));
  });

  it('produces a CIDv1 dag-cbor string', async () => {
    // base32 CIDv1 + dag-cbor (0x71) + sha2-256 → "bafyrei…"
    expect(await computeCid(record)).toMatch(/^bafyrei[a-z2-7]+$/);
  });

  it('changes when the record changes', async () => {
    expect(await computeCid(record)).not.toBe(
      await computeCid({ ...record, text: 'hello world!' }),
    );
  });

  it('is sensitive to $type presence', async () => {
    const { $type, ...withoutType } = record;
    expect(await computeCid(record)).not.toBe(await computeCid(withoutType));
  });

  it('ignores undefined fields (DAG-CBOR has no undefined)', async () => {
    expect(await computeCid({ ...record, embed: undefined })).toBe(
      await computeCid(record),
    );
  });

  it('produces a deterministic CID for identical records (ground truth vector)', async () => {
    // Simulates bsky.social golden vector: exact record structure with real values.
    const value = {
      text: 'We’re rolling out improvements to trending topics right now! If you don’t already have it, you will in the next day or so.\n\nThe new system catches more topics, identifies more posts within that topic, and serves them up faster, so you can feel more in tune with what everyone’s talking about.',
      $type: 'app.bsky.feed.post',
      langs: ['en'],
      createdAt: '2026-08-05T20:32:40.425Z',
    };
    // Compute CID twice; must be identical
    const cid1 = await computeCid(value);
    const cid2 = await computeCid(value);
    expect(cid1).toBe(cid2);
    // Verify it’s a valid CIDv1 dag-cbor
    expect(cid1).toMatch(/^bafyrei[a-z2-7]+$/);
  });

  it('handles BlobRef instances with nested CID refs deterministically', async () => {
    const { CID } = await import('multiformats/cid');
    const { sha256 } = await import('multiformats/hashes/sha2');

    // Create a deterministic CID for testing
    const refCid = CID.createV1(
      0x71,
      await sha256.digest(new Uint8Array([1, 2, 3])),
    );

    // Construct a record with an embedded blob reference
    const recordWithBlob = {
      ...record,
      embed: {
        $type: 'app.bsky.embed.images',
        images: [
          {
            image: {
              $type: 'blob',
              ref: refCid,
              mimeType: 'image/jpeg',
              size: 12345,
            },
            alt: 'test image',
          },
        ],
      },
    };

    // Compute CID for record with this blob
    const cidWithBlob = await computeCid(recordWithBlob);
    expect(cidWithBlob).toMatch(/^bafyrei[a-z2-7]+$/);

    // Changing the blob's ref CID should produce a different record CID
    const differentRefCid = CID.createV1(
      0x71,
      await sha256.digest(new Uint8Array([4, 5, 6])),
    );
    const recordWithDifferentBlob = {
      ...recordWithBlob,
      embed: {
        ...recordWithBlob.embed,
        images: [
          {
            ...recordWithBlob.embed.images[0],
            image: {
              ...recordWithBlob.embed.images[0].image,
              ref: differentRefCid,
            },
          },
        ],
      },
    };

    const cidWithDifferentBlob = await computeCid(recordWithDifferentBlob);
    expect(cidWithDifferentBlob).not.toBe(cidWithBlob);
  });
});

describe('prepareForHashing', () => {
  it('strips undefined recursively', () => {
    expect(
      prepareForHashing({ a: 1, b: undefined, c: { d: undefined, e: [1] } }),
    ).toEqual({ a: 1, c: { e: [1] } });
  });

  it('converts BlobRef-like objects via ipld()', () => {
    const blobRef = {
      ipld: () => ({ $type: 'blob', mimeType: 'image/jpeg' }),
    };
    expect(prepareForHashing({ image: blobRef })).toEqual({
      image: { $type: 'blob', mimeType: 'image/jpeg' },
    });
  });

  it('passes real multiformats CID instances through untouched', async () => {
    // A real BlobRef.ipld() contains a live CID in its ref field — that
    // instance must survive prepareForHashing so dag-cbor can encode it
    // natively (tag 42), and computeCid must accept records containing it.
    const { CID } = await import('multiformats/cid');
    const { sha256 } = await import('multiformats/hashes/sha2');
    const cid = CID.createV1(0x71, await sha256.digest(new Uint8Array([1])));
    expect(prepareForHashing({ ref: cid }).ref).toBe(cid);
    const withBlob = {
      ...record,
      embed: { $type: 'app.bsky.embed.images', ref: cid },
    };
    expect(await computeCid(withBlob)).toBe(await computeCid({ ...withBlob }));
    expect(await computeCid(withBlob)).not.toBe(await computeCid(record));
  });
});

describe('nextTid', () => {
  it('returns 13-char TIDs that strictly increase', async () => {
    const a = await nextTid();
    const b = await nextTid();
    const c = await nextTid();
    for (const tid of [a, b, c]) {
      expect(tid).toMatch(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
    }
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
  });
});

describe('buildThreadWrites', () => {
  const testDid = 'did:plc:example123456789abcdefg';
  const baseRecord = {
    text: 'test post',
    $type: 'app.bsky.feed.post',
    createdAt: '2026-08-10T00:00:00.000Z',
  };

  it('builds writes with correct shape ($type/collection/rkey/value)', async () => {
    const records = [{ ...baseRecord }];
    const result = await buildThreadWrites({
      did: testDid,
      records,
      computeCidFn: async () => 'bafyreihash',
      nextTidFn: async () => 'abc1234567890',
    });

    expect(result.writes).toHaveLength(1);
    const write = result.writes[0];
    expect(write).toHaveProperty(
      '$type',
      'com.atproto.repo.applyWrites#create',
    );
    expect(write).toHaveProperty('collection', 'app.bsky.feed.post');
    expect(write).toHaveProperty('rkey', 'abc1234567890');
    expect(write).toHaveProperty('value');
    expect(write.value).toBe(records[0]);
  });

  it('generates URIs in format at://did/app.bsky.feed.post/rkey', async () => {
    const records = [{ ...baseRecord }, { ...baseRecord, text: 'post 2' }];
    const tids = ['abc1234567890', 'def1234567890'];
    let tidIndex = 0;

    const result = await buildThreadWrites({
      did: testDid,
      records,
      computeCidFn: async () => 'bafyreihash',
      nextTidFn: async () => tids[tidIndex++],
    });

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].uri).toBe(
      `at://${testDid}/app.bsky.feed.post/${tids[0]}`,
    );
    expect(result.posts[1].uri).toBe(
      `at://${testDid}/app.bsky.feed.post/${tids[1]}`,
    );
  });

  it('chains replies in fresh thread (no initialReply)', async () => {
    const records = [
      { ...baseRecord, text: 'post 0' },
      { ...baseRecord, text: 'post 1' },
      { ...baseRecord, text: 'post 2' },
    ];

    const result = await buildThreadWrites({
      did: testDid,
      records,
      computeCidFn: async () => 'bafyreihash',
      nextTidFn: async () => 'abc1234567890',
    });

    const posts = result.posts;

    // Post 0: no reply ref
    expect(posts[0].record.reply).toBeUndefined();

    // Post 1: replies to post 0; root == parent == post0
    expect(posts[1].record.reply).toBeDefined();
    expect(posts[1].record.reply.root).toEqual({
      uri: posts[0].uri,
      cid: posts[0].cid,
    });
    expect(posts[1].record.reply.parent).toEqual({
      uri: posts[0].uri,
      cid: posts[0].cid,
    });

    // Post 2: replies to post 1; root == post0, parent == post1
    expect(posts[2].record.reply).toBeDefined();
    expect(posts[2].record.reply.root).toEqual({
      uri: posts[0].uri,
      cid: posts[0].cid,
    });
    expect(posts[2].record.reply.parent).toEqual({
      uri: posts[1].uri,
      cid: posts[1].cid,
    });
  });

  it('preserves root when replying to an existing thread (initialReply)', async () => {
    const existingRoot = {
      uri: 'at://did:plc:existing/app.bsky.feed.post/existing1234567890',
      cid: 'bafyreieexistingcid',
    };
    const initialReply = {
      root: existingRoot,
      parent: existingRoot,
    };

    const records = [
      { ...baseRecord, text: 'reply 0' },
      { ...baseRecord, text: 'reply 1' },
    ];

    const result = await buildThreadWrites({
      did: testDid,
      records,
      initialReply,
      computeCidFn: async () => 'bafyreihash',
      nextTidFn: async () => 'abc1234567890',
    });

    const posts = result.posts;

    // Reply 0: gets initialReply, root stays fixed
    expect(posts[0].record.reply).toEqual(initialReply);
    expect(posts[0].record.reply.root).toEqual(existingRoot);

    // Reply 1: chains to reply 0, but root stays the original
    expect(posts[1].record.reply).toBeDefined();
    expect(posts[1].record.reply.root).toEqual(existingRoot);
    expect(posts[1].record.reply.parent).toEqual({
      uri: posts[0].uri,
      cid: posts[0].cid,
    });
  });

  it('returns finalReply for next-thread chaining', async () => {
    const records = [{ ...baseRecord, text: 'post' }];

    const result = await buildThreadWrites({
      did: testDid,
      records,
      computeCidFn: async () => 'bafyreihash',
      nextTidFn: async () => 'abc1234567890',
    });

    expect(result.finalReply).toEqual({
      root: {
        uri: result.posts[0].uri,
        cid: result.posts[0].cid,
      },
      parent: {
        uri: result.posts[0].uri,
        cid: result.posts[0].cid,
      },
    });
  });
});
