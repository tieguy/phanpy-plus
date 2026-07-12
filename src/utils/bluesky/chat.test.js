import { describe, expect, it } from 'vitest';

import { convoToConversation, messageToMessage } from './chat';

const SELF = 'did:plc:self';
const OTHER = 'did:plc:other';
const INSTANCE = 'bsky.social';

const otherMember = {
  did: OTHER,
  handle: 'alice.bsky.social',
  displayName: 'Alice',
  avatar: 'https://cdn/alice.jpg',
};
const selfMember = { did: SELF, handle: 'me.bsky.social', displayName: 'Me' };

function messageView(overrides = {}) {
  return {
    $type: 'chat.bsky.convo.defs#messageView',
    id: 'msg1',
    rev: '3l',
    text: 'hello there',
    sender: { did: OTHER },
    sentAt: '2026-07-12T10:00:00.000Z',
    ...overrides,
  };
}

describe('messageToMessage', () => {
  it('converts a peer message', () => {
    const m = messageToMessage(messageView(), SELF, INSTANCE);
    expect(m.id).toBe('msg1');
    expect(m.text).toBe('hello there');
    expect(m.html).toBe('<p>hello there</p>');
    expect(m.createdAt).toBe('2026-07-12T10:00:00.000Z');
    expect(m.fromSelf).toBe(false);
    expect(m.senderId).toBe(OTHER);
    expect(m._instance).toBe(INSTANCE);
  });

  it('marks own messages fromSelf', () => {
    const m = messageToMessage(
      messageView({ sender: { did: SELF } }),
      SELF,
      INSTANCE,
    );
    expect(m.fromSelf).toBe(true);
  });

  it('renders link facets as anchors', () => {
    const text = 'see docs';
    const m = messageToMessage(
      messageView({
        text,
        facets: [
          {
            index: { byteStart: 4, byteEnd: 8 },
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://example.com',
              },
            ],
          },
        ],
      }),
      SELF,
      INSTANCE,
    );
    expect(m.html).toContain('href="https://example.com"');
    expect(m.html).toContain('>docs</a>');
  });

  it('handles deleted messages without a text field', () => {
    const m = messageToMessage(
      {
        $type: 'chat.bsky.convo.defs#deletedMessageView',
        id: 'gone',
        sender: { did: OTHER },
        sentAt: '2026-07-12T10:00:00.000Z',
      },
      SELF,
      INSTANCE,
    );
    expect(m.text).toBe('');
    expect(m.html).toBe('');
    expect(m.deleted).toBe(true);
  });

  it('returns null for a missing message', () => {
    expect(messageToMessage(null, SELF, INSTANCE)).toBeNull();
  });
});

describe('convoToConversation', () => {
  const baseConvo = {
    id: 'convo1',
    rev: '3labc',
    members: [selfMember, otherMember],
    lastMessage: messageView(),
    unreadCount: 2,
    muted: false,
  };

  it('exposes the other member as the conversation account', () => {
    const c = convoToConversation(baseConvo, SELF, INSTANCE);
    expect(c.id).toBe('convo1');
    expect(c.network).toBe('bluesky');
    expect(c.accounts).toHaveLength(1);
    expect(c.accounts[0].id).toBe(OTHER);
    expect(c.accounts[0].acct).toBe('alice.bsky.social');
  });

  it('summarises the last message and unread state', () => {
    const c = convoToConversation(baseConvo, SELF, INSTANCE);
    expect(c.lastMessage.text).toBe('hello there');
    expect(c.lastMessage.fromSelf).toBe(false);
    expect(c.unread).toBe(true);
    expect(c.unreadCount).toBe(2);
  });

  it('uses the last message time as the merge sort key', () => {
    const c = convoToConversation(baseConvo, SELF, INSTANCE);
    expect(c.createdAt).toBe('2026-07-12T10:00:00.000Z');
    expect(c._instance).toBe(INSTANCE);
  });

  it('falls back to rev when there is no last message', () => {
    const c = convoToConversation(
      { ...baseConvo, lastMessage: undefined, unreadCount: 0 },
      SELF,
      INSTANCE,
    );
    expect(c.lastMessage).toBeNull();
    expect(c.unread).toBe(false);
    expect(c.createdAt).toBe('3labc');
  });

  it('skips a deleted last message for the snippet', () => {
    const c = convoToConversation(
      {
        ...baseConvo,
        lastMessage: {
          $type: 'chat.bsky.convo.defs#deletedMessageView',
          id: 'x',
          sender: { did: OTHER },
          sentAt: '2026-07-12T11:00:00.000Z',
        },
      },
      SELF,
      INSTANCE,
    );
    expect(c.lastMessage).toBeNull();
  });

  it('flags group conversations', () => {
    const third = { did: 'did:plc:third', handle: 'bob.bsky.social' };
    const c = convoToConversation(
      { ...baseConvo, members: [selfMember, otherMember, third] },
      SELF,
      INSTANCE,
    );
    expect(c.group).toBe(true);
    expect(c.accounts).toHaveLength(2);
  });
});
