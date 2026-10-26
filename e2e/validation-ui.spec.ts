/**
 * Validation report in the run wizard (spec §10, §15.1 step 4; AC-07, AC-08; MEMORY 08:59/09:12).
 * Files are built in memory with SheetJS; fake data only.
 */
import { expect, test, type Page } from './fixtures';
import {
  employees,
  fixtures,
  nv,
  openFlow,
  PAYROLL_HEADERS,
  payroll,
  payrollInput,
  payrollList,
  reportCard,
  RESULT_URL,
  runButton,
  timesheet,
  timesheetInput,
  timesheetList,
  TIMESHEET_HEADERS,
  workbook,
  XLSX,
  payrollAoa,
  type UploadPayload,
} from './helpers';

/** Upload the 3 timesheet fixtures so only the payroll slot decides readiness. */
async function withTimesheets(page: Page): Promise<void> {
  await openFlow(page);
  await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
  await expect(timesheetList(page).getByTestId('file-status')).toHaveText([
    /\d+ dòng/,
    /\d+ dòng/,
    /\d+ dòng/,
  ]);
}

function reportRows(page: Page) {
  return reportCard(page).locator('tbody tr');
}

async function uploadPayroll(page: Page, files: UploadPayload[]): Promise<void> {
  await payrollInput(page).setInputFiles(files);
  await expect(payrollList(page).getByTestId('file-status').first()).not.toHaveText(
    'Đang kiểm tra…',
  );
}

test('AC-07: duplicate Mã NV across two files names both file + row and blocks Run', async ({
  page,
}) => {
  await withTimesheets(page);
  await uploadPayroll(page, [
    payroll('luong_A.xlsx', employees(5, 1)), // NV00001..NV00005, NV00005 on Excel row 9
    payroll('luong_B.xlsx', employees(3, 5, 'CN02')), // NV00005 again on Excel row 5
  ]);
  const rows = reportRows(page);
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row.getByRole('cell').nth(0)).toHaveText('Lỗi');
  await expect(row).toContainText('Mã NV');
  await expect(row).toContainText('luong_A.xlsx dòng 9');
  await expect(row).toContainText('luong_B.xlsx dòng 5');
  await expect(row).toContainText('NV00005');
  // MEMORY 13:08: the duplicate marks BOTH files, while the report counts it once.
  await expect(payrollList(page).getByTestId('file-status')).toHaveText(['1 lỗi', '1 lỗi']);
  await expect(reportCard(page).getByText('1 lỗi', { exact: true })).toBeVisible();
  await expect(runButton(page)).toHaveText('Chạy (sửa 1 lỗi trước)');
  await expect(runButton(page)).toBeDisabled();
});

test('duplicate Mã NV differing only by case/whitespace is still a duplicate (MEMORY 09:12)', async ({
  page,
}) => {
  await withTimesheets(page);
  const b = employees(1, 99, 'CN02');
  b[0]![0] = '  nv00002 ';
  await uploadPayroll(page, [payroll('luong_A.xlsx', employees(3, 1)), payroll('luong_B.xlsx', b)]);
  // The acceptance flow has no ID format rule (MEMORY 13:08): only the duplicate is reported.
  await expect(reportCard(page)).toContainText('bị trùng giá trị');
  await expect(reportCard(page)).toContainText('luong_A.xlsx dòng 6');
  await expect(runButton(page)).toBeDisabled();
});

