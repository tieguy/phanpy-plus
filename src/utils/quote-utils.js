import { isBlueskyInstance } from './bluesky';
import { getAPIVersions, getCurrentInstance } from './store-utils';

// Quotes are native on Bluesky; on Mastodon they need API version 7+.
// Pass the post's/target's instance for cross-account correctness —
// without it, the check falls back to the current account's instance
export function supportsNativeQuote(instance) {
  if (instance ? isBlueskyInstance(instance) : getCurrentInstance()?._bluesky) {
    return true;
  }
  return getAPIVersions(instance)?.mastodon >= 7;
}

export function getPostQuoteApprovalPolicy(quoteApproval) {
  return quoteApproval?.[quoteApproval?.currentUser]?.[0] || 'nobody';
}

// Whether the user may quote a post, for an instance with native quotes.
// Returns { disabled, reason }. `reason` is null, 'requestQuote' (allowed, the
// author reviews it), or why quoting is disabled: 'quotePrivate',
// 'quoteFollowersOnly' or 'quoteCannot'. Follows Mastodon's own rules:
// https://github.com/mastodon/mastodon/blob/854aaec6fe69df02e6d850cb90eef37032b4d72f/app/javascript/mastodon/components/status/boost_button_utils.ts#L131-L163
export function getQuotePolicy({ visibility, isSelf, quoteApproval }) {
  const isPublic = ['public', 'unlisted'].includes(visibility);
  const isMineAndPrivate = isSelf && visibility === 'private';
  if (!isPublic && !isSelf) {
    return { disabled: true, reason: 'quotePrivate' };
  }
  if (
    quoteApproval?.currentUser === 'automatic' &&
    (isPublic || isMineAndPrivate)
  ) {
    return { disabled: false, reason: null };
  }
  if (
    quoteApproval?.currentUser === 'manual' &&
    (isPublic || isMineAndPrivate)
  ) {
    return { disabled: false, reason: 'requestQuote' };
  }
  const followersOnly =
    quoteApproval?.automatic?.[0] === 'followers' ||
    quoteApproval?.manual?.[0] === 'followers';
  return {
    disabled: true,
    reason: followersOnly ? 'quoteFollowersOnly' : 'quoteCannot',
  };
}
