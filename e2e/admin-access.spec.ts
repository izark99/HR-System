/**
 * Non-admin access to /admin/* (spec §6): the route guard redirects, the admin code is not even
 * downloaded and the admin API (Edge Function, config tables, admin RPCs) is never called.
 */
import { ADMIN, expect, test, USER } from './fixtures';
import { FLOW_URL, recordRequests, type RecordedRequest } from './helpers';

/** JS chunks of the admin area (layout, pages, admin API, version screen). */
const ADMIN_CHUNK =
  /\/assets\/(Admin[A-Za-z]*|use-admin|FlowVersions[A-Za-z]*|version-[a-z-]+)-[\w-]+\.js$/;
const adminChunks = (requests: RecordedRequest[]) =>
  requests.map((r) => r.url).filter((u) => ADMIN_CHUNK.test(new URL(u).pathname));

const ADMIN_URLS = [
  '/admin',
  '/admin/',
  '/admin/users',
  '/admin/flows',
  '/admin/users/',
  '/admin/does-not-exist',
  '/admin/users?tab=groups',
  '/admin/flows#import',
];

test.describe('signed in as a User', () => {
  for (const url of ADMIN_URLS) {
    test(`${url} → home, admin screens never render, no admin API call`, async ({
      page,
      supabase,
    }) => {
      const requests = recordRequests(page);
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Chọn quy trình cần chạy hôm nay',
      );
      expect(new URL(page.url()).pathname).toBe('/');
      await expect(page.getByRole('navigation', { name: 'Menu Admin' })).toHaveCount(0);
      await page.waitForTimeout(300);
      expect(supabase.adminCalls()).toEqual([]);
      expect(supabase.functionCalls).toEqual([]);
      expect(requests.filter((r) => r.url.includes('/functions/v1/'))).toEqual([]);
      // The guard runs before the router loads the route: no admin code is downloaded (AC-B3-92).
      expect(adminChunks(requests)).toEqual([]);
    });
  }

  test('flow list and run page never download an admin chunk (AC-B3-92)', async ({ page }) => {
    const requests = recordRequests(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Chọn quy trình cần chạy hôm nay',
    );
    await page.goto(FLOW_URL);
    await expect(page.getByRole('button', { name: /^Chạy/ }).last()).toBeVisible();
    await page.waitForTimeout(300);
    expect(requests.some((r) => /\/assets\/index-[\w-]+\.js$/.test(r.url))).toBe(true);
    expect(adminChunks(requests)).toEqual([]);
  });

  test('a differently-cased path (/ADMIN/users) matches no route: nothing admin is shown or fetched', async ({
    page,
    supabase,
  }) => {
    await page.goto('/ADMIN/users');
    await expect(page.getByRole('table', { name: 'Danh sách tài khoản' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Menu Admin' })).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(supabase.adminCalls()).toEqual([]);
  });

  test('no entry point: user menu has no "Quản trị" link and the DOM has no /admin links', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: `Tài khoản ${USER.username}` }).click();
    await expect(page.getByRole('link', { name: 'Quản trị' })).toHaveCount(0);
    expect(await page.locator('a[href^="/admin"]').count()).toBe(0);
  });

  test('client-side navigation to /admin/users (history API) is bounced as well', async ({
    page,
    supabase,
  }) => {
    await page.goto('/');
    await page.evaluate(() => {
      history.pushState({}, '', '/admin/users');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Chọn quy trình cần chạy hôm nay',
    );
    await page.waitForTimeout(300);
    expect(supabase.adminCalls()).toEqual([]);
  });

  test('client-side navigation to /admin/flows downloads no admin chunk either', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const requests = recordRequests(page);
    await page.evaluate(() => {
      history.pushState({}, '', '/admin/flows');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page).toHaveURL(/\/$/);
    await page.waitForTimeout(300);
    expect(adminChunks(requests)).toEqual([]);
  });
});

test.describe('signed out', () => {
  test.use({ signedInAs: null });

  test('/admin/users → login (deep link kept), no admin API call', async ({ page, supabase }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login\?redirect=%2Fadmin%2Fusers$/);
    expect(supabase.adminCalls()).toEqual([]);
  });

  test('/admin/flows signed out downloads no admin chunk', async ({ page }) => {
    const requests = recordRequests(page);
    await page.goto('/admin/flows');
    await expect(page).toHaveURL(/\/login\?redirect=%2Fadmin%2Fflows$/);
    await page.waitForTimeout(300);
    expect(adminChunks(requests)).toEqual([]);
  });
});

test.describe('signed in as an Admin', () => {
  test.use({ signedInAs: ADMIN });

  test('/admin → /admin/users; menu shows both admin pages', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/users$/);
    const nav = page.getByRole('navigation', { name: 'Menu Admin' });
    await expect(nav.getByRole('link', { name: 'Users & Groups' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await nav.getByRole('link', { name: 'Flows' }).click();
    await expect(page).toHaveURL(/\/admin\/flows$/);
    // Not-yet-built sections are inert and labelled.
    await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(4);
  });

  test('an Admin does download the admin chunks', async ({ page }) => {
    const requests = recordRequests(page);
    await page.goto('/admin/flows');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flow và phiên bản');
    expect(adminChunks(requests).length).toBeGreaterThan(0);
  });
});
