/**
 * Independent QA of round A of the UI frame (spec §29.2 AC-UI-64/66/67/68) on the E2E-only
 * showcase page: edge cases beyond `ui-frame.spec.ts` (toasts past the limit, closing while
 * hovered, keyboard focus holding the timer, dialog reopened / closed by its X button, one Tab
 * stop after a click), plus no request off the origin and nothing written to storage.
 */
import { expect, test, type Page } from './fixtures';
import { recordRequests } from './helpers';

const URL = '/e2e-showcase.html';

async function open(page: Page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { level: 1, name: 'UI frame' })).toBeVisible();
}

test.use({ signedInAs: null, viewport: { width: 1280, height: 800 } });

test('toasts past the limit: oldest dropped, the rest still close after 5 s', async ({ page }) => {
  await page.clock.install();
  await open(page);
  const region = page.getByRole('region', { name: 'Thông báo' });
  const success = page.getByRole('button', { name: 'toast success' });
  for (let i = 0; i < 5; i++) await success.click();
  await expect(region.getByRole('status')).toHaveCount(3);
  // Park the pointer away from the toasts so hover does not hold the timers.
  await page.mouse.move(0, 0);
  await page.clock.runFor(5100);
  await expect(region.getByRole('status')).toHaveCount(0);
});

test('closing a hovered toast leaves the other timers running', async ({ page }) => {
  await page.clock.install();
  await open(page);
  const region = page.getByRole('region', { name: 'Thông báo' });
  await page.getByRole('button', { name: 'toast error' }).click();
  await page.getByRole('button', { name: 'toast success' }).click();
  const alert = region.getByRole('alert');
  await alert.hover();
  await alert.getByRole('button', { name: 'Đóng thông báo' }).click();
  await expect(alert).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.clock.runFor(5100);
  await expect(region.getByRole('status')).toHaveCount(0);
});

test('keyboard focus inside a toast holds its timer; leaving restarts it', async ({ page }) => {
  await page.clock.install();
  await open(page);
  const region = page.getByRole('region', { name: 'Thông báo' });
  await page.getByRole('button', { name: 'toast success' }).click();
  const ok = region.getByRole('status');
  await page.mouse.move(0, 0);
  await ok.getByRole('button', { name: 'Đóng thông báo' }).focus();
  await page.clock.runFor(20_000);
  await expect(ok).toBeVisible();
  await page.getByRole('button', { name: 'toast success' }).focus();
  await page.clock.runFor(4900);
  await expect(ok).toBeVisible();
  await page.clock.runFor(200);
  await expect(ok).toHaveCount(0);
});

test('ConfirmDialog danger: X closes, focus back; reopened it focuses Cancel again; Enter cancels', async ({
  page,
}) => {
  await open(page);
  const opener = page.getByRole('button', { name: 'Lock test.user01' });
  const dialog = page.getByRole('dialog', { name: 'Lock test.user01?' });
  await opener.click();
  await dialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog.getByRole('button', { name: 'Hủy' })).toBeFocused();
  // A stray Enter on the initial focus must not confirm the destructive action.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('confirmed')).toHaveText('0');
  await expect(opener).toBeFocused();
  // Focus stays inside the modal while moving through its buttons (Cancel -> Lock -> X).
  await opener.click();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Lock', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Hủy' })).toBeFocused();
  await page.keyboard.press('Escape');
});

test('Tabs: after a click the selected tab is the only Tab stop; Shift+Tab from panel', async ({
  page,
}) => {
  await open(page);
  const tabs = page.getByRole('tablist', { name: 'Demo tabs' }).getByRole('tab');
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tabpanel').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');
  await expect(tabs.nth(2)).toHaveAttribute('tabindex', '-1');
  const panel = page.getByRole('tabpanel');
  await expect(panel).toHaveAttribute('aria-labelledby', (await tabs.nth(1).getAttribute('id'))!);
  await expect(tabs.nth(1)).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!);
  // ArrowDown / ArrowUp are not tab keys in a horizontal list.
  await page.keyboard.press('ArrowDown');
  await expect(tabs.nth(1)).toBeFocused();
});

test('FormField: clicking the label focuses the control; hint + error both read', async ({
  page,
}) => {
  await open(page);
  await page.locator('label', { hasText: /^Name$/ }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await name.fill('x');
  await expect(name).toHaveAccessibleDescription('Lower case Taken');
  await name.fill('y');
  await expect(name).toHaveAccessibleDescription('Lower case');
  await expect(name).not.toHaveAttribute('aria-invalid', /.*/);
  const group = page.getByRole('combobox', { name: /Group/ });
  await expect(group).toHaveAccessibleName(/Group.*bắt buộc/);
  await expect(page.getByRole('checkbox', { name: 'Keep' })).toBeVisible();
  await page.locator('label', { hasText: /^Keep$/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Keep' })).toBeChecked();
});

test('privacy: no request off the origin and nothing stored after using every component', async ({
  page,
}) => {
  const requests = recordRequests(page);
  await open(page);
  await page.getByRole('button', { name: 'toast success' }).click();
  await page.getByRole('button', { name: 'toast error' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('sample');
  await page.getByRole('button', { name: 'open confirm' }).click();
  await page.keyboard.press('Escape');
  const origin = new globalThis.URL(page.url()).origin;
  expect(requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:'))).toEqual(
    [],
  );
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
    caches: (await caches.keys()).length,
  }));
  expect(storage).toEqual({ local: 0, session: 0, idb: 0, caches: 0 });
  expect(page.url()).not.toContain('sample');
});