test('AC-08: missing key column gives exactly one "thiếu cột" error naming file + column', async ({
  page,
}) => {
  await withTimesheets(page);
  const headers = [...PAYROLL_HEADERS];
  headers[1] = 'Mã số'; // not an alias of ma_nv
  await uploadPayroll(page, [payroll('thieu_cot.xlsx', employees(10), { headers })]);
  const rows = reportRows(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('thieu_cot.xlsx');
  await expect(rows.first()).toContainText('thiếu cột bắt buộc "Mã NV"');
  await expect(payrollList(page).getByTestId('file-status')).toHaveText('1 lỗi');
  await expect(runButton(page)).toBeDisabled();
});

test('missing metric column (presence required) is an error', async ({ page }) => {
  await withTimesheets(page);
  const headers = PAYROLL_HEADERS.filter((h) => h !== 'Giờ OT');
  const rows = employees(4).map((r) => [r[0], r[1], r[2], r[3], r[5], r[6]] as const);
  await uploadPayroll(page, [
    workbook('thieu_ot.xlsx', {
      Luong: [['BẢNG LƯƠNG'], [], [], headers, ...rows.map((r, i) => [i + 1, ...r])],
    }),
  ]);
  await expect(reportRows(page).filter({ hasText: 'thiếu cột bắt buộc "OT (giờ)"' })).toHaveCount(
    1,
  );
  await expect(runButton(page)).toBeDisabled();
});

test('wrong sheet name: error names the expected sheet, Run blocked', async ({ page }) => {
  await withTimesheets(page);
  await uploadPayroll(page, [payroll('sai_sheet.xlsx', employees(5), { sheet: 'Sheet1' })]);
  await expect(reportRows(page)).toHaveCount(1);
  await expect(reportRows(page).first()).toContainText(
    'File sai_sheet.xlsx: không tìm thấy sheet "Luong"',
  );
  await expect(runButton(page)).toBeDisabled();
});

test('0-byte .xlsx file: reported as unreadable, Run blocked, UI usable', async ({ page }) => {
  await withTimesheets(page);
  await uploadPayroll(page, [
    { name: 'rong.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) },
  ]);
  await expect(reportRows(page).first()).toContainText('rong.xlsx');
  await expect(
    reportCard(page)
      .getByText(/^\d+ lỗi$/)
      .first(),
  ).not.toHaveText('0 lỗi');
  await expect(runButton(page)).toBeDisabled();
});

// Was a known bug (reported as "không tìm thấy sheet"); fixed by the container signature check in
// apps/web/src/engine/io/excel-reader.ts parseWorkbook().
test('0-byte .xlsx file: message says the file cannot be read', async ({ page }) => {
  await withTimesheets(page);
  await uploadPayroll(page, [
    { name: 'rong.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) },
  ]);
  await expect(reportRows(page).first()).toContainText('rong.xlsx');
  await expect(reportRows(page).first()).toContainText('Không đọc được file rong.xlsx', {
    timeout: 2_000,
  });
});

test('garbage bytes named .xlsx: error, Run blocked', async ({ page }) => {
  await withTimesheets(page);
  const garbage = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256));
  await uploadPayroll(page, [
    { name: 'hong.xlsx', mimeType: 'application/octet-stream', buffer: garbage },
  ]);
  await expect(reportRows(page).first()).toContainText('hong.xlsx');
  await expect(runButton(page)).toBeDisabled();
});

test('garbage bytes named .xlsx: message says the file cannot be read (not "sheet not found")', async ({
  page,
}) => {
  await withTimesheets(page);
  const garbage = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256));
  await uploadPayroll(page, [
    { name: 'hong.xlsx', mimeType: 'application/octet-stream', buffer: garbage },
  ]);
  await expect(reportRows(page).first()).toContainText('hong.xlsx');
  await expect(reportRows(page).first()).toContainText('Không đọc được file hong.xlsx', {
    timeout: 2_000,
  });
});

test('truncated zip (.xlsx cut in half): unreadable error', async ({ page }) => {
  await withTimesheets(page);
  const good = payroll('cut.xlsx', employees(30));
  await uploadPayroll(page, [{ ...good, buffer: good.buffer.subarray(0, good.buffer.length / 2) }]);
  await expect(reportRows(page).first()).toContainText('cut.xlsx');
  await expect(runButton(page)).toBeDisabled();
});

test('file type not in accept list (.txt) is rejected', async ({ page }) => {
  await withTimesheets(page);
  await uploadPayroll(page, [
    { name: 'ghi_chu.txt', mimeType: 'text/plain', buffer: Buffer.from('NV00001,Nguyen') },
  ]);
  await expect(reportRows(page).first()).toContainText('định dạng không được hỗ trợ');
  await expect(runButton(page)).toBeDisabled();
});

