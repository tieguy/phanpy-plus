import { api } from './api';
import { getOtherNetworkAccounts, isBlueskyAccount } from './bluesky';
import { computeSyncActions, SYNCED_FILTER_TITLE } from './muted-words-diff';
import { getCurrentAccount } from './store-utils';

// Union-merge keyword mute lists between a Mastodon account and a Bluesky
// account. Only ever adds words — never deletes — so re-running is a no-op
// once both sides converge. Diff semantics live in muted-words-diff.js;
// this module handles account resolution and the actual API writes:
// - Bluesky → Mastodon: words land in a single 'hide' filter (all
//   contexts, no expiry) so they don't clutter the filter list

export { SYNCED_FILTER_TITLE };

const FILTER_CONTEXTS = [
  'home',
  'notifications',
  'public',
  'thread',
  'account',
];

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

  return {
    mastodonAccount,
    blueskyAccount,
    ...computeSyncActions(mastoFilters, bskyFilters),
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
