/**
 * Admin "Users & Groups" screen (spec §6): create / reset / lock / edit accounts, actions on the
 * own account (allowed, with a warning), groups CRUD and flow assignment. Supabase and the admin-users Edge Function are mocked
 * (e2e/supabase-mock.ts); fake accounts only.
 */
import { ADMIN, expect, SUPABASE_ORIGIN, test, USER, type Page } from './fixtures';
import { FIXED_TEMP_PASSWORD, RESET_TEMP_PASSWORD } from './supabase-mock';
import { chooseOption, persistedState, recordRequests } from './helpers';

test.use({ signedInAs: ADMIN });

const GROUP_CB = '00000000-0000-4000-8000-0000000000b1';
const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';

const usersTable = (page: Page) => page.getByRole('table', { name: 'Danh sách tài khoản' });
const groupsTable = (page: Page) => page.getByRole('table', { name: 'Danh sách nhóm' });
const userRow = (page: Page, username: string) =>
  usersTable(page).getByRole('row', { name: new RegExp(`^${username.replace('.', '\\.')}\\b`) });
const createButton = (page: Page) => page.getByRole('button', { name: 'Tạo và hiện mật khẩu tạm' });

async function openUsers(page: Page) {
  await page.goto('/admin/users');
  await expect(usersTable(page)).toBeVisible();
}

async function create(page: Page, username: string, fullName = '') {
  await page.getByLabel(/^Username/).fill(username);
  if (fullName) await page.getByLabel('Họ tên', { exact: true }).fill(fullName);
  await createButton(page).click();
}

