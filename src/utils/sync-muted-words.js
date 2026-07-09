import { api } from './api';
import { getOtherNetworkAccounts, isBlueskyAccount } from './bluesky';
import { getCurrentAccount } from './store-utils';

// Union-merge keyword mute lists between a Mastodon account and a Bluesky
// account. Only ever adds words — never deletes — so re-running is a no-op
// once both sides converge.
//
// Semantics chosen deliberately:
// - Mastodon → Bluesky: only keywords from 'hide' filters are pushed, since
//   Bluesky muted words always fully hide (pushing 'warn' keywords would
//   silently escalate them)
// - Bluesky → Mastodon: words land in a single 'hide' filter (all contexts,
//   no expiry) so they don't clutter the filter list
// - Expired entries on either side are ignored
// - Duplicate detection compares against *all* Mastodon keywords (any
//   action), so a word already warn-filtered isn't also added as hidden

export const SYNCED_FILTER_TITLE = 'Muted words (synced)';

const FILTER_CONTEXTS = [
  'home',
  'notifications',
  'public',
  'thread',
  'account',
];

function normalize(keyword) {
  return keyword.trim().toLowerCase();
}

function isExpired(expiresAt) {
  return !!expiresAt && Date.parse(expiresAt) <= Date.now();
}

// Resolve the { mastodonAccount, blueskyAccount } pair: the current account
// plus the first logged-in account on the other network
export function getSyncAccountPair() {
  const current = getCurrentAccount();
  const others = getOtherNetworkAccounts();
  if (!current || !others.length) return null;
  return isBlueskyAccount(current)
    ? { mastodonAccount: others[0], blueskyAccount: current }
    : { mastodonAccount: current, blueskyAccount: others[0] };
}

export async function computeMutedWordsSyncPlan() {
  const pair = getSyncAccountPair();
  if (!pair) return null;
  const { mastodonAccount, blueskyAccount } = pair;

  const { masto: mastoAPI } = api({ account: mastodonAccount });
  const { masto: bskyAPI } = api({ account: blueskyAccount });

  const [mastoFilters, bskyFilters] = await Promise.all([
    mastoAPI.v2.filters.list(),
    bskyAPI.v2.filters.list(),
  ]);

  // Every keyword on Mastodon, regardless of action — for dedupe
  const mastoAllKeywords = new Set();
  // Keywords eligible to push to Bluesky: active 'hide' filters only
  const mastoHideKeywords = new Map(); // normalized -> original
  let syncedFilter = null;
  for (const filter of mastoFilters) {
    if (filter.title === SYNCED_FILTER_TITLE) syncedFilter = filter;
    const expired = isExpired(filter.expiresAt);
    for (const { keyword } of filter.keywords || []) {
      const norm = normalize(keyword);
      mastoAllKeywords.add(norm);
      if (!expired && filter.filterAction === 'hide') {
        if (!mastoHideKeywords.has(norm)) mastoHideKeywords.set(norm, keyword);
      }
    }
  }

  // The Bluesky facade maps one muted word to one single-keyword filter
  const bskyWords = new Map(); // normalized -> original
  for (const filter of bskyFilters) {
    if (isExpired(filter.expiresAt)) continue;
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

  return {
    mastodonAccount,
    blueskyAccount,
    toBluesky,
    toMastodon,
    syncedFilter,
  };
}

export async function applyMutedWordsSyncPlan(plan) {
  const {
    mastodonAccount,
    blueskyAccount,
    toBluesky,
    toMastodon,
    syncedFilter,
  } = plan;

  if (toBluesky.length) {
    const { masto: bskyAPI } = api({ account: blueskyAccount });
    // The facade's create() adds every keyword as a muted word in one
    // putPreferences call and refreshes its cache
    await bskyAPI.v2.filters.create({
      title: toBluesky[0],
      keywordsAttributes: toBluesky.map((keyword) => ({ keyword })),
    });
  }

  if (toMastodon.length) {
    const { masto: mastoAPI } = api({ account: mastodonAccount });
    const keywordsAttributes = toMastodon.map((keyword) => ({
      keyword,
      wholeWord: !/\s/.test(keyword),
    }));
    if (syncedFilter) {
      // Nested-attributes semantics: records without an id are created,
      // existing keywords not mentioned are left untouched
      await mastoAPI.v2.filters.$select(syncedFilter.id).update({
        title: syncedFilter.title,
        context: syncedFilter.context,
        filterAction: syncedFilter.filterAction,
        keywordsAttributes,
      });
    } else {
      await mastoAPI.v2.filters.create({
        title: SYNCED_FILTER_TITLE,
        context: FILTER_CONTEXTS,
        filterAction: 'hide',
        expiresIn: null,
        keywordsAttributes,
      });
    }
  }
}
