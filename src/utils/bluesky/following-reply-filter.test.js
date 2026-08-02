import { describe, expect, it } from 'vitest';

import {
  areSameAuthor,
  getFeedItemAuthors,
  shouldDisplayReplyInFollowing,
} from './following-reply-filter';

const ME = 'did:plc:me';

function profile(did, { following = false } = {}) {
  return {
    did,
    handle: `${did.split(':').pop()}.bsky.social`,
    viewer: following ? { following: `at://${ME}/follow/x` } : {},
  };
}

const POST_VIEW = 'app.bsky.feed.defs#postView';

function postView(author) {
  return {
    $type: POST_VIEW,
    uri: `at://${author.did}/app.bsky.feed.post/abc`,
    author,
    record: { text: 'hi', createdAt: '2024-01-01T00:00:00.000Z' },
  };
}

// A FeedViewPost as returned by getTimeline: a reply by `author` with the
// given parent/root (post views) and optional grandparentAuthor profile
function replyItem({ author, parent, root, grandparentAuthor }) {
  return {
    post: postView(author),
    reply: {
      parent: parent && postView(parent),
      root: root && postView(root),
      grandparentAuthor,
    },
  };
}

const followed = profile('did:plc:followed', { following: true });
const followed2 = profile('did:plc:followed2', { following: true });
const stranger = profile('did:plc:stranger');
const stranger2 = profile('did:plc:stranger2');

describe('shouldDisplayReplyInFollowing', () => {
  it('hides a reply by someone you do not follow', () => {
    expect(
      shouldDisplayReplyInFollowing(
        replyItem({ author: stranger, parent: followed, root: followed }),
        ME,
      ),
    ).toBe(false);
  });

  it('shows a reply to someone you follow', () => {
    expect(
      shouldDisplayReplyInFollowing(
        replyItem({ author: followed, parent: followed2, root: stranger }),
        ME,
      ),
    ).toBe(true);
  });

  it('shows a reply to yourself', () => {
    const me = profile(ME);
    expect(
      shouldDisplayReplyInFollowing(
        replyItem({ author: followed, parent: me, root: stranger }),
        ME,
      ),
    ).toBe(true);
  });

  it('hides a reply to a stranger in a stranger-rooted thread', () => {
    expect(
      shouldDisplayReplyInFollowing(
        replyItem({ author: followed, parent: stranger, root: stranger2 }),
        ME,
      ),
    ).toBe(false);
  });

  it('shows a whole self-thread', () => {
    expect(
      shouldDisplayReplyInFollowing(
        replyItem({ author: followed, parent: followed, root: followed }),
        ME,
      ),
    ).toBe(true);
  });

  // The "ongoing argument" leak: a followed person chains self-replies
  // deep inside a stranger's thread. Parent is themselves, but the root
  // is a stranger — the official app hides this
  it('hides a self-reply chain rooted in a stranger thread', () => {
    expect(
      shouldDisplayReplyInFollowing(
        replyItem({ author: followed, parent: followed, root: stranger }),
        ME,
      ),
    ).toBe(false);
  });

  it('shows a reply to a stranger when the thread root is followed', () => {
    expect(
      shouldDisplayReplyInFollowing(
        replyItem({ author: followed, parent: stranger, root: followed2 }),
        ME,
      ),
    ).toBe(true);
  });

  it('shows a reply to a stranger when the grandparent is followed', () => {
    const item = replyItem({
      author: followed,
      parent: stranger,
      root: stranger2,
      grandparentAuthor: followed2,
    });
    expect(shouldDisplayReplyInFollowing(item, ME)).toBe(true);
  });

  it('hides a reply whose parent is missing in a stranger thread', () => {
    // Deleted/blocked parent: notFoundPost has no author
    const item = {
      post: postView(followed),
      reply: {
        parent: {
          $type: 'app.bsky.feed.defs#notFoundPost',
          uri: 'at://x/app.bsky.feed.post/gone',
          notFound: true,
        },
        root: postView(stranger),
      },
    };
    expect(shouldDisplayReplyInFollowing(item, ME)).toBe(false);
  });
});

describe('areSameAuthor / getFeedItemAuthors', () => {
  it('treats parent-only self-reply in a stranger thread as NOT a self-thread', () => {
    const authors = getFeedItemAuthors(
      replyItem({ author: followed, parent: followed, root: stranger }),
    );
    expect(areSameAuthor(authors)).toBe(false);
  });

  it('treats a full one-author chain as a self-thread', () => {
    const authors = getFeedItemAuthors(
      replyItem({ author: followed, parent: followed, root: followed }),
    );
    expect(areSameAuthor(authors)).toBe(true);
  });

  it('ignores unhydrated (notFound/blocked) parent and root views', () => {
    const authors = getFeedItemAuthors({
      post: postView(followed),
      reply: {
        parent: { $type: 'app.bsky.feed.defs#blockedPost', blocked: true },
        root: { $type: 'app.bsky.feed.defs#notFoundPost', notFound: true },
      },
    });
    expect(authors.parentAuthor).toBeUndefined();
    expect(authors.rootAuthor).toBeUndefined();
  });

  it('accepts post views missing $type when they look hydrated', () => {
    const parent = postView(followed2);
    delete parent.$type;
    const authors = getFeedItemAuthors({
      post: postView(followed),
      reply: { parent, root: postView(stranger) },
    });
    expect(authors.parentAuthor?.did).toBe(followed2.did);
  });
});
