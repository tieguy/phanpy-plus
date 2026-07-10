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
    ([a, b]) => {
      localStorage.setItem('accounts', JSON.stringify([a, b]));
      localStorage.setItem(
        'instances',
        JSON.stringify({
          [a.instanceURL]: { domain: a.instanceURL },
          [b.instanceURL]: { domain: b.instanceURL },
        }),
      );
      sessionStorage.setItem('currentAccount', a.info.id);
    },
    [ACCOUNT_A, ACCOUNT_B],
  );
  await page.route('https://instance-a.test/**', (route) => route.abort());
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
