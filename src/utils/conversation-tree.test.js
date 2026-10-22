import { describe, expect, it } from 'vitest';

import { isHiddenAuthor, nestRows, threadRows } from './conversation-tree';

let minute = 0;
function post(id, inReplyToId = null, account = { id: 'bob' }) {
  minute++;
  return {
    id,
    inReplyToId,
    account,
    createdAt: `2026-10-22T10:${String(minute).padStart(2, '0')}:00.000Z`,
  };
}

const shape = (rows) =>
  rows.map((r) =>
    r.type === 'post' ? `${r.depth}:${r.id}` : `${r.depth}:+${r.count}`,
  );

describe('threadRows', () => {
  it('nests replies under their parent in time order', () => {
    const rows = threadRows(
      [post('root'), post('a', 'root'), post('b', 'root'), post('a1', 'a')],
      { rootId: 'root', focusedId: 'root' },
    );
    expect(shape(rows)).toEqual(['0:root', '1:a', '2:a1', '1:b']);
  });

  it('caps the depth', () => {
    const rows = threadRows(
      [
        post('r'),
        post('1', 'r'),
        post('2', '1'),
        post('3', '2'),
        post('4', '3'),
      ],
      { rootId: 'r', focusedId: '4' },
    );
    expect(shape(rows)).toEqual(['0:r', '1:1', '2:2', '3:3', '3:4']);
  });

  it('collapses a long side branch and keeps the focused branch open', () => {
    const statuses = [
      post('r'),
      post('side', 'r'),
      post('s1', 'side'),
      post('s2', 'side'),
      post('s3', 's1'),
      post('mine', 'r'),
      post('m1', 'mine'),
      post('m2', 'mine'),
      post('m3', 'm1'),
    ];
    const rows = threadRows(statuses, { rootId: 'r', focusedId: 'm3' });
    expect(shape(rows)).toEqual([
      '0:r',
      '1:side',
      '2:+3',
      '1:mine',
      '2:m1',
      '3:m3',
      '2:m2',
    ]);
    const open = threadRows(statuses, {
      rootId: 'r',
      focusedId: 'm3',
      expanded: new Set(['side']),
    });
    expect(shape(open).slice(0, 5)).toEqual([
      '0:r',
      '1:side',
      '2:s1',
      '3:s3',
      '2:s2',
    ]);
  });

  it('shows a post with a missing parent as a reply to the root', () => {
    const rows = threadRows([post('r'), post('orphan', 'gone')], {
      rootId: 'r',
      focusedId: 'orphan',
    });
    expect(shape(rows)).toEqual(['0:r', '1:orphan']);
  });

  it('leaves out muted and blocked authors with the replies under them', () => {
    const muted = { id: 'm', _viewer: { muted: true } };
    const rows = threadRows(
      [post('r'), post('x', 'r', muted), post('x1', 'x'), post('ok', 'r')],
      { rootId: 'r', focusedId: 'ok' },
    );
    expect(shape(rows)).toEqual(['0:r', '1:ok']);
  });

  it('keeps a muted author on the line to the focused post', () => {
    const muted = { id: 'm', _viewer: { muted: true } };
    const rows = threadRows(
      [post('r', null, muted), post('x', 'r', muted), post('me', 'x')],
      { rootId: 'r', focusedId: 'me' },
    );
    expect(shape(rows)).toEqual(['0:r', '1:x', '2:me']);
  });

  it('returns nothing without the root', () => {
    expect(threadRows([post('a')], { rootId: 'r', focusedId: 'a' })).toEqual(
      [],
    );
  });

  it('stops on a reply cycle', () => {
    const rows = threadRows([post('r'), post('a', 'b'), post('b', 'a')], {
      rootId: 'r',
      focusedId: 'a',
    });
    expect(rows[0]).toEqual({ type: 'post', id: 'r', depth: 0 });
  });
});

describe('isHiddenAuthor', () => {
  it('hides muted, blocked and blocking Bluesky accounts only', () => {
    expect(isHiddenAuthor({ _viewer: { muted: true } })).toBe(true);
    expect(isHiddenAuthor({ _viewer: { blocking: 'at://x' } })).toBe(true);
    expect(isHiddenAuthor({ _viewer: { blockedBy: true } })).toBe(true);
    expect(isHiddenAuthor({ _viewer: { following: 'at://y' } })).toBe(false);
    expect(isHiddenAuthor({ id: 'mastodon' })).toBe(false);
    expect(isHiddenAuthor(null)).toBe(false);
  });
});

describe('nestRows', () => {
  const ids = (nodes) =>
    nodes.map((n) => (n.children.length ? [n.id, ids(n.children)] : n.id));

  it('makes deeper rows children of the row before them', () => {
    const rows = [
      { type: 'post', id: 'r', depth: 0 },
      { type: 'post', id: 'a', depth: 1 },
      { type: 'post', id: 'a1', depth: 2 },
      { type: 'more', id: 'a1', depth: 3 },
      { type: 'post', id: 'b', depth: 1 },
    ];
    expect(ids(nestRows(rows))).toEqual([
      ['r', [['a', [['a1', ['a1']]]], 'b']],
    ]);
  });

  it('keeps rows at the depth cap as siblings', () => {
    const rows = [
      { type: 'post', id: 'r', depth: 0 },
      { type: 'post', id: '1', depth: 1 },
      { type: 'post', id: '2', depth: 2 },
      { type: 'post', id: '3', depth: 3 },
      { type: 'post', id: '4', depth: 3 },
    ];
    expect(ids(nestRows(rows))).toEqual([['r', [['1', [['2', ['3', '4']]]]]]]);
  });
});
