/**
 * Cancel → restore → run again (spec §13 "Cancel bất kỳ lúc nào"), at a size that runs in the
 * default suite: 12k mismatched rows per side keep the run busy for a moment (compare + ExcelJS)
 * so Hủy lands mid-run. Whether the cancel ends cooperatively or by terminate + restore, the UI
 * must become usable again and a second run must succeed. Fake data only.
 */
import { expect, test } from '@playwright/test';
import {
  employees,
  openFlow,
  payroll,
  payrollInput,
  RESULT_URL,
  runButton,
  timesheet,
  timesheetInput,
} from './helpers';

const ROWS = 12_000;

test('cancel mid-run, files are restored, a second run succeeds', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openFlow(page);
  // Payroll says 26 days, timesheet 24: every employee lands on "Lệch".
  await payrollInput(page).setInputFiles([payroll('bang_luong_lon.xlsx', employees(ROWS))]);
  await timesheetInput(page).setInputFiles([
    timesheet('cham_cong_lon.xlsx', employees(ROWS, 1, 'CN01', 24)),
  ]);
  await expect(runButton(page)).toHaveText('Chạy', { timeout: 30_000 });

  await runButton(page).click();
  await page.getByRole('button', { name: 'Hủy', exact: true }).click({ timeout: 5_000 });
  await expect(page.getByText('Đã hủy lần chạy:')).toBeVisible({ timeout: 30_000 });
  const path = (await page.getByText('đang nạp lại file sau khi hủy…').count())
    ? 'terminate+restore'
    : 'cooperative';
  test.info().annotations.push({ type: 'cancel-path', description: path });
  expect(page.url()).not.toContain('/result');

  // Restored: no pending restore, Run enabled again, files still listed and valid.
  await expect(page.getByText('đang nạp lại file sau khi hủy…')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(runButton(page)).toHaveText('Chạy', { timeout: 30_000 });
  await expect(runButton(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Bỏ file bang_luong_lon.xlsx' })).toBeEnabled();

  await runButton(page).click();
  await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`), { timeout: 60_000 });
  await expect(page.getByTestId('kpi').nth(1)).toContainText(ROWS.toLocaleString('vi-VN'));
  expect(errors).toEqual([]);
});
