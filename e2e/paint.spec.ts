import { expect, test } from '@playwright/test';

test('paints the high World map by default', async ({ page }) => {
  await page.goto('/?nobench=1');
  await expect(page.getByTestId('status')).toContainText(/painted World \d+×\d+/, {
    timeout: 90_000,
  });
  await expect(page.getByTestId('tier-high')).toHaveClass(/active/);
  await expect(page.getByTestId('tier-mid')).toBeEnabled();
  await expect(page.locator('[data-testid="hex-host"] canvas')).toBeVisible();
});
