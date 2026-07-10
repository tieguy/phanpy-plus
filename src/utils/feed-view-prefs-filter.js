// Apply Bluesky-style following-feed preferences (feedViewPref for the
// 'home' feed) to Mastodon-shaped statuses, so one preference set governs
// the whole home timeline across both networks.
// No imports — unit tests load this in Node.
//
// Semantics mirror the official Bluesky app:
// - hideReposts drops boosts/reposts; quote posts are unaffected
// - hideQuotePosts drops posts quoting another post
// - Replies to yourself (self-threads) are never treated as replies
// - hideRepliesByLikeCount hides replies below the like threshold
// - hideRepliesByUnfollowed is NOT applied here: Mastodon's home timeline
//   already omits replies to people you don't follow server-side
//   (the Bluesky facade applies it to its own feed with real follow data)

export function filterStatusesByFeedViewPrefs(statuses, fvp) {
  if (!fvp) return statuses;
  return statuses.filter((status) => {
    if (fvp.hideReposts && status.reblog) return false;

    const s = status.reblog || status;
    if (fvp.hideQuotePosts && s.quote) return false;
    const isReply =
      s.inReplyToId && s.inReplyToAccountId !== s.account?.id && !status.reblog;
    if (isReply) {
      if (fvp.hideReplies) return false;
      if (
        fvp.hideRepliesByLikeCount > 0 &&
        (s.favouritesCount || 0) < fvp.hideRepliesByLikeCount
      ) {
        return false;
      }
    }
    return true;
  });
}