test.describe('create account → temporary password', () => {
  test('shown once with warning + copy; never reaches storage, URL, requests or the DOM after closing', async ({
    page,
    supabase,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openUsers(page);
    await create(page, ' HR.CN05 ', 'Nhân viên Giả 5');

    const dialog = page.getByRole('dialog', { name: 'Mật khẩu tạm của hr.cn05' });
    await expect(dialog).toBeVisible();
    const output = dialog.getByLabel('Mật khẩu tạm');
    await expect(output).toHaveText(FIXED_TEMP_PASSWORD);
    await expect(dialog.getByText('mật khẩu chỉ hiện một lần và không lưu ở đâu cả')).toBeVisible();

    await dialog.getByRole('button', { name: 'Sao chép' }).click();
    await expect(dialog.locator('span[role="status"]')).toHaveText('Đã sao chép');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FIXED_TEMP_PASSWORD);

    // While the dialog is open: password is in no storage, no URL, no title, no outgoing request.
    expect(await persistedState(page)).not.toContain(FIXED_TEMP_PASSWORD);
    expect(supabase.calls.map((c) => `${c.path}${c.body}`).join('\n')).not.toContain(
      FIXED_TEMP_PASSWORD,
    );

    // Escape (native dialog) closes it; it cannot be shown again.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(FIXED_TEMP_PASSWORD);
    expect(await page.locator('body').innerHTML()).not.toContain(FIXED_TEMP_PASSWORD);
    await page.reload();
    await expect(usersTable(page)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(FIXED_TEMP_PASSWORD);
    expect(await persistedState(page)).not.toContain(FIXED_TEMP_PASSWORD);

    // Username was trimmed + lowercased before it was sent.
    expect(supabase.functionCalls).toEqual([
      {
        action: 'create',
        username: 'hr.cn05',
        full_name: 'Nhân viên Giả 5',
        role: 'user',
        group_ids: [],
      },
    ]);
    await expect(userRow(page, 'hr.cn05')).toContainText('Chưa đổi MK lần đầu');
  });

  test('the "copied" hint is reset when the dialog is reopened for another account', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openUsers(page);
    await create(page, 'hr.cn06');
    const first = page.getByRole('dialog', { name: 'Mật khẩu tạm của hr.cn06' });
    await first.getByRole('button', { name: 'Sao chép' }).click();
    await expect(first.locator('span[role="status"]')).toHaveText('Đã sao chép');
    await first.getByRole('button', { name: 'Đã lưu, đóng' }).click();
    await create(page, 'hr.cn07');
    const second = page.getByRole('dialog', { name: 'Mật khẩu tạm của hr.cn07' });
    await expect(second).toBeVisible();
    await expect(second.locator('span[role="status"]')).toHaveText('');
  });

  test('role and groups are sent; admin-role account shows the Admin chip', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await page.getByLabel(/^Username/).fill('qt.phu');
    await page.getByRole('radio', { name: 'Admin' }).check();
    await page.getByRole('checkbox', { name: 'C&B' }).check();
    await createButton(page).click();
    await page.getByRole('button', { name: 'Đã lưu, đóng' }).click();
    expect(supabase.functionCalls[0]).toMatchObject({
      role: 'admin',
      group_ids: [GROUP_CB],
    });
    await expect(userRow(page, 'qt.phu')).toContainText('Admin');
    // The form is cleared for the next account.
    await expect(page.getByLabel(/^Username/)).toHaveValue('');
    await expect(page.getByRole('radio', { name: 'User' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'C&B' })).not.toBeChecked();
  });

  for (const bad of [
    'ab',
    'Nguyễn Văn',
    'a b c',
    "x'; drop table profiles;--",
    '-abc',
    'abc-',
    '',
  ]) {
    test(`invalid username "${bad}" is refused client-side, no request`, async ({
      page,
      supabase,
    }) => {
      await openUsers(page);
      await create(page, bad);
      await expect(page.getByRole('alert')).toContainText('thông tin chưa hợp lệ');
      expect(supabase.functionCalls).toEqual([]);
    });
  }

  test('server errors keep the form and show a localized message (duplicate / forbidden / network-ish)', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await create(page, USER.username);
    await expect(page.getByRole('alert')).toContainText('username đã tồn tại');
    await expect(page.getByLabel(/^Username/)).toHaveValue(USER.username);
    supabase.functionFailure = { status: 500, code: 'internal' };
    await createButton(page).click();
    await expect(page.getByRole('alert')).toContainText('có lỗi không xác định');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test('admin session talks only to the app and the (mocked) Supabase project; storage holds only the auth token', async ({
  page,
}) => {
  const requests = recordRequests(page);
  await openUsers(page);
  await create(page, 'hr.cn09');
  await page.getByRole('button', { name: 'Đã lưu, đóng' }).click();
  await page.getByRole('tab', { name: /^Nhóm/ }).click();
  const origin = new URL(page.url()).origin;
  const outside = requests
    .map((r) => new URL(r.url))
    .filter((u) => !['blob:', 'data:'].includes(u.protocol))
    .filter((u) => u.origin !== origin && u.origin !== SUPABASE_ORIGIN);
  expect(outside.map(String)).toEqual([]);
  const keys = await page.evaluate(() => [
    ...Object.keys(localStorage),
    ...Object.keys(sessionStorage),
  ]);
  expect(keys).toEqual(['hrflow.auth']);
});

test.describe('reset password', () => {
  test('needs confirmation; cancel does nothing; confirm shows the new temp password once', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await userRow(page, USER.username)
      .getByRole('button', { name: `Reset mật khẩu ${USER.username}` })
      .click();
    const confirm = page.getByRole('dialog', { name: `Reset mật khẩu ${USER.username}?` });
    await expect(confirm).toContainText('đăng xuất mọi phiên');
    await confirm.getByRole('button', { name: 'Hủy' }).click();
    await expect(confirm).toHaveCount(0);
    expect(supabase.functionCalls).toEqual([]);

    await userRow(page, USER.username)
      .getByRole('button', { name: `Reset mật khẩu ${USER.username}` })
      .click();
    await confirm.getByRole('button', { name: 'Reset mật khẩu', exact: true }).click();
    const secret = page.getByRole('dialog', { name: `Mật khẩu tạm của ${USER.username}` });
    await expect(secret.getByLabel('Mật khẩu tạm')).toHaveText(RESET_TEMP_PASSWORD);
    // Exactly one modal is open: the confirm dialog was closed when the secret appeared.
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    expect(supabase.functionCalls).toEqual([{ action: 'reset_password', user_id: USER.id }]);
    expect(await persistedState(page)).not.toContain(RESET_TEMP_PASSWORD);

    await secret.getByRole('button', { name: 'Đã lưu, đóng' }).click();
    await expect(page.locator('body')).not.toContainText(RESET_TEMP_PASSWORD);
    await expect(userRow(page, USER.username)).toContainText('Chưa đổi MK lần đầu');
    // The old password no longer works; the temp one forces a change (see auth.spec).
    expect(supabase.users.find((u) => u.id === USER.id)).toMatchObject({
      password: RESET_TEMP_PASSWORD,
      must_change_password: true,
    });
  });

  test('a failed reset keeps the confirm dialog open with the localized error', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await userRow(page, USER.username)
      .getByRole('button', { name: `Reset mật khẩu ${USER.username}` })
      .click();
    const confirm = page.getByRole('dialog', { name: `Reset mật khẩu ${USER.username}?` });
    supabase.functionFailure = { status: 404, code: 'not_found' };
    await confirm.getByRole('button', { name: 'Reset mật khẩu', exact: true }).click();
    await expect(confirm.getByRole('alert')).toContainText('không tìm thấy tài khoản');
    await expect(page.getByRole('dialog', { name: /Mật khẩu tạm/ })).toHaveCount(0);
    // Closing clears the error for the next time.
    await confirm.getByRole('button', { name: 'Hủy' }).click();
    await userRow(page, USER.username)
      .getByRole('button', { name: `Reset mật khẩu ${USER.username}` })
      .click();
    await expect(confirm.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('lock / unlock', () => {
  test('lock → chip + button flip → the account cannot sign in; unlock restores it', async ({
    page,
    supabase,
    browser,
  }) => {
    await openUsers(page);
    await userRow(page, USER.username)
      .getByRole('button', { name: `Khóa tài khoản ${USER.username}` })
      .click();
    const lock = page.getByRole('dialog', { name: `Khóa tài khoản ${USER.username}?` });
    await expect(lock).toContainText('Tài khoản không đăng nhập được nữa');
    await lock.getByRole('button', { name: 'Hủy' }).click();
    expect(supabase.functionCalls).toEqual([]);

    await userRow(page, USER.username)
      .getByRole('button', { name: `Khóa tài khoản ${USER.username}` })
      .click();
    await lock.getByRole('button', { name: 'Khóa', exact: true }).click();
    await expect(lock).toHaveCount(0);
    expect(supabase.functionCalls).toEqual([
      { action: 'set_active', user_id: USER.id, active: false },
    ]);
    await expect(userRow(page, USER.username)).toContainText('Đã khóa');
    await expect(
      userRow(page, USER.username).getByRole('button', {
        name: `Mở khóa tài khoản ${USER.username}`,
      }),
    ).toBeVisible();

    // A second browser: the locked User is refused at login.
    const other = await browser.newContext({ locale: 'vi-VN' });
    await supabase.install(other);
    const p2 = await other.newPage();
    await p2.goto('/login');
    await p2.getByLabel('Tên đăng nhập').fill(USER.username);
    await p2.getByLabel('Mật khẩu').fill(USER.password);
    await p2.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(p2.getByRole('alert')).toContainText('tài khoản đã bị khóa');
    await other.close();

    await userRow(page, USER.username)
      .getByRole('button', { name: `Mở khóa tài khoản ${USER.username}` })
      .click();
    const unlock = page.getByRole('dialog', { name: `Mở khóa tài khoản ${USER.username}?` });
    await unlock.getByRole('button', { name: 'Mở khóa', exact: true }).click();
    await expect(unlock).toHaveCount(0);
    expect(supabase.functionCalls.at(-1)).toEqual({
      action: 'set_active',
      user_id: USER.id,
      active: true,
    });
    await expect(userRow(page, USER.username)).toContainText('Hoạt động');
  });
});

test.describe('edit account', () => {
  test('name, role and groups are saved in one update call', async ({ page, supabase }) => {
    await openUsers(page);
    await page.getByRole('button', { name: `Sửa tài khoản ${USER.username}` }).click();
    const dialog = page.getByRole('dialog', { name: `Sửa tài khoản ${USER.username}` });
    await expect(dialog.getByLabel('Họ tên')).toHaveValue(USER.full_name);
    await expect(dialog.getByRole('radio', { name: 'User' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'C&B' })).toBeChecked();

    await dialog.getByLabel('Họ tên').fill('Tên Mới');
    await dialog.getByRole('radio', { name: 'Admin' }).check();
    await dialog.getByRole('checkbox', { name: 'C&B' }).uncheck();
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(dialog).toHaveCount(0);
    expect(supabase.functionCalls).toEqual([
      { action: 'update', user_id: USER.id, full_name: 'Tên Mới', role: 'admin', group_ids: [] },
    ]);
    const row = userRow(page, USER.username);
    await expect(row).toContainText('Tên Mới');
    await expect(row).toContainText('Admin');
    await expect(row).not.toContainText('C&B');
  });

  test('closing without saving sends nothing and the next open shows fresh values', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await page.getByRole('button', { name: `Sửa tài khoản ${USER.username}` }).click();
    const dialog = page.getByRole('dialog', { name: `Sửa tài khoản ${USER.username}` });
    await dialog.getByLabel('Họ tên').fill('Chưa lưu');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: `Sửa tài khoản ${USER.username}` }).click();
    await expect(dialog.getByLabel('Họ tên')).toHaveValue(USER.full_name);
    expect(supabase.functionCalls).toEqual([]);
  });
});

test.describe('own account (MEMORY 2026-10-26 18:09: no self-action guard, explicit warning)', () => {
  test('own row has edit, reset and lock like any other row', async ({ page }) => {
    await openUsers(page);
    await expect(userRow(page, ADMIN.username).getByRole('button')).toHaveCount(3);
    await expect(userRow(page, USER.username).getByRole('button')).toHaveCount(3);
    await expect(
      page.getByRole('button', { name: `Khóa tài khoản ${ADMIN.username}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Reset mật khẩu ${ADMIN.username}` }),
    ).toBeVisible();
  });

  test('other accounts get no self warning', async ({ page }) => {
    await openUsers(page);
    await userRow(page, USER.username)
      .getByRole('button', { name: `Khóa tài khoản ${USER.username}` })
      .click();
    const dialog = page.getByRole('dialog', { name: `Khóa tài khoản ${USER.username}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText('Bạn đang khóa chính mình');
  });

  test('lock self: explicit warning; cancel sends nothing; confirm locks and signs out', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    const lockSelf = () =>
      userRow(page, ADMIN.username)
        .getByRole('button', { name: `Khóa tài khoản ${ADMIN.username}` })
        .click();
    await lockSelf();
    const dialog = page.getByRole('dialog', { name: `Khóa tài khoản ${ADMIN.username}?` });
    await expect(dialog.getByRole('alert')).toContainText('Bạn đang khóa chính mình');
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    expect(supabase.functionCalls).toEqual([]);

    await lockSelf();
    await dialog.getByRole('button', { name: 'Khóa', exact: true }).click();
    await expect(page).toHaveURL(/\/login\?reason=signedOut$/);
    // Wait for the reloaded login page (ending the test mid-navigation can hang the teardown).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
    await page.waitForLoadState('networkidle');
    expect(supabase.functionCalls).toEqual([
      { action: 'set_active', user_id: ADMIN.id, active: false },
    ]);
    expect(supabase.users.find((u) => u.id === ADMIN.id)?.is_active).toBe(false);
  });

  test('reset own password: warning, temp password shown once, then signed out', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await userRow(page, ADMIN.username)
      .getByRole('button', { name: `Reset mật khẩu ${ADMIN.username}` })
      .click();
    const confirm = page.getByRole('dialog', { name: `Reset mật khẩu ${ADMIN.username}?` });
    await expect(confirm.getByRole('alert')).toContainText(
      'Bạn đang reset mật khẩu của chính mình',
    );
    await confirm.getByRole('button', { name: 'Reset mật khẩu', exact: true }).click();
    const secret = page.getByRole('dialog', { name: `Mật khẩu tạm của ${ADMIN.username}` });
    await expect(secret.getByLabel('Mật khẩu tạm')).toHaveText(RESET_TEMP_PASSWORD);
    expect(supabase.functionCalls).toEqual([{ action: 'reset_password', user_id: ADMIN.id }]);
    await secret.getByRole('button', { name: 'Đã lưu, đóng' }).click();
    await expect(page).toHaveURL(/\/login\?reason=signedOut$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(RESET_TEMP_PASSWORD);
  });

  test('demote self: needs a second confirmation with a warning, then leaves the Admin area', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await userRow(page, ADMIN.username)
      .getByRole('button', { name: `Sửa tài khoản ${ADMIN.username}` })
      .click();
    const dialog = page.getByRole('dialog', { name: `Sửa tài khoản ${ADMIN.username}` });
    await expect(dialog.getByRole('radio', { name: 'User' })).toBeEnabled();
    await dialog.getByRole('radio', { name: 'User' }).check();
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Bạn đang hạ quyền chính mình');
    expect(supabase.functionCalls).toEqual([]);

    // Changing the choice back drops the pending confirmation.
    await dialog.getByRole('radio', { name: 'Admin' }).check();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('radio', { name: 'User' }).check();
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await dialog.getByRole('button', { name: 'Vẫn hạ quyền chính mình' }).click();
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Chọn quy trình cần chạy hôm nay',
    );
    await page.waitForLoadState('networkidle');
    expect(supabase.functionCalls).toEqual([
      {
        action: 'update',
        user_id: ADMIN.id,
        full_name: ADMIN.full_name,
        role: 'user',
        group_ids: [],
      },
    ]);
    expect(supabase.users.find((u) => u.id === ADMIN.id)?.role).toBe('user');
  });

  test('editing own name only: saved directly, role sent unchanged', async ({ page, supabase }) => {
    await openUsers(page);
    await userRow(page, ADMIN.username)
      .getByRole('button', { name: `Sửa tài khoản ${ADMIN.username}` })
      .click();
    const dialog = page.getByRole('dialog', { name: `Sửa tài khoản ${ADMIN.username}` });
    await dialog.getByLabel('Họ tên').fill('Quản trị Giả 2');
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(dialog).toHaveCount(0);
    expect(supabase.functionCalls).toEqual([
      {
        action: 'update',
        user_id: ADMIN.id,
        full_name: 'Quản trị Giả 2',
        role: 'admin',
        group_ids: [],
      },
    ]);
  });
});

test.describe('function errors and warnings', () => {
  const errors: [string, string][] = [
    ['forbidden', 'bạn không có quyền'],
    ['unauthorized', 'phiên đăng nhập đã hết hạn'],
    ['origin_not_allowed', 'chưa được phép gọi chức năng quản trị'],
    ['invalid_input', 'thông tin chưa hợp lệ'],
    ['not_found', 'không tìm thấy tài khoản'],
    ['group_not_found', 'có nhóm không còn tồn tại'],
    // No longer sent by the function; an old deployment's code falls back to the generic text.
    ['self_action_forbidden', 'có lỗi không xác định'],
    ['made_up_code', 'có lỗi không xác định'],
  ];
  for (const [code, text] of errors) {
    test(`function error "${code}" → localized message (lock dialog)`, async ({
      page,
      supabase,
    }) => {
      await openUsers(page);
      await userRow(page, USER.username)
        .getByRole('button', { name: `Khóa tài khoản ${USER.username}` })
        .click();
      const dialog = page.getByRole('dialog', { name: `Khóa tài khoản ${USER.username}?` });
      supabase.functionFailure = { status: 400, code };
      await dialog.getByRole('button', { name: 'Khóa', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText(text);
      await expect(dialog.getByRole('alert')).not.toContainText(code);
      await expect(userRow(page, USER.username)).toContainText('Hoạt động'); // nothing changed
    });
  }

  test('function error is also mapped in the edit dialog', async ({ page, supabase }) => {
    await openUsers(page);
    await page.getByRole('button', { name: `Sửa tài khoản ${USER.username}` }).click();
    const dialog = page.getByRole('dialog', { name: `Sửa tài khoản ${USER.username}` });
    supabase.functionFailure = { status: 403, code: 'forbidden' };
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(dialog.getByRole('alert')).toContainText('bạn không có quyền');
    await expect(dialog).toBeVisible();
  });

  test('audit_failed: the temp password is still shown, with a warning (create and reset)', async ({
    page,
    supabase,
  }) => {
    supabase.functionWarning = 'audit_failed';
    await openUsers(page);
    await create(page, 'hr.audit');
    const created = page.getByRole('dialog', { name: 'Mật khẩu tạm của hr.audit' });
    await expect(created.getByLabel('Mật khẩu tạm')).toHaveText(FIXED_TEMP_PASSWORD);
    await expect(created).toContainText('chưa ghi được nhật ký quản trị');
    await created.getByRole('button', { name: 'Đã lưu, đóng' }).click();

    await userRow(page, USER.username)
      .getByRole('button', { name: `Reset mật khẩu ${USER.username}` })
      .click();
    await page
      .getByRole('dialog', { name: `Reset mật khẩu ${USER.username}?` })
      .getByRole('button', { name: 'Reset mật khẩu', exact: true })
      .click();
    const reset = page.getByRole('dialog', { name: `Mật khẩu tạm của ${USER.username}` });
    await expect(reset.getByLabel('Mật khẩu tạm')).toHaveText(RESET_TEMP_PASSWORD);
    await expect(reset).toContainText('chưa ghi được nhật ký quản trị');

    supabase.functionWarning = null;
    await reset.getByRole('button', { name: 'Đã lưu, đóng' }).click();
    await create(page, 'hr.audit2');
    await expect(
      page.getByRole('dialog', { name: 'Mật khẩu tạm của hr.audit2' }),
    ).not.toContainText('chưa ghi được nhật ký quản trị');
  });
});

test.describe('groups', () => {
  test('create, duplicate, rename, delete (members and assignments follow)', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await page.getByRole('tab', { name: /^Nhóm/ }).click();
    await expect(groupsTable(page).getByRole('row', { name: /C&B/ })).toContainText('1'); // members

    await page.getByLabel(/^Tên nhóm/).fill('Kế toán <b>x</b>');
    await page.getByLabel('Mô tả').fill('Nhóm thử');
    await page.getByRole('button', { name: 'Tạo nhóm' }).click();
    const row = groupsTable(page).getByRole('row', { name: /Kế toán/ });
    await expect(row).toContainText('Kế toán <b>x</b>'); // shown as text
    await expect(row.locator('b')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Nhóm (2)' })).toBeVisible();
    expect(supabase.bodiesOf('/rest/v1/groups', 'POST').at(-1)).toEqual({
      name: 'Kế toán <b>x</b>',
      description: 'Nhóm thử',
    });
    await expect(page.getByLabel(/^Tên nhóm/)).toHaveValue(''); // form cleared

    // Duplicate name → localized, nothing added.
    await page.getByLabel(/^Tên nhóm/).fill('C&B');
    await page.getByRole('button', { name: 'Tạo nhóm' }).click();
    await expect(page.getByRole('alert')).toContainText('tên/mã này đã tồn tại');
    await expect(page.getByRole('tab', { name: 'Nhóm (2)' })).toBeVisible();

    // Rename.
    await page.getByRole('button', { name: 'Sửa nhóm C&B' }).click();
    const edit = page.getByRole('dialog', { name: 'Sửa nhóm C&B' });
    await edit.getByLabel(/^Tên nhóm/).fill('  C&B 2026  ');
    await edit.getByRole('button', { name: 'Lưu nhóm' }).click();
    await expect(edit).toHaveCount(0);
    await expect(groupsTable(page).getByRole('row', { name: /C&B 2026/ })).toBeVisible();
    expect(supabase.groups.map((g) => g.name)).toContain('C&B 2026'); // trimmed

    // Delete asks first, then members lose the group and assignments are gone.
    await page.getByRole('button', { name: 'Xóa nhóm C&B 2026' }).click();
    const del = page.getByRole('dialog', { name: 'Xóa nhóm C&B 2026?' });
    await del.getByRole('button', { name: 'Hủy' }).click();
    expect(supabase.groups).toHaveLength(2);
    await page.getByRole('button', { name: 'Xóa nhóm C&B 2026' }).click();
    await del.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(del).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Nhóm (1)' })).toBeVisible();
    expect(supabase.assignments).toEqual([]);
    await page.getByRole('tab', { name: /^Tài khoản/ }).click();
    await expect(userRow(page, USER.username)).not.toContainText('C&B');
  });

  test('blank group name (spaces) is refused client-side', async ({ page, supabase }) => {
    await openUsers(page);
    await page.getByRole('tab', { name: /^Nhóm/ }).click();
    await page.getByLabel(/^Tên nhóm/).fill('    ');
    await page.getByRole('button', { name: 'Tạo nhóm' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(supabase.bodiesOf('/rest/v1/groups', 'POST')).toEqual([]);
  });

  test('group name is capped at 80 characters by the input', async ({ page }) => {
    await openUsers(page);
    await page.getByRole('tab', { name: /^Nhóm/ }).click();
    await expect(page.getByLabel(/^Tên nhóm/)).toHaveAttribute('maxlength', '80');
  });
});

test.describe('fixed bugs (were KNOWN BUGS)', () => {
  test('blank group name shows a group message, not the username hint', async ({ page }) => {
    // Was AdminUsersPage.tsx:613-616 (reused 'invalid_input', whose text is about usernames).
    await openUsers(page);
    await page.getByRole('tab', { name: /^Nhóm/ }).click();
    await page.getByLabel(/^Tên nhóm/).fill('   ');
    await page.getByRole('button', { name: 'Tạo nhóm' }).click();
    await expect(page.getByRole('alert')).toContainText('nhập tên nhóm');
    await expect(page.getByRole('alert')).not.toContainText('Username');
  });
});

test.describe('assign flows', () => {
  const assignCard = (page: Page) => page.getByRole('region', { name: /^Gán flow/ });
  const flowBox = (page: Page) =>
    page.getByRole('group', { name: 'Flow được gán' }).getByRole('checkbox', {
      name: 'Đối chiếu bảng lương – chấm công',
    });

  test('group: shows current assignment, unassign and re-assign send the right rows', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await expect(assignCard(page)).toContainText('Gán flow cho nhóm "C&B"');
    await expect(flowBox(page)).toBeChecked();

    await flowBox(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã gỡ flow' })).toBeVisible();
    expect(supabase.assignments).toEqual([]);
    expect(supabase.calls.some((c) => c.method === 'DELETE' && c.path.includes('id=eq.a1'))).toBe(
      true,
    );

    await flowBox(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã gán flow' })).toBeVisible();
    expect(supabase.assignments).toMatchObject([
      { flow_id: FLOW_ID, group_id: GROUP_CB, user_id: null },
    ]);
    expect(supabase.bodiesOf('/rest/v1/flow_assignments', 'POST').at(-1)).toEqual({
      flow_id: FLOW_ID,
      group_id: GROUP_CB,
    });
  });

  test('user target: direct assignment is created with user_id only', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    await chooseOption(page.getByLabel('Gán cho'), USER.username);
    await expect(assignCard(page)).toContainText(`Gán flow cho tài khoản "${USER.username}"`);
    await expect(flowBox(page)).not.toBeChecked(); // group assignment is not shown as direct
    await flowBox(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã gán flow' })).toBeVisible();
    expect(supabase.bodiesOf('/rest/v1/flow_assignments', 'POST').at(-1)).toEqual({
      flow_id: FLOW_ID,
      user_id: USER.id,
    });
    // Switching target clears the status line.
    await chooseOption(page.getByLabel('Gán cho'), 'C&B');
    await expect(page.getByRole('status').filter({ hasText: 'Đã gán flow' })).toHaveCount(0);
  });

  test('effect: after unassigning, the User no longer sees the flow; after assigning, does', async ({
    page,
    supabase,
    browser,
  }) => {
    await openUsers(page);
    const userView = async () => {
      const ctx = await browser.newContext({ locale: 'vi-VN' });
      await supabase.install(ctx);
      const p = await ctx.newPage();
      await supabase.signInAs(p, USER);
      await p.goto('/');
      await expect(p.getByRole('heading', { level: 1 })).toHaveText(
        'Chọn quy trình cần chạy hôm nay',
      );
      const seen = await p.getByRole('link', { name: /^Chạy flow Đối chiếu bảng lương/ }).count();
      await ctx.close();
      return seen;
    };
    expect(await userView()).toBe(1);
    await flowBox(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã gỡ flow' })).toBeVisible();
    expect(await userView()).toBe(0);
    await flowBox(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã gán flow' })).toBeVisible();
    expect(await userView()).toBe(1);
  });

  test('each toggle sends exactly one request (no double submit)', async ({ page, supabase }) => {
    await openUsers(page);
    await flowBox(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã gỡ flow' })).toBeVisible();
    await flowBox(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã gán flow' })).toBeVisible();
    expect(
      supabase.calls.filter(
        (c) => c.method === 'POST' && c.path.startsWith('/rest/v1/flow_assignments'),
      ),
    ).toHaveLength(1);
  });
});
