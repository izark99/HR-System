/**
 * Auth edge cases (spec §6): session expiring mid-use, locked accounts, wrong password, and an
 * open-redirect attempt through `?redirect=`. Supabase is mocked (e2e/supabase-mock.ts).
 */
import { ADMIN, expect, test, USER, type Page } from './fixtures';
import { FLOW_URL, payrollInput, persistedState, recordRequests, textFile } from './helpers';

async function login(page: Page, username: string, password: string) {
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

test.describe('session expires mid-use', () => {
  test('refresh is refused → reload to /login?reason=sessionExpired, in-memory files are gone', async ({
    page,
    supabase,
  }) => {
    await page.clock.install();
    await page.goto(FLOW_URL);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Đối chiếu bảng lương/);
    // The User has picked a file: it must not survive the forced reload.
    await payrollInput(page).setInputFiles(textFile('luong.xlsx', 'x', 'application/octet-stream'));
    await expect(page.getByRole('list', { name: /File đã chọn cho Bảng lương/ })).toBeVisible();

    supabase.refreshRevoked = true; // e.g. an Admin locked the account / revoked its sessions
    await page.clock.fastForward('25:00:00'); // token (24 h) is expired → auto-refresh runs
    await page.waitForURL(/\/login\?reason=sessionExpired$/);

    await expect(page.getByRole('status')).toContainText('Phiên đã hết hạn');
    await expect(page.getByRole('status')).toContainText(
      'File đã chọn trước đó không được giữ lại',
    );
    expect(await page.evaluate(() => sessionStorage.length + localStorage.length)).toBe(0);
    await expect(page.getByText('luong.xlsx')).toHaveCount(0);
    // Protected pages are closed again.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test.describe('Admin screen', () => {
    test.use({ signedInAs: ADMIN });

    test('after expiry no admin request is made, the deep link is remembered', async ({
      page,
      supabase,
    }) => {
      await page.clock.install();
      await page.goto('/admin/users');
      await expect(page.getByRole('table', { name: 'Danh sách tài khoản' })).toBeVisible();
      supabase.refreshRevoked = true;
      await page.clock.fastForward('25:00:00');
      await page.waitForURL(/\/login\?reason=sessionExpired$/);
      const admin = supabase.adminCalls().length;
      await page.goto('/admin/users');
      await expect(page).toHaveURL(/\/login\?redirect=%2Fadmin%2Fusers$/);
      expect(supabase.adminCalls().length).toBe(admin);
    });
  });

  test('?reason= is only honoured for the known reasons', async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => sessionStorage.clear());
    for (const reason of ['__proto__', 'toString', 'constructor', '<img src=x>', '']) {
      await page.goto(`/login?reason=${encodeURIComponent(reason)}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
      await expect(page.getByRole('status')).toHaveCount(0);
    }
    await page.goto('/login?reason=locked');
    await expect(page.getByRole('status')).toContainText('Tài khoản đã bị khóa');
  });
});

test.describe('login problems', () => {
  test.use({ signedInAs: null });

  test('wrong password: one generic message, password cleared, username kept, nothing stored', async ({
    page,
    supabase,
  }) => {
    await page.goto('/login');
    await login(page, USER.username, 'sai-mat-khau-1');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('tên đăng nhập hoặc mật khẩu không đúng');
    await expect(page.getByLabel('Mật khẩu')).toHaveValue('');
    await expect(page.getByLabel('Tên đăng nhập')).toHaveValue(USER.username);
    await expect(page).toHaveURL(/\/login$/);
    const wrong = await alert.innerText();
    const state = await persistedState(page);
    expect(state).not.toContain('sai-mat-khau-1');
    expect(state).not.toContain(USER.password);

    // Unknown username → the very same message (no account enumeration).
    await login(page, 'khong.ton.tai', 'sai-mat-khau-2');
    await expect(alert).toBeVisible();
    expect(await alert.innerText()).toBe(wrong);

    // The password is only ever in the POST body, never in a URL.
    for (const c of supabase.calls) expect(c.path).not.toContain('sai-mat-khau');
  });

  test('empty fields: refused without any request', async ({ page, supabase }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('alert')).toContainText('nhập tên đăng nhập và mật khẩu');
    await page.getByLabel('Tên đăng nhập').fill('   ');
    await page.getByLabel('Mật khẩu').fill('x');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('alert')).toContainText('nhập tên đăng nhập và mật khẩu');
    expect(supabase.calls.filter((c) => c.path.startsWith('/auth/v1/token'))).toEqual([]);
  });

  test('username is case-insensitive and trimmed; SQL-looking input is just a wrong login', async ({
    page,
    supabase,
  }) => {
    await page.goto('/login');
    await login(page, `x' OR '1'='1`, `' OR 1=1 --`);
    await expect(page.getByRole('alert')).toContainText('tên đăng nhập hoặc mật khẩu không đúng');
    const body = JSON.parse(
      supabase.calls.find((c) => c.path.startsWith('/auth/v1/token'))!.body,
    ) as Record<string, unknown>;
    expect(body).toEqual({
      email: `x' or '1'='1@users.hrflow.local`,
      password: `' OR 1=1 --`,
      gotrue_meta_security: {},
    });
    await login(page, `  ${USER.username.toUpperCase()}  `, USER.password);
    await expect(page).toHaveURL(/\/$/);
  });

  test('locked account (auth says user_banned): clear message, no session left', async ({
    page,
    supabase,
  }) => {
    supabase.users.find((u) => u.id === USER.id)!.is_active = false;
    await page.goto('/login');
    await login(page, USER.username, USER.password);
    await expect(page.getByRole('alert')).toContainText('tài khoản đã bị khóa. Liên hệ Admin.');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Mật khẩu')).toHaveValue('');
    expect(await page.evaluate(() => sessionStorage.length + localStorage.length)).toBe(0);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('locked account whose profile is already hidden by RLS: refused, session cleared', async ({
    page,
    supabase,
  }) => {
    // Auth still issues a token (ban not applied yet) but RLS shows a locked user nothing.
    supabase.authEnforcesBan = false;
    supabase.users.find((u) => u.id === USER.id)!.is_active = false;
    await page.goto('/login');
    await login(page, USER.username, USER.password);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => sessionStorage.length + localStorage.length)).toBe(0);
    await page.goto(FLOW_URL);
    await expect(page).toHaveURL(/\/login\?redirect=/);
    expect(supabase.calls.filter((c) => c.path.includes('resolve_flow_version'))).toEqual([]);
  });

  test('rate limiting is reported as such', async ({ page, supabase }) => {
    supabase.tokenFailure = { status: 429, code: 'over_request_rate_limit' };
    await page.goto('/login');
    await login(page, USER.username, USER.password);
    await expect(page.getByRole('alert')).toContainText('thử quá nhiều lần');
  });

  test('double click on "Đăng nhập" sends one token request', async ({ page, supabase }) => {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập').fill(USER.username);
    await page.getByLabel('Mật khẩu').fill(USER.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).dblclick();
    await expect(page).toHaveURL(/\/$/);
    expect(supabase.calls.filter((c) => c.path.startsWith('/auth/v1/token'))).toHaveLength(1);
  });
});

