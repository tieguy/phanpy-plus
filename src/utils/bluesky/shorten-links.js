// Link shortening for Bluesky posts. The AT Protocol has no server-side URL
// shortening: the 300-grapheme limit applies to the literal record text, so a
// long URL posted verbatim eats the whole budget. The official Bluesky app
// instead rewrites each link's *display text* to a truncated form and keeps
// the full URL in the link facet (social-app: lib/strings/rich-text-manip.ts,
// `shortenLinks`/`toShortUrl`). This module ports that behavior.
//
// Pure module — no @atproto/api import, so the compose counter can use
// `toShortUrl` without pulling the lazy-loaded Bluesky bundle.

const LINK_TYPE = 'app.bsky.richtext.facet#link';

// Matches the official app's toShortUrl: host plus up to 15 chars of
// path/query/hash, longer paths cut to 13 chars + '…' (they use '...';
// we do too, for byte-count parity with what others see).
export function toShortUrl(url) {
  try {
    const urlp = new URL(url);
    if (urlp.protocol !== 'http:' && urlp.protocol !== 'https:') {
      return url;
    }
    const path =
      (urlp.pathname === '/' ? '' : urlp.pathname) + urlp.search + urlp.hash;
    if (path.length > 15) {
      return urlp.host + path.slice(0, 13) + '...';
    }
    return urlp.host + path;
  } catch (e) {
    return url;
  }
}

// Rewrites each link facet's display text to toShortUrl(text) while leaving
// `feature.uri` untouched, shifting the byte ranges of that facet and every
// later facet accordingly. Facet indices are byte offsets into the UTF-8
// encoding of `text`, so all the arithmetic here is done on bytes.
// Returns { text, facets } (new objects; inputs are not mutated).
export function shortenLinkFacets(text, facets) {
  if (!facets?.length) return { text, facets };

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let bytes = encoder.encode(text);
  const newFacets = facets.map((f) => ({
    ...f,
    index: { ...f.index },
  }));
  // Process in byteStart order so shifts apply cleanly to later facets.
  const order = [...newFacets].sort(
    (a, b) => a.index.byteStart - b.index.byteStart,
  );

  for (const facet of order) {
    const isLink = facet.features?.some((feat) => feat?.$type === LINK_TYPE);
    if (!isLink) continue;

    const { byteStart, byteEnd } = facet.index;
    if (
      !(byteStart >= 0 && byteEnd > byteStart && byteEnd <= bytes.length)
    ) {
      continue;
    }
    const urlText = decoder.decode(bytes.slice(byteStart, byteEnd));
    const shortened = toShortUrl(urlText);
    if (shortened === urlText) continue;

    const shortBytes = encoder.encode(shortened);
    const delta = shortBytes.length - (byteEnd - byteStart);

    const next = new Uint8Array(bytes.length + delta);
    next.set(bytes.slice(0, byteStart), 0);
    next.set(shortBytes, byteStart);
    next.set(bytes.slice(byteEnd), byteStart + shortBytes.length);
    bytes = next;

    facet.index.byteEnd = byteStart + shortBytes.length;
    for (const other of newFacets) {
      if (other === facet) continue;
      if (other.index.byteStart >= byteEnd) {
        other.index.byteStart += delta;
        other.index.byteEnd += delta;
      }
    }
  }

  return { text: decoder.decode(bytes), facets: newFacets };
}
