// @ts-check
import { expect, test } from '@playwright/test';

// Regression tests for cross-account interactions: posts from an instance
// the user has a logged-in account on must be interactable, with replies
// routed through that account's client — not the current account's.
// (These bugs shipped in sequence: the "another server" banner blocked
// interactions, then replies went through the wrong client.)

const AVATAR =
  'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

const ACCOUNT_A = {
  info: {
    id: 'a1',
    username: 'alice',
    acct: 'alice@instance-a.test',
    displayName: 'Alice',
    avatar: AVATAR,
    avatarStatic: AVATAR,
  },
  instanceURL: 'instance-a.test',
  accessToken: 'token-a',
};

const ACCOUNT_B = {
  info: {
    id: 'b1',
    username: 'bob',
    acct: 'bob@instance-b.test',
    displayName: 'Bob',
    avatar: AVATAR,
    avatarStatic: AVATAR,
  },
  instanceURL: 'instance-b.test',
  accessToken: 'token-b',
};

const BSKY_DID = 'did:plc:testcarol';

// @atproto/api decodes JWTs locally to check expiry, so fake tokens must
// be structurally valid with a far-future exp
function fakeJwt(scope) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    scope,
    sub: BSKY_DID,
    exp: 4102444800,
    iat: 1,
  })}.x`;
}
const BSKY_ACCESS_JWT = fakeJwt('com.atproto.access');
const BSKY_REFRESH_JWT = fakeJwt('com.atproto.refresh');
// A structurally valid CID — the lexicon validates the format
const CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a';
const ACCOUNT_BSKY = {
  info: {
    id: BSKY_DID,
    username: 'carol.bsky.social',
    acct: 'carol.bsky.social',
    displayName: 'Carol',
    avatar: AVATAR,
    avatarStatic: AVATAR,
  },
  instanceURL: 'bsky.social',
  accountType: 'bluesky',
  accessToken: BSKY_ACCESS_JWT,
  blueskySession: {
    did: BSKY_DID,
    handle: 'carol.bsky.social',
    accessJwt: BSKY_ACCESS_JWT,
    refreshJwt: BSKY_REFRESH_JWT,
    active: true,
  },
};

function makeStatus(id, domain) {
  return {
    id,
    created_at: '2026-01-01T12:00:00.000Z',
    account: {
      id: 'author1',
      username: 'author',
      display_name: 'Author',
      acct: `author@${domain}`,
      url: `https://${domain}/@author`,
      avatar: '',
      avatar_static: '',
    },
    content: '<p>Hello from a stubbed post</p>',
    visibility: 'public',
    sensitive: false,
    spoiler_text: '',
    media_attachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    reblogs_count: 0,
    favourites_count: 0,
    replies_count: 0,
  };
}

async function stubStatusEndpoints(page, domain, id) {
  await page.route(`https://${domain}/api/v1/statuses/${id}`, (route) =>
    route.fulfill({ json: makeStatus(id, domain) }),
  );
  await page.route(`https://${domain}/api/v1/statuses/${id}/context`, (route) =>
    route.fulfill({ json: { ancestors: [], descendants: [] } }),
  );
}

test.beforeEach(async ({ page }) => {
  // Two logged-in Mastodon accounts; A is current. Instance A's other
  // startup calls are aborted — the app tolerates network failures
  await page.addInitScript(
    ([a, b, bsky]) => {
      localStorage.setItem('accounts', JSON.stringify([a, b, bsky]));
      localStorage.setItem(
        'instances',
        JSON.stringify({
          [a.instanceURL]: { domain: a.instanceURL },
          [b.instanceURL]: { domain: b.instanceURL },
        }),
      );
      sessionStorage.setItem('currentAccount', a.info.id);
    },
    [ACCOUNT_A, ACCOUNT_B, ACCOUNT_BSKY],
  );
  await page.route('https://instance-a.test/**', (route) => route.abort());
  await page.route('https://bsky.social/**', (route) => route.abort());
});

test('post from another logged-in account’s instance is interactable', async ({
  page,
}) => {
  await stubStatusEndpoints(page, 'instance-b.test', '123');

  await page.goto('/#/instance-b.test/s/123');
  await expect(page.getByText('Hello from a stubbed post')).toBeVisible();

  // The behavioral assertion: replying must open compose. The old bug
  // blocked it with an alert ("your current logged-in server can't
  // interact...") — Playwright auto-dismisses dialogs, so compose would
  // never appear
  await page.locator('.reply-button').first().click();
  await expect(page.locator('#compose-container')).toBeVisible();

  // And the "from another server" banner must not be on the page
  await expect(page.getByText('This post is from another server')).toBeHidden();
});

