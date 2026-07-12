import { describe, expect, it } from 'vitest';

import { conversationToNeutral, statusToMessage } from './dm-convert';

const SELF = 'self-123';
const INSTANCE = 'mastodon.social';

const peer = { id: 'peer-1', acct: 'alice@mastodon.social', username: 'alice' };
const me = { id: SELF, acct: 'me@mastodon.social', username: 'me' };

function status(overrides = {}) {
  return {
    id: 's1',
    content: '<p>hello <br>there</p>',
    createdAt: '2026-07-12T10:00:00.000Z',
    account: peer,
    visibility: 'direct',
    ...overrides,
  };
}

describe('statusToMessage', () => {
  it('flattens HTML content to a snippet but keeps the HTML', () => {
    const m = statusToMessage(status(), SELF);
    expect(m.text).toBe('hello there');
    expect(m.html).toBe('<p>hello <br>there</p>');
    expect(m.fromSelf).toBe(false);
    expect(m.senderId).toBe('peer-1');
    expect(m.sender).toBe(peer);
  });

  it('marks own statuses fromSelf', () => {
    const m = statusToMessage(status({ account: me }), SELF);
    expect(m.fromSelf).toBe(true);
  });

  it('returns null for a missing status', () => {
    expect(statusToMessage(null, SELF)).toBeNull();
  });
});

describe('conversationToNeutral', () => {
  const conv = {
    id: 'c1',
    unread: true,
    accounts: [peer],
    lastStatus: status(),
  };

  it('maps the conversation to the neutral shape', () => {
    const c = conversationToNeutral(conv, SELF, INSTANCE);
    expect(c.id).toBe('c1');
    expect(c.network).toBe('mastodon');
    expect(c.instance).toBe(INSTANCE);
    expect(c._instance).toBe(INSTANCE);
    expect(c.accounts).toEqual([peer]);
    expect(c.unread).toBe(true);
  });

  it('summarises the last status and exposes it for threading', () => {
    const c = conversationToNeutral(conv, SELF, INSTANCE);
    expect(c.lastMessage.text).toBe('hello there');
    expect(c.lastMessage.fromSelf).toBe(false);
    expect(c.createdAt).toBe('2026-07-12T10:00:00.000Z');
    expect(c._lastStatus).toBe(conv.lastStatus);
  });

  it('handles a conversation with no last status', () => {
    const c = conversationToNeutral(
      { id: 'c2', unread: false, accounts: [peer], lastStatus: null },
      SELF,
      INSTANCE,
    );
    expect(c.lastMessage).toBeNull();
    expect(c.createdAt).toBe('');
    expect(c.unread).toBe(false);
  });

  it('flags group conversations by participant count', () => {
    const c = conversationToNeutral(
      { ...conv, accounts: [peer, me] },
      SELF,
      INSTANCE,
    );
    expect(c.group).toBe(true);
  });
});
