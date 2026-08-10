// Client-side helpers for atomic Bluesky thread creation via applyWrites.
// Mirrors the official social-app implementation (src/lib/api/index.ts):
// records are DAG-CBOR-encoded, SHA-256-hashed, wrapped as CIDv1 (0x71),
// so reply refs can reference posts that don't exist server-side yet.
//
// Everything here is only ever reached from the lazy-loaded Bluesky path,
// and @ipld/dag-cbor is itself dynamically imported — Mastodon-only users
// pay no bundle cost.
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

const DAG_CBOR_CODE = 0x71;

// Recursively prepare a record for hashing: strip undefined fields
// (DAG-CBOR cannot encode undefined — the server strips them too, so
// hashing them locally would produce a mismatching CID) and convert
// BlobRef instances to their IPLD form. CID instances pass through
// untouched (dag-cbor encodes them natively as tag 42).
export function prepareForHashing(v) {
  if (Array.isArray(v)) return v.map(prepareForHashing);
  if (v instanceof Uint8Array) return v;
  if (v && typeof v === 'object') {
    // CID detection: handle both regular and cross-copy instances.
    // The documented signal for cross-copy-safe CIDs is v['/'] === v.bytes;
    // v.asCID === v works for multiformats instances created in-process.
    if (v['/'] && v['/'] === v.bytes) return v;
    if (v.asCID === v) return v;
    if (typeof v.ipld === 'function') return prepareForHashing(v.ipld());
    const out = {};
    for (const [key, value] of Object.entries(v)) {
      if (value === undefined) continue;
      out[key] = prepareForHashing(value);
    }
    return out;
  }
  return v;
}

// Compute the CID the PDS will assign this record. The record MUST
// already carry $type ('app.bsky.feed.post') — omitting it silently
// yields a different CID and broken reply refs.
export async function computeCid(record) {
  const dcbor = await import('@ipld/dag-cbor');
  const prepared = prepareForHashing(record);
  const encoded = dcbor.encode(prepared);
  const digest = await sha256.digest(encoded);
  return CID.createV1(DAG_CBOR_CODE, digest).toString();
}

// Monotonically-increasing TIDs (record keys). TID.next(prev) guarantees
// strict ordering even for same-millisecond calls — required so thread
// posts sort correctly.
let lastTid;
export async function nextTid() {
  const { TID } = await import('@atproto/common-web');
  lastTid = TID.next(lastTid);
  return lastTid.toString();
}

// Build the writes and post metadata for an atomic thread creation.
// Records must already carry $type, text, createdAt, and other fields — this
// function only adds reply refs (chaining posts together).
// Returns { writes, posts, finalReply } where posts = [{ uri, cid, record }].
export async function buildThreadWrites({
  did,
  records,
  initialReply,
  computeCidFn = computeCid,
  nextTidFn = nextTid,
}) {
  const writes = [];
  const posts = [];
  let reply = initialReply;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (reply) record.reply = reply;

    const rkey = await nextTidFn();
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;

    writes.push({
      $type: 'com.atproto.repo.applyWrites#create',
      collection: 'app.bsky.feed.post',
      rkey,
      value: record,
    });

    // Next post replies to this one; root stays the thread's first ref
    const cid = await computeCidFn(record);
    posts.push({ uri, cid, record });

    const ref = { uri, cid };
    reply = { root: reply?.root ?? ref, parent: ref };
  }

  return { writes, posts, finalReply: reply };
}
