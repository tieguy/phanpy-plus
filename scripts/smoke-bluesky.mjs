// Usage: start `npx vite --port 5173`, then `node scripts/smoke-bluesky.mjs`
// Optional env: CHROMIUM_PATH (browser binary), SCRATCH (screenshot dir)
// Smoke test: boot phanpy with a mocked Bluesky account and verify the
// home timeline renders converted Bluesky posts.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const DID = 'did:plc:testuser0001';
const HANDLE = 'tester.bsky.social';

const profile = {
  did: DID,
  handle: HANDLE,
  displayName: 'Test User',
  description: 'Just testing',
  avatar: 'https://cdn.example.com/avatar.jpg',
  followersCount: 10,
  followsCount: 20,
  postsCount: 30,
  indexedAt: '2026-07-01T00:00:00.000Z',
  viewer: {},
};

const alice = {
  did: 'did:plc:alice0001',
  handle: 'alice.bsky.social',
  displayName: 'Alice ✨',
  avatar: 'https://cdn.example.com/avatar.jpg',
  viewer: {},
};
const bob = {
  did: 'did:plc:bob0001',
  handle: 'bob.example.com',
  displayName: 'Bob',
  avatar: 'https://cdn.example.com/avatar.jpg',
  viewer: {},
};

function post(author, rkey, text, extra = {}) {
  return {
    uri: `at://${author.did}/app.bsky.feed.post/${rkey}`,
    cid: 'bafyreib2rxk3rw6l3dqe2xk5rbrekt2qx3ekvjmnp6mfk5m5tqrcdrn4dm',
    author,
    record: {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: extra.createdAt || '2026-07-08T12:00:00.000Z',
      facets: extra.facets,
      reply: extra.reply,
      langs: ['en'],
    },
    embed: extra.embed,
    replyCount: 1,
    repostCount: 2,
    likeCount: 3,
    quoteCount: 0,
    indexedAt: extra.createdAt || '2026-07-08T12:00:00.000Z',
    viewer: {},
    labels: [],
  };
}

const timeline = {
  feed: [
    {
      post: post(
        alice,
        'aaa1',
        'Hello from Bluesky! This is a test post with a #hashtag and a link https://example.com',
        {
          createdAt: '2026-07-08T12:30:00.000Z',
          facets: [
            {
              index: { byteStart: 51, byteEnd: 59 },
              features: [
                { $type: 'app.bsky.richtext.facet#tag', tag: 'hashtag' },
              ],
            },
          ],
          embed: {
            $type: 'app.bsky.embed.images#view',
            images: [
              {
                thumb: 'https://cdn.example.com/thumb.jpg',
                fullsize: 'https://cdn.example.com/full.jpg',
                alt: 'A test image',
                aspectRatio: { width: 800, height: 600 },
              },
            ],
          },
        },
      ),
    },
    {
      post: post(bob, 'bbb1', 'A reposted post appears', {
        createdAt: '2026-07-08T11:00:00.000Z',
      }),
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost',
        by: alice,
        indexedAt: '2026-07-08T12:15:00.000Z',
      },
    },
    {
      post: post(bob, 'ccc1', 'Plain old third post', {
        createdAt: '2026-07-08T10:00:00.000Z',
      }),
    },
  ],
  cursor: undefined,
};

const account = {
  info: {
    id: DID,
    username: HANDLE,
    acct: HANDLE,
    displayName: 'Test User',
    avatar: 'https://cdn.example.com/avatar.jpg',
    avatarStatic: '',
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
};

const instanceInfo = {
  domain: 'bsky.social',
  title: 'Bluesky',
  version: '0.0.1',
  configuration: {
    statuses: { maxCharacters: 300, maxMediaAttachments: 4 },
    mediaAttachments: { supportedMimeTypes: ['image/jpeg', 'image/png'] },
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
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err}`));

// Mock all XRPC calls
await page.route('**/xrpc/**', async (route) => {
  const url = new URL(route.request().url());
  const nsid = url.pathname.split('/xrpc/')[1];
  const json = (data) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  console.log('XRPC', nsid);
  switch (nsid) {
    case 'com.atproto.server.getSession':
      return json({ did: DID, handle: HANDLE, active: true });
    case 'com.atproto.server.refreshSession':
      return json({
        did: DID,
        handle: HANDLE,
        accessJwt: 'fake-access-jwt2',
        refreshJwt: 'fake-refresh-jwt2',
        active: true,
      });
    case 'app.bsky.actor.getProfile':
      return json(profile);
    case 'app.bsky.actor.getProfiles':
      return json({ profiles: [profile] });
    case 'app.bsky.feed.getTimeline':
      return json(timeline);
    case 'app.bsky.notification.listNotifications':
      return json({ notifications: [], cursor: undefined });
    case 'app.bsky.feed.getPosts':
      return json({ posts: [] });
    default:
      return json({});
  }
});

await page.goto(`${BASE}/`);
await page.evaluate(
  ([account, instanceInfo]) => {
    localStorage.setItem('accounts', JSON.stringify([account]));
    localStorage.setItem(
      'instances',
      JSON.stringify({ 'bsky.social': instanceInfo }),
    );
    localStorage.setItem(
      'nodeInfos',
      JSON.stringify({
        'bsky.social': { software: { name: 'bluesky', version: '1.0.0' } },
      }),
    );
    sessionStorage.setItem('currentAccount', account.info.id);
  },
  [account, instanceInfo],
);
await page.reload();
await page.waitForTimeout(1000);
await page.goto(`${BASE}/#/`);
await page.waitForTimeout(8000);

const bodyText = await page.evaluate(() => document.body.innerText);
const html = await page.content();

const checks = {
  'timeline shows alice post': bodyText.includes('Hello from Bluesky'),
  'timeline shows repost': bodyText.includes('A reposted post appears'),
  'timeline shows third post': bodyText.includes('Plain old third post'),
  'shows author name': bodyText.includes('Alice'),
  'hashtag link rendered': html.includes('hashtag'),
  'image attachment rendered': html.includes('cdn.example.com'),
};

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  console.log(ok ? '✅' : '❌', name);
  if (!ok) failed++;
}
if (failed) {
  console.log('\n--- body text ---\n', bodyText.slice(0, 3000));
}
console.log('\nConsole errors:', consoleErrors.slice(0, 20));

await page.screenshot({ path: (process.env.SCRATCH || '.') + '/bsky-timeline.png', fullPage: false });
await browser.close();
process.exit(failed ? 1 : 0);
