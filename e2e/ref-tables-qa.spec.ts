/**
 * Verifier checks of reference tables on the run page (spec §34 AC-RT-15 c, d; data-privacy.md),
 * written from the requirements: reference rows never leave the page (no off-origin request, no
 * request body to Supabase carrying a row, no console line, nothing in Web Storage / IndexedDB /
 * Cache Storage / URL); "Xem bảng" by keyboard (focus kept in the dialog, Esc, focus back) and at
 * 390px; a 50,000-row table (the per-version limit) stays usable. Supabase mocked, fake data only.
 */
import { expect, SUPABASE_ORIGIN, test, type Page } from './fixtures';
import { fixtures, payrollInput, runButton, timesheetInput } from './helpers';
import { openRefFlow, refBox, seedRefRun } from './ref-run-helpers';
import { branchRows } from './supabase-mock-ref';

/** Branch names of the fake list: any of them outside the page memory is a leak. */
const NAMES = ['Hồ Chí Minh', 'Hà Nội', 'Cần Thơ', 'Đà Nẵng', 'Hậu Giang', 'Bình Dương'];

function watch(page: Page) {
  const external: string[] = [];
  const bodies: string[] = [];
  const consoleLines: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (
      url.hostname !== 'localhost' &&
      url.origin !== SUPABASE_ORIGIN &&
      url.protocol !== 'blob:' &&
      url.protocol !== 'data:'
    ) {
      external.push(`${req.method()} ${url.origin}`);
    }
    if (url.origin === SUPABASE_ORIGIN) bodies.push(`${req.url()} ${req.postData() ?? ''}`);
  });
  page.on('console', (m) => consoleLines.push(m.text()));
  return { external, bodies, consoleLines };
}

async function storageDump(page: Page) {
  return page.evaluate(async () => {
    const cacheUrls: string[] = [];
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) cacheUrls.push(req.url);
    }
    return {
      web: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
      dbs: (await indexedDB.databases()).map((d) => d.name ?? ''),
      cacheUrls,
      url: location.href,
      title: document.title,
    };
  });
}

