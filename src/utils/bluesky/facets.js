// Repair of mention facets that the atproto SDK left unresolved.
//
// `RichText#detectFacets` starts each mention feature with the handle in its
// `did` field, asks the PDS to resolve it, and on ANY failure — expired
// session, network blip, or a word that merely looks like a handle
// ("@example.com") — writes `did: ''` and keeps the facet. Sending that record
// fails lexicon validation:
//
//   Invalid app.bsky.feed.post record: Invalid DID (got "")
//   at $.record.facets[0].features[0].did
//
// so a single unresolvable mention loses the whole post. `repairMentionFacets`
// retries each bad DID against the public appview — unauthenticated, and a
// different host from the PDS, so it survives an expired session — and drops
// whatever still won't resolve, leaving that mention as plain text.

const PUBLIC_APPVIEW = 'https://public.api.bsky.app';
const MENTION_TYPE = 'app.bsky.richtext.facet#mention';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const isDid = (value) => typeof value === 'string' && value.startsWith('did:');

// Resolve a handle to a DID without authentication. Returns null on any
// failure — callers treat that as "not a mention".
export async function resolveHandleDid(handle, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(
      `${PUBLIC_APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(
        handle,
      )}`,
    );
    if (!res?.ok) return null;
    const data = await res.json();
    return isDid(data?.did) ? data.did : null;
  } catch (e) {
    return null;
  }
}

// The handle is not stored in the facet — it lives in the post text bytes at
// the facet's byte range. Same decoding as `postToStatus` in convert.js.
function handleAtIndex(textBytes, index) {
  const { byteStart, byteEnd } = index || {};
  if (!textBytes || !(byteStart >= 0) || !(byteEnd >= byteStart)) return '';
  return decoder.decode(textBytes.slice(byteStart, byteEnd)).replace(/^@/, '');
}

// Returns `{ facets, unresolved }` — facets safe to send, plus the handles that
// were dropped. Mutates the `did` of features it manages to resolve; facets it
// cannot repair are removed from the returned list, and a facet left with no
// features at all is removed with them.
export async function repairMentionFacets(
  text,
  facets,
  { resolve = resolveHandleDid } = {},
) {
  if (!facets?.length) return { facets, unresolved: [] };

  const broken = [];
  for (const facet of facets) {
    for (const feature of facet?.features || []) {
      if (feature?.$type === MENTION_TYPE && !isDid(feature.did)) {
        broken.push({ facet, feature });
      }
    }
  }
  if (!broken.length) return { facets, unresolved: [] };

  const textBytes = encoder.encode(text || '');
  // One lookup per distinct handle, however many times it is mentioned.
  const lookups = new Map();
  const unresolved = [];

  await Promise.all(
    broken.map(async ({ facet, feature }) => {
      // Prefer the text bytes; fall back to whatever detectFacets left in
      // `did`, which is the raw handle when resolution was never attempted.
      const handle =
        handleAtIndex(textBytes, facet.index) ||
        (feature.did && !isDid(feature.did) ? feature.did : '');
      if (!handle) return;
      if (!lookups.has(handle)) lookups.set(handle, resolve(handle));
      const did = await lookups.get(handle);
      if (did) feature.did = did;
      else unresolved.push(handle);
    }),
  );

  const repaired = [];
  for (const facet of facets) {
    const features = (facet?.features || []).filter(
      (feature) => !(feature?.$type === MENTION_TYPE && !isDid(feature.did)),
    );
    if (features.length) repaired.push({ ...facet, features });
  }
  return { facets: repaired, unresolved };
}
