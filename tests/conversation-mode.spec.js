// @ts-check
import { expect, test } from '@playwright/test';

// The conversation-mode guard. Dev builds show the full app unless
// localStorage `conversationModeOverride` is 'on' (see useConversationMode).

const ACCOUNT = {
  info: {
    id: 'a1',
    username: 'alice',
    acct: 'alice@instance-a.test',
    displayName: 'Alice',
  },
  instanceURL: 'instance-a.test',
  accessToken: 'token-a',
};

function seed(page, { loggedIn, conversationMode }) {
  return page.addInitScript(
    ([account, loggedIn, conversationMode]) => {
      if (conversationMode) {
        localStorage.setItem('conversationModeOverride', 'on');
      }
      if (loggedIn) {
        localStorage.setItem('accounts', JSON.stringify([account]));
        localStorage.setItem(
          'instances',
          JSON.stringify({
            [account.instanceURL]: { domain: account.instanceURL },
          }),
        );
        sessionStorage.setItem('currentAccount', account.info.id);
      }
    },
    [ACCOUNT, loggedIn, conversationMode],
  );
}

test.beforeEach(async ({ page }) => {
  await page.route('https://instance-a.test/**', (route) => route.abort());
});

test.describe('in conversation mode', () => {
  test.beforeEach(({ page }) =>
    seed(page, { loggedIn: true, conversationMode: true }),
  );

  for (const path of [
    '/',
    '/following',
    '/notifications',
    '/instance-a.test/s/123',
    '/instance-a.test/a/a1',
    '/search?q=hello',
    '/https://instance-a.test/@alice',
  ]) {
    test(`${path} redirects to the conversation list`, async ({ page }) => {
      await page.goto(`/#${path}`);
      await expect(page).toHaveURL(/#\/conversations$/);
      await expect(
        page.getByRole('heading', { name: 'Conversations' }),
      ).toBeVisible();
    });
  }

  test('shows no app chrome', async ({ page }) => {
    await page.goto('/#/conversations');
    await expect(
      page.getByRole('heading', { name: 'Conversations' }),
    ).toBeVisible();
    await expect(page.locator('#compose-button')).toHaveCount(0);
    await expect(page.locator('#shortcuts')).toHaveCount(0);
    await expect(page.locator('.nav-menu-button')).toHaveCount(0);
  });
});

test('logged out in conversation mode, a deep link goes to login', async ({
  page,
}) => {
  await seed(page, { loggedIn: false, conversationMode: true });
  await page.goto('/#/following');
  await expect(page).toHaveURL(/#\/login$/);
});

test('outside conversation mode, the full app is unchanged', async ({
  page,
}) => {
  await seed(page, { loggedIn: true, conversationMode: false });
  await page.goto('/#/following');
  await expect(page).toHaveURL(/#\/following$/);
  await expect(page.locator('#compose-button')).toBeVisible();
});