test.describe('reference tables: privacy and "Xem bảng" (verifier)', () => {
  test('rows stay in page memory: no leak to requests, console, storage, caches or URL', async ({
    page,
    supabase,
  }) => {
    test.setTimeout(120_000);
    const w = watch(page);
    seedRefRun(supabase);
    await openRefFlow(page, '2026-09');
    await refBox(page).getByRole('button', { name: 'Xem bảng Danh mục chi nhánh' }).click();
    const dialog = page.getByRole('dialog', { name: 'Danh mục chi nhánh' });
    await dialog.getByRole('searchbox', { name: 'Tìm trong bảng' }).fill('ha noi');
    await expect(dialog.locator('tbody tr').first()).toContainText('Hà Nội');
    // The search text does not land in the URL either.
    expect(page.url()).not.toContain('noi');
    await dialog.locator('[data-dialog-footer]').getByRole('button', { name: 'Đóng' }).click();
    await expect(dialog).toHaveCount(0);

    await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
    await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
    await expect(runButton(page)).toHaveText('Chạy', { timeout: 30_000 });
    await runButton(page).click();
    await page.waitForURL(/\/result$/, { timeout: 60_000 });
    await expect.poll(() => supabase.runLogs.length).toBe(1);

    expect(w.external).toEqual([]);
    for (const n of NAMES) {
      for (const b of w.bodies) expect(b, 'request to Supabase').not.toContain(n);
      for (const l of w.consoleLines) expect(l, 'console').not.toContain(n);
    }
    const s = await storageDump(page);
    for (const n of NAMES) {
      expect(s.web).not.toContain(n);
      expect(decodeURIComponent(s.url)).not.toContain(n);
    }
    expect(s.web).not.toContain('ma_cn');
    expect(s.dbs).toEqual([]);
    // Cache Storage only holds the app's own assets (DuckDB parts), never a Supabase answer.
    for (const u of s.cacheUrls) expect(new URL(u).origin).not.toBe(SUPABASE_ORIGIN);
    expect(s.cacheUrls.filter((u) => u.includes('ref_table'))).toEqual([]);
  });

  test('"Xem bảng" by keyboard: focus stays inside, Esc closes, focus returns', async ({
    page,
    supabase,
  }) => {
    seedRefRun(supabase);
    await openRefFlow(page, '2026-09');
    const open = refBox(page).getByRole('button', { name: 'Xem bảng Danh mục chi nhánh' });
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Danh mục chi nhánh' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('searchbox')).toBeVisible();
    // Native modal <dialog>: Tab may step out to the browser UI (activeElement = body) but never
    // onto the page behind the dialog.
    const inside = () =>
      dialog.evaluate(
        (d) => d.contains(document.activeElement) || document.activeElement === document.body,
      );
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await inside(), `Tab ${i + 1} keeps the focus in the dialog`).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true);
    }
    // In the search box the first Esc clears the text (native search field), the next one closes.
    const search = dialog.getByRole('searchbox');
    await search.fill('can tho');
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(dialog).toBeVisible();
    await search.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('"Xem bảng" at 390px fits the screen and its table scrolls inside', async ({
    page,
    supabase,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    seedRefRun(supabase);
    await openRefFlow(page, '2026-09');
    await refBox(page).getByRole('button', { name: 'Xem bảng Danh mục chi nhánh' }).click();
    const dialog = page.getByRole('dialog', { name: 'Danh mục chi nhánh' });
    await expect(dialog.locator('tbody tr').first()).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const close = dialog.locator('[data-dialog-footer]').getByRole('button', { name: 'Đóng' });
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport();
  });

  test('a 50,000-row table: run page, "Xem bảng" search and run stay responsive', async ({
    page,
    supabase,
  }) => {
    test.setTimeout(180_000);
    seedRefRun(supabase);
    const v2 = supabase.ref.versions.find((v) => v.id === 'reftbl-1-v2')!;
    v2.rows = branchRows(50_000);
    await openRefFlow(page, '2026-09');
    await expect(refBox(page)).toHaveAttribute('role', 'status');
    await expect(refBox(page)).toContainText('Danh mục chi nhánh · v2');

    let t0 = Date.now();
    await refBox(page).getByRole('button', { name: 'Xem bảng Danh mục chi nhánh' }).click();
    const dialog = page.getByRole('dialog', { name: 'Danh mục chi nhánh' });
    await expect(
      dialog.getByText('50000 / 50000 dòng').or(dialog.getByText('50.000 / 50.000 dòng')),
    ).toBeVisible();
    const openMs = Date.now() - t0;
    await expect(dialog.locator('tbody tr')).toHaveCount(100);

    const expected = branchRows(50_000).filter((r) => r.ten_cn === 'Đà Nẵng').length;
    t0 = Date.now();
    await dialog.getByRole('searchbox', { name: 'Tìm trong bảng' }).fill('da nang');
    await expect(dialog.locator('tbody tr').first()).toContainText('Đà Nẵng');
    await expect(dialog).toContainText(`/ 50`);
    const searchMs = Date.now() - t0;
    await expect(dialog.locator('tbody tr')).toHaveCount(100);
    expect(expected).toBeGreaterThan(100);
    // Each keystroke re-filters 50k rows on the main thread: measure one character.
    t0 = Date.now();
    await dialog.getByRole('searchbox').press('Backspace');
    await expect(dialog.locator('tbody tr').first()).toBeVisible();
    const keyMs = Date.now() - t0;
    console.log(`[perf] Xem bảng 50k: open ${openMs} ms, search ${searchMs} ms, key ${keyMs} ms`);
    expect(openMs).toBeLessThan(5_000);
    expect(searchMs).toBeLessThan(3_000);
    await dialog.locator('[data-dialog-footer]').getByRole('button', { name: 'Đóng' }).click();
    await expect(dialog).toHaveCount(0);

    await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
    await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
    await expect(runButton(page)).toHaveText('Chạy', { timeout: 30_000 });
    t0 = Date.now();
    await runButton(page).click();
    await page.waitForURL(/\/result$/, { timeout: 120_000 });
    console.log(`[perf] run with a 50k-row reference table: ${Date.now() - t0} ms`);
    await expect.poll(() => supabase.runLogs.length).toBe(1);
    expect(supabase.runLogs[0]).toMatchObject({ status: 'succeeded' });
  });
});
