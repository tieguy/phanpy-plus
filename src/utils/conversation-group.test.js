import { describe, expect, it } from 'vitest';

import { groupConversations } from './conversation-group';

let seq = 0;
function response({
  id,
  inReplyToId = null,
  root,
  at,
  author = 'bob',
  type = 'mention',
  visibility = 'public',
}) {
  return {
    id: `n${seq++}`,
    type,
    createdAt: at,
    account: { id: author, displayName: author },
    status: {
      id,
      inReplyToId,
      visibility,
      ...(root ? { _threadRootId: root } : {}),
    },
  };
}

const t = (hour) => `2026-10-21T${String(hour).padStart(2, '0')}:00:00.000Z`;

describe('groupConversations', () => {
  it('groups replies to the same post into one conversation', () => {
    const [entry, ...rest] = groupConversations([
      {
        instance: 'm.test',
        notifications: [
          response({ id: 'r1', inReplyToId: 'mine', at: t(10), author: 'bob' }),
          response({ id: 'r2', inReplyToId: 'mine', at: t(11), author: 'cat' }),
        ],
      },
    ]);
    expect(rest).toEqual([]);
    expect(entry.key).toBe('m.test/mine');
    expect(entry.responseCount).toBe(2);
    expect(entry.latestStatus.id).toBe('r2');
    expect(entry.latestAt).toBe(t(11));
    expect(entry.accounts.map((a) => a.id)).toEqual(['cat', 'bob']);
  });

  it('follows a reply chain through the batch', () => {
    const entries = groupConversations([
      {
        instance: 'm.test',
        notifications: [
          response({ id: 'r1', inReplyToId: 'mine', at: t(10) }),
          response({ id: 'r2', inReplyToId: 'r1', at: t(11) }),
        ],
      },
    ]);
    expect(entries.map((e) => e.threadId)).toEqual(['mine']);
  });

  it('uses the Bluesky thread root when the status has one', () => {
    const entries = groupConversations([
      {
        instance: 'bsky.social',
        notifications: [
          response({ id: 'a', inReplyToId: 'x', root: 'root', at: t(10) }),
          response({ id: 'b', inReplyToId: 'y', root: 'root', at: t(11) }),
        ],
      },
    ]);
    expect(entries.map((e) => e.key)).toEqual(['bsky.social/root']);
  });

  it('treats a mention that is not a reply as its own thread', () => {
    const entries = groupConversations([
      {
        instance: 'm.test',
        notifications: [response({ id: 'solo', at: t(10) })],
      },
    ]);
    expect(entries.map((e) => e.threadId)).toEqual(['solo']);
  });

  it('keeps only public replies and mentions', () => {
    const entries = groupConversations([
      {
        instance: 'm.test',
        notifications: [
          response({ id: 'dm', at: t(10), visibility: 'direct' }),
          response({ id: 'q', at: t(11), type: 'quote' }),
          response({ id: 'f', at: t(12), type: 'favourite' }),
          { id: 'gone', type: 'mention', createdAt: t(13), status: null },
          response({ id: 'ok', at: t(9) }),
        ],
      },
    ]);
    expect(entries.map((e) => e.threadId)).toEqual(['ok']);
  });

  it('keeps instances apart and sorts newest first', () => {
    const entries = groupConversations([
      {
        instance: 'm.test',
        notifications: [response({ id: 'r', inReplyToId: 'p', at: t(10) })],
      },
      {
        instance: 'bsky.social',
        notifications: [response({ id: 'r', inReplyToId: 'p', at: t(12) })],
      },
    ]);
    expect(entries.map((e) => e.key)).toEqual(['bsky.social/p', 'm.test/p']);
  });

  it('stops on a reply cycle', () => {
    const entries = groupConversations([
      {
        instance: 'm.test',
        notifications: [
          response({ id: 'a', inReplyToId: 'b', at: t(10) }),
          response({ id: 'b', inReplyToId: 'a', at: t(11) }),
        ],
      },
    ]);
    expect(entries.length).toBeGreaterThan(0);
  });
});
