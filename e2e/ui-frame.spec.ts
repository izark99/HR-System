/**
 * Round A of the UI frame (spec §29.2 AC-UI-63..69) on a real DOM: the E2E-only showcase page
 * (apps/web/e2e-showcase.html, built by `vite build --mode e2e` only) holds every shared
 * component. Checks keyboard (APG tabs), accessible names/descriptions of FormField, toast timing
 * and roles, ConfirmDialog focus and Escape, sizes at 1280x800 and an axe scan with 0 violations.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './fixtures';
import { recordRequests } from './helpers';

const URL = '/e2e-showcase.html';

async function open(page: Page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { level: 1, name: 'UI frame' })).toBeVisible();
}

test.use({ signedInAs: null, viewport: { width: 1280, height: 800 } });

test('PageShell: one main#main; header within 96px; axe has no violation', async ({ page }) => {
  const requests = recordRequests(page);
  await open(page);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main')).toHaveAttribute('id', 'main');
  const header = await page.locator('[data-page-header]').boundingBox();
  expect(header!.height).toBeLessThanOrEqual(96);
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCSS('font-size', '28px');
  await expect(h1).toHaveCSS('font-weight', '600');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  // Nothing leaves the app origin.
  const origin = new globalThis.URL(page.url()).origin;
  expect(requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:'))).toEqual(
    [],
  );
});

test('Tabs: one Tab stop, arrows select and wrap, Home/End (APG)', async ({ page }) => {
  await open(page);
  const tabs = page.getByRole('tablist', { name: 'Demo tabs' }).getByRole('tab');
  await expect(tabs).toHaveCount(3);
  const first = tabs.nth(0);
  await first.focus();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: /Second/ })).toHaveText('panel second');
  await page.keyboard.press('End');
  await expect(tabs.nth(2)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tabs.nth(0)).toBeFocused();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  // Tab leaves the tab list for the panel (one Tab stop).
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel')).toBeFocused();
  await expect(tabs.nth(0)).toHaveCSS('min-height', '44px');
  await expect(tabs.nth(0)).toHaveText('First (3)');
});

test('FormField: name + description from label, hint and error; sizes 44px', async ({ page }) => {
  await open(page);
  const name = page.getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveAccessibleDescription('Lower case');
  await expect(name).not.toHaveAttribute('aria-invalid', /.*/);
  await name.fill('x');
  await expect(name).toHaveAccessibleDescription('Lower case Taken');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const group = page.getByRole('combobox', { name: /Group/ });
  await expect(group).toHaveAccessibleDescription('Pick one Required');
  await expect(group).toHaveAttribute('aria-invalid', 'true');
  const period = page.getByRole('button', { name: /Period/ });
  await expect(period).toHaveAccessibleDescription('Month of the run');
  // DatePicker through FormField on the real DOM (round B): named by the label (+ value), hint
  // then error as its description, invalid and required on the trigger.
  const start = page.getByRole('button', { name: /^Start date/ });
  await expect(start).toHaveAccessibleDescription('First day of validity Pick a date');
  await expect(start).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('label', { hasText: 'Start date' })).toHaveAttribute(
    'for',
    (await start.getAttribute('id'))!,
  );
  await start.click();
  const calendar = page.locator('[role="dialog"][aria-modal="false"]');
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAccessibleName(/Start date/);
  await page.keyboard.press('Escape');
  await expect(start).toBeFocused();
  await expect(page.getByRole('checkbox', { name: 'Keep' })).toBeVisible();
  for (const control of [name, group, period, start]) {
    expect(Math.round((await control.boundingBox())!.height)).toBe(44);
    await expect(control).toHaveCSS('font-size', '16px');
  }
  const button = page.getByRole('button', { name: 'open confirm' });
  expect(Math.round((await button.boundingBox())!.height)).toBe(44);
  await expect(button).toHaveCSS('font-size', '16px');
});

test('DataTable: caption, focusable region, 44px header and 48px rows', async ({ page }) => {
  await open(page);
  const table = page.getByRole('table', { name: 'Accounts' });
  await expect(table).toBeVisible();
  await expect(page.getByRole('region', { name: 'Accounts' })).toHaveAttribute('tabindex', '0');
  const head = await table.locator('thead tr').boundingBox();
  expect(Math.abs(head!.height - 44)).toBeLessThanOrEqual(1);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const box = await rows.nth(i).boundingBox();
    expect(Math.abs(box!.height - 48), `row ${i}`).toBeLessThanOrEqual(1);
  }
  const small = page.getByRole('button', { name: 'Lock test.user01' });
  expect(Math.round((await small.boundingBox())!.height)).toBe(36);
});

test('ConfirmDialog: danger focuses Cancel; Escape closes and focus returns to the opener', async ({
  page,
}) => {
  await open(page);
  const opener = page.getByRole('button', { name: 'Lock test.user01' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Lock test.user01?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Hủy' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.getByTestId('confirmed')).toHaveText('0');

  const primary = page.getByRole('button', { name: 'open confirm' });
  await primary.click();
  const publish = page.getByRole('dialog', { name: 'Publish version 3?' });
  await expect(publish.getByRole('button', { name: 'Publish' })).toBeFocused();
  await publish.getByRole('button', { name: 'Hủy' }).click();
  await expect(publish).toBeHidden();
  await expect(primary).toBeFocused();
  await primary.click();
  await publish.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByTestId('confirmed')).toHaveText('1');
});

test('Toast: success hides after 5 s (held while hovered), error stays, max 3, roles', async ({
  page,
}) => {
  await page.clock.install();
  await open(page);
  const region = page.getByRole('region', { name: 'Thông báo' });
  await page.getByRole('button', { name: 'toast success' }).click();
  const ok = region.getByRole('status');
  await expect(ok).toHaveText('Saved sample-flow');
  await page.clock.runFor(4000);
  await expect(ok).toBeVisible();
  // Hover holds the timer; leaving restarts the full 5 s.
  await ok.hover();
  await page.clock.runFor(10_000);
  await expect(ok).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(4900);
  await expect(ok).toBeVisible();
  await page.clock.runFor(200);
  await expect(ok).toHaveCount(0);

  const error = page.getByRole('button', { name: 'toast error' });
  for (let i = 0; i < 4; i++) await error.click();
  await expect(region.getByRole('alert')).toHaveCount(3);
  await page.clock.runFor(60_000);
  await expect(region.getByRole('alert')).toHaveCount(3);
  const close = region.getByRole('button', { name: 'Đóng thông báo' }).first();
  expect(Math.round((await close.boundingBox())!.height)).toBe(44);
  await close.click();
  await expect(region.getByRole('alert')).toHaveCount(2);
});

test('Stepper and KPI: aria-current, kpi 40px; 390px shows only the current label', async ({
  page,
}) => {
  await open(page);
  const steps = page.getByRole('list', { name: 'Steps' }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('kpi').first().locator('dd')).toHaveCSS('font-size', '40px');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '24px');
  await expect(page.getByTestId('kpi').first().locator('dd')).toHaveCSS('font-size', '32px');
  await expect(steps.nth(1).getByText('Step two')).toBeVisible();
  await expect(steps.nth(0).getByText('Step one')).toHaveCSS('width', '1px');
});
