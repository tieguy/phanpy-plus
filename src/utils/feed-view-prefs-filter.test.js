import { describe, expect, it } from 'vitest';

import { filterStatusesByFeedViewPrefs } from './feed-view-prefs-filter';

function post(props = {}) {
  return {
    id: 'p1',
    account: { id: 'author' },
    favouritesCount: 0,
    ...props,
  };
}

const boost = () => post({ reblog: post({ id: 'boosted' }) });
const quote = () => post({ quote: { id: 'quoted' } });
const reply = (props = {}) =>
  post({ inReplyToId: 'x', inReplyToAccountId: 'someone-else', ...props });
const selfThread = () =>
  post({ inReplyToId: 'x', inReplyToAccountId: 'author' });

describe('filterStatusesByFeedViewPrefs', () => {
  it('is a no-op with empty prefs', () => {
    const items = [post(), boost(), quote(), reply()];
    expect(filterStatusesByFeedViewPrefs(items, {})).toEqual(items);
    expect(filterStatusesByFeedViewPrefs(items, null)).toEqual(items);
  });

  it('hideReposts drops boosts but keeps quote posts', () => {
    const q = quote();
    const filtered = filterStatusesByFeedViewPrefs([post(), boost(), q], {
      hideReposts: true,
    });
    expect(filtered).toHaveLength(2);
    expect(filtered).toContain(q);
  });

  it('hideQuotePosts drops quote posts and boosted quotes', () => {
    const boostedQuote = post({ reblog: post({ quote: { id: 'q' } }) });
    const filtered = filterStatusesByFeedViewPrefs(
      [post(), quote(), boostedQuote],
      { hideQuotePosts: true },
    );
    expect(filtered).toHaveLength(1);
  });

  it('hideReplies drops replies but keeps self-threads', () => {
    const st = selfThread();
    const filtered = filterStatusesByFeedViewPrefs([reply(), st, post()], {
      hideReplies: true,
    });
    expect(filtered).toHaveLength(2);
    expect(filtered).toContain(st);
  });

  it('hideRepliesByLikeCount hides low-engagement replies only', () => {
    const popular = reply({ favouritesCount: 5 });
    const unpopular = reply({ favouritesCount: 1 });
    const plain = post({ favouritesCount: 0 });
    const filtered = filterStatusesByFeedViewPrefs(
      [popular, unpopular, plain],
      { hideRepliesByLikeCount: 2 },
    );
    expect(filtered).toEqual([popular, plain]);
  });

  it('boosted replies count as boosts, not replies', () => {
    const boostedReply = post({
      reblog: reply(),
    });
    expect(
      filterStatusesByFeedViewPrefs([boostedReply], { hideReplies: true }),
    ).toHaveLength(1);
    expect(
      filterStatusesByFeedViewPrefs([boostedReply], { hideReposts: true }),
    ).toHaveLength(0);
  });
});
