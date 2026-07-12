// Bluesky direct-message (chat) support.
//
// Bluesky chat is a separate service from the PDS: every call must be routed
// through the `bsky_chat` service proxy. It is also a genuinely different data
// model from Mastodon DMs (which are just `visibility: direct` posts) — chat is
// message-based, not post-based. This module converts the AT Protocol
// `chat.bsky.convo.*` shapes into the network-neutral DM shapes used by the
// unified DM client (`src/utils/dm.js`), so a Bluesky conversation can sit in
// the same merged inbox as a Mastodon one.

import { profileToAccount, textToHTML } from './convert';

// Service proxy required for all chat.bsky.convo.* calls. Without it the
// request hits the user's PDS, which does not host chat, and errors.
export const CHAT_PROXY_SERVICE = 'did:web:api.bsky.chat';
export const CHAT_PROXY_TYPE = 'bsky_chat';

// chat.bsky.convo.defs#messageView → neutral Message.
// Sender is resolved to a bare DID here (the message view only carries a DID);
// the thread UI maps it to a full account from the conversation's participants.
export function messageToMessage(msg, selfDid, instance) {
  if (!msg) return null;
  // Deleted / system messages have no `text`.
  const text = typeof msg.text === 'string' ? msg.text : '';
  const senderDid = msg.sender?.did;
  return {
    id: msg.id,
    network: 'bluesky',
    _instance: instance,
    text,
    html: textToHTML(text, msg.facets),
    createdAt: msg.sentAt,
    fromSelf: !!senderDid && senderDid === selfDid,
    senderId: senderDid,
    deleted: msg.$type === 'chat.bsky.convo.defs#deletedMessageView',
  };
}

// chat.bsky.convo.defs#convoView → neutral Conversation (an inbox row).
export function convoToConversation(convo, selfDid, instance) {
  if (!convo) return null;
  const members = convo.members || [];
  const others = members.filter((m) => m.did !== selfDid);
  // For a direct convo `others` has one member; for a group it has several.
  const accounts = others.map((m) => profileToAccount(m, instance));

  const lm = convo.lastMessage;
  // Only real messages carry text; skip deleted/system views for the snippet.
  const hasText = lm && typeof lm.text === 'string';
  const lastMessage = hasText
    ? {
        id: lm.id,
        text: lm.text,
        createdAt: lm.sentAt,
        fromSelf: lm.sender?.did === selfDid,
        senderId: lm.sender?.did,
      }
    : null;

  return {
    id: convo.id,
    network: 'bluesky',
    _instance: instance,
    instance,
    accounts,
    lastMessage,
    unread: (convo.unreadCount || 0) > 0,
    unreadCount: convo.unreadCount || 0,
    muted: !!convo.muted,
    group: (members.length || 0) > 2,
    // Sort key for the merged inbox. Fall back to `rev` (a sortable TID) when a
    // convo has no messages yet, so it still orders deterministically.
    createdAt: lastMessage?.createdAt || convo.rev || '',
  };
}
