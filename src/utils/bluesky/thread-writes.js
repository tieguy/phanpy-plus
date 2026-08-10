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
  if (v && typeof v === 'object') {
    if (v.asCID === v) return v; // multiformats CID instance
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
