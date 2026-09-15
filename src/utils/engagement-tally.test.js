import { describe, expect, it } from 'vitest';

import { tallyEngagement, walkUntilCutoff } from './engagement-tally';

const cutoff = Date.parse('2026-09-14T12:00:00.000Z');
const inside = '2026-09-15T08:00:00.000Z';
const outside = '2026-09-14T11:00:00.000Z';

function post(id, createdAt = '2026-09-10T00:00:00.000Z') {
  return { id, createdAt, favouritesCount: 10, reblogsCount: 2 };
}

function notif(type, status, createdAt = inside) {
  return { id: `${type}-${Math.random()}`, type, createdAt, status };
}

describe('tallyEngagement', () => {
  it('counts likes and boosts inside the window per network and per post', () => {
    const a = post('a');
    const { networks, rows } = tallyEngagement(
      [
        {
          instance: 'mastodon.social',
          notifications: [
            notif('favourite', a),
            notif('favourite', a),
            notif('reblog', a),
          ],
          capped: false,
        },
      ],
      { cutoff },
    );
    expect(networks).toEqual([
      { instance: 'mastodon.social', likes: 2, boosts: 1, capped: false },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'mastodon.social/a',
      windowLikes: 2,
      windowBoosts: 1,
    });
    expect(rows[0].status).toBe(a);
  });

  it('ignores items outside the window and other notification types', () => {
    const a = post('a');
    const { networks, rows } = tallyEngagement(
      [
        {
          instance: 'x',
          notifications: [
            notif('favourite', a, outside),
            notif('mention', a),
            notif('follow', null),
          ],
        },
      ],
      { cutoff },
    );
    expect(networks[0]).toMatchObject({ likes: 0, boosts: 0 });
    expect(rows).toEqual([]);
  });

  it('keeps the same status id on two sources separate', () => {
    const { rows } = tallyEngagement(
      [
        { instance: 'one', notifications: [notif('favourite', post('1'))] },
        { instance: 'two', notifications: [notif('favourite', post('1'))] },
      ],
      { cutoff },
    );
    expect(rows.map((r) => r.key).sort()).toEqual(['one/1', 'two/1']);
  });

  it('resolves a reblog wrapper to the inner post', () => {
    const inner = post('inner');
    const wrapper = { id: 'wrapper', reblog: inner, favouritesCount: 0 };
    const { rows } = tallyEngagement(
      [{ instance: 'x', notifications: [notif('reblog', wrapper)] }],
      { cutoff },
    );
    expect(rows[0].key).toBe('x/inner');
    expect(rows[0].status).toBe(inner);
  });

  it('counts a notification with no status in the total but gives it no row', () => {
    const { networks, rows } = tallyEngagement(
      [{ instance: 'bsky.social', notifications: [notif('favourite', null)] }],
      { cutoff },
    );
    expect(networks[0].likes).toBe(1);
    expect(rows).toEqual([]);
  });

  it('passes capped through per network', () => {
    const { networks } = tallyEngagement(
      [
        { instance: 'one', notifications: [], capped: true },
        { instance: 'two', notifications: [], capped: false },
      ],
      { cutoff },
    );
    expect(networks.map((n) => n.capped)).toEqual([true, false]);
  });

  it('sorts by window tally, then by post recency', () => {
    const older = post('older', '2026-09-01T00:00:00.000Z');
    const newer = post('newer', '2026-09-12T00:00:00.000Z');
    const top = post('top', '2026-08-01T00:00:00.000Z');
    const { rows } = tallyEngagement(
      [
        {
          instance: 'x',
          notifications: [
            notif('favourite', older),
            notif('favourite', newer),
            notif('favourite', top),
            notif('reblog', top),
          ],
        },
      ],
      { cutoff },
    );
    expect(rows.map((r) => r.status.id)).toEqual(['top', 'newer', 'older']);
  });
});

function iteratorOf(pages) {
  let i = 0;
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async next() {
      calls++;
      if (i >= pages.length) return { done: true, value: undefined };
      return { done: false, value: pages[i++] };
    },
  };
}

describe('walkUntilCutoff', () => {
  it('stops at the first page that reaches past the cutoff', async () => {
    const it = iteratorOf([
      [notif('favourite', post('a'))],
      [notif('favourite', post('b')), notif('favourite', post('c'), outside)],
      [notif('favourite', post('d'))],
    ]);
    const result = await walkUntilCutoff(it, { cutoff, pageCap: 5 });
    expect(result.capped).toBe(false);
    expect(result.notifications).toHaveLength(3);
    expect(it.calls).toBe(2);
  });

  it('keeps walking past empty pages', async () => {
    const it = iteratorOf([[], [], [notif('favourite', post('a'), outside)]]);
    const result = await walkUntilCutoff(it, { cutoff, pageCap: 5 });
    expect(result.capped).toBe(false);
    expect(result.notifications).toHaveLength(1);
  });

  it('is not capped when the iterator ends first', async () => {
    const it = iteratorOf([[notif('favourite', post('a'))]]);
    const result = await walkUntilCutoff(it, { cutoff, pageCap: 5 });
    expect(result.capped).toBe(false);
  });

  it('reports capped when the page cap is hit inside the window', async () => {
    const it = iteratorOf([
      [notif('favourite', post('a'))],
      [notif('favourite', post('b'))],
      [notif('favourite', post('c'))],
    ]);
    const result = await walkUntilCutoff(it, { cutoff, pageCap: 2 });
    expect(result.capped).toBe(true);
    expect(result.notifications).toHaveLength(2);
    expect(it.calls).toBe(2);
  });
});
