import { describe, expect, it } from 'vitest';

import { parseFixedAccounts } from './fixed-accounts.js';

describe('parseFixedAccounts', () => {
  it('returns no accounts when unset', () => {
    expect(parseFixedAccounts(undefined)).toEqual([]);
    expect(parseFixedAccounts('')).toEqual([]);
  });

  it('parses one Mastodon and one Bluesky account, in order', () => {
    expect(
      parseFixedAccounts('mastodon:luis_in_brief@social.coop,bluesky:lu.is'),
    ).toEqual([
      {
        network: 'mastodon',
        username: 'luis_in_brief',
        instance: 'social.coop',
        label: '@luis_in_brief@social.coop',
      },
      { network: 'bluesky', handle: 'lu.is', label: '@lu.is' },
    ]);
  });

  it('accepts a leading @, spaces and mixed-case networks and hosts', () => {
    expect(
      parseFixedAccounts(' Mastodon:@Luis@Social.Coop , BLUESKY:@Lu.Is '),
    ).toEqual([
      {
        network: 'mastodon',
        username: 'Luis',
        instance: 'social.coop',
        label: '@Luis@social.coop',
      },
      { network: 'bluesky', handle: 'lu.is', label: '@lu.is' },
    ]);
  });

  it('drops malformed entries and keeps the rest', () => {
    expect(
      parseFixedAccounts(
        'mastodon:social.coop,mastodon:luis@,nostr:npub1,bluesky:,lu.is,bluesky:lu.is',
      ),
    ).toEqual([{ network: 'bluesky', handle: 'lu.is', label: '@lu.is' }]);
  });
});
