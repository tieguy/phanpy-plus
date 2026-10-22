// Conversation mode: groups reply and mention notifications into one entry per
// thread. A conversation exists only once someone responds to the user, so
// notifications are the only source.

import { isDirectResponse } from './notification-filter';

export const PAGE_CAP = 5;

const VIDEO_TYPES = new Set(['video', 'gifv']);

function timeOf(notification) {
  const time = Date.parse(notification?.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

// Mastodon delivers private mentions (DMs) as `mention` notifications too. DMs
// are not part of conversation mode.
function isPublicResponse(notification) {
  return (
    isDirectResponse(notification) &&
    !!notification.status &&
    notification.status.visibility !== 'direct'
  );
}

// Bluesky statuses carry their thread root (`_threadRootId`). Mastodon
// statuses do not, so the key follows `inReplyToId` through the statuses in
// this batch and stops at the first post outside it: usually the user's own
// post, which never arrives as a notification. Replies to the same post of the
// user's therefore share a key. Two replies whose chains meet only outside the
// batch get two keys.
function threadKey(status, byId) {
  if (status._threadRootId) return status._threadRootId;
  let current = status;
  const seen = new Set();
  while (current.inReplyToId && byId.has(current.inReplyToId)) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    current = byId.get(current.inReplyToId);
  }
  return current.inReplyToId || current.id;
}

// sources: [{ instance, notifications }]. Returns entries sorted newest first:
// { key, instance, threadId, latestAt, latestStatus, responseCount, accounts }.
// `accounts` lists the people who responded, newest first, once each.
export function groupConversations(sources) {
  const groups = new Map();
  for (const { instance, notifications = [] } of sources) {
    const responses = notifications.filter(isPublicResponse);
    const byId = new Map(responses.map((n) => [n.status.id, n.status]));
    for (const notification of responses) {
      const threadId = threadKey(notification.status, byId);
      const key = `${instance}/${threadId}`;
      let group = groups.get(key);
      if (!group) {
        group = { key, instance, threadId, responses: [] };
        groups.set(key, group);
      }
      group.responses.push(notification);
    }
  }

  return [...groups.values()]
    .map(({ responses, ...group }) => {
      responses.sort((a, b) => timeOf(b) - timeOf(a));
      const accounts = [];
      const seenAccounts = new Set();
      for (const { account } of responses) {
        if (!account || seenAccounts.has(account.id)) continue;
        seenAccounts.add(account.id);
        accounts.push(account);
      }
      return {
        ...group,
        latestAt: responses[0].createdAt,
        latestStatus: responses[0].status,
        responseCount: responses.length,
        accounts,
      };
    })
    .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt));
}

// What a row's text excerpt leaves out, so the row can say so:
// { images, videos, others, quote, card, poll }.
export function statusExtras(status) {
  const extras = {
    images: 0,
    videos: 0,
    others: 0,
    quote: !!status?.quote,
    card: !!status?.card,
    poll: !!status?.poll,
  };
  for (const m of status?.mediaAttachments || []) {
    if (m.type === 'image') extras.images++;
    else if (VIDEO_TYPES.has(m.type)) extras.videos++;
    else extras.others++;
  }
  return extras;
}
