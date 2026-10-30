/**
 * QA re-measurement of AC-B3-24 in Chromium (opt-in, HEAVY_E2E=1; rows: HEAVY_AC24_ROWS, default
 * 100000): 30-column workbook → filter → join → groupBy → output.excel, run twice in the same
 * browser context. Run 1 downloads, verifies and instantiates DuckDB (cold); after a reload run 2
 * finds the .wasm parts in Cache Storage (warm). Reports read+validate time and run time for
 * both, so "< 10 s excluding the first DuckDB load" can be judged with and without the
 * per-session instantiate. Fake data only.
 */
import { expect, test } from './fixtures';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  perfBranchAoa,
  perfFlow,
  writePerfWorkbook,
} from '../apps/web/src/engine/__tests__/perf-flow';
import { ExcelJS, XLSX } from './helpers';

const HEAVY = !!process.env.HEAVY_E2E;
const ROWS = Number(process.env.HEAVY_AC24_ROWS ?? 100_000);
const DIR = join(tmpdir(), 'hrflow-heavy-ac24');
const DATA = join(DIR, `du_lieu_${ROWS}.xlsx`);
const BRANCHES = join(DIR, 'chi_nhanh.xlsx');

test.skip(!HEAVY, 'heavy E2E: set HEAVY_E2E=1');
test.describe.configure({ timeout: 30 * 60_000 });

test.beforeAll(async () => {
  test.setTimeout(30 * 60_000);
  mkdirSync(DIR, { recursive: true });
  if (!existsSync(BRANCHES)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perfBranchAoa()), 'ChiNhanh');
    writeFileSync(BRANCHES, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  }
  if (!existsSync(DATA)) await writePerfWorkbook(ExcelJS, DATA, ROWS);
});

test(`AC-B3-24: ${ROWS} rows x 30 columns, cold and warm DuckDB`, async ({ page, supabase }) => {
  supabase.setVersions([{ no: 1, from: '2026-01-01', definition: perfFlow() }]);
  const timings: Record<string, number> = {};
  const crashed: string[] = [];
  page.on('crash', () => crashed.push('page crashed'));
  page.on('pageerror', (e) => crashed.push(e.message));

  for (const pass of ['cold', 'warm'] as const) {
    await page.goto('/run/payroll-timesheet');
    await expect(page.getByLabel(/^Chọn file cho Dữ liệu nhân sự/)).toBeAttached();
    const run = page.getByRole('button', { name: /^(Chạy|Đang)/ }).last();

    const t0 = Date.now();
    await page.getByLabel(/^Chọn file cho Danh mục chi nhánh/).setInputFiles(BRANCHES);
    await page.getByLabel(/^Chọn file cho Dữ liệu nhân sự/).setInputFiles(DATA);
    await expect(run).toHaveText('Chạy', { timeout: 20 * 60_000 });
    await expect(run).toBeEnabled();
    timings[`${pass}: read + validate`] = Date.now() - t0;

    const t1 = Date.now();
    await run.click();
    await expect(page).toHaveURL(/\/result$/, { timeout: 20 * 60_000 });
    await expect(page.getByRole('tab', { name: /Tổng hợp/ })).toBeVisible();
    timings[`${pass}: run (click -> result)`] = Date.now() - t1;
    timings[`${pass}: read + run`] = Date.now() - t0;
  }
  const cache = await page.evaluate(async () => (await caches.keys()).length);
  expect(cache).toBe(1);
  console.log(`[AC-B3-24 Chromium] rows=${ROWS} timings(ms)=${JSON.stringify(timings, null, 1)}`);
  expect(crashed).toEqual([]);
});
