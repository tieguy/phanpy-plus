import { isBlueskyInstance } from './bluesky';
import { getAPIVersions, getCurrentInstance } from './store-utils';

// Quotes are native on Bluesky; on Mastodon they need API version 7+.
// Pass the post's/target's instance for cross-account correctness —
// without it, the check falls back to the current account's instance
export function supportsNativeQuote(instance) {
  if (instance ? isBlueskyInstance(instance) : getCurrentInstance()?._bluesky) {
    return true;
  }
  return getAPIVersions()?.mastodon >= 7;
}

export function getPostQuoteApprovalPolicy(quoteApproval) {
  return quoteApproval?.[quoteApproval?.currentUser]?.[0] || 'nobody';
}
