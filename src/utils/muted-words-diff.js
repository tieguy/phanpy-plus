// Pure diff logic for the Mastodon ↔ Bluesky muted-words sync.
// No imports — keep it that way so unit tests can load it in Node.
//
// Semantics chosen deliberately:
// - Mastodon → Bluesky: only keywords from 'hide' filters are pushed, since
//   Bluesky muted words always fully hide (pushing 'warn' keywords would
//   silently escalate them)
// - Expired entries on either side are ignored
// - Duplicate detection compares against *all* Mastodon keywords (any
//   action), so a word already warn-filtered isn't also added as hidden

export const SYNCED_FILTER_TITLE = 'Muted words (synced)';

function normalize(keyword) {
  return keyword.trim().toLowerCase();
}

function isExpired(expiresAt, now = Date.now()) {
  return !!expiresAt && Date.parse(expiresAt) <= now;
}

// Takes Mastodon filters and the Bluesky facade's filter-shaped muted
// words; returns what each side is missing plus the existing synced
// filter, if any. `now` is injectable for tests.
export function computeSyncActions(mastoFilters, bskyFilters, now) {
  const expired = (expiresAt) => isExpired(expiresAt, now);

  // Every keyword on Mastodon, regardless of action — for dedupe
  const mastoAllKeywords = new Set();
  // Keywords eligible to push to Bluesky: active 'hide' filters only
  const mastoHideKeywords = new Map(); // normalized -> original
  let syncedFilter = null;
  for (const filter of mastoFilters) {
    if (filter.title === SYNCED_FILTER_TITLE) syncedFilter = filter;
    const filterExpired = expired(filter.expiresAt);
    for (const { keyword } of filter.keywords || []) {
      const norm = normalize(keyword);
      mastoAllKeywords.add(norm);
      if (!filterExpired && filter.filterAction === 'hide') {
        if (!mastoHideKeywords.has(norm)) mastoHideKeywords.set(norm, keyword);
      }
    }
  }

  // The Bluesky facade maps one muted word to one single-keyword filter
  const bskyWords = new Map(); // normalized -> original
  for (const filter of bskyFilters) {
    if (expired(filter.expiresAt)) continue;
    const keyword = filter.keywords?.[0]?.keyword;
    if (!keyword) continue;
    const norm = normalize(keyword);
    if (!bskyWords.has(norm)) bskyWords.set(norm, keyword);
  }

  const toBluesky = [...mastoHideKeywords]
    .filter(([norm]) => !bskyWords.has(norm))
    .map(([, keyword]) => keyword);
  const toMastodon = [...bskyWords]
    .filter(([norm]) => !mastoAllKeywords.has(norm))
    .map(([, keyword]) => keyword);

  return { toBluesky, toMastodon, syncedFilter };
}
