/**
 * Login, first-login password change, route guards, sign-out and the Admin "create account"
 * screen, all against the mocked Supabase (e2e/supabase-mock.ts). Fake accounts only.
 */
import { ADMIN, expect, test, USER } from './fixtures';
import { fixtures, payrollInput, pickMonth, runButton, timesheetInput } from './helpers';

test.describe('signed out', () => {
  test.use({ signedInAs: null });

  test('login → forced password change → run the assigned flow (run logged as metadata)', async ({
    page,
    supabase,
  }) => {
    const user = supabase.users.find((u) => u.id === USER.id)!;
    user.must_change_password = true;

    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
    await expect(page.getByText('Quên mật khẩu, vui lòng liên hệ Admin.')).toBeVisible();
    await expect(page.getByRole('link', { name: /quên mật khẩu/i })).toHaveCount(0);

    await page.getByLabel('Tên đăng nhập').fill('HR.NV01');
    await page.getByLabel('Mật khẩu').fill('sai-mat-khau');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('alert')).toContainText('tên đăng nhập hoặc mật khẩu không đúng');
    // The username was sent as the synthetic e-mail.
    const tokenCall = supabase.calls.find((c) => c.path.startsWith('/auth/v1/token'))!;
    expect(JSON.parse(tokenCall.body)).toMatchObject({ email: 'hr.nv01@users.hrflow.local' });

    await page.getByLabel('Mật khẩu').fill(USER.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByText('Lần đăng nhập đầu tiên')).toBeVisible();

    // Forced: other pages bounce back here.
    await page.goto('/run/payroll-timesheet');
    await expect(page).toHaveURL(/\/change-password$/);

    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('ngan');
    await page.getByLabel('Nhập lại mật khẩu mới').fill('ngan');
    await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
    await expect(page.getByRole('alert')).toContainText('ít nhất 10 ký tự');
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('mat-khau-moi-2026');
    await page.getByLabel('Nhập lại mật khẩu mới').fill('mat-khau-moi-2027');
    await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
    await expect(page.getByRole('alert')).toContainText('chưa khớp');
    await page.getByLabel('Nhập lại mật khẩu mới').fill('mat-khau-moi-2026');
    await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Chọn quy trình cần chạy hôm nay',
    );
    expect(user.password).toBe('mat-khau-moi-2026');
    await expect(page.getByText('2 đầu vào · Phiên bản v3')).toBeVisible();

    await page.getByRole('link', { name: /^Chạy flow Đối chiếu bảng lương/ }).click();
    await pickMonth(page, '2026-09');
    await expect(page.getByRole('status').filter({ hasText: 'Phiên bản áp dụng:' })).toContainText(
      'v3',
    );
    await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
    await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
    await expect(runButton(page)).toHaveText('Chạy');
    await runButton(page).click();
    await expect(page.getByTestId('kpi').first()).toBeVisible({ timeout: 120_000 });
    await expect.poll(() => supabase.runLogs.length).toBe(1);
    expect(supabase.runLogs[0]).toMatchObject({
      flow_version_id: '00000000-0000-4000-8000-0000000001f1',
      status: 'succeeded',
      params: { ky_luong: '2026-09' },
    });

    // The run shows up in the history card (metadata only).
    await page.getByRole('link', { name: 'Danh sách flow' }).first().click();
    const recent = page.getByRole('region', { name: 'Lần chạy gần đây' });
    await expect(recent.getByRole('row')).toHaveCount(2);
    await expect(recent).toContainText('Kỳ lương: 09/2026');
    await expect(recent).toContainText('Thành công');
  });

  test('deep link survives the login; locked account is refused', async ({ page, supabase }) => {
    await page.goto('/run/payroll-timesheet');
    await expect(page).toHaveURL(/\/login\?redirect=%2Frun%2Fpayroll-timesheet$/);
    await page.getByLabel('Tên đăng nhập').fill(USER.username);
    await page.getByLabel('Mật khẩu').fill(USER.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/run\/payroll-timesheet$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Đối chiếu bảng lương/);

    // Sign out from the user menu: back to login, session gone.
    await page.getByRole('button', { name: `Tài khoản ${USER.username}` }).click();
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/login\?reason=signedOut$/);
    await expect(page.getByRole('status')).toContainText('Đã đăng xuất');
    expect(await page.evaluate(() => sessionStorage.length + localStorage.length)).toBe(0);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);

    supabase.users.find((u) => u.id === USER.id)!.is_active = false;
    await page.getByLabel('Tên đăng nhập').fill(USER.username);
    await page.getByLabel('Mật khẩu').fill(USER.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('alert')).toContainText('tài khoản đã bị khóa');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('signed in as a User', () => {
  test('cannot open /admin (redirected home, no admin menu entry)', async ({ page, supabase }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Chọn quy trình cần chạy hôm nay',
    );
    await page.getByRole('button', { name: `Tài khoản ${USER.username}` }).click();
    await expect(page.getByRole('link', { name: 'Quản trị' })).toHaveCount(0);
    expect(supabase.functionCalls).toEqual([]);
  });

  test('a flow that is not assigned is neither listed nor runnable', async ({ page, supabase }) => {
    supabase.flowVisibleToUsers = false;
    await page.goto('/');
    await expect(page.getByText('Không tìm thấy flow phù hợp.')).toBeVisible();
    await page.goto('/run/payroll-timesheet');
    await expect(page.getByRole('alert')).toContainText('Không tìm thấy flow');
  });
});

