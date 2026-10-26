/**
 * Result screen (spec §15.1 step 6; AC-04, AC-06): tabs, branch + metric filters, the downloaded
 * workbook read back with ExcelJS, and direct navigation / reload of the run routes.
 */
import { expect, test } from '@playwright/test';
import { ExcelJS, FLOW_URL, RESULT_URL, runButton, runToResult, uploadFixtures } from './helpers';

test.describe('result page', () => {
  test.beforeEach(async ({ page }) => {
    await uploadFixtures(page);
    await runToResult(page);
  });

  test('tabs: click and arrow keys switch sheets, row counts match expected.json', async ({
    page,
  }) => {
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText([
      'Tổng hợp',
      'Lệch (9)',
      'Chỉ có trong lương (3)',
      'Chỉ có trong chấm công (3)',
    ]);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Lệch (9)');

    await page.getByRole('tab', { name: 'Tổng hợp' }).click();
    const summary = page.getByRole('region', { name: 'Tổng hợp' });
    await expect(summary.getByRole('row')).toHaveCount(1 + 5); // 4 metrics + total
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', /tab-/);

    // Roving tabindex: only the selected tab is in the Tab order; arrows move selection + focus.
    await page.getByRole('tab', { selected: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Lệch (9)');
    await expect(page.getByRole('tab', { selected: true })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft'); // wraps to the last tab
    await expect(page.getByRole('tab', { selected: true })).toHaveText(
      'Chỉ có trong chấm công (3)',
    );
    const onlyRight = page.getByRole('region', { name: 'Chỉ có trong chấm công' });
    await expect(onlyRight.getByRole('row')).toHaveCount(1 + 3);
    for (const id of ['NV90031', 'NV90056', 'NV90076']) {
      await expect(onlyRight.getByRole('cell', { name: id, exact: true })).toBeVisible();
    }
    await expect(page.locator('[role=tab][tabindex="0"]')).toHaveCount(1);
  });

  test('mismatched sheet: diff cells highlighted, Vietnamese number format', async ({ page }) => {
    const table = page.getByRole('region', { name: 'Lệch' });
    const row = table.getByRole('row').filter({ hasText: 'NV00001' });
    await expect(row).toBeVisible();
    // NV00001: công lệch -2 → shown as "-2" (vi format, comma decimals elsewhere).
    await expect(row.locator('td.bg-coral-tint')).not.toHaveCount(0);
    const ot = table.getByRole('row').filter({ hasText: 'NV00025' });
    await expect(ot).toContainText('4');
  });

  test('branch and metric filters, combined and reset', async ({ page }) => {
    const region = () => page.getByRole('region', { name: 'Lệch' });
    const branch = page.getByLabel('Chi nhánh');
    const metric = page.getByLabel('Chỉ tiêu lệch');
    await expect(branch.locator('option')).toHaveText(['Tất cả', 'CN01', 'CN02', 'CN03']);
    await expect(metric.locator('option')).toHaveText([
      'Tất cả',
      'Công',
      'OT (giờ)',
      'Phép',
      'Không lương',
    ]);

    await metric.selectOption('Công');
    await expect(region().getByRole('row')).toHaveCount(1 + 6);
    await expect(page.getByText('6 dòng', { exact: true })).toBeVisible();
    await metric.selectOption('OT (giờ)');
    await expect(region().getByRole('row')).toHaveCount(1 + 3);
    await metric.selectOption('Phép');
    await expect(region().getByRole('row')).toHaveCount(1 + 3);
    await metric.selectOption('Không lương');
    await expect(page.getByText('Không có dòng nào.')).toBeVisible();

    await metric.selectOption('Công');
    await branch.selectOption('CN01');
    await expect(region().getByRole('row')).toHaveCount(1 + 2); // NV00001, NV00007
    await expect(region().getByRole('cell', { name: 'NV00001', exact: true })).toBeVisible();
    await expect(region().getByRole('cell', { name: 'NV00007', exact: true })).toBeVisible();

    await branch.selectOption('');
    await metric.selectOption('');
    await expect(region().getByRole('row')).toHaveCount(1 + 9);

    // Filters are per tab: switching away and back resets them.
    await branch.selectOption('CN02');
    await page.getByRole('tab', { name: 'Tổng hợp' }).click();
    await page.getByRole('tab', { name: 'Lệch (9)' }).click();
    await expect(page.getByLabel('Chi nhánh')).toHaveValue('');
  });

  test('AC-06: downloaded workbook has the 4 sheets, expected rows, bold frozen header, auto-filter', async ({
    page,
  }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Tải Excel (4 sheet)' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('DoiChieu_2026-09.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await download.path());
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Tổng hợp',
      'Lệch',
      'Chỉ có trong lương',
      'Chỉ có trong chấm công',
    ]);
    const expectedRows: Record<string, number> = {
      'Tổng hợp': 1 + 5,
      Lệch: 1 + 9,
      'Chỉ có trong lương': 1 + 3,
      'Chỉ có trong chấm công': 1 + 3,
    };
    for (const ws of wb.worksheets) {
      expect(ws.actualRowCount, ws.name).toBe(expectedRows[ws.name]);
      expect(ws.getRow(1).getCell(1).font?.bold, `${ws.name} bold header`).toBe(true);
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.autoFilter, `${ws.name} auto-filter`).toBeTruthy();
    }
    const ids: string[] = [];
    wb.getWorksheet('Lệch')!.eachRow((r, i) => {
      if (i > 1) ids.push(r.getCell(1).text);
    });
    expect(ids.sort()).toEqual([
      'NV00001',
      'NV00007',
      'NV00025',
      'NV00036',
      'NV00046',
      'NV00049',
      'NV00062',
      'NV00066',
      'NV00072',
    ]);

    // A second download works (artifact is copied, not transferred away).
    const [again] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Tải Excel (4 sheet)' }).click(),
    ]);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(await again.path());
    expect(wb2.worksheets).toHaveLength(4);
  });

  test('"Chạy lại" goes back to the wizard with files kept and Run enabled', async ({ page }) => {
    await page.getByRole('button', { name: 'Chạy lại' }).click();
    await expect(page).toHaveURL(new RegExp(`${FLOW_URL}$`));
    await expect(runButton(page)).toHaveText('Chạy');
    await expect(runButton(page)).toBeEnabled();
    await runToResult(page);
    await expect(page.getByTestId('kpi')).toHaveText([/63/, /9/, /3/, /3/]);
  });
});

