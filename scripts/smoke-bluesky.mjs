// Usage: start `npx vite --port 5173`, then `node scripts/smoke-bluesky.mjs`
// Optional env: CHROMIUM_PATH (browser binary), SCRATCH (screenshot dir)
//
// Smoke test: boot phanpy with a mocked Bluesky account and verify the
// home timeline, muted-word filtering, trending, lists, and login page.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const DID = 'did:plc:testuser0001';
const HANDLE = 'tester.bsky.social';
const CID = 'bafyreib2rxk3rw6l3dqe2xk5rbrekt2qx3ekvjmnp6mfk5m5tqrcdrn4dm';

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
    cid: CID,
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
      post: post(alice, 'aaa1', 'Hello from Bluesky! A fine test post', {
        createdAt: '2026-07-08T12:30:00.000Z',
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
      }),
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
      post: post(bob, 'ccc1', 'This mentions skipme and should be hidden', {
        createdAt: '2026-07-08T10:30:00.000Z',
      }),
    },
    {
      post: post(bob, 'ddd1', 'Plain old third post', {
        createdAt: '2026-07-08T10:00:00.000Z',
      }),
    },
  ],
  cursor: undefined,
};

const discoverFeed = {
  feed: [
    {
      post: post(alice, 'hot1', 'A trending hot post from Discover', {
        createdAt: '2026-07-08T12:00:00.000Z',
      }),
    },
  ],
};

const trends = {
  trends: [
    {
      topic: 'test-topic',
      displayName: 'Test Topic',
      link: '/topic/test-topic',
      startedAt: '2026-07-08T00:00:00.000Z',
      postCount: 1234,
      actors: [],
    },
  ],
};

const preferences = {
  preferences: [
    {
      $type: 'app.bsky.actor.defs#mutedWordsPref',
      items: [
        {
          id: 'mw1',
          value: 'skipme',
          targets: ['content', 'tag'],
          actorTarget: 'all',
        },
      ],
    },
  ],
};

const LIST_URI = `at://${DID}/app.bsky.graph.list/mylist1`;
const lists = {
  lists: [
    {
      uri: LIST_URI,
      cid: CID,
      creator: profile,
      name: 'Cool People',
      purpose: 'app.bsky.graph.defs#curatelist',
      listItemCount: 1,
      indexedAt: '2026-07-01T00:00:00.000Z',
    },
  ],
};

const account = {
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
    case 'app.bsky.actor.getPreferences':
      return json(preferences);
    case 'app.bsky.feed.getTimeline':
      return json(timeline);
    case 'app.bsky.feed.getFeed':
      return json(discoverFeed);
    case 'app.bsky.unspecced.getTrends':
      return json(trends);
    case 'app.bsky.graph.getLists':
      return json(lists);
    case 'app.bsky.graph.getList':
      return json({
        list: lists.lists[0],
        items: [
          { uri: `at://${DID}/app.bsky.graph.listitem/li1`, subject: alice },
        ],
      });
    case 'app.bsky.feed.getListFeed':
      return json({
        feed: [
          {
            post: post(alice, 'lp1', 'A post in the Cool People list', {
              createdAt: '2026-07-08T09:00:00.000Z',
            }),
          },
        ],
      });
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
await page.waitForTimeout(6000);

const checks = {};
let bodyText = await page.evaluate(() => document.body.innerText);
let html = await page.content();
checks['home shows alice post'] = bodyText.includes('Hello from Bluesky');
checks['home shows repost'] = bodyText.includes('A reposted post appears');
checks['home shows plain post'] = bodyText.includes('Plain old third post');
checks['muted word post hidden'] = !bodyText.includes('should be hidden');
checks['image attachment rendered'] = html.includes('cdn.example.com');
// Single-network install → no per-post network badges
checks['no network badges (single network)'] =
  (await page.$$eval('.network-badge', (els) => els.length)) === 0;
await page.screenshot({
  path: (process.env.SCRATCH || '.') + '/bsky-timeline.png',
});

// Trending
await page.goto(`${BASE}/#/bsky.social/trending`);
await page.waitForTimeout(4000);
bodyText = await page.evaluate(() => document.body.innerText);
checks['trending shows topic'] = bodyText.includes('Test Topic');
checks['trending shows discover post'] = bodyText.includes(
  'A trending hot post from Discover',
);
await page.screenshot({
  path: (process.env.SCRATCH || '.') + '/bsky-trending.png',
});

// Lists
await page.goto(`${BASE}/#/l`);
await page.waitForTimeout(3000);
bodyText = await page.evaluate(() => document.body.innerText);
checks['lists page shows list'] = bodyText.includes('Cool People');
// List timeline
const listID = `${DID}+app.bsky.graph.list+mylist1`;
await page.goto(`${BASE}/#/l/${listID}`);
await page.waitForTimeout(4000);
bodyText = await page.evaluate(() => document.body.innerText);
checks['list timeline shows post'] = bodyText.includes(
  'A post in the Cool People list',
);
await page.screenshot({
  path: (process.env.SCRATCH || '.') + '/bsky-list.png',
});

// Filters page (muted words)
await page.goto(`${BASE}/#/ft`);
await page.waitForTimeout(3000);
bodyText = await page.evaluate(() => document.body.innerText);
checks['filters page shows muted word'] = bodyText.includes('skipme');

// Login page — OAuth-first Bluesky login
await page.goto(`${BASE}/#/login`);
await page.waitForTimeout(1500);
await page.click('#bluesky-login button');
await page.waitForTimeout(500);
bodyText = await page.evaluate(() => document.body.innerText);
checks['login shows OAuth button'] = bodyText.includes('Continue with Bluesky');
checks['login shows app password fallback'] = bodyText.includes(
  'Use an app password instead',
);
await page.screenshot({
  path: (process.env.SCRATCH || '.') + '/bsky-login.png',
});

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  console.log(ok ? '✅' : '❌', name);
  if (!ok) failed++;
}
if (failed) {
  console.log('\n--- last body text ---\n', bodyText.slice(0, 2000));
}
console.log('\nPage errors:', consoleErrors.slice(0, 10));

await browser.close();
process.exit(failed ? 1 : 0);
