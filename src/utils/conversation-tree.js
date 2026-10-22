// Conversation mode: turns a thread's statuses into the rows the thread view
// renders, nested by `inReplyToId`.

export const MAX_DEPTH = 3;
// A side branch with more replies under its first post than this shows only
// that first post and a "more replies" row until the user opens it.
export const BRANCH_LIMIT = 2;

// Bluesky accounts carry the viewer's relationship in `_viewer`. Mastodon
// servers already leave muted and blocked accounts out of notifications and
// thread context, so their accounts have no `_viewer` and always pass.
export function isHiddenAuthor(account) {
  const viewer = account?._viewer;
  return !!(viewer?.muted || viewer?.blocking || viewer?.blockedBy);
}

function timeOf(status) {
  const time = Date.parse(status?.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

// statuses: every post of the thread, in any order. rootId: the post with no
// parent. focusedId: the post the user came to see; the branch that holds it
// never collapses. expanded: ids of branches the user opened.
//
// Returns [{ type: 'post', id, depth }] and [{ type: 'more', id, count,
// depth }] rows in reading order. `depth` stops at MAX_DEPTH, so deeper
// replies line up with their parent. A post whose parent is missing from
// `statuses` shows as a reply to the root. A post by a muted or blocked
// author is left out, with every reply under it, unless it is the root or
// leads to the focused post.
export function threadRows(statuses, { rootId, focusedId, expanded }) {
  const byId = new Map();
  for (const status of statuses) {
    if (status?.id && !byId.has(status.id)) byId.set(status.id, status);
  }
  const root = byId.get(rootId);
  if (!root) return [];

  const children = new Map();
  for (const status of byId.values()) {
    if (status.id === rootId) continue;
    const parentId = byId.has(status.inReplyToId) ? status.inReplyToId : rootId;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(status);
  }
  for (const list of children.values()) {
    list.sort((a, b) => timeOf(a) - timeOf(b));
  }

  // Posts that lead to the focused post, which stay open.
  const focusPath = new Set();
  for (
    let current = byId.get(focusedId), seen = 0;
    current && seen <= byId.size;
    current = byId.get(current.inReplyToId), seen++
  ) {
    focusPath.add(current.id);
  }

  // The root and the line to the focused post always show, so a muted author
  // there cannot hide the post the user came to see.
  const visible = (status) =>
    status.id === rootId ||
    focusPath.has(status.id) ||
    !isHiddenAuthor(status.account);
  const countUnder = (id, seen = new Set()) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let count = 0;
    for (const child of children.get(id) || []) {
      if (!visible(child)) continue;
      count += 1 + countUnder(child.id, seen);
    }
    return count;
  };

  const rows = [];
  const placed = new Set();
  const walk = (status, depth, collapsible) => {
    if (placed.has(status.id) || !visible(status)) return;
    placed.add(status.id);
    rows.push({
      type: 'post',
      id: status.id,
      depth: Math.min(depth, MAX_DEPTH),
    });
    const under = children.get(status.id) || [];
    if (collapsible && !focusPath.has(status.id) && !expanded?.has(status.id)) {
      const count = countUnder(status.id);
      if (count > BRANCH_LIMIT) {
        rows.push({
          type: 'more',
          id: status.id,
          count,
          depth: Math.min(depth + 1, MAX_DEPTH),
        });
        return;
      }
    }
    for (const child of under) walk(child, depth + 1, true);
  };
  walk(root, 0, false);
  return rows;
}

// Nests threadRows output for rendering as lists inside lists: each row takes
// the rows after it with a greater depth as its children. Rows at MAX_DEPTH
// stay siblings, because their depth stops growing.
export function nestRows(rows) {
  const top = [];
  const stack = [{ depth: -1, children: top }];
  for (const row of rows) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= row.depth) {
      stack.pop();
    }
    const node = { ...row, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return top;
}
