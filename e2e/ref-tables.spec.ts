/**
 * "Bảng tham chiếu" (spec §34 round 1, AC-RT-01..06, 11): an Admin creates a table and its
 * columns (personal-data confirmation), imports an Excel file into the draft (checked in the
 * engine worker), edits the grid (undo / redo, multi-cell paste), saves, publishes, starts a new
 * draft from it and compares the versions by key. Fake reference data only (branch list).
 */
import { ADMIN, expect, test, type Locator, type Page } from './fixtures';
import { recordRequests, workbook } from './helpers';
import { branchRows } from './supabase-mock-ref';

const LIST = '/admin/ref-tables';
const HEAD = ['Mã CN', 'Tên chi nhánh', 'Vùng lương tối thiểu'];

const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });
const grid = (page: Page) => page.getByRole('region', { name: /^Dữ liệu v\d+$/ });
const cell = (page: Page, column: string, row: number) =>
  grid(page).getByRole('textbox', { name: `${column}, dòng ${row}`, exact: true });
const status = (page: Page) => page.locator('[data-grid-status]');

async function pasteInto(target: Locator, text: string): Promise<void> {
  await target.focus();
  await target.evaluate((el, data) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', data);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, text);
}

async function addColumn(
  page: Page,
  c: { title: string; aliases?: string; type?: string; key?: boolean },
): Promise<void> {
  await page.getByRole('button', { name: '+ Thêm cột' }).click();
  const d = dialog(page, 'Thêm cột');
  await d.getByRole('textbox', { name: /^Tên hiển thị/ }).fill(c.title);
  if (c.aliases) await d.getByRole('textbox', { name: /^Tên cột trong file/ }).fill(c.aliases);
  if (c.type) {
    await d.getByRole('combobox', { name: 'Kiểu dữ liệu' }).click();
    await page.getByRole('option', { name: c.type }).click();
  }
  const box = d.getByRole('checkbox', { name: 'Cột khóa' });
  if (c.key !== undefined && (await box.isChecked()) !== c.key) await box.click();
  await d.getByRole('button', { name: 'Lưu cột' }).click();
  await expect(d).toBeHidden();
}

test.describe('Admin', () => {
  test.use({ signedInAs: ADMIN });

  test('create → columns → import → edit cells → save → publish → new draft → diff', async ({
    page,
    supabase,
  }) => {
    const requests = recordRequests(page);
    await page.goto('/admin/users');
    await page
      .getByRole('navigation', { name: 'Menu Admin' })
      .getByRole('link', { name: 'Bảng tham chiếu' })
      .click();
    await expect(page).toHaveURL(/\/admin\/ref-tables$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bảng tham chiếu dùng chung');
    await expect(page.getByText('Chưa có bảng tham chiếu')).toBeVisible();

    // Table + columns (AC-RT-02); the code follows the name.
    await page.getByRole('link', { name: '+ Tạo bảng' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tạo bảng tham chiếu');
    await page.getByRole('textbox', { name: /^Tên bảng/ }).fill('Danh mục chi nhánh');
    await expect(page.getByRole('textbox', { name: /^Mã bảng/ })).toHaveValue('DANH_MUC_CHI_NHANH');
    await page.getByRole('textbox', { name: /^Mã bảng/ }).fill('DM_CHI_NHANH');
    await addColumn(page, { title: 'Mã chi nhánh', aliases: 'Mã CN' });
    await addColumn(page, { title: 'Tên chi nhánh', aliases: 'Tên CN' });
    await addColumn(page, { title: 'Vùng lương tối thiểu', aliases: 'Vùng', type: 'Số nguyên' });
    const cols = page.getByRole('region', { name: 'Các cột của bảng' });
    await expect(cols.locator('tbody tr')).toHaveCount(3);
    await expect(cols.locator('tbody tr').first()).toContainText('ma_chi_nhanh');
    await expect(cols.locator('tbody tr').first()).toContainText('Khóa');

    // A column named like personal data: warning, Lưu only after the confirmation (AC-RT-05).
    await addColumn(page, { title: 'Họ tên giám đốc CN' });
    await expect(page.getByText('Có thể là dữ liệu cá nhân:')).toBeVisible();
    const save = page.getByRole('button', { name: 'Lưu', exact: true });
    await expect(save).toBeDisabled();
    // Removing it instead clears the warning.
    await page.getByRole('button', { name: 'Xóa cột ho_ten_giam_doc_cn' }).click();
    await expect(page.getByText('Có thể là dữ liệu cá nhân:')).toHaveCount(0);
    await addColumn(page, { title: 'Họ tên giám đốc CN' });
    await page.getByRole('checkbox', { name: /không chứa dữ liệu cá nhân/ }).check();
    await save.click();
    await expect(page).toHaveURL(/\/admin\/ref-tables\/DM_CHI_NHANH\/versions$/);
    expect(supabase.ref.confirmations).toEqual([
      { table: supabase.ref.tables[0]!.id, context: 'columns', columns: ['ho_ten_giam_doc_cn'] },
    ]);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Danh mục chi nhánh: phiên bản & hiệu lực',
    );
    const versions = page.getByRole('region', { name: 'Phiên bản của bảng' });
    await expect(versions.locator('tbody tr')).toHaveCount(1);
    await expect(versions.locator('tbody tr').first()).toContainText('Draft');

    // Import (AC-RT-03): checked in the worker, preview, confirmation, replace the draft.
    await page.getByRole('button', { name: 'Import Excel vào draft' }).click();
    const imp = dialog(page, 'Import Excel vào draft v1');
    await imp.getByLabel('Chọn file Excel để import').setInputFiles(
      workbook('danh_muc_chi_nhanh.xlsx', {
        DanhMuc: [
          [...HEAD, 'Họ tên giám đốc CN', 'Ghi chú'],
          ['CN01', 'Hồ Chí Minh', 1, 'GĐ Một', 'x'],
          ['CN02', 'Hà Nội', 1, 'GĐ Hai', null],
          ['CN03', 'Cần Thơ', 2, null, null],
        ],
      }),
    );
    await expect(imp.getByText('1 cảnh báo')).toBeVisible();
    await expect(imp).toContainText('cột "Ghi chú" không có trong bảng, sẽ bỏ qua');
    await expect(
      imp.getByRole('region', { name: 'Xem trước dữ liệu' }).locator('tbody tr'),
    ).toHaveCount(3);
    const replace = imp.getByRole('button', { name: 'Thay dữ liệu draft (0 → 3 dòng)' });
    await expect(replace).toBeDisabled();
    await imp.getByRole('checkbox', { name: /không chứa dữ liệu cá nhân/ }).check();
    await replace.click();
    await expect(page).toHaveURL(/\/DM_CHI_NHANH\/versions\/1$/);
    expect(supabase.ref.draftOf('DM_CHI_NHANH')!.rows).toEqual([
      {
        ma_chi_nhanh: 'CN01',
        ten_chi_nhanh: 'Hồ Chí Minh',
        vung_luong_toi_thieu: 1,
        ho_ten_giam_doc_cn: 'GĐ Một',
      },
      {
        ma_chi_nhanh: 'CN02',
        ten_chi_nhanh: 'Hà Nội',
        vung_luong_toi_thieu: 1,
        ho_ten_giam_doc_cn: 'GĐ Hai',
      },
      { ma_chi_nhanh: 'CN03', ten_chi_nhanh: 'Cần Thơ', vung_luong_toi_thieu: 2 },
    ]);
    expect(supabase.ref.confirmations.at(-1)?.context).toBe('import');

    // Grid (AC-RT-04): type check in place, undo / redo, paste past the end.
    await expect(grid(page).locator('tbody tr')).toHaveCount(3);
    await expect(status(page)).toHaveText(/^3 dòng · đã lưu /);
    const vung2 = cell(page, 'Vùng lương tối thiểu', 2);
    await vung2.fill('hai');
    await expect(vung2).toHaveAttribute('aria-invalid', 'true');
    await vung2.fill('3');
    await vung2.press('Enter');
    await expect(cell(page, 'Vùng lương tối thiểu', 3)).toBeFocused();
    await expect(status(page)).toHaveText('1 ô sửa · 0 dòng mới · 0 dòng xóa — chưa lưu');
    await page.keyboard.press('Control+z');
    await expect(vung2).toHaveValue('1');
    await expect(status(page)).toHaveText(/^3 dòng · đã lưu /);
    await page.keyboard.press('Control+y');
    await expect(vung2).toHaveValue('3');

    await pasteInto(
      cell(page, 'Mã chi nhánh', 3),
      'CN03\tCần Thơ\t2\nCN04\tĐà Nẵng\t1\r\nCN05\tHậu Giang\t3\r\n',
    );
    await expect(grid(page).locator('tbody tr')).toHaveCount(5);
    await expect(cell(page, 'Tên chi nhánh', 5)).toHaveValue('Hậu Giang');
    await expect(status(page)).toHaveText('1 ô sửa · 2 dòng mới · 0 dòng xóa — chưa lưu');
    // The paste is one undo step.
    await page.getByRole('button', { name: 'Hoàn tác (Ctrl+Z)' }).click();
    await expect(grid(page).locator('tbody tr')).toHaveCount(3);
    await page.getByRole('button', { name: 'Làm lại (Ctrl+Y)' }).click();
    await expect(grid(page).locator('tbody tr')).toHaveCount(5);

    // Search over the data.
    await page.getByLabel('Tìm trong dữ liệu').fill('hau giang');
    await expect(grid(page).locator('tbody tr')).toHaveCount(1);
    await expect(status(page)).toHaveText('1 / 5 dòng');
    await page.getByLabel('Tìm trong dữ liệu').fill('');

    await page.getByRole('button', { name: 'Lưu draft' }).click();
    await expect(page.getByText('Đã lưu draft v1.')).toBeVisible();
    await expect(status(page)).toHaveText(/^5 dòng · đã lưu /);
    const saved = supabase.ref.draftOf('DM_CHI_NHANH')!.rows;
    expect(saved).toHaveLength(5);
    expect(saved[1]).toMatchObject({ ma_chi_nhanh: 'CN02', vung_luong_toi_thieu: 3 });
    expect(saved[4]).toEqual({
      ma_chi_nhanh: 'CN05',
      ten_chi_nhanh: 'Hậu Giang',
      vung_luong_toi_thieu: 3,
    });

    // Publish v1 (AC-RT-06).
    await page.getByRole('link', { name: 'Phiên bản của DM_CHI_NHANH' }).click();
    await page.getByRole('button', { name: 'Thao tác khác cho v1' }).click();
    await page.getByRole('menuitem', { name: 'Publish v1' }).click();
    const pub = dialog(page, 'Publish v1 của DM_CHI_NHANH');
    await pub.getByRole('button', { name: 'Publish' }).click();
    await expect(pub.getByText('Nhập ghi chú thay đổi.')).toBeVisible();
    await pub.getByLabel(/Ghi chú thay đổi/).fill('Khởi tạo danh mục');
    await pub.getByRole('button', { name: 'Publish' }).click();
    await expect(pub).toBeHidden();
    await expect(versions.locator('tbody tr').first()).toContainText('Published');
    await expect(versions.locator('tbody tr').first()).toContainText('Khởi tạo danh mục');

    // Rollback / next version: draft v2 from v1, change one cell, diff by key.
    await page.getByRole('button', { name: 'Thao tác khác cho v1' }).click();
    await page.getByRole('menuitem', { name: 'Tạo draft từ bản này v1' }).click();
    await expect(page.getByText('Đã tạo draft v2 từ v1.')).toBeVisible();
    await page.getByRole('link', { name: 'Sửa dữ liệu v2' }).click();
    await cell(page, 'Vùng lương tối thiểu', 5).fill('2');
    await page.getByRole('button', { name: 'Xóa dòng 4' }).click();
    await expect(page.locator('[data-grid-row="3"]')).toHaveAttribute('data-removed', 'true');
    await page.getByRole('button', { name: 'Lưu draft' }).click();
    await expect(page.getByText('Đã lưu draft v2.')).toBeVisible();
    await expect(grid(page).locator('tbody tr')).toHaveCount(4);
    await page.getByRole('link', { name: 'Phiên bản của DM_CHI_NHANH' }).click();
    const diff = page.locator('[data-diff-summary]');
    await expect(diff).toHaveText('Thêm 0 dòng, xóa 1, sửa 1, giữ nguyên 3 (so theo cột khóa).');
    await expect(page.locator('[data-diff-line="changed"]')).toContainText('CN05');
    await expect(page.locator('[data-diff-cell]')).toHaveText('3 → 2');
    await expect(page.locator('[data-diff-line="removed"]')).toContainText('CN04');

    // Everything stayed on the app origin and the mocked Supabase (no other host).
    const hosts = new Set(requests.map((r) => new URL(r.url).host));
    hosts.delete(new URL(page.url()).host);
    hosts.delete('rzakjtgvbyxqsmbpcomw.supabase.co');
    expect([...hosts]).toEqual([]);
  });

  test('import errors block the save and keep the draft (AC-RT-03)', async ({ page, supabase }) => {
    supabase.ref.seed({ code: 'DM_CHI_NHANH', name: 'Danh mục chi nhánh', draft: branchRows(4) });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions`);
    await page.getByRole('button', { name: 'Import Excel vào draft' }).click();
    const imp = dialog(page, 'Import Excel vào draft v1');
    await imp.getByLabel('Chọn file Excel để import').setInputFiles(
      workbook('loi.xlsx', {
        S: [HEAD, ['CN01', 'A', 1], ['cn01 ', 'B', 'một']],
      }),
    );
    await expect(imp.getByText('2 lỗi')).toBeVisible();
    await expect(imp).toContainText('trùng với dòng 2');
    await expect(imp).toContainText('không phải số nguyên');
    await expect(imp).toContainText('Dữ liệu draft hiện tại (4 dòng) chưa bị thay.');
    await expect(imp.getByRole('button', { name: 'Thay dữ liệu draft' })).toBeDisabled();

    // Missing column: one line per column.
    await imp
      .getByLabel('Chọn file Excel để import')
      .setInputFiles(workbook('thieu.xlsx', { S: [['Mã CN'], ['CN01']] }));
    await expect(imp.getByText('2 lỗi')).toBeVisible();
    await expect(imp).toContainText('thiếu cột bắt buộc "Tên chi nhánh"');
    await imp.getByRole('button', { name: 'Hủy' }).click();
    expect(
      supabase.ref.rpcBodies.filter((b) => b.name === 'admin_replace_ref_table_draft'),
    ).toEqual([]);
    expect(supabase.ref.draftOf('DM_CHI_NHANH')!.rows).toHaveLength(4);
  });

  test('bad cells block the save and get the focus; another save first → conflict', async ({
    page,
    supabase,
  }) => {
    supabase.ref.seed({ code: 'DM_CHI_NHANH', name: 'Danh mục chi nhánh', draft: branchRows(3) });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions/1`);
    await cell(page, 'Mã chi nhánh', 3).fill(' cn01');
    await cell(page, 'Vùng lương tối thiểu', 2).fill('1,5');
    await page.getByRole('button', { name: '+ Thêm dòng' }).click();
    await expect(cell(page, 'Mã chi nhánh', 4)).toBeFocused();
    await cell(page, 'Tên chi nhánh', 4).fill('Không mã');
    await page.getByRole('button', { name: 'Lưu draft' }).click();
    await expect(page.getByText('còn 3 ô lỗi')).toBeVisible();
    await expect(cell(page, 'Vùng lương tối thiểu', 2)).toBeFocused();
    await expect(cell(page, 'Mã chi nhánh', 3)).toHaveAttribute(
      'data-cell-problem',
      'keyDuplicate',
    );
    await expect(cell(page, 'Mã chi nhánh', 4)).toHaveAttribute('data-cell-problem', 'keyBlank');
    expect(supabase.ref.rpcBodies).toEqual([]);

    await cell(page, 'Vùng lương tối thiểu', 2).fill('2');
    await cell(page, 'Mã chi nhánh', 3).fill('CN03');
    await page.getByRole('button', { name: 'Xóa dòng 4' }).click();
    // Someone else saves the draft meanwhile.
    supabase.ref.draftOf('DM_CHI_NHANH')!.updated_at = '2026-11-09T08:00:00.000001+00:00';
    await page.getByRole('button', { name: 'Lưu draft' }).click();
    const conflict = dialog(page, 'Có người vừa lưu');
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: 'Tải lại' }).click();
    await expect(status(page)).toHaveText(/^3 dòng · đã lưu /);
    await expect(cell(page, 'Vùng lương tối thiểu', 2)).toHaveValue(String(branchRows(3)[1]!.vung));
  });

  test('leaving with unsaved cells asks first; published versions are read-only', async ({
    page,
    supabase,
  }) => {
    supabase.ref.seed({
      code: 'DM_CHI_NHANH',
      name: 'Danh mục chi nhánh',
      published: [{ from: '2026-01-01', rows: branchRows(2) }],
      draft: branchRows(3),
    });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions/2`);
    await cell(page, 'Tên chi nhánh', 1).fill('Đổi tên');
    await cell(page, 'Tên chi nhánh', 1).press('Tab');
    await page.getByRole('link', { name: 'Phiên bản của DM_CHI_NHANH' }).click();
    const leave = dialog(page, 'Rời trang?');
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Ở lại' }).click();
    await expect(page).toHaveURL(/\/versions\/2$/);
    await page.getByRole('link', { name: 'Phiên bản của DM_CHI_NHANH' }).click();
    await dialog(page, 'Rời trang?').getByRole('button', { name: 'Rời trang' }).click();
    await expect(page).toHaveURL(/\/versions$/);

    await page.getByRole('link', { name: 'Xem dữ liệu v1' }).click();
    await expect(grid(page).getByRole('textbox')).toHaveCount(0);
    await expect(grid(page).locator('tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Lưu draft' })).toHaveCount(0);
  });

  test('list: versions, row count, usage; discard keeps the number unused', async ({
    page,
    supabase,
  }) => {
    supabase.ref.seed({
      code: 'DM_CHI_NHANH',
      name: 'Danh mục chi nhánh',
      retired: [{ from: '2025-01-01', to: '2026-01-01', rows: branchRows(2) }],
      published: [
        { from: '2026-01-01', to: '2026-07-01', rows: branchRows(4) },
        { from: '2026-07-01', rows: branchRows(6) },
      ],
      draft: branchRows(7),
    });
    supabase.ref.usage = [
      {
        ref_table_code: 'DM_CHI_NHANH',
        flow_id: 'f1',
        flow_code: 'payroll-timesheet',
        flow_name: 'Đối chiếu bảng lương – chấm công',
        version_no: 3,
        status: 'published',
      },
    ];
    await page.goto(LIST);
    const row = page.getByRole('region', { name: 'Bảng tham chiếu' }).locator('tbody tr').first();
    await expect(row).toContainText('v3 · từ 01/07/2026');
    await expect(row).toContainText('v2 · từ 01/01/2026');
    await expect(row).toContainText('Draft');
    await expect(row).toContainText('6');
    await expect(row).toContainText('1 flow');

    await page.getByRole('link', { name: 'Sửa cột DM_CHI_NHANH' }).click();
    await expect(
      page.getByText(/bảng có trong 1 flow: Đối chiếu bảng lương – chấm công \(v3\)/),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Phiên bản', exact: true }).click();
    await page.getByRole('button', { name: 'Thao tác khác cho v4' }).click();
    await page.getByRole('menuitem', { name: 'Hủy draft v4' }).click();
    await page
      .getByRole('dialog', { name: 'Hủy draft v4?' })
      .getByRole('button', { name: 'Hủy draft' })
      .click();
    await expect(page.getByText('Đã hủy draft v4.')).toBeVisible();
    expect(supabase.ref.versions.find((v) => v.version_no === 4)?.status).toBe('discarded');
    const versions = page.getByRole('region', { name: 'Phiên bản của bảng' });
    await expect(versions.locator('tbody tr')).toHaveCount(3);
    await page.getByRole('button', { name: 'Thao tác khác cho v3' }).click();
    await page.getByRole('menuitem', { name: 'Tạo draft từ bản này v3' }).click();
    await expect(page.getByText('Đã tạo draft v5 từ v3.')).toBeVisible();
  });
});
