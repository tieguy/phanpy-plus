// Pure converters for the unified DM client (see ./dm.js).
// Kept dependency-free so they're cheap to unit-test in isolation.

// Minimal HTML → text for inbox snippets (full HTML is kept for the thread).
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>\s*<p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// masto.js Status → neutral Message
export function statusToMessage(status, selfId) {
  if (!status) return null;
  return {
    id: status.id,
    network: 'mastodon',
    text: htmlToText(status.content),
    html: status.content || '',
    createdAt: status.createdAt,
    fromSelf: status.account?.id === selfId,
    senderId: status.account?.id,
    sender: status.account,
    _status: status,
  };
}

// masto.js Conversation → neutral Conversation
export function conversationToNeutral(conversation, selfId, instance) {
  if (!conversation) return null;
  const ls = conversation.lastStatus;
  const accounts = conversation.accounts || [];
  return {
    id: conversation.id,
    network: 'mastodon',
    _instance: instance,
    instance,
    accounts,
    lastMessage: ls
      ? {
          id: ls.id,
          text: htmlToText(ls.content),
          createdAt: ls.createdAt,
          fromSelf: ls.account?.id === selfId,
          senderId: ls.account?.id,
        }
      : null,
    unread: !!conversation.unread,
    unreadCount: conversation.unread ? 1 : 0,
    muted: false,
    group: accounts.length > 1,
    createdAt: ls?.createdAt || '',
    _lastStatus: ls,
  };
}
