import { expect, test } from '@playwright/test';

test('paints the mid Europe map by default', async ({ page }) => {
  await page.goto('/?nobench=1');
  await expect(page.getByTestId('status')).toContainText(/painted Europe \d+×\d+/, {
    timeout: 90_000,
  });
  await expect(page.getByTestId('tier-mid')).toHaveClass(/active/);
  await expect(page.getByTestId('tier-mid')).toBeEnabled();
  await expect(page.locator('[data-testid="hex-host"] canvas')).toBeVisible();
});
