// Link-card (website preview) generation for outgoing Bluesky posts.
//
// Unlike Mastodon, which unfurls links server-side, a Bluesky client must build
// the `app.bsky.embed.external` card itself: fetch the URL's OpenGraph metadata,
// upload a thumbnail blob, and attach the embed. We use Bluesky's own hosted
// unfurl service (CardyB) — the same one the official app uses — because the
// browser can't fetch arbitrary sites directly (CORS).
//
// This is strictly best-effort: any failure here must leave the post untouched,
// so callers treat a null return as "post without a card".

const CARDYB_ENDPOINT = 'https://cardyb.bsky.app/v1/extract';
const CARDYB_TIMEOUT = 5_000; // ms — never hold up a post for long
// Kept in step with MAX_IMAGE_SIZE in client.js (the PDS blob limit is ~976 KB);
// skip an oversized thumbnail rather than failing, so the card still posts
// without an image. CardyB thumbnails are normally well under this.
const MAX_THUMB_BYTES = 950_000;

// Returns the URIs of every `#link` facet in a RichText facet list, in facet
// order. Pure and dependency-free so it stays unit-testable under the node
// runner.
export function linkFacetUris(facets) {
  const uris = [];
  if (!Array.isArray(facets)) return uris;
  for (const facet of facets) {
    for (const feature of facet?.features || []) {
      if (feature?.$type === 'app.bsky.richtext.facet#link' && feature.uri) {
        uris.push(feature.uri);
      }
    }
  }
  return uris;
}

// Returns the URI of the first `#link` facet, or null.
export function firstLinkFacetUri(facets) {
  return linkFacetUris(facets)[0] ?? null;
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CARDYB_TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Builds an `app.bsky.embed.external` embed for `url`, or returns null on any
// failure (service down, timeout, no metadata, blob rejected). Never throws.
export async function buildExternalEmbed(agent, url) {
  try {
    const res = await fetchWithTimeout(
      `${CARDYB_ENDPOINT}?url=${encodeURIComponent(url)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error || !data?.title) return null;

    let thumb;
    if (data.image) {
      try {
        const imgRes = await fetchWithTimeout(data.image);
        if (imgRes.ok) {
          const buf = await imgRes.arrayBuffer();
          if (buf.byteLength && buf.byteLength <= MAX_THUMB_BYTES) {
            const encoding = imgRes.headers.get('content-type') || 'image/jpeg';
            const uploaded = await agent.uploadBlob(new Uint8Array(buf), {
              encoding,
            });
            thumb = uploaded?.data?.blob;
          }
        }
      } catch (e) {
        // Thumbnail is optional — fall through and post the card without it.
      }
    }

    return {
      $type: 'app.bsky.embed.external',
      external: {
        uri: url,
        title: data.title,
        description: data.description || '',
        ...(thumb ? { thumb } : {}),
      },
    };
  } catch (e) {
    return null;
  }
}
