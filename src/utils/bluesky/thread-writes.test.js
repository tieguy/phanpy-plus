import { describe, expect, it } from 'vitest';

import { computeCid, nextTid, prepareForHashing } from './thread-writes';

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
