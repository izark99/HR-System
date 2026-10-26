import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname, '../fixtures/payroll-timesheet');

function fixtures(prefix: string): string[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((f) => join(FIXTURES, f));
}

/** Requests leaving localhost. Google Fonts is blocked in tests (offline-safe, and not data). */
function trackExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    const fonts = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
    if (
      url.hostname !== 'localhost' &&
      !fonts &&
      url.protocol !== 'blob:' &&
      url.protocol !== 'data:'
    ) {
      external.push(`${req.method()} ${url.origin}`);
    }
  });
  return external;
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
});

test('acceptance flow: upload 6 fixtures, run, see 63/9/3/3, download the workbook', async ({
  page,
}) => {
  const external = trackExternalRequests(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Chọn quy trình cần chạy hôm nay',
  );
  await expect(page.getByText('Chưa có lần chạy')).toBeVisible();
  await page.getByRole('link', { name: /^Chạy flow Đối chiếu bảng lương/ }).click();

  await expect(page).toHaveURL(/\/run\/payroll-timesheet$/);
  const runButton = page.getByRole('button', { name: /^Chạy/ }).last();
  await expect(runButton).toBeDisabled();

  await page.getByLabel(/Kỳ lương/).fill('2026-09');
  await page.getByLabel(/^Chọn file cho Bảng lương/).setInputFiles(fixtures('bang_luong_'));
  await page.getByLabel(/^Chọn file cho Chấm công/).setInputFiles(fixtures('cham_cong_'));

  const payrollFiles = page.getByRole('list', { name: /File đã chọn cho Bảng lương/ });
  await expect(payrollFiles.getByRole('listitem')).toHaveCount(3);
  await expect(payrollFiles.getByTestId('file-status')).toHaveText([
    '30 dòng',
    '25 dòng',
    '20 dòng',
  ]);
  await expect(page.getByText('Hợp lệ:')).toBeVisible();
  await expect(page.getByText('3 dòng đã bỏ qua')).toBeVisible();

  await expect(runButton).toHaveText('Chạy');
  await expect(runButton).toBeEnabled();
  await runButton.click();

  await expect(page).toHaveURL(/\/run\/payroll-timesheet\/result$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Kỳ 09/2026 có 9 nhân viên lệch cần xử lý',
  );
  const kpis = page.getByTestId('kpi');
  await expect(kpis).toHaveText([/Khớp\s*63/, /Lệch\s*9/, /lương\s*3/, /chấm công\s*3/]);

  await expect(page.getByRole('tab', { selected: true })).toHaveText('Lệch (9)');
  const table = page.getByRole('region', { name: 'Lệch' });
  await expect(table.getByRole('row')).toHaveCount(1 + 9);
  await expect(table.getByRole('cell', { name: 'NV00001', exact: true })).toBeVisible();

  await page.getByLabel('Chi nhánh').selectOption('CN01');
  await expect(page.getByRole('region', { name: 'Lệch' }).getByRole('row')).toHaveCount(1 + 3);
  await page.getByLabel('Chi nhánh').selectOption('');

  await page.getByRole('tab', { name: 'Chỉ có trong lương (3)' }).click();
  await expect(
    page.getByRole('region', { name: 'Chỉ có trong lương' }).getByRole('row'),
  ).toHaveCount(1 + 3);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải Excel (4 sheet)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('DoiChieu_092026.xlsx');
  const path = await download.path();
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // .xlsx = zip

  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
