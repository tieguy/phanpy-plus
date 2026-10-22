// The accounts a single-user deployment offers on the login page, from the
// build-time FLEETING_ACCOUNTS variable. When it is set, the login page
// shows one entry per account instead of free-text server and handle fields.
//
// Format: comma-separated `network:identifier` pairs, e.g.
//   mastodon:luis_in_brief@social.coop,bluesky:lu.is
//
// Pure module so it runs under vitest's node runner. Malformed entries are
// dropped rather than thrown: a typo in deploy config must not take the
// login page down.

export function parseFixedAccounts(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseEntry)
    .filter(Boolean);
}

function parseEntry(entry) {
  const sep = entry.indexOf(':');
  if (sep < 0) return null;
  const network = entry.slice(0, sep).trim().toLowerCase();
  const id = entry
    .slice(sep + 1)
    .trim()
    .replace(/^@/, '');
  if (!id) return null;

  if (network === 'mastodon') {
    const at = id.lastIndexOf('@');
    if (at <= 0 || at === id.length - 1) return null;
    const username = id.slice(0, at);
    const instance = id.slice(at + 1).toLowerCase();
    return { network, username, instance, label: `@${username}@${instance}` };
  }
  if (network === 'bluesky') {
    const handle = id.toLowerCase();
    return { network, handle, label: `@${handle}` };
  }
  return null;
}
