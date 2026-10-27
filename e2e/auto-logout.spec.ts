/**
 * Auto sign-out after 8 hours without interaction (spec §6.1, AC-B3-80..88), on Playwright's fake
 * clock. Supabase is mocked; fake accounts only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { recordRequests } from './helpers';

const HOME_TITLE = 'Chọn quy trình cần chạy hôm nay';
const warning = (page: Page) => page.getByRole('alertdialog', { name: 'Bạn sắp bị đăng xuất' });
const continueButton = (page: Page) =>
  warning(page).getByRole('button', { name: 'Tiếp tục làm việc' });

async function openHome(page: Page) {
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HOME_TITLE);
}

test.describe('auto sign-out', () => {
  test('warning at 7h55 with a countdown; mouse moves keep it open; "Tiếp tục làm việc" restarts 8 hours', async ({
    page,
  }) => {
    await openHome(page);
    await page.clock.fastForward('07:54:00');
    await expect(warning(page)).toHaveCount(0);
    await page.clock.fastForward('01:00');
    await expect(warning(page)).toBeVisible();
    await expect(warning(page)).toContainText('05:00');
    await page.clock.fastForward('01:00');
    await expect(warning(page)).toContainText('04:00');
    // No unsaved Designer work: no extra line.
    await expect(warning(page)).not.toContainText('chưa lưu');

    await page.mouse.move(100, 100);
    await page.mouse.move(300, 200);
    await page.keyboard.press('Shift');
    await expect(warning(page)).toBeVisible();
    await page.keyboard.press('Escape'); // does not dismiss
    await expect(warning(page)).toBeVisible();

    await expect(continueButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(warning(page)).toHaveCount(0);
    await page.clock.fastForward('07:54:00');
    await expect(warning(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await page.clock.fastForward('01:00');
    await expect(warning(page)).toBeVisible();
    await continueButton(page).click();
    await expect(warning(page)).toHaveCount(0);
  });

  test('no click: signed out at 8h, session removed, login screen says why', async ({
    page,
    supabase,
  }) => {
    await openHome(page);
    expect(await page.evaluate(() => sessionStorage.getItem('hrflow.auth'))).not.toBeNull();
    await page.clock.fastForward('07:55:00');
    await expect(warning(page)).toBeVisible();
    await page.clock.fastForward('05:00');
    await expect(page).toHaveURL(/\/login\?reason=idle$/);
    await expect(page.getByRole('status')).toContainText(
      'Bạn đã được đăng xuất do không thao tác trong 8 giờ. Vui lòng đăng nhập lại.',
    );
    await expect(page.getByLabel('Tên đăng nhập')).toBeVisible();
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
    // Scope local: this session's refresh token is revoked on the server, nothing global.
    expect(
      supabase.calls.filter((c) => c.path.startsWith('/auth/v1/logout')).map((c) => c.path),
    ).toEqual(['/auth/v1/logout?scope=local']);
    // Going back into the app needs a new sign-in.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('expired access token (logout 401): refresh once, then revoke with the new token', async ({
    page,
    supabase,
  }) => {
    supabase.logoutRejectsFirstToken = true;
    await openHome(page);
    const before = supabase.calls.length;
    await page.clock.fastForward('08:00:00');
    await expect(page).toHaveURL(/\/login\?reason=idle$/);
    const auth = supabase.calls
      .slice(before)
      .filter((c) => c.method === 'POST' && c.path.startsWith('/auth/v1/'))
      .map((c) => c.path);
    expect(auth).toEqual([
      '/auth/v1/logout?scope=local',
      '/auth/v1/token?grant_type=refresh_token',
      '/auth/v1/logout?scope=local',
    ]);
    expect(supabase.logoutTokens).toHaveLength(2);
    expect(supabase.logoutTokens[0]).not.toBe(supabase.logoutTokens[1]);
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  });

  test('a server that does not answer the logout delays the login page by about 3 s, not more', async ({
    page,
    supabase,
  }) => {
    supabase.logoutDelayMs = 20_000;
    await openHome(page);
    await page.clock.fastForward('08:00:00');
    // The session is gone from the tab right away, while the request is still pending.
    await expect
      .poll(() => page.evaluate(() => Object.keys(sessionStorage)).catch(() => []))
      .toEqual([]);
    const started = Date.now();
    await expect(page).toHaveURL(/\/login\?reason=idle$/, { timeout: 10_000 });
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  test('activity at 7h restarts the countdown: no warning at 7h55', async ({ page }) => {
    await openHome(page);
    await page.clock.fastForward('07:00:00');
    await page.mouse.move(50, 50);
    await page.mouse.wheel(0, 200);
    // Let the (asynchronous) scroll events land before jumping: a late scroll would count as
    // activity after the jump.
    await page.waitForTimeout(500);
    await page.clock.fastForward('00:55:00');
    await expect(warning(page)).toHaveCount(0);
    await page.clock.fastForward('07:01:00');
    await expect(warning(page)).toBeVisible();
  });

  test('tab asleep / hidden for 9 hours: signed out at once, no 5-minute warning first', async ({
    page,
  }) => {
    await openHome(page);
    let warned = false;
    await page.exposeFunction('hrflowSawWarning', () => {
      warned = true;
    });
    await page.evaluate(() => {
      new MutationObserver(() => {
        if (document.querySelector('[role="alertdialog"]')) {
          (window as unknown as { hrflowSawWarning: () => void }).hrflowSawWarning();
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.clock.fastForward('09:00:00');
    // The late timer may already have started the sign-out navigation: the page can be gone.
    await page
      .evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      .catch(() => undefined);
    await expect(page).toHaveURL(/\/login\?reason=idle$/);
    expect(warned).toBe(false);
  });

  test('interaction is never sent over the network or stored (AC-B3-88)', async ({ page }) => {
    const requests = recordRequests(page);
    await openHome(page);
    const before = requests.length;
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(20 + i * 30, 40);
      await page.keyboard.press('Tab');
      await page.clock.fastForward('00:31');
    }
    await page.mouse.wheel(0, 300);
    const after = requests.slice(before).map((r) => `${r.method} ${new URL(r.url).pathname}`);
    // Only the auth client's own token refresh may talk to the server; nothing activity-related.
    // (Static assets of the app itself, e.g. a font weight shown for the first time, are fine.)
    expect(
      after.filter((r) => !r.endsWith('/auth/v1/token') && !r.startsWith('GET /assets/')),
    ).toEqual([]);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual(['hrflow.auth']);
  });
});

test.describe('auto sign-out (Admin)', () => {
  test.use({ signedInAs: ADMIN });

  test('Admin on the flows screen is signed out after 8 hours as well', async ({ page }) => {
    await page.clock.install();
    await page.goto('/admin/flows');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flow và phiên bản');
    await page.clock.fastForward('07:55:00');
    await expect(warning(page)).toBeVisible();
    await page.clock.fastForward('05:00');
    await expect(page).toHaveURL(/\/login\?reason=idle$/);
  });
});
