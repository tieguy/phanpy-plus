// Notification filtering for the "only direct responses" preference
// (settings.notificationsResponsesOnly).
//
// A "direct response" is a reply to, or an @-mention of, the user — the only
// notifications kept when the preference is on. Quote-posts, reposts/boosts,
// likes/favourites, follows and passive post types (status/poll/update) are not
// responses and are dropped.
//
// On BOTH networks a reply and a mention arrive as the Mastodon-shaped
// `mention` type: Mastodon uses `mention` for replies and mentions alike, and
// the Bluesky converter maps reply+mention → 'mention' and quote → 'quote'
// (see src/utils/bluesky/convert.js). So keeping `mention` keeps replies and
// mentions while excluding quotes across networks.
export function isDirectResponse(notification) {
  return notification?.type === 'mention';
}