test('header-only file is a warning: still runnable, run succeeds', async ({ page }) => {
  await withTimesheets(page);
  await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
  await payrollInput(page).setInputFiles([payroll('chi_header.xlsx', [], { total: false })]);
  await expect(payrollList(page).getByRole('listitem')).toHaveCount(4);
  const row = reportRows(page).filter({ hasText: 'chi_header.xlsx' });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell').first()).toHaveText('Cảnh báo');
  await expect(row).toContainText('không có dòng dữ liệu nào');
  await expect(reportCard(page).getByText('Lưu ý:')).toBeVisible();
  await expect(runButton(page)).toHaveText('Chạy');
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`));
  await expect(page.getByTestId('kpi')).toHaveText([/63/, /9/, /3/, /3/]);
});

test('ambiguous "1,500" is a warning with the parsed value, still runnable', async ({ page }) => {
  await withTimesheets(page);
  const rows = employees(3);
  rows[1]![4] = '1,500'; // OT as text
  await uploadPayroll(page, [payroll('mo_ho.xlsx', rows)]);
  const row = reportRows(page).filter({ hasText: '1,500' });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell').first()).toHaveText('Cảnh báo');
  await expect(row).toContainText('mo_ho.xlsx, dòng 6');
  await expect(row).toContainText('có thể hiểu theo 2 cách');
  await expect(payrollList(page).getByTestId('file-status')).toHaveText('1 cảnh báo');
  await expect(runButton(page)).toBeEnabled();
});

test('total rows are skipped and counted (fixtures: 3; plus one more file: 4)', async ({
  page,
}) => {
  await withTimesheets(page);
  await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
  await expect(reportCard(page).getByText('3 dòng đã bỏ qua')).toBeVisible();
  await payrollInput(page).setInputFiles([payroll('them.xlsx', employees(2, 900))]);
  await expect(reportCard(page).getByText('4 dòng đã bỏ qua')).toBeVisible();
  await expect(payrollList(page).getByRole('listitem').last()).toContainText('2 dòng');
});

test('removing the bad file re-validates and unblocks Run', async ({ page }) => {
  await withTimesheets(page);
  await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
  await payrollInput(page).setInputFiles([payroll('trung.xlsx', employees(2, 1))]);
  await expect(runButton(page)).toHaveText(/sửa 2 lỗi/);
  await page.getByRole('button', { name: 'Bỏ file trung.xlsx' }).click();
  await expect(payrollList(page).getByRole('listitem')).toHaveCount(3);
  await expect(reportCard(page).getByText('Hợp lệ:')).toBeVisible();
  await expect(runButton(page)).toBeEnabled();
});

test('removing all files of a slot returns to "need files"', async ({ page }) => {
  await withTimesheets(page);
  await uploadPayroll(page, [payroll('a.xlsx', employees(2))]);
  await page.getByRole('button', { name: 'Bỏ file a.xlsx' }).click();
  await expect(payrollList(page)).toHaveCount(0);
  await expect(runButton(page)).toHaveText('Chạy (cần upload đủ file)');
});

test('re-adding a file with the same name replaces it (no duplicate entry, new content)', async ({
  page,
}) => {
  await withTimesheets(page);
  await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
  await expect(payrollList(page).getByTestId('file-status')).toHaveText([
    '30 dòng',
    '25 dòng',
    '20 dòng',
  ]);
  await payrollInput(page).setInputFiles([
    payroll('bang_luong_CN01_092026.xlsx', employees(2, 500)),
  ]);
  const items = payrollList(page).getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items.filter({ hasText: 'bang_luong_CN01_092026.xlsx' })).toContainText('2 dòng');
});

test('changing files after a run clears the old result', async ({ page }) => {
  await withTimesheets(page);
  await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`));
  await expect(page.getByTestId('kpi').first()).toContainText('63');

  await page.goBack(); // SPA navigation, session kept
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Đối chiếu/);
  await page.getByRole('button', { name: 'Bỏ file bang_luong_CN03_092026.xlsx' }).click();
  await expect(payrollList(page).getByRole('listitem')).toHaveCount(2);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`));
  await expect(page.getByText(/Chưa có kết quả trong phiên này/)).toBeVisible();
  await expect(page.getByTestId('kpi')).toHaveCount(0);
});

test('validation report download (.xlsx) lists the issues', async ({ page }) => {
  await withTimesheets(page);
  await uploadPayroll(page, [
    payroll('luong_A.xlsx', employees(5, 1)),
    payroll('luong_B.xlsx', employees(3, 5, 'CN02')),
  ]);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải báo cáo lỗi (.xlsx)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('BaoCaoKiemTra.xlsx');
  const { ExcelJS } = await import('./helpers');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await download.path());
  const ws = wb.getWorksheet('Báo cáo kiểm tra');
  expect(ws).toBeDefined();
  const text: string[] = [];
  ws!.eachRow((r) => text.push(JSON.stringify(r.values)));
  const joined = text.join('\n');
  expect(joined).toContain('luong_A.xlsx');
  expect(joined).toContain('luong_B.xlsx');
  expect(joined).toContain('Lỗi');
  // Skipped total rows are listed too (severity "Bỏ qua").
  expect(joined).toContain('Bỏ qua');
});

test('a slot error does not leak into the other slot status', async ({ page }) => {
  await openFlow(page);
  await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
  await timesheetInput(page).setInputFiles([
    timesheet('cc.xlsx', employees(2, 1)),
    timesheet('cc2.xlsx', [[nv(1), 'X', 'CN01', 26, 4, 1, 0]]),
  ]);
  // MEMORY 13:08: a duplicate across 2 files marks both files (the report counts it once).
  await expect(timesheetList(page).getByTestId('file-status')).toHaveText(['1 lỗi', '1 lỗi']);
  await expect(reportCard(page).getByText('1 lỗi', { exact: true })).toBeVisible();
  await expect(reportCard(page)).toContainText('cc.xlsx dòng 2');
  await expect(payrollList(page).getByTestId('file-status')).toHaveText([
    '30 dòng',
    '25 dòng',
    '20 dòng',
  ]);
});

test('legacy .xls (BIFF8) payroll is accepted like .xlsx', async ({ page }) => {
  await withTimesheets(page);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(payrollAoa(employees(4))), 'Luong');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
  await uploadPayroll(page, [{ name: 'cu.xls', mimeType: 'application/vnd.ms-excel', buffer }]);
  await expect(payrollList(page).getByTestId('file-status')).toHaveText('4 dòng');
});

// Was a known bug (CSV advertised, then rejected as "không tìm thấy sheet"). MEMORY 13:08: CSV is
// not accepted; the slot no longer advertises it and a CSV gets a clear "unsupported" error.
test('CSV is not advertised and a dropped CSV is rejected as an unsupported format', async ({
  page,
}) => {
  await openFlow(page);
  await expect(page.getByText(/\.csv/)).toHaveCount(0);
  await expect(timesheetInput(page)).toHaveAttribute('accept', '.xlsx,.xls');
  const csv = [TIMESHEET_HEADERS, ...employees(3)].map((r) => r.join(',')).join('\n');
  await timesheetInput(page).setInputFiles([
    {
      name: 'cham_cong.csv',
      mimeType: 'text/csv',
      buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]),
    },
  ]);
  await expect(timesheetList(page).getByTestId('file-status')).toHaveText('1 lỗi');
  await expect(reportRows(page).first()).toContainText(
    'File cham_cong.csv: định dạng không được hỗ trợ (chỉ nhận .xlsx, .xls).',
  );
  await expect(reportRows(page).first()).not.toContainText('không tìm thấy sheet');
  await expect(runButton(page)).toBeDisabled();
});
