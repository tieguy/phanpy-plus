// @ts-check
import { expect, test } from '@playwright/test';

// The Playwright project runs under iPhone 13 Mini (Mobile Safari), which is
// exactly the context the install hint targets: iOS Safari, not installed.

test('shows the iOS install hint and lets you dismiss it for good', async ({
  page,
}) => {
  await page.goto('/');

  const hint = page.locator('.ios-install-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Add to Home Screen');

  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(hint).toHaveCount(0);

  // Dismissal persists across reloads.
  await page.reload();
  await expect(page.locator('.ios-install-hint')).toHaveCount(0);
});
