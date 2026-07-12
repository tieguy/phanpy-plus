// Unified direct-message client across both networks.
//
// The two networks model DMs very differently:
//   - Mastodon: a DM thread is a chain of `visibility: direct` statuses. The
//     Conversations API lists them; replies are just statuses that mention the
//     participants; a thread is the status context.
//   - Bluesky: a genuinely separate chat service (see ./bluesky/chat.js).
//
// This module hides that behind one interface producing the network-neutral
// Conversation / Message shapes (matching ./bluesky/chat.js), so a single
// merged inbox can list both and one thread view can render either.

import { api } from './api';
import { isBlueskyAccount, getOtherNetworkAccounts } from './bluesky';
import { conversationToNeutral, statusToMessage } from './dm-convert';
import { getCurrentAccount } from './store-utils';

export { conversationToNeutral, statusToMessage } from './dm-convert';

// The app uses hash routing and does not carry router state across links, so
// the inbox stashes loaded conversations here for the thread view to pick up
// (keyed by instance + id). Lost on hard reload — the thread view then refetches
// (Bluesky) or redirects back to the inbox (Mastodon).
const conversationCache = new Map();
const cacheKey = (instance, id) => `${instance}:${id}`;
export function cacheConversation(conversation) {
  if (conversation?.id && conversation._instance) {
    conversationCache.set(
      cacheKey(conversation._instance, conversation.id),
      conversation,
    );
  }
}
export function getCachedConversation(instance, id) {
  return conversationCache.get(cacheKey(instance, id)) || null;
}

// masto.js-style paginator whose pages are mapped through `mapFn`.
function mapPaginator(iterable, mapFn) {
  return {
    values() {
      const it = iterable.values();
      return {
        async next() {
          const { done, value } = await it.next();
          return { done, value: value?.map(mapFn) };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
    [Symbol.asyncIterator]() {
      return this.values();
    },
  };
}

// Build a per-account DM adapter with a network-neutral interface.
export function getDMClient(account) {
  const bluesky = isBlueskyAccount(account);
  const instance = account.instanceURL;
  const selfId = account.info?.id;
  const apiResult = api({ account });
  const { masto } = apiResult;

  if (bluesky) {
    const chat = apiResult.client?.chat;
    return {
      account,
      instance,
      network: 'bluesky',
      listConversations: (opts) => chat.listConversations(opts),
      getConversation: (id) => chat.getConvo(id),
      async getThread(conversation, { limit = 50 } = {}) {
        // Newest-first from the API; reverse to chronological for display.
        const { value } = await chat
          .getMessages(conversation.id, { limit })
          .values()
          .next();
        return (value || []).slice().reverse();
      },
      sendMessage: (conversation, text) =>
        chat.sendMessage(conversation.id, text),
      markRead: (conversation) => chat.markRead(conversation.id),
    };
  }

  return {
    account,
    instance,
    network: 'mastodon',
    // Mastodon has no "fetch one conversation by id" endpoint; the thread view
    // relies on the conversation passed via navigation state.
    getConversation: async () => null,
    listConversations: ({ limit = 40 } = {}) =>
      mapPaginator(masto.v1.conversations.list({ limit }), (c) =>
        conversationToNeutral(c, selfId, instance),
      ),
    async getThread(conversation) {
      const statusId = conversation._lastStatus?.id;
      if (!statusId) return [];
      const ctx = await masto.v1.statuses.$select(statusId).context.fetch();
      const thread = [
        ...(ctx.ancestors || []),
        conversation._lastStatus,
        ...(ctx.descendants || []),
      ];
      return thread.map((s) => statusToMessage(s, selfId));
    },
    async sendMessage(conversation, text) {
      // Mastodon delivers a DM only to accounts mentioned in the post.
      const mentions = (conversation.accounts || [])
        .map((a) => `@${a.acct}`)
        .join(' ');
      const status = mentions ? `${mentions} ${text}` : text;
      const created = await masto.v1.statuses.create({
        status,
        visibility: 'direct',
        inReplyToId: conversation._lastStatus?.id,
      });
      return statusToMessage(created, selfId);
    },
    async markRead(conversation) {
      try {
        await masto.v1.conversations.$select(conversation.id).read();
      } catch (e) {}
    },
  };
}

// Every account whose DMs should appear in the merged inbox: the current
// account, plus other-network accounts when the merged view is enabled.
export function getDMSources({ merged = true } = {}) {
  const current = getCurrentAccount();
  const accounts = [current, ...(merged ? getOtherNetworkAccounts() : [])]
    .filter(Boolean)
    // De-dupe by account id in case current shows up in both lists.
    .filter((a, i, arr) => arr.findIndex((b) => b.info?.id === a.info?.id) === i);
  return accounts.map(getDMClient);
}

// The DM adapter for a specific account instance (used by the thread view to
// resolve which network/account a conversation belongs to on hard reload).
export function getDMClientForInstance(instance) {
  return getDMSources().find((s) => s.instance === instance) || null;
}
