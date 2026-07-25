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

// Whether a notification batch contains a direct response NEWER than the last
// notification the user saw (lastSeenCreatedAt, an ISO string or epoch ms).
//
// The bell badge uses this instead of a server `sinceId` cursor: the Bluesky
// facade's notifications.list ignores sinceId, so "is there anything new?" must
// be decided client-side by comparing timestamps against the last-seen marker.
// Comparing against a per-subtype timestamp (not a whole-stream read marker)
// avoids lighting the bell for likes/reposts/follows.
export function hasNewDirectResponse(notifications, lastSeenCreatedAt) {
  if (!Array.isArray(notifications)) return false;
  const lastSeen = lastSeenCreatedAt
    ? new Date(lastSeenCreatedAt).getTime()
    : 0;
  return notifications.some(
    (n) => isDirectResponse(n) && new Date(n.createdAt).getTime() > lastSeen,
  );
}
