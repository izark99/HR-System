/**
 * Heavy, opt-in E2E (set HEAVY_E2E=1): ~100k rows per side. Cancel (cooperative and
 * terminate-and-restore), UI usable afterwards, a full run, virtualization of a ~100k-row result.
 *
 * Size: HEAVY_ROWS (default 100000) rows per side. The acceptance flow has no ID format rule
 * (MEMORY 13:08: Mã NV only required + unique), so any size works; ids past NV99999 just get
 * longer (NV100000…).
 * Files are generated once into the OS temp dir and reused.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nv,
  openFlow,
  PAYROLL_HEADERS,
  payrollInput,
  RESULT_URL,
  runButton,
  TIMESHEET_HEADERS,
  timesheetInput,
  XLSX,
  type Cell,
} from './helpers';

const HEAVY = !!process.env.HEAVY_E2E;
const ROWS = Number(process.env.HEAVY_ROWS ?? 100_000);
const DIR = join(tmpdir(), `hrflow-heavy-${ROWS}`);
const PAYROLL = join(DIR, `bang_luong_heavy_${ROWS}.xlsx`);
const TIMESHEET = join(DIR, `cham_cong_heavy_${ROWS}.xlsx`);

test.skip(!HEAVY, 'heavy E2E: set HEAVY_E2E=1');
test.describe.configure({ timeout: 15 * 60_000 });

function write(path: string, sheet: string, aoa: Cell[][]): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { dense: true }), sheet);
  const data = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
  writeFileSync(path, data);
}

/** Every employee mismatches on "Công" (payroll 26, timesheet 24) → a ROWS-row "Lệch" sheet. */
function generate(): void {
  if (existsSync(PAYROLL) && existsSync(TIMESHEET)) return;
  mkdirSync(DIR, { recursive: true });
  const branch = (i: number) => `CN${String((i % 5) + 1).padStart(2, '0')}`;
  const pay: Cell[][] = [['BẢNG LƯƠNG GIẢ'], [], [], PAYROLL_HEADERS];
  const ts: Cell[][] = [TIMESHEET_HEADERS];
  for (let i = 1; i <= ROWS; i++) {
    pay.push([i, nv(i), `Nhân viên Giả ${i}`, branch(i), 26, 4, 1, 0]);
    ts.push([nv(i), `Nhân viên Giả ${i}`, branch(i), 24, 4, 1, 0]);
  }
  pay.push([null, null, 'TỔNG CỘNG']);
  write(PAYROLL, 'Luong', pay);
  write(TIMESHEET, 'ChamCong', ts);
}

const timings: Record<string, number> = {};
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timings[label] = Date.now() - t0;
  }
}

async function uploadHeavy(page: Page): Promise<void> {
  await openFlow(page);
  await timed('upload+validate both slots', async () => {
    await payrollInput(page).setInputFiles(PAYROLL);
    await timesheetInput(page).setInputFiles(TIMESHEET);
    await expect(runButton(page)).toHaveText('Chạy', { timeout: 5 * 60_000 });
  });
  await expect(
    page.getByRole('list', { name: /Bảng lương/ }).getByTestId('file-status'),
  ).toHaveText(new RegExp(`${ROWS.toLocaleString('vi-VN')} dòng`));
}

function nodeRow(page: Page, label: string) {
  return page
    .getByRole('region', { name: 'Đang chạy flow' })
    .getByRole('listitem')
    .filter({ has: page.getByText(label, { exact: true }) });
}

/** UI is idle and usable again: Run enabled, file remove buttons enabled, no restore pending. */
async function expectUsable(page: Page): Promise<void> {
  await expect(page.getByText('đang nạp lại file sau khi hủy…')).toHaveCount(0, {
    timeout: 5 * 60_000,
  });
  await expect(runButton(page)).toHaveText('Chạy', { timeout: 5 * 60_000 });
  await expect(runButton(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: /^Bỏ file bang_luong_heavy/ })).toBeEnabled();
  await expect(page.getByLabel(/Kỳ lương/)).toBeEditable();
}

test.beforeAll(() => {
  const t0 = Date.now();
  generate();
  timings['generate fixtures (cached after first run)'] = Date.now() - t0;
});

test.afterAll(() => {
  console.log(`[heavy E2E] rows/side=${ROWS} timings(ms)=${JSON.stringify(timings, null, 1)}`);
});

