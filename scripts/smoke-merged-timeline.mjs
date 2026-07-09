// Usage: start `npx vite --port 5173`, then `node scripts/smoke-merged-timeline.mjs`
// Optional env: CHROMIUM_PATH (browser binary), SCRATCH (screenshot dir)
// Smoke test: merged home timeline with a Mastodon account (current) +
// a Bluesky account, both mocked.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const DID = 'did:plc:testuser0001';
const HANDLE = 'tester.bsky.social';
const CID = 'bafyreib2rxk3rw6l3dqe2xk5rbrekt2qx3ekvjmnp6mfk5m5tqrcdrn4dm';

const alice = {
  did: 'did:plc:alice0001',
  handle: 'alice.bsky.social',
  displayName: 'Alice',
  avatar: 'https://cdn.example.com/avatar.jpg',
  viewer: {},
};

function bskyPost(author, rkey, text, createdAt) {
  return {
    uri: `at://${author.did}/app.bsky.feed.post/${rkey}`,
    cid: CID,
    author,
    record: { $type: 'app.bsky.feed.post', text, createdAt, langs: ['en'] },
    replyCount: 0,
    repostCount: 0,
    likeCount: 5,
    quoteCount: 0,
    indexedAt: createdAt,
    viewer: {},
    labels: [],
  };
}

const bskyTimeline = {
  feed: [
    { post: bskyPost(alice, 'aaa1', 'Bluesky post NEWEST', '2026-07-08T12:30:00.000Z') },
    { post: bskyPost(alice, 'aaa2', 'Bluesky post MIDDLE', '2026-07-08T11:00:00.000Z') },
    { post: bskyPost(alice, 'aaa3', 'Bluesky post OLDEST', '2026-07-08T09:00:00.000Z') },
  ],
};

function mastoStatus(id, content, created_at) {
  return {
    id,
    created_at,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    sensitive: false,
    spoiler_text: '',
    visibility: 'public',
    language: 'en',
    uri: `https://mastodon.example/users/mario/statuses/${id}`,
    url: `https://mastodon.example/@mario/${id}`,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 2,
    favourited: false,
    reblogged: false,
    muted: false,
    bookmarked: false,
    content: `<p>${content}</p>`,
    filtered: [],
    reblog: null,
    account: {
      id: '999',
      username: 'mario',
      acct: 'mario',
      display_name: 'Mario M.',
      locked: false,
      bot: false,
      url: 'https://mastodon.example/@mario',
      avatar: 'https://cdn.example.com/avatar2.jpg',
      avatar_static: 'https://cdn.example.com/avatar2.jpg',
      emojis: [],
    },
    media_attachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    card: null,
    poll: null,
  };
}

const mastoTimeline = [
  mastoStatus('111', 'Mastodon post UPPER', '2026-07-08T12:00:00.000Z'),
  mastoStatus('112', 'Mastodon post LOWER', '2026-07-08T10:00:00.000Z'),
];

const accounts = [
  {
    info: {
      id: '999',
      username: 'mario',
      acct: 'mario',
      displayName: 'Mario M.',
      avatar: 'https://cdn.example.com/avatar2.jpg',
      avatarStatic: 'https://cdn.example.com/avatar2.jpg',
      url: 'https://mastodon.example/@mario',
    },
    instanceURL: 'mastodon.example',
    accessToken: 'fake-masto-token',
    vapidKey: null,
    createdAt: Date.now(),
  },
  {
    info: {
      id: DID,
      username: HANDLE,
      acct: HANDLE,
      displayName: 'Test User',
      avatar: 'https://cdn.example.com/avatar.jpg',
      avatarStatic: 'https://cdn.example.com/avatar.jpg',
      url: `https://bsky.app/profile/${DID}`,
      _bluesky: true,
    },
    instanceURL: 'bsky.social',
    accessToken: 'fake-access-jwt',
    accountType: 'bluesky',
    blueskyService: 'https://bsky.social',
    blueskySession: {
      did: DID,
      handle: HANDLE,
      accessJwt: 'fake-access-jwt',
      refreshJwt: 'fake-refresh-jwt',
      active: true,
    },
    createdAt: Date.now(),
  },
];

