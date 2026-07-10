import { expect, test, type Page, type TestInfo } from '@playwright/test';

let consoleErrors: string[] = [];
let externalRequests: string[] = [];

async function waitForPlaceIndex(page: Page) {
  await expect(page.getByText('Loading Census place index. Researched cities are ready.')).toHaveCount(0);
}

async function assertNoViewportOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  externalRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') externalRequests.push(request.url());
  });
  await page.goto('/');
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('renders the compact desktop dashboard with correct initial counts and colors', async ({ page }, testInfo: TestInfo) => {
  await expect(page.getByRole('heading', { name: 'DUI Market Opportunity Dashboard' })).toBeVisible();
  await expect(page.getByText('Data refreshed July 10, 2026')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'City Table' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'U.S. Map' })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('row')).toHaveCount(26);
  await expect(page.getByText('Showing 1-25 of 345')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Qualified 43' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'High CPC 84' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unknown CPC 148' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Low volume 70' })).toBeVisible();

  expect(await page.locator('.summary-item.status-qualified').evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe('rgb(22, 128, 74)');
  expect(await page.locator('.summary-item.status-high-cpc').evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe('rgb(180, 35, 24)');
  expect(await page.locator('.summary-item.status-unknown-cpc').evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe('rgb(154, 103, 0)');
  expect(await page.locator('.summary-item.status-low-volume').evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe('rgb(23, 105, 170)');

  await page.screenshot({ path: testInfo.outputPath('desktop-1440x900.png') });
  await assertNoViewportOverflow(page);
});

test('searches, selects researched cities, and preserves the spotlight through view changes', async ({ page }) => {
  await waitForPlaceIndex(page);
  const search = page.getByRole('combobox', { name: 'Search cities' });
  await search.fill('Springfield');
  await expect(page.getByRole('option', { name: 'Springfield, Massachusetts' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Springfield, Illinois' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Springfield, Missouri' })).toBeVisible();

  await search.focus();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('region', { name: 'Selected city spotlight' })).toContainText('Springfield, Illinois');

  const mapTab = page.getByRole('tab', { name: 'U.S. Map' });
  await mapTab.focus();
  await mapTab.press('Enter');
  await expect(page.getByRole('tabpanel', { name: 'U.S. Map' })).toBeVisible();
  await expect(page.getByTestId('us-map')).toHaveAttribute('data-zoom-scale', '4');
  await expect(page.getByRole('region', { name: 'Selected city spotlight' })).toContainText('Springfield, Illinois');

  await page.getByRole('tab', { name: 'City Table' }).click();
  await expect(page.getByRole('region', { name: 'Selected city spotlight' })).toContainText('Springfield, Illinois');
});

test('selects an unresearched Census place as gray no-data on the map', async ({ page }) => {
  await waitForPlaceIndex(page);
  const search = page.getByRole('combobox', { name: 'Search cities' });
  await search.fill('Aaronsburg');
  await page.locator('[id^="city-suggestion-census-"]', { hasText: 'Aaronsburg, Pennsylvania' }).first().click();
  const spotlight = page.getByRole('region', { name: 'Selected city spotlight' });
  await expect(spotlight).toContainText('No metrics in current dataset');
  await expect(spotlight.getByText('No data')).toBeVisible();
  expect(await spotlight.getByText('No data').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(229, 231, 235)');

  await page.getByRole('tab', { name: 'U.S. Map' }).click();
  const noDataMarker = page.locator('[data-marker="no-data"]');
  await expect(noDataMarker).toHaveCount(1);
  expect(await noDataMarker.evaluate((element) => getComputedStyle(element).stroke)).toBe('rgb(107, 114, 128)');
});

test('filters, sorts, paginates, and exposes a functional keyboard-accessible map', async ({ page }) => {
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Showing 26-50 of 345')).toBeVisible();
  await page.getByRole('combobox', { name: 'State' }).selectOption('IL');
  await expect(page.getByText(/Showing 1-\d+ of \d+/)).toBeVisible();
  await page.getByRole('group', { name: 'Status filter' }).getByRole('button', { name: 'Low volume' }).click();
  await expect(page.getByRole('button', { name: 'Low volume' }).last()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Average CPC' }).click();
  await expect(page.getByRole('columnheader', { name: /Average CPC/ })).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: 'Average CPC (desc)' }).click();
  await expect(page.getByRole('columnheader', { name: /Average CPC/ })).toHaveAttribute('aria-sort', 'ascending');

  const firstTableRow = page.getByRole('row').nth(1);
  await firstTableRow.focus();
  await firstTableRow.press('Enter');
  await expect(page.getByRole('region', { name: 'Selected city spotlight' })).toBeVisible();

  await page.getByRole('tab', { name: 'U.S. Map' }).click();
  const map = page.getByTestId('us-map');
  await expect(map.locator('[data-state-geometry]')).toHaveCount(51);
  await expect(map.locator('[data-state-geometry]').first()).toHaveAttribute('d', /.+/);
  await expect(map.locator('[data-marker]')).toHaveCount(345);
  await page.getByRole('button', { name: 'Toggle low-volume markers' }).click();
  await expect(map.locator('[data-marker]')).toHaveCount(275);
  await page.getByRole('button', { name: 'Toggle low-volume markers' }).click();
  const mapMarker = map.getByRole('button', { name: /Springfield, Illinois\. Volume 260/ });
  await mapMarker.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await mapMarker.focus();
  await mapMarker.press('Enter');
  await expect(page.getByRole('region', { name: 'Selected city spotlight' })).toBeVisible();
  await expect(map).toHaveAttribute('data-zoom-scale', '4');
  const reset = page.getByRole('button', { name: 'Reset map view' });
  await expect(reset).toHaveAttribute('title', 'Reset map view');
  await reset.focus();
  await reset.press('Enter');
  await expect(map).toHaveAttribute('data-zoom-scale', '1');
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps essential controls visible without clipping and captures the map', async ({ page }, testInfo: TestInfo) => {
    await waitForPlaceIndex(page);
    await page.getByRole('tab', { name: 'U.S. Map' }).click();
    await expect(page.getByTestId('us-map')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('mobile-390x844.png') });
    await assertNoViewportOverflow(page);
    expect(await page.locator('.app-header, .search-control, .map-controls').evaluateAll((elements) => elements.every((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth;
    }))).toBe(true);
  });
});