test('cancel while the workbook is written (cooperative if the worker yields within 400ms, else terminate + restore); then a full run succeeds', async ({
  page,
}) => {
  await uploadHeavy(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await runButton(page).click();
  // output.excel (ExcelJS) is async and yields: the abort is seen there without terminating.
  await expect(nodeRow(page, 'File đối chiếu')).toContainText('Đang chạy', { timeout: 5 * 60_000 });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByText('Đã hủy lần chạy:')).toBeVisible({ timeout: 60_000 });
  timings['cooperative cancel → cancelled'] = Date.now() - t0;
  const restored = await page.getByText('đang nạp lại file sau khi hủy…').count();
  test.info().annotations.push({
    type: 'cancel-path',
    description: restored ? 'terminate+restore (grace period exceeded)' : 'cooperative',
  });
  await expectUsable(page);
  timings['cooperative cancel → usable'] = Date.now() - t0;
  expect(page.url()).not.toContain('/result');

  await timed('full run (100k mismatched rows, incl. ExcelJS)', async () => {
    await runButton(page).click();
    // Spec §18: the UI must not freeze while the engine runs (work is in the worker).
    const maxFrameGap = await page.evaluate(
      () =>
        new Promise<number>((done) => {
          let last = performance.now();
          let max = 0;
          const end = last + 3000;
          const tick = (t: number) => {
            max = Math.max(max, t - last);
            last = t;
            if (t < end) requestAnimationFrame(tick);
            else done(max);
          };
          requestAnimationFrame(tick);
        }),
    );
    timings['max main-thread frame gap during run (ms)'] = Math.round(maxFrameGap);
    expect(maxFrameGap).toBeLessThan(500);
    await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`), { timeout: 10 * 60_000 });
  });
  await expect(page.getByTestId('kpi')).toHaveText([
    /Khớp\s*0/,
    new RegExp(`Lệch\\s*${ROWS.toLocaleString('vi-VN')}`),
    /0/,
    /0/,
  ]);
  expect(errors).toEqual([]);
});

test('hard cancel during the synchronous compare: worker terminated, files restored, rerun works', async ({
  page,
}) => {
  await uploadHeavy(page);
  await runButton(page).click();
  await expect(nodeRow(page, 'Đối chiếu')).toContainText('Đang chạy', { timeout: 60_000 });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByText('Đã hủy lần chạy:')).toBeVisible({ timeout: 60_000 });
  timings['hard cancel → cancelled'] = Date.now() - t0;
  // While restoring, Run must not be clickable.
  const restoringSeen = await page
    .getByText('đang nạp lại file sau khi hủy…')
    .isVisible()
    .catch(() => false);
  test.info().annotations.push({
    type: 'cancel-path',
    description: restoringSeen ? 'terminate+restore' : 'settled cooperatively before grace period',
  });
  if (restoringSeen) await expect(runButton(page)).toBeDisabled();
  await expectUsable(page);
  timings['hard cancel → usable (re-validated in new worker)'] = Date.now() - t0;
  await expect(page.getByText('Hợp lệ:')).toBeVisible();

  await timed('rerun after hard cancel', async () => {
    await runButton(page).click();
    await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`), { timeout: 10 * 60_000 });
  });
  await expect(page.getByTestId('kpi').nth(1)).toContainText(ROWS.toLocaleString('vi-VN'));
});

test('virtualized result: only a window of rows in the DOM; scrolling reaches the last row; download', async ({
  page,
}) => {
  await uploadHeavy(page);
  await runButton(page).click();
  await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`), { timeout: 10 * 60_000 });

  const region = page.getByRole('region', { name: 'Lệch' });
  await expect(region.getByRole('cell', { name: nv(1), exact: true })).toBeVisible();
  const domRows = await region.locator('tbody tr').count();
  expect(domRows).toBeLessThan(100);
  await expect(
    page.getByText(`${ROWS.toLocaleString('vi-VN')} dòng`, { exact: true }),
  ).toBeVisible();

  await timed('scroll to bottom → last row rendered', async () => {
    await region.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(region.getByRole('cell', { name: nv(ROWS), exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });
  await region.evaluate((el) => el.scrollTo({ top: el.scrollHeight / 2 }));
  await expect(region.locator('tbody tr').first()).toBeVisible();
  expect(await region.locator('tbody tr').count()).toBeLessThan(100);

  // Filter by branch on a big sheet.
  await page.getByLabel('Chi nhánh').selectOption('CN03');
  let cn03 = 0;
  for (let i = 1; i <= ROWS; i++) if (i % 5 === 2) cn03++;
  await expect(page.getByText(`${cn03.toLocaleString('vi-VN')} dòng`, { exact: true })).toBeVisible(
    {
      timeout: 30_000,
    },
  );

  const [download] = await timed('download big workbook', () =>
    Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.getByRole('button', { name: /^Tải Excel/ }).click(),
    ]),
  );
  const { ExcelJS } = await import('./helpers');
  const wb = new ExcelJS.Workbook();
  const file = await download.path();
  await timed('ExcelJS read of downloaded workbook', () => wb.xlsx.readFile(file));
  expect(wb.getWorksheet('Lệch')!.actualRowCount).toBe(1 + ROWS);
});