const mastoInstanceInfo = {
  domain: 'mastodon.example',
  title: 'Mastodon Example',
  version: '4.3.0',
  source_url: 'https://github.com/mastodon/mastodon',
  configuration: {
    statuses: { max_characters: 500, max_media_attachments: 4 },
    media_attachments: { supported_mime_types: ['image/jpeg'] },
    polls: { max_options: 4 },
  },
};

const bskyInstanceInfo = {
  domain: 'bsky.social',
  title: 'Bluesky',
  version: '0.0.1',
  configuration: {
    statuses: { maxCharacters: 300, maxMediaAttachments: 4 },
    polls: { maxOptions: 0 },
  },
  _bluesky: true,
};

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err}`));

await page.route('**/xrpc/**', async (route) => {
  const nsid = new URL(route.request().url()).pathname.split('/xrpc/')[1];
  const json = (data) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  switch (nsid) {
    case 'com.atproto.server.getSession':
      return json({ did: DID, handle: HANDLE, active: true });
    case 'com.atproto.server.refreshSession':
      return json({ did: DID, handle: HANDLE, accessJwt: 'a2', refreshJwt: 'r2', active: true });
    case 'app.bsky.feed.getTimeline':
      return json(bskyTimeline);
    case 'app.bsky.notification.listNotifications':
      return json({ notifications: [] });
    case 'app.bsky.feed.getPosts':
      return json({ posts: [] });
    default:
      return json({});
  }
});

await page.route('**/mastodon.example/**', async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const json = (data) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  if (path === '/api/v1/timelines/home') return json(mastoTimeline);
  if (path === '/api/v2/instance') return json(mastoInstanceInfo);
  if (path === '/api/v1/preferences') return json({});
  if (path === '/api/v1/markers') return json({});
  if (path === '/api/v1/custom_emojis') return json([]);
  if (path === '/api/v1/announcements') return json([]);
  if (path === '/api/v1/followed_tags') return json([]);
  if (path === '/api/v1/notifications') return json([]);
  if (path === '/api/v1/statuses') return json([]);
  if (path === '/.well-known/nodeinfo') return json({ links: [] });
  return json([]);
});

await page.goto(`${BASE}/`);
await page.evaluate(
  ([accounts, mastoInstanceInfo, bskyInstanceInfo]) => {
    localStorage.setItem('accounts', JSON.stringify(accounts));
    localStorage.setItem(
      'instances',
      JSON.stringify({
        'mastodon.example': mastoInstanceInfo,
        'bsky.social': bskyInstanceInfo,
      }),
    );
    localStorage.setItem(
      'nodeInfos',
      JSON.stringify({
        'mastodon.example': { software: { name: 'mastodon', version: '4.3.0' } },
        'bsky.social': { software: { name: 'bluesky', version: '1.0.0' } },
      }),
    );
    sessionStorage.setItem('currentAccount', '999');
  },
  [accounts, mastoInstanceInfo, bskyInstanceInfo],
);
await page.reload();
await page.waitForTimeout(9000);

const bodyText = await page.evaluate(() => document.body.innerText);

const posts = [
  'Bluesky post NEWEST',
  'Mastodon post UPPER',
  'Bluesky post MIDDLE',
  'Mastodon post LOWER',
  'Bluesky post OLDEST',
];
const positions = posts.map((p) => bodyText.indexOf(p));
const checks = {
  'all posts present': positions.every((p) => p >= 0),
  'chronologically merged': positions.every(
    (p, i) => i === 0 || p > positions[i - 1],
  ),
};
let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  console.log(ok ? '✅' : '❌', name, JSON.stringify(positions));
  if (!ok) failed++;
}
if (failed) console.log('\n--- body ---\n', bodyText.slice(0, 2500));

// Open compose and check cross-post toggle
try {
  await page.click('#compose-button');
  await page.waitForTimeout(2500);
  const composeText = await page.evaluate(() => document.body.innerText);
  const hasCrossPost = composeText.includes('Also post to');
  console.log(hasCrossPost ? '✅' : '❌', 'compose shows cross-post toggle');
  if (!hasCrossPost) failed++;
  await page.screenshot({ path: (process.env.SCRATCH || '.') + '/compose.png' });
} catch (e) {
  console.log('❌ compose open failed', e.message);
  failed++;
}
await page.screenshot({ path: (process.env.SCRATCH || '.') + '/merged-timeline.png' });
console.log('Page errors:', consoleErrors.slice(0, 10));
await browser.close();
process.exit(failed ? 1 : 0);
