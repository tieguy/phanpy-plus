// Cross-network mention routing.
//
// A @-mention only renders as a link and notifies the recipient when it is
// posted from an account on the SAME network as the mentioned profile: a
// Bluesky handle (e.g. `alice.bsky.social`) is inert text in a Mastodon post,
// and a Mastodon `@user@domain` is inert on Bluesky. So when the user mentions
// a profile we must compose from one of their accounts on that profile's
// network — or, if they have none, not offer the mention at all.

import { eligibleAccounts } from './acting-accounts';

// Returns the instanceURL to compose a mention of the target profile from, or
// null when the user has no account on the target's network (in which case the
// caller must suppress the mention affordance).
//
//   targetIsBluesky – is the mentioned profile on Bluesky
//   active          – { instance, isBluesky } of the currently-active account
//   accounts        – all logged-in accounts (getAccounts())
export function getMentionInstance({ targetIsBluesky, active, accounts }) {
  // The active account is already on the target's network → post from it. This
  // is exactly the case that works today, including remote Mastodon mentions
  // across instances, so behaviour there is unchanged.
  if (active?.instance && !!active.isBluesky === !!targetIsBluesky) {
    return active.instance;
  }
  // Otherwise fall back to any account of mine on the target's network.
  const [match] = eligibleAccounts({ targetIsBluesky, accounts });
  return match?.instanceURL || null;
}