test.describe('open redirect through ?redirect=', () => {
  const evil = [
    'https://evil.example',
    'http://evil.example/x',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/\\/evil.example',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'evil.example',
    ' //evil.example',
    '/login',
    '/change-password',
    '/login?redirect=https://evil.example',
    '%2F%2Fevil.example',
  ];

  test.describe('signed out', () => {
    test.use({ signedInAs: null });

    for (const target of evil) {
      test(`login with redirect=${JSON.stringify(target)} stays in the app`, async ({
        page,
        baseURL,
      }) => {
        const requests = recordRequests(page);
        await page.route(
          (u) => u.hostname === 'evil.example',
          (r) => r.abort(),
        );
        await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
        await login(page, USER.username, USER.password);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          'Chọn quy trình cần chạy hôm nay',
        );
        const url = new URL(page.url());
        expect(url.origin).toBe(new URL(baseURL!).origin);
        expect(url.pathname).toBe('/');
        expect(requests.filter((r) => new URL(r.url).hostname === 'evil.example')).toEqual([]);
      });
    }

    test('same-app deep link (with query) is honoured after login', async ({ page }) => {
      await page.goto(`/login?redirect=${encodeURIComponent('/run/payroll-timesheet?x=1')}`);
      await login(page, USER.username, USER.password);
      await expect(page).toHaveURL(/\/run\/payroll-timesheet\?x=1$/);
    });

    test('a non-admin sent to /admin/users after login lands on home, admin lands there', async ({
      page,
      browser,
      supabase,
    }) => {
      await page.goto(`/login?redirect=${encodeURIComponent('/admin/users')}`);
      await login(page, USER.username, USER.password);
      await expect(page).toHaveURL(/\/$/);
      expect(supabase.adminCalls()).toEqual([]);

      const ctx = await browser.newContext({ locale: 'vi-VN' });
      await supabase.install(ctx);
      const p2 = await ctx.newPage();
      await p2.goto(`/login?redirect=${encodeURIComponent('/admin/users')}`);
      await login(p2, ADMIN.username, ADMIN.password);
      await expect(p2).toHaveURL(/\/admin\/users$/);
      await ctx.close();
    });
  });

  test.describe('already signed in', () => {
    for (const target of evil.slice(0, 11)) {
      test(`visiting /login?redirect=${JSON.stringify(target)} goes to the app home`, async ({
        page,
        baseURL,
      }) => {
        await page.route(
          (u) => u.hostname === 'evil.example',
          (r) => r.abort(),
        );
        await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          'Chọn quy trình cần chạy hôm nay',
        );
        expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
      });
    }
  });
});

test.describe('KNOWN BUG', () => {
  test.use({ signedInAs: null });

  // guard.ts:34-41 safeRedirect() accepts control characters: the router strips them, so
  // "/\t/evil.example" becomes "/evil.example" and the User lands on a "Not Found" page. Not an
  // external redirect (same origin), but the fallback to "/" is not applied.
  for (const [name, ctrl] of [
    ['tab', '\t'],
    ['newline', '\n'],
    ['carriage return', '\r'],
  ] as const) {
    test.fail(`redirect containing a ${name} falls back to home`, async ({ page, baseURL }) => {
      await page.route(
        (u) => u.hostname === 'evil.example',
        (r) => r.abort(),
      );
      await page.goto(`/login?redirect=${encodeURIComponent(`/${ctrl}/evil.example`)}`);
      await login(page, USER.username, USER.password);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Chọn quy trình cần chạy hôm nay',
        { timeout: 3_000 },
      );
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
      expect(new URL(page.url()).pathname).toBe('/');
    });
  }
});