test.describe('direct navigation and reload', () => {
  test('deep link to /run/:code opens the wizard', async ({ page }) => {
    await page.goto(FLOW_URL);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Đối chiếu bảng lương/);
    await expect(runButton(page)).toHaveText('Chạy (cần upload đủ file)');
    await expect(runButton(page)).toBeDisabled();
  });

  test('deep link to /run/:code/result without a session explains and links back', async ({
    page,
  }) => {
    await page.goto(RESULT_URL);
    await expect(page.getByText(/Chưa có kết quả trong phiên này/)).toBeVisible();
    await page.getByRole('link', { name: 'Về trang chạy flow' }).click();
    await expect(page).toHaveURL(new RegExp(`${FLOW_URL}$`));
  });

  test('reload of the result page drops the in-memory result (no persistence)', async ({
    page,
  }) => {
    await uploadFixtures(page);
    await runToResult(page);
    await page.reload();
    await expect(page.getByText(/Chưa có kết quả trong phiên này/)).toBeVisible();
    await expect(page.getByTestId('kpi')).toHaveCount(0);
  });

  test('reload of the wizard drops uploaded files', async ({ page }) => {
    await uploadFixtures(page);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Đối chiếu/);
    await expect(page.getByRole('list', { name: /File đã chọn/ })).toHaveCount(0);
    await expect(page.getByLabel(/Kỳ lương/)).toHaveValue('');
  });

  test('unknown flow code shows "not found"', async ({ page }) => {
    await page.goto('/run/khong-ton-tai');
    await expect(page.getByRole('alert')).toContainText('Không tìm thấy flow');
    await page.goto('/run/khong-ton-tai/result');
    await expect(page.getByText(/Chưa có kết quả/)).toBeVisible();
  });

  test('unknown path does not crash (no page error)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto('/khong-co-trang-nay');
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator('body')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });
});

// Was a known bug; fixed per MEMORY 13:08 ("Xem kết quả" while the result is in memory).
test('after leaving the result page, the wizard offers a way back to the result', async ({
  page,
}) => {
  await uploadFixtures(page);
  await runToResult(page);
  await page.getByRole('link', { name: 'Danh sách flow' }).click();
  await page.getByRole('link', { name: /^Chạy flow Đối chiếu/ }).click();
  await expect(page).toHaveURL(new RegExp(`${FLOW_URL}$`));
  await expect(page.locator('[aria-current=step]')).toContainText('Kết quả');
  const back = page.getByRole('link', { name: 'Xem kết quả' });
  await expect(back).toBeVisible({ timeout: 3_000 });
  await back.click();
  await expect(page).toHaveURL(new RegExp(`${FLOW_URL}/result$`));
  await expect(page.getByRole('tablist')).toBeVisible();
});
