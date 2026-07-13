// Shared keyword muting across both networks.
//
// The user's ask: filtering the day's "main character" should be one action,
// and it should apply everywhere — Mastodon has no shared keyword filtering
// with Bluesky. Both networks accept the same v2.filters.create shape (the
// Bluesky facade maps it onto muted words), so we just fan out.

import { api } from './api';
import { getOtherNetworkAccounts } from './bluesky';
import { getCurrentAccount } from './store-utils';

const DAY = 24 * 60 * 60;
export const MUTE_DURATIONS = {
  day: DAY,
  week: 7 * DAY,
  forever: 0,
};

// Mute `keyword` on the current account and every other-network account.
// `expiresIn` is seconds (0/falsy = permanent). Returns the instances it
// succeeded on so the caller can report what happened.
export async function muteWordEverywhere(keyword, { expiresIn = DAY } = {}) {
  const word = (keyword || '').trim();
  if (!word) return [];
  const accounts = [getCurrentAccount(), ...getOtherNetworkAccounts()]
    .filter(Boolean)
    .filter(
      (a, i, arr) => arr.findIndex((b) => b.info?.id === a.info?.id) === i,
    );
  const params = {
    title: word,
    context: ['home', 'notifications', 'public', 'thread', 'account'],
    filterAction: 'hide',
    keywordsAttributes: [{ keyword: word, wholeWord: true }],
    ...(expiresIn ? { expiresIn } : {}),
  };
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const { masto, instance } = api({ account });
        await masto.v2.filters.create(params);
        return instance;
      } catch (e) {
        console.error('Failed to mute word on account', account?.info?.id, e);
        return null;
      }
    }),
  );
  return results.filter(Boolean);
}
