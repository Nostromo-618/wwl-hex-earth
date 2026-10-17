import { expect, test } from '@playwright/test';

test('defaults to Europe mid and switches the World globe to high', async ({ page }) => {
  await page.goto('/?nobench=1');
  await expect(page.getByTestId('status')).toContainText(/painted Europe \d+×\d+/, {
    timeout: 90_000,
  });
  await expect(page.getByTestId('region-europe')).toHaveClass(/active/);
  await expect(page.getByTestId('tier-mid')).toHaveClass(/active/);
  await page.getByTestId('region-world').click();
  await expect(page.getByTestId('status')).toContainText(/painted World \d+×\d+/, {
    timeout: 90_000,
  });
  await expect(page.getByTestId('region-world')).toHaveClass(/active/);
  await expect(page.getByTestId('tier-high')).toHaveClass(/active/);
  await expect(page.getByTestId('tier-max')).toHaveText('512k');
  await page.getByTestId('region-europe').click();
  await expect(page.getByTestId('tier-mid')).toHaveClass(/active/);
  await expect(page.getByTestId('tier-max')).toHaveCount(0);
});