test('post from an instance with no account shows the banner', async ({
  page,
}) => {
  await stubStatusEndpoints(page, 'instance-c.test', '456');

  await page.goto('/#/instance-c.test/s/456');
  await expect(page.getByText('Hello from a stubbed post')).toBeVisible();
  await expect(
    page.getByText('This post is from another server'),
  ).toBeVisible();
});

test('notifications tab merges both accounts’ notifications', async ({
  page,
}) => {
  function makeNotification(id, domain, text) {
    return {
      id,
      type: 'mention',
      created_at: `2026-01-0${id}T12:00:00.000Z`,
      account: makeStatus(id, domain).account,
      status: { ...makeStatus(id, domain), content: `<p>${text}</p>` },
    };
  }

  // More-specific routes registered here take precedence over the
  // beforeEach aborts of instance-a.test and bsky.social
  await page.route('https://instance-a.test/api/v1/notifications*', (route) =>
    route.fulfill({
      json: [makeNotification('2', 'instance-a.test', 'Mentioned you on A')],
    }),
  );

  const bskyAuthor = {
    did: 'did:plc:someoneelse',
    handle: 'dave.bsky.social',
    displayName: 'Dave',
    avatar: AVATAR,
  };
  const bskyPostUri = `at://${bskyAuthor.did}/app.bsky.feed.post/xyz`;
  const bskyRecord = {
    $type: 'app.bsky.feed.post',
    text: 'Mentioned you on Bluesky',
    createdAt: '2026-01-03T12:00:00.000Z',
  };
  await page.route(
    'https://bsky.social/xrpc/com.atproto.server.getSession',
    (route) =>
      route.fulfill({
        json: { did: BSKY_DID, handle: 'carol.bsky.social', active: true },
      }),
  );
  await page.route(
    'https://bsky.social/xrpc/com.atproto.server.refreshSession',
    (route) =>
      route.fulfill({
        json: {
          did: BSKY_DID,
          handle: 'carol.bsky.social',
          active: true,
          accessJwt: BSKY_ACCESS_JWT,
          refreshJwt: BSKY_REFRESH_JWT,
        },
      }),
  );
  await page.route(
    'https://bsky.social/xrpc/app.bsky.notification.listNotifications*',
    (route) =>
      route.fulfill({
        json: {
          notifications: [
            {
              uri: bskyPostUri,
              cid: CID,
              author: bskyAuthor,
              reason: 'mention',
              record: bskyRecord,
              isRead: false,
              indexedAt: '2026-01-03T12:00:00.000Z',
            },
          ],
        },
      }),
  );
  await page.route(
    'https://bsky.social/xrpc/app.bsky.feed.getPosts*',
    (route) =>
      route.fulfill({
        json: {
          posts: [
            {
              uri: bskyPostUri,
              cid: CID,
              author: bskyAuthor,
              record: bskyRecord,
              indexedAt: '2026-01-03T12:00:00.000Z',
              replyCount: 0,
              repostCount: 0,
              likeCount: 0,
            },
          ],
        },
      }),
  );

  await page.goto('/#/notifications');

  // Both networks' notifications interleave in the one tab; before the
  // merge, only the current account's (Mastodon A) showed
  await expect(page.getByText('Mentioned you on A')).toBeVisible();
  await expect(page.getByText('Mentioned you on Bluesky')).toBeVisible();
});

test('reply is composed as and posted through the owning account', async ({
  page,
}) => {
  await stubStatusEndpoints(page, 'instance-b.test', '123');

  let createRequest = null;
  await page.route('https://instance-b.test/api/v1/statuses', (route) => {
    createRequest = route.request();
    return route.fulfill({
      json: { ...makeStatus('999', 'instance-b.test'), in_reply_to_id: '123' },
    });
  });

  await page.goto('/#/instance-b.test/s/123');
  await page.locator('.reply-button').first().click();

  const composeSheet = page.locator('#compose-container');
  await expect(composeSheet).toBeVisible();

  // The old bug: compose presented (and posted as) the *current* account
  await expect(composeSheet.getByText(/bob@instance-b\.test/)).toBeVisible();

  await composeSheet.locator('textarea').first().fill('A reply from a test');
  await composeSheet.locator('button[type=submit]').click();

  // The reply must POST to instance B (the post's instance), never A
  await expect
    .poll(() => createRequest && createRequest.url())
    .toContain('https://instance-b.test/api/v1/statuses');
  expect(createRequest.postDataJSON().in_reply_to_id).toBe('123');
});
