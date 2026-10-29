/**
 * AC-B3-33 (replaces AC-11): the acceptance flow (spec §24) is built from scratch in the Flow
 * Designer, saved, reloaded, published, then run in the Run Wizard with the fixtures; the result
 * matches fixtures/payroll-timesheet/expected.json. Supabase is mocked; fake data only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADMIN, expect, test, type Locator, type Page } from './fixtures';
import { chooseOption, fixtures, pickDate, pickMonth } from './helpers';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const EXPECTED = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../fixtures/payroll-timesheet/expected.json'), 'utf8'),
) as { counts: Record<string, number> };

const panel = (page: Page) => page.getByRole('complementary', { name: 'Cấu hình' });
const items = (set: Locator) => set.locator(':scope > [role="group"]');
const node = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const handle = (page: Page, nodeId: string, port: string) =>
  page.locator(`.react-flow__handle[data-nodeid="${nodeId}"][data-handleid="${port}"]`);

async function wire(page: Page, from: string, fromPort: string, to: string, toPort: string) {
  await handle(page, from, fromPort).dragTo(handle(page, to, toPort));
  await expect(
    page.locator(`[data-testid^="rf__edge-${from}.${fromPort}>${to}.${toPort}"]`),
  ).toHaveCount(1);
}

interface ColumnSpec {
  key: string;
  label: string;
  alias: string;
  metric?: boolean;
}

async function fillSlot(
  page: Page,
  slot: { key: string; label: string; sheet: string; headerRow?: number; dataStartRow?: number },
  keyAliases: string,
  columns: ColumnSpec[],
) {
  const p = panel(page);
  await p.getByRole('button', { name: 'Thêm mục upload' }).click();
  await p.getByLabel('Mã', { exact: true }).fill(slot.key);
  await p.getByLabel('Tên hiển thị', { exact: true }).first().fill(slot.label);
  await chooseOption(p.getByLabel('Chọn sheet'), 'Theo tên');
  await p.getByLabel('Tên sheet', { exact: true }).fill(slot.sheet);
  if (slot.headerRow)
    await p.getByLabel('Dòng tiêu đề', { exact: true }).fill(String(slot.headerRow));
  if (slot.dataStartRow) {
    await p.getByLabel('Dòng dữ liệu đầu tiên').fill(String(slot.dataStartRow));
  }
  await p.getByLabel('Dừng khi gặp số dòng trống liên tiếp').fill('2');
  await p.getByRole('checkbox', { name: 'Bỏ qua dòng không phải dữ liệu' }).check();
  await p.getByLabel('Bỏ dòng khi cột khóa chứa').fill('TỔNG CỘNG');
  await p.getByRole('checkbox', { name: 'Cho upload nhiều file và tự gộp' }).check();

  const cols = p.getByRole('group', { name: 'Các cột', exact: true });
  const first = items(cols).nth(0);
  await first.getByLabel('Tên cột trong file').fill(keyAliases);
  await first.getByRole('button', { name: 'Thêm quy tắc' }).click();
  for (const [i, c] of columns.entries()) {
    await cols.getByRole('button', { name: 'Thêm cột', exact: true }).last().click();
    const col = items(cols).nth(i + 1);
    await col.getByLabel('Mã cột').fill(c.key);
    await col.getByLabel('Tên hiển thị').fill(c.label);
    await col.getByLabel('Tên cột trong file').fill(c.alias);
    if (c.metric) {
      await chooseOption(col.getByLabel('Kiểu dữ liệu'), 'Số thập phân');
      await chooseOption(col.getByLabel('Cột phải có trong file'), 'Bắt buộc (thiếu là lỗi)');
      await col.getByLabel('Giá trị khi ô trống').fill('0');
      await col.getByRole('button', { name: 'Thêm quy tắc' }).click();
      await chooseOption(col.getByLabel('Loại'), 'Giá trị tối thiểu');
    }
  }
}

const COLUMNS = (aliases: [string, string, string, string, string, string]): ColumnSpec[] => [
  { key: 'ho_ten', label: 'Họ tên', alias: aliases[0] },
  { key: 'chi_nhanh', label: 'Chi nhánh', alias: aliases[1] },
  { key: 'cong', label: 'Công', alias: aliases[2], metric: true },
  { key: 'ot', label: 'OT (giờ)', alias: aliases[3], metric: true },
  { key: 'phep', label: 'Phép', alias: aliases[4], metric: true },
  { key: 'khong_luong', label: 'Không lương', alias: aliases[5], metric: true },
];

test('AC-B3-33: build the acceptance flow in the Designer, save, reload, publish, run', async ({
  page,
  supabase,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // AC-B3-31: new flow + draft v1 in one step.
  await page.goto('/admin/flows');
  await page.getByRole('button', { name: 'Tạo flow mới' }).click();
  const create = page.getByRole('dialog', { name: 'Tạo flow mới' });
  await create.getByLabel('Mã flow').fill('doi-chieu-moi');
  await create.getByLabel('Tên flow').fill('Đối chiếu dựng bằng Designer');
  await create.getByLabel('Nhóm').fill('Lương & công');
  await create.getByRole('button', { name: 'Tạo và mở Designer' }).click();
  await expect(page).toHaveURL(/\/admin\/flows\/doi-chieu-moi\/designer$/);
  expect(supabase.bodiesOf('/rest/v1/rpc/admin_create_flow')).toHaveLength(1);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Đối chiếu dựng bằng Designer',
  );

  // Params: month, required, as-of date.
  const p = panel(page);
  await p.getByRole('button', { name: 'Thêm tham số' }).click();
  const param = items(p.getByRole('group', { name: 'Tham số', exact: true })).nth(0);
  await param.getByLabel('Mã', { exact: true }).fill('ky_luong');
  await param.getByLabel('Tên hiển thị').fill('Kỳ lương');
  await chooseOption(param.getByLabel('Kiểu', { exact: true }), 'Tháng');
  await param.getByRole('checkbox', { name: 'Bắt buộc nhập' }).check();
  await param.getByRole('checkbox', { name: 'Dùng làm ngày hiệu lực' }).check();

  // Two multi-file slots.
  await p.getByRole('tab', { name: 'Input slot' }).click();
  await fillSlot(
    page,
    {
      key: 'bang_luong',
      label: 'Bảng lương (nhiều chi nhánh)',
      sheet: 'Luong',
      headerRow: 4,
      dataStartRow: 5,
    },
    'Mã NV\nMSNV',
    COLUMNS([
      'Họ và tên',
      'Chi nhánh',
      'Công tính lương',
      'Giờ OT',
      'Ngày phép',
      'Nghỉ không lương',
    ]),
  );
  await fillSlot(
    page,
    { key: 'cham_cong', label: 'Chấm công (nhiều chi nhánh)', sheet: 'ChamCong' },
    'Mã nhân viên',
    COLUMNS([
      'Họ tên',
      'Chi nhánh',
      'Công thực tế',
      'OT (giờ)',
      'Phép (ngày)',
      'Không lương (ngày)',
    ]),
  );

  // Nodes from the palette.
  const palette = page.getByRole('navigation', { name: 'Thêm node' });
  await palette.getByRole('button', { name: /^Đọc file Excel/ }).click();
  await p.getByLabel('Tên node').fill('Bảng lương');
  await palette.getByRole('button', { name: /^Đọc file Excel/ }).click();
  await p.getByLabel('Tên node').fill('Chấm công');
  await chooseOption(p.getByLabel('Mục upload'), 'Chấm công (nhiều chi nhánh) (cham_cong)');
  await palette.getByRole('button', { name: /^Đối chiếu/ }).click();
  await p.getByLabel('Tên node').fill('Đối chiếu');
  await palette.getByRole('button', { name: /^Xuất Excel/ }).click();
  await p.getByLabel('Tên node').fill('File đối chiếu');
  await p.getByLabel('Tên file').fill('DoiChieu_{ky_luong}.xlsx');
  const sheets = p.getByRole('group', { name: 'Các sheet', exact: true });
  await items(sheets).nth(0).getByLabel('Tên sheet').fill('Tổng hợp');
  for (const [i, name] of ['Lệch', 'Chỉ có trong lương', 'Chỉ có trong chấm công'].entries()) {
    await p.getByRole('button', { name: 'Thêm sheet' }).click();
    await items(sheets)
      .nth(i + 1)
      .getByLabel('Tên sheet')
      .fill(name);
  }
  await page.getByRole('toolbar').getByRole('button', { name: 'Tự sắp xếp' }).click();

  await wire(page, 'input_1', 'table', 'compare_1', 'left');
  await wire(page, 'input_2', 'table', 'compare_1', 'right');

  // Compare: key, 4 metrics with tolerances, carried columns, side names.
  await node(page, 'compare_1').click();
  await expect(p.getByRole('heading', { name: 'Đối chiếu' })).toBeVisible();
  await chooseOption(p.getByLabel('Thêm cột vào Cột khóa'), 'Mã NV (ma_nv)');
  const metrics = p.getByRole('group', { name: 'Chỉ tiêu đối chiếu', exact: true });
  const metricSpecs: [string, string, string][] = [
    ['Công', 'Công (cong)', '0.5'],
    ['OT (giờ)', 'OT (giờ) (ot)', '1'],
    ['Phép', 'Phép (phep)', '0'],
    ['Không lương', 'Không lương (khong_luong)', '0'],
  ];
  for (const [i, [label, column, tolerance]] of metricSpecs.entries()) {
    await p.getByRole('button', { name: 'Thêm chỉ tiêu' }).click();
    const m = items(metrics).nth(i);
    await m.getByLabel('Tên chỉ tiêu').fill(label);
    await chooseOption(m.getByLabel('Cột ở bảng trái (left)'), column);
    await m.getByLabel('Ngưỡng chênh lệch').fill(tolerance);
  }
  await chooseOption(p.getByLabel('Thêm cột vào Cột hiển thị kèm'), 'Họ tên (ho_ten)');
  await chooseOption(p.getByLabel('Thêm cột vào Cột hiển thị kèm'), 'Chi nhánh (chi_nhanh)');
  await p.getByRole('checkbox', { name: 'Đặt tên cho 2 bảng' }).check();
  await p.getByLabel('Tên bảng trái').fill('lương');
  await p.getByLabel('Tên bảng phải').fill('chấm công');

  for (const [i, port] of ['summary', 'mismatched', 'only_left', 'only_right'].entries()) {
    await wire(page, 'compare_1', port, 'excel_1', `sheet_${i + 1}`);
  }
  await page.getByRole('toolbar').getByRole('button', { name: 'Tự sắp xếp' }).click();

  const status = page.getByRole('button', { name: /lỗi · / });
  await expect(status).toContainText('0 lỗi');
  await expect(node(page, 'compare_1')).toContainText('cột');

  // AC-B3-39: Ctrl+S saves (no browser dialog), status "Đã lưu".
  await page.keyboard.press('Control+S');
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
  expect(supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft')).toHaveLength(1);

  // Reload: the same content comes back.
  await page.reload();
  await expect(node(page, 'excel_1')).toBeVisible();
  await expect(page.locator('.react-flow__node-flow')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
  await expect(status).toContainText('0 lỗi');

  // Publish v1 on the Version screen (full engine check passes).
  await page.getByRole('link', { name: 'Về màn Phiên bản' }).click();
  await page.getByRole('button', { name: 'Publish v1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish v1' });
  await pickDate(page, dialog.locator('#publish-from'), '2026-01-01');
  await dialog.getByLabel(/^Ghi chú thay đổi/).fill('Dựng bằng Designer');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog).toHaveCount(0);

  // Run it like a User would, with the fixtures.
  await page.goto('/run/doi-chieu-moi');
  await pickMonth(page, '2026-09');
  await page.getByLabel(/^Chọn file cho Bảng lương/).setInputFiles(fixtures('bang_luong_'));
  await page.getByLabel(/^Chọn file cho Chấm công/).setInputFiles(fixtures('cham_cong_'));
  const run = page.getByRole('button', { name: /^Chạy/ }).last();
  await expect(run).toHaveText('Chạy');
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page).toHaveURL(/\/run\/doi-chieu-moi\/result$/, { timeout: 120_000 });
  const c = EXPECTED.counts;
  await expect(page.getByTestId('kpi')).toHaveText([
    new RegExp(`Khớp\\s*${c.matched}`),
    new RegExp(`Lệch\\s*${c.mismatched}`),
    new RegExp(`lương\\s*${c.only_in_payroll}`),
    new RegExp(`chấm công\\s*${c.only_in_timesheet}`),
  ]);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải Excel (4 sheet)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('DoiChieu_2026-09.xlsx');
  expect(errors).toEqual([]);
});
