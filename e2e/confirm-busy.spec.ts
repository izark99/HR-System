/**
 * ConfirmDialog while its action runs (round B of the UI frame, spec §25.5 "ConfirmDialog",
 * AC-UI-68/73): both buttons and the close button are disabled, Escape does not close the dialog
 * half-way; once the server answers the dialog closes and a toast reports the result. The
 * request is held with a page route in front of the Supabase mock. Fake accounts only.
 */
import { ADMIN, expect, test, USER, type Page } from './fixtures';
import { rowAction } from './helpers';

test.use({ signedInAs: ADMIN });

/** Holds matching requests until `release()`; then they go on to the Supabase mock. */
async function hold(page: Page, match: (url: URL, method: string) => boolean) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let held = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (match(new URL(req.url()), req.method())) {
      held++;
      await gate;
    }
    await route.fallback();
  });
  return { release, held: () => held };
}

async function expectBusy(page: Page, dialog: ReturnType<Page['getByRole']>, confirm: string) {
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('button', { name: 'Hủy' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: confirm, exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Đóng' })).toBeDisabled();
  // Escape twice (Chromium lets the second one through a prevented `cancel`): still open.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
}

test('lock: Escape is ignored while the request runs, then a toast reports it', async ({
  page,
  supabase,
}) => {
  await page.goto('/admin/users');
  const table = page.getByRole('table', { name: 'Danh sách tài khoản' });
  const row = table.getByRole('row', {
    name: new RegExp(`^${USER.username.replace('.', '\\.')}\\b`),
  });
  await rowAction(row, `Khóa tài khoản ${USER.username}`);
  const dialog = page.getByRole('dialog', { name: `Khóa tài khoản ${USER.username}?` });
  // Danger confirmation: focus starts on "Hủy".
  await expect(dialog.getByRole('button', { name: 'Hủy' })).toBeFocused();

  const gate = await hold(
    page,
    (u, m) => u.pathname === '/functions/v1/admin-users' && m === 'POST',
  );
  await dialog.getByRole('button', { name: 'Khóa', exact: true }).click();
  await expect.poll(gate.held).toBe(1);
  await expectBusy(page, dialog, 'Khóa');
  expect(supabase.functionCalls).toEqual([]);

  gate.release();
  await expect(dialog).toHaveCount(0);
  expect(supabase.functionCalls).toEqual([
    { action: 'set_active', user_id: USER.id, active: false },
  ]);
  await expect(page.getByRole('status').filter({ hasText: 'Đã khóa tài khoản' })).toContainText(
    `Đã khóa tài khoản ${USER.username}.`,
  );
  await expect(row).toContainText('Đã khóa');
});

test('retire: Escape is ignored while the request runs, then a toast reports it', async ({
  page,
  supabase,
}) => {
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  await page.goto('/admin/flows/payroll-timesheet/versions');
  const row = page
    .getByRole('table', { name: 'Danh sách phiên bản' })
    .getByRole('row', { name: /^v1\b/ });
  await rowAction(row, 'Retire v1');
  const dialog = page.getByRole('dialog', { name: 'Retire v1?' });
  await expect(dialog.getByRole('button', { name: 'Hủy' })).toBeFocused();

  const gate = await hold(page, (u, m) => u.pathname === '/rest/v1/flow_versions' && m === 'PATCH');
  await dialog.getByRole('button', { name: 'Retire', exact: true }).click();
  await expect.poll(gate.held).toBe(1);
  await expectBusy(page, dialog, 'Retire');
  expect(supabase.versionWrites).toEqual([]);

  gate.release();
  await expect(dialog).toHaveCount(0);
  expect(supabase.versionWrites).toEqual([
    { method: 'PATCH', id: supabase.versions[0]!.id, body: { status: 'retired' } },
  ]);
  await expect(page.getByRole('status').filter({ hasText: 'Đã xong:' })).toContainText(
    'đã retire v1.',
  );
  await expect(row).toContainText('Retired');
});
