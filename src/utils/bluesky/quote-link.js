// Pasted post URLs → native quotes.
//
// Bluesky does no server-side unfurling, so the client decides what a pasted
// URL becomes. For a bsky.app post URL the official client builds an
// `app.bsky.embed.record` quote; every other URL becomes an external link
// card (see `link-card.js`). The distinction is not cosmetic: only a `record`
// embed increments the target's `quoteCount` and puts the post in its quote
// list. A post URL sent as an external card looks like a quote in the
// composer's preview and is invisible to the network as one.

import { linkFacetUris } from './link-card';

const BSKY_HOSTS = new Set(['bsky.app', 'www.bsky.app']);

// Parses `https://bsky.app/profile/<handle-or-did>/post/<rkey>` into its
// parts, or returns null for any other URL. The actor may be a handle, which
// the caller has to resolve to a DID before it can build an AT-URI.
export function parseBskyPostUrl(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!BSKY_HOSTS.has(parsed.hostname)) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length !== 4) return null;
  if (parts[0] !== 'profile' || parts[2] !== 'post') return null;
  const actor = decodeURIComponent(parts[1]);
  const rkey = decodeURIComponent(parts[3]);
  if (!actor || !rkey) return null;
  return { actor, rkey };
}

// Returns `{ actor, rkey, url }` for the first link facet that points at a
// Bluesky post, or null. A post URL wins over an earlier plain link: writing
// one out is a deliberate act of quoting, while a link card is only ever a
// default.
export function firstQuotedPostLink(facets) {
  for (const url of linkFacetUris(facets)) {
    const post = parseBskyPostUrl(url);
    if (post) return { ...post, url };
  }
  return null;
}
