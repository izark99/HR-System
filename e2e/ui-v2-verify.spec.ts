/**
 * Independent checks of the design v2 fix round (spec §28.8 AC-UI-50..56, §25.3 "Thao tác trên
 * dòng bảng", "Skeleton"): row-action menu behaviour beyond the keyboard walk in ui-v2.spec.ts
 * (outside click, one menu at a time, scroll, viewport edges, destructive confirm), the create
 * account dialog (focus trap, error inside the dialog, temp password in no console/URL), and
 * loading skeletons (no flash on a fast answer, no large layout shift). Fake accounts only.
 */
import { ADMIN, expect, SUPABASE_ORIGIN, test, USER, type Page } from './fixtures';
import { openCreateAccount, persistedState } from './helpers';
import { baseFlowDefinition, FIXED_TEMP_PASSWORD } from './supabase-mock';

const usersTable = (page: Page) => page.getByRole('table', { name: 'Danh sách tài khoản' });
const menuButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Thao tác khác cho ${name}`, exact: true });

/** Adds fake accounts hr.qa01..hr.qaNN so the table is taller than the viewport. */
function addUsers(supabase: { users: (typeof USER)[] }, n: number): string[] {
  const names: string[] = [];
  for (let i = 1; i <= n; i++) {
    const username = `hr.qa${String(i).padStart(2, '0')}`;
    names.push(username);
    supabase.users.push({
      ...USER,
      id: `00000000-0000-4000-8000-${String(500 + i).padStart(12, '0')}`,
      username,
      full_name: `Nhân viên Giả QA ${i}`,
    });
  }
  return names;
}

async function openUsers(page: Page): Promise<void> {
  await page.goto('/admin/users');
  await expect(usersTable(page)).toBeVisible();
}

test.describe('row action menu (AC-UI-54)', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1280, height: 800 } });

  test('mouse open focuses the first item; outside click closes; only one menu open', async ({
    page,
  }) => {
    await openUsers(page);
    // `a` is the lower row: its menu opens downwards and does not cover the other row's button
    // (round B: the shorter header leaves room below the table, so the menu no longer flips up).
    const a = menuButton(page, ADMIN.username);
    const b = menuButton(page, USER.username);
    await a.click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await expect(page.getByRole('menu').getByRole('menuitem').first()).toBeFocused();
    await expect(a).toHaveAttribute('aria-expanded', 'true');

    // Opening another row's menu closes the first one.
    await b.click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await expect(a).toHaveAttribute('aria-expanded', 'false');
    await expect(b).toHaveAttribute('aria-expanded', 'true');

    // Click outside (page title) closes.
    await page.getByRole('heading', { level: 1 }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(b).toHaveAttribute('aria-expanded', 'false');

    // Clicking the button again toggles it closed.
    await a.click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await a.click();
    await expect(page.getByRole('menu')).toHaveCount(0);

    // ArrowUp on the button opens on the last item.
    await a.focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menu').getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(a).toBeFocused();
  });

  test('destructive item still asks for confirmation; cancel returns focus to the menu button', async ({
    page,
    supabase,
  }) => {
    await openUsers(page);
    const button = menuButton(page, USER.username);
    await button.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    await expect(
      page.getByRole('menuitem', { name: `Khóa tài khoản ${USER.username}` }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    const confirm = page.getByRole('dialog', { name: `Khóa tài khoản ${USER.username}?` });
    await expect(confirm).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await confirm.getByRole('button', { name: 'Hủy' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(supabase.functionCalls).toEqual([]);
  });

  test('menu follows its button when the page scrolls and stays inside the viewport near the bottom edge', async ({
    page,
    supabase,
  }) => {
    const names = addUsers(supabase, 14);
    await page.setViewportSize({ width: 1280, height: 600 });
    await openUsers(page);
    const button = menuButton(page, names[3]!);
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const gap = async () => {
      const bb = (await button.boundingBox())!;
      const mb = (await menu.boundingBox())!;
      return { below: mb.y - (bb.y + bb.height), above: bb.y - (mb.y + mb.height) };
    };
    const before = await gap();
    expect(Math.min(Math.abs(before.below - 4), Math.abs(before.above - 4))).toBeLessThan(1.5);

    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, 120);
    await expect
      .poll(async () => {
        const g = await gap();
        return Math.min(Math.abs(g.below - 4), Math.abs(g.above - 4));
      })
      .toBeLessThan(1.5);

    await page.keyboard.press('Escape');

    // Last row pushed to the bottom of the viewport: the menu opens above and stays visible.
    const last = menuButton(page, names[names.length - 1]!);
    await last.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await last.click();
    const mb = (await menu.boundingBox())!;
    expect(mb.y).toBeGreaterThanOrEqual(0);
    expect(mb.y + mb.height).toBeLessThanOrEqual(600);
    await expect(menu.getByRole('menuitem').last()).toBeInViewport({ ratio: 1 });
  });

  test('1024px: menu does not overflow the right edge; action column on one line', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openUsers(page);
    await menuButton(page, USER.username).click();
    const mb = (await page.getByRole('menu').boundingBox())!;
    expect(mb.x).toBeGreaterThanOrEqual(0);
    expect(mb.x + mb.width).toBeLessThanOrEqual(1024);
    const heights = await usersTable(page)
      .locator('[data-row-actions]')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeLessThanOrEqual(48);
  });
});

test.describe('create account dialog (AC-UI-55)', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1280, height: 800 } });

  test('focus stays in the dialog; a taken username shows the error inside it and keeps the input', async ({
    page,
  }) => {
    await openUsers(page);
    const dialog = await openCreateAccount(page);
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const a = document.activeElement;
        return !a || a === document.body || !!a.closest('dialog[open]');
      });
      expect(inside, `Tab ${i + 1} left the dialog`).toBe(true);
    }
    await dialog.getByLabel(/^Username/).fill(USER.username);
    await dialog.getByRole('button', { name: 'Tạo và hiện mật khẩu tạm' }).click();
    await expect(dialog.getByRole('alert')).toContainText('username đã tồn tại');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^Username/)).toHaveValue(USER.username);
    await expect(page.getByRole('dialog', { name: /^Mật khẩu tạm/ })).toHaveCount(0);
  });

  test('temporary password never reaches the console, the URL or storage', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(String(e)));
    await openUsers(page);
    const dialog = await openCreateAccount(page);
    await dialog.getByLabel(/^Username/).fill('hr.qa77');
    await dialog.getByRole('button', { name: 'Tạo và hiện mật khẩu tạm' }).click();
    const secret = page.getByRole('dialog', { name: 'Mật khẩu tạm của hr.qa77' });
    await expect(secret.getByLabel('Mật khẩu tạm')).toHaveText(FIXED_TEMP_PASSWORD);
    // The create dialog closed: only the secret dialog is open.
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    expect(page.url()).not.toContain(FIXED_TEMP_PASSWORD);
    expect(await persistedState(page)).not.toContain(FIXED_TEMP_PASSWORD);
    await page.keyboard.press('Escape');
    await expect(secret).toHaveCount(0);
    expect(logs.join('\n')).not.toContain(FIXED_TEMP_PASSWORD);
    // Reopening the create dialog starts empty.
    const again = await openCreateAccount(page);
    await expect(again.getByLabel(/^Username/)).toHaveValue('');
  });
});

/** Records whether any skeleton block was ever attached, from the first script of the page. */
async function watchSkeleton(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __skeletonSeen: boolean };
    w.__skeletonSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-skeleton]')) w.__skeletonSeen = true;
    }).observe(document, { childList: true, subtree: true });
  });
}

/** Holds every data request (not the signed-in profile) until released. */
async function holdData(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(`${SUPABASE_ORIGIN}/{rest,functions}/**`, async (route, request) => {
    if (!new URL(request.url()).pathname.startsWith('/rest/v1/profiles')) await gate;
    await route.fallback();
  });
  return release;
}

test.describe('loading skeleton (AC-UI-56)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a fast answer never flashes a skeleton (flow list)', async ({ page }) => {
    await watchSkeleton(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: /^Chạy flow Đối chiếu/ })).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __skeletonSeen: boolean }).__skeletonSeen),
    ).toBe(false);
  });

  test.describe('admin', () => {
    test.use({ signedInAs: ADMIN });

    test('a fast answer never flashes a skeleton (users)', async ({ page }) => {
      await watchSkeleton(page);
      await page.goto('/admin/users');
      await expect(usersTable(page)).toBeVisible();
      expect(
        await page.evaluate(
          () => (window as unknown as { __skeletonSeen: boolean }).__skeletonSeen,
        ),
      ).toBe(false);
    });

    test('users: title does not move and layout shift stays small when data arrives', async ({
      page,
    }) => {
      const release = await holdData(page);
      await page.goto('/admin/users');
      await expect(page.locator('[data-skeleton]').first()).toBeVisible();
      const h1 = page.getByRole('heading', { level: 1 });
      const before = (await h1.boundingBox())!;
      const cardBefore = (await page
        .locator('[data-loading] [data-skeleton]')
        .first()
        .boundingBox())!;
      await page.evaluate(() => {
        const w = window as unknown as { __cls: number };
        w.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { value: number }[]) w.__cls += e.value;
        }).observe({ type: 'layout-shift', buffered: false });
      });
      release();
      await expect(usersTable(page)).toBeVisible();
      await expect(page.locator('[data-loading]')).toHaveCount(0);
      const after = (await h1.boundingBox())!;
      expect(after.y).toBe(before.y);
      expect(after.x).toBe(before.x);
      const cardAfter = (await page.locator('main [data-card]').first().boundingBox())!;
      // The table card starts where the skeleton card started (no big jump).
      expect(Math.abs(cardAfter.y - cardBefore.y)).toBeLessThan(40);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls).toBeLessThan(0.1);
    });
  });
});

test.describe('designer top bar at 1024px (AC-UI-52, narrower than the AC)', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1024, height: 768 } });

  test('title and toolbar fit the row without overflowing the viewport', async ({
    page,
    supabase,
  }) => {
    supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
    supabase.versions.push({
      id: '00000000-0000-4000-8000-000000000777',
      flow_id: '00000000-0000-4000-8000-0000000000f1',
      version_no: 2,
      status: 'draft',
      effective_from: '',
      effective_to: null,
      definition: baseFlowDefinition(),
      published_at: null,
      updated_at: '2026-10-27T01:00:00.000001+00:00',
    });
    await page.goto('/admin/flows/payroll-timesheet/designer');
    const toolbar = page.getByRole('toolbar', { name: 'Thao tác trên flow' });
    await expect(toolbar).toBeVisible({ timeout: 30_000 });
    const tb = (await toolbar.boundingBox())!;
    expect(tb.x + tb.width).toBeLessThanOrEqual(1024);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const name of ['Hoàn tác', 'Làm lại', 'Sao chép', 'Dán', 'Xóa']) {
      await expect(toolbar.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
  });
});
