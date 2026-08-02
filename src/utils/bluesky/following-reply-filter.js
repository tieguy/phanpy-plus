// Which replies belong in the Following feed — a faithful port of the
// official app's FeedTuner logic (social-app src/lib/api/feed-manip.ts:
// getAuthors / areSameAuthor / shouldDisplayReplyInFollowing).
//
// The official rule: a reply shows in Following only when its author is
// you or someone you follow, AND either the whole chain is one author (a
// true self-thread) or at least one *other* participant (parent,
// grandparent or root author) is you or someone you follow. This is what
// keeps arguments between people you follow and strangers from spilling
// into your timeline — a chain of self-replies deep in a stranger's
// thread is NOT a self-thread, because the root author differs.

const POST_VIEW_TYPE = 'app.bsky.feed.defs#postView';

// Union members carry $type on the wire; tolerate a missing $type as long
// as it looks like a hydrated post (notFound/blocked views have neither)
function isPostView(v) {
  return (
    !!v &&
    (v.$type === POST_VIEW_TYPE || (!v.$type && !!v.author && !!v.record))
  );
}

// Every thread participant visible on a feed item (a FeedViewPost from
// app.bsky.feed.getTimeline). Missing/blocked parents yield undefined.
export function getFeedItemAuthors(item) {
  const author = item?.post?.author;
  let parentAuthor;
  let grandparentAuthor;
  let rootAuthor;
  const reply = item?.reply;
  if (reply) {
    if (isPostView(reply.parent)) parentAuthor = reply.parent.author;
    if (reply.grandparentAuthor) grandparentAuthor = reply.grandparentAuthor;
    if (isPostView(reply.root)) rootAuthor = reply.root.author;
  }
  return { author, parentAuthor, grandparentAuthor, rootAuthor };
}

// A true self-thread: parent, grandparent AND root (where known) are all
// the reply's own author
export function areSameAuthor({
  author,
  parentAuthor,
  grandparentAuthor,
  rootAuthor,
}) {
  const authorDid = author?.did;
  if (parentAuthor && parentAuthor.did !== authorDid) return false;
  if (grandparentAuthor && grandparentAuthor.did !== authorDid) return false;
  if (rootAuthor && rootAuthor.did !== authorDid) return false;
  return true;
}

function isSelfOrFollowing(profile, userDid) {
  return Boolean(profile?.did === userDid || profile?.viewer?.following);
}

export function shouldDisplayReplyInFollowing(item, userDid) {
  const authors = getFeedItemAuthors(item);
  const { author, parentAuthor, grandparentAuthor, rootAuthor } = authors;
  if (!isSelfOrFollowing(author, userDid)) {
    // Only show replies from self or people you follow
    return false;
  }
  if (areSameAuthor(authors)) {
    // Always show self-threads
    return true;
  }
  // From this point on we need at least one more reason to show it
  if (
    parentAuthor &&
    parentAuthor.did !== author.did &&
    isSelfOrFollowing(parentAuthor, userDid)
  ) {
    return true;
  }
  if (
    grandparentAuthor &&
    grandparentAuthor.did !== author.did &&
    isSelfOrFollowing(grandparentAuthor, userDid)
  ) {
    return true;
  }
  if (
    rootAuthor &&
    rootAuthor.did !== author.did &&
    isSelfOrFollowing(rootAuthor, userDid)
  ) {
    return true;
  }
  return false;
}