test.describe('signed in as Admin', () => {
  test.use({ signedInAs: ADMIN });

  test('creates an account: temp password shown once with copy + warning', async ({
    page,
    supabase,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: `Tài khoản ${ADMIN.username}` }).click();
    await page.getByRole('link', { name: 'Quản trị' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Quản lý tài khoản và quyền chạy flow',
    );
    await expect(page.getByRole('navigation', { name: 'Menu Admin' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Tài khoản (2)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const table = page.getByRole('table', { name: 'Danh sách tài khoản' });
    await expect(table.getByRole('row')).toHaveCount(3);

    await page.getByLabel(/^Username/).fill('HR.CN03');
    await page.getByLabel('Họ tên', { exact: true }).fill('Nhân viên Giả 3');
    await page.getByRole('checkbox', { name: 'C&B' }).check();
    await page.getByRole('button', { name: 'Tạo và hiện mật khẩu tạm' }).click();

    const dialog = page.getByRole('dialog', { name: 'Mật khẩu tạm của hr.cn03' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('output')).toContainText('TamThoi2345abcXY');
    await expect(dialog).toContainText('mật khẩu chỉ hiện một lần');
    await expect(dialog.getByRole('button', { name: 'Sao chép' })).toBeVisible();
    expect(supabase.functionCalls).toEqual([
      {
        action: 'create',
        username: 'hr.cn03',
        full_name: 'Nhân viên Giả 3',
        role: 'user',
        group_ids: ['00000000-0000-4000-8000-0000000000b1'],
      },
    ]);
    await dialog.getByRole('button', { name: 'Đã lưu, đóng' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('TamThoi2345abcXY');

    const row = table.getByRole('row', { name: /hr\.cn03/ });
    await expect(row).toContainText('Chưa đổi MK lần đầu');
    await expect(row).toContainText('C&B');
    await expect(page.getByRole('tab', { name: 'Tài khoản (3)' })).toBeVisible();

    // Duplicate username → localized error from the function's error code.
    await page.getByLabel(/^Username/).fill('hr.cn03');
    await page.getByRole('button', { name: 'Tạo và hiện mật khẩu tạm' }).click();
    await expect(page.getByRole('alert')).toContainText('username đã tồn tại');

    // Own row has no reset/lock actions.
    const own = table.getByRole('row', { name: /^admin/ });
    await expect(own.getByRole('button', { name: /Khóa|Reset/ })).toHaveCount(0);

    // Tabs follow the APG pattern (arrow keys).
    await page.getByRole('tab', { name: /Tài khoản/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Nhóm (1)' })).toBeFocused();
    await expect(page.getByRole('table', { name: 'Danh sách nhóm' })).toBeVisible();
  });

  test('flows page lists the flow and its version', async ({ page }) => {
    await page.goto('/admin/flows');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flow và phiên bản');
    await expect(page.getByRole('row', { name: /Đối chiếu bảng lương/ })).toContainText('v3');
    await expect(page.getByRole('button', { name: 'Nhập flow JSON' })).toBeVisible();
  });
});
