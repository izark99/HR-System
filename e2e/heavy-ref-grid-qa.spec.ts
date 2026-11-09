/**
 * QA timing of the reference table grid at the version limit (spec §34 AC-RT-04: 50,000 rows must
 * not freeze the page). Opt-in: HEAVY_E2E=1 (HEAVY_REF_CPU = CPU slowdown, default 4). Prints the
 * timings; fails only past generous bounds. Fake branch rows only.
 */
import { ADMIN, expect, test } from './fixtures';

const HEAVY = !!process.env.HEAVY_E2E;
const CPU = Number(process.env.HEAVY_REF_CPU ?? 4);
const ROWS = 50_000;

test.skip(!HEAVY, 'heavy E2E: set HEAVY_E2E=1');
test.use({ signedInAs: ADMIN });

test(`grid with ${ROWS} rows at CPU ×${CPU}: open, edit a cell, search, save`, async ({
  page,
  supabase,
}) => {
  test.setTimeout(300_000);
  const rows = Array.from({ length: ROWS }, (_, i) => ({
    ma_cn: `CN${String(i + 1).padStart(5, '0')}`,
    ten_cn: `Chi nhánh giả ${i + 1}`,
    vung: (i % 4) + 1,
  }));
  supabase.ref.seed({ code: 'DM_LON', name: 'Danh mục lớn', draft: rows });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

  const grid = page.getByRole('region', { name: /^Dữ liệu v\d+$/ });
  const cell = (c: string, r: number) =>
    grid.getByRole('textbox', { name: `${c}, dòng ${r}`, exact: true });
  const status = page.locator('[data-grid-status]');
  const timings: Record<string, number> = {};
  const time = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    await fn();
    timings[name] = Date.now() - t0;
  };

  await page.goto('/admin/ref-tables');
  await time('open data page', async () => {
    await page.goto('/admin/ref-tables/DM_LON/versions/1');
    await expect(cell('Tên chi nhánh', 1)).toBeVisible({ timeout: 120_000 });
  });
  timings['rows drawn'] = await grid.locator('tbody tr').count();
  await time('edit one cell (commit → status)', async () => {
    await cell('Tên chi nhánh', 2).fill('Đổi tên');
    await cell('Tên chi nhánh', 2).press('Enter');
    await expect(status).toHaveText(/^1 ô sửa/, { timeout: 60_000 });
  });
  await time('keystroke latency (type 10 chars)', async () => {
    await cell('Tên chi nhánh', 3).click();
    await page.keyboard.type('abcdefghij');
    await expect(cell('Tên chi nhánh', 3)).toHaveValue(/abcdefghij$/);
  });
  await cell('Tên chi nhánh', 3).press('Escape');
  await time('search', async () => {
    await page.getByLabel('Tìm trong dữ liệu').fill('CN49999');
    await expect(grid.locator('tbody tr')).toHaveCount(1, { timeout: 60_000 });
  });
  await page.getByLabel('Tìm trong dữ liệu').fill('');
  await time('save', async () => {
    await page.getByRole('button', { name: 'Lưu draft' }).click();
    await expect(page.getByText('Đã lưu draft v1.')).toBeVisible({ timeout: 120_000 });
  });
  console.log(`[ref grid ${ROWS} rows, CPU ×${CPU}] ${JSON.stringify(timings)}`);
  expect(supabase.ref.draftOf('DM_LON')!.rows).toHaveLength(ROWS);
  expect(timings['keystroke latency (type 10 chars)']).toBeLessThan(10_000);
});
