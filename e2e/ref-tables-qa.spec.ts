/**
 * Verifier checks of "Bảng tham chiếu" round 1 (spec §34 AC-RT-03, 04, 05, 06, 11), independent
 * of e2e/ref-tables.spec.ts: no cell value leaves the import except in the draft save, nothing is
 * persisted, keyboard moves of the grid, undo while typing, paste over removed rows / while
 * searching, readable error of a bad cell, publish proposals (close the open version, gap), retire,
 * .xls import, axe on every screen. Fake reference data only (branch list).
 */
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, expect, test, type Locator, type Page } from './fixtures';
import { persistedState, recordRequests, workbook, XLSX } from './helpers';
import { branchRows } from './supabase-mock-ref';

const LIST = '/admin/ref-tables';
const HEAD = ['Mã CN', 'Tên chi nhánh', 'Vùng lương tối thiểu'];
const MARK = 'QAMARK';

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

test.describe('Admin', () => {
  test.use({ signedInAs: ADMIN });

  test('import: cell values only travel in the draft save; nothing persisted or logged', async ({
    page,
    supabase,
  }) => {
    const requests = recordRequests(page);
    const logs: string[] = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(String(e)));
    supabase.ref.seed({ code: 'DM_CHI_NHANH', name: 'Danh mục chi nhánh', draft: branchRows(2) });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions`);
    await page.getByRole('button', { name: 'Import Excel vào draft' }).click();
    const imp = page.getByRole('dialog', { name: 'Import Excel vào draft v1' });
    await imp.getByLabel('Chọn file Excel để import').setInputFiles(
      workbook(`${MARK}_file.xlsx`, {
        S: [HEAD, [`${MARK}01`, `${MARK} Tên`, 1], [`${MARK}02`, 'B', 2]],
      }),
    );
    await imp.getByRole('button', { name: 'Thay dữ liệu draft (2 → 2 dòng)' }).click();
    await expect(page).toHaveURL(/\/versions\/1$/);
    await expect(cell(page, 'Mã chi nhánh', 1)).toHaveValue(`${MARK}01`);

    const carrying = requests.filter((r) => r.url.includes(MARK) || r.body.includes(MARK));
    expect(carrying.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      'POST /rest/v1/rpc/admin_replace_ref_table_draft',
    ]);
    // The file name is not sent either (only the rows).
    expect(carrying[0]!.body).not.toContain(`${MARK}_file`);
    expect(logs.filter((l) => l.includes(MARK))).toEqual([]);
    expect(await persistedState(page)).not.toContain(MARK);
  });

  test('a legacy .xls file imports like an .xlsx', async ({ page, supabase }) => {
    supabase.ref.seed({ code: 'DM_CHI_NHANH', name: 'Danh mục chi nhánh', draft: [] });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions`);
    await page.getByRole('button', { name: 'Import Excel vào draft' }).click();
    const imp = page.getByRole('dialog', { name: 'Import Excel vào draft v1' });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ['CN01', 'A', 1]]), 'S');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
    await imp.getByLabel('Chọn file Excel để import').setInputFiles({
      name: 'dm.xls',
      mimeType: 'application/vnd.ms-excel',
      buffer,
    });
    await imp.getByRole('button', { name: 'Thay dữ liệu draft (0 → 1 dòng)' }).click();
    await expect(page).toHaveURL(/\/versions\/1$/);
    expect(supabase.ref.draftOf('DM_CHI_NHANH')!.rows).toEqual([
      { ma_cn: 'CN01', ten_cn: 'A', vung: 1 },
    ]);
  });

  test('grid keyboard: arrows, Enter, Tab; Ctrl+Z while typing undoes the text only', async ({
    page,
    supabase,
  }) => {
    supabase.ref.seed({ code: 'DM_CHI_NHANH', name: 'Danh mục chi nhánh', draft: branchRows(3) });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions/1`);
    const a1 = cell(page, 'Mã chi nhánh', 1);
    await a1.focus();
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, 'Mã chi nhánh', 2)).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await expect(cell(page, 'Tên chi nhánh', 2)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cell(page, 'Vùng lương tối thiểu', 2)).toBeFocused();
    await page.keyboard.press('Shift+Enter');
    await expect(cell(page, 'Vùng lương tối thiểu', 1)).toBeFocused();

    // A committed edit, then typing in another cell: Ctrl+Z undoes the typing, not the grid.
    const name1 = cell(page, 'Tên chi nhánh', 1);
    await name1.fill('Đổi một');
    await name1.press('Enter');
    await expect(status(page)).toHaveText('1 ô sửa · 0 dòng mới · 0 dòng xóa — chưa lưu');
    const name3 = cell(page, 'Tên chi nhánh', 3);
    await name3.click();
    await name3.press('End');
    await page.keyboard.type('xyz');
    await page.keyboard.press('Control+z');
    await expect(name1).toHaveValue('Đổi một');
    await expect(name3).not.toHaveValue(/xyz$/);
  });

  test('a bad cell keeps the save blocked and nothing reaches the server', async ({
    page,
    supabase,
  }) => {
    supabase.ref.seed({ code: 'DM_CHI_NHANH', name: 'Danh mục chi nhánh', draft: branchRows(2) });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions/1`);
    const v = cell(page, 'Vùng lương tối thiểu', 1);
    await v.fill('hai');
    await v.press('Tab');
    await expect(v).toHaveAttribute('aria-invalid', 'true');
    // The reason is available to assistive technology.
    await expect(v).toHaveAccessibleDescription(/số nguyên/i);
    await page.getByRole('button', { name: 'Lưu draft' }).click();
    await expect(page.getByText('còn 1 ô lỗi')).toBeVisible();
    expect(supabase.ref.rpcBodies).toEqual([]);
  });

  test('paste while searching fills the matching rows, extra lines become new rows', async ({
    page,
    supabase,
  }) => {
    supabase.ref.seed({ code: 'DM_CHI_NHANH', name: 'Danh mục chi nhánh', draft: branchRows(6) });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions/1`);
    await page.getByLabel('Tìm trong dữ liệu').fill('ha');
    // Hà Nội (CN02), Hậu Giang (CN05).
    await expect(grid(page).locator('tbody tr')).toHaveCount(2);
    await pasteInto(cell(page, 'Tên chi nhánh', 2), 'Hà Nội 2\nHậu Giang 2\nMới');
    await page.getByLabel('Tìm trong dữ liệu').fill('');
    await expect(grid(page).locator('tbody tr')).toHaveCount(7);
    await expect(cell(page, 'Tên chi nhánh', 2)).toHaveValue('Hà Nội 2');
    await expect(cell(page, 'Tên chi nhánh', 3)).toHaveValue('Cần Thơ');
    await expect(cell(page, 'Tên chi nhánh', 5)).toHaveValue('Hậu Giang 2');
    await expect(cell(page, 'Tên chi nhánh', 7)).toHaveValue('Mới');
    // The new row has no key: the save is refused and the cell is shown.
    await page.getByRole('button', { name: 'Lưu draft' }).click();
    await expect(cell(page, 'Mã chi nhánh', 7)).toHaveAttribute('data-cell-problem', 'keyBlank');
    expect(supabase.ref.rpcBodies).toEqual([]);
  });

  test('publish proposes closing the open version and warns about a gap; retire', async ({
    page,
    supabase,
  }) => {
    supabase.ref.seed({
      code: 'DM_CHI_NHANH',
      name: 'Danh mục chi nhánh',
      published: [{ from: '2026-01-01', rows: branchRows(2) }],
      draft: branchRows(3),
    });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions`);
    await page.getByRole('button', { name: 'Thao tác khác cho v2' }).click();
    await page.getByRole('menuitem', { name: 'Publish v2' }).click();
    const pub = page.getByRole('dialog', { name: 'Publish v2 của DM_CHI_NHANH' });
    const closeBox = pub.getByRole('checkbox', { name: /Kết thúc v1|Đặt v1 hiệu lực đến/ });
    await expect(closeBox).toBeChecked();
    await expect(pub).toContainText('draft thêm 1 dòng');
    // Not closing v1 → the server refuses the overlap and says which version.
    await closeBox.uncheck();
    await pub.getByLabel(/Ghi chú thay đổi/).fill('Thêm CN03');
    await pub.getByRole('button', { name: 'Publish' }).click();
    await expect(pub).toContainText('v1');
    await expect(pub).toBeVisible();
    expect(supabase.ref.versions.find((v) => v.version_no === 2)!.status).toBe('draft');
    await closeBox.check();
    await pub.getByRole('button', { name: 'Publish' }).click();
    await expect(pub).toBeHidden();
    const v1 = supabase.ref.versions.find((v) => v.version_no === 1)!;
    const v2 = supabase.ref.versions.find((v) => v.version_no === 2)!;
    expect(v2.status).toBe('published');
    expect(v1.effective_to).toBe(v2.effective_from);

    // Retire v2 → a gap from its start appears.
    await page.getByRole('button', { name: 'Thao tác khác cho v2' }).click();
    await page.getByRole('menuitem', { name: 'Retire v2' }).click();
    await page
      .getByRole('dialog', { name: 'Retire v2?' })
      .getByRole('button', { name: 'Retire' })
      .click();
    await expect(page.getByText('Đã retire v2.')).toBeVisible();
    expect(
      v2.status === 'retired' ||
        supabase.ref.versions.find((v) => v.version_no === 2)!.status === 'retired',
    ).toBe(true);
    await expect(page.getByText(/trở đi không có phiên bản hiệu lực/)).toBeVisible();
  });

  test('axe: list, columns, versions, data grid and import dialog have no violation', async ({
    page,
    supabase,
  }) => {
    supabase.ref.seed({
      code: 'DM_CHI_NHANH',
      name: 'Danh mục chi nhánh',
      published: [{ from: '2026-01-01', rows: branchRows(2) }],
      draft: branchRows(3),
    });
    const scan = async (label: string) => {
      const r = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target).join(' ')}`),
      ).toEqual([]);
    };
    await page.goto(LIST);
    await expect(page.getByRole('region', { name: 'Bảng tham chiếu', exact: true })).toBeVisible();
    await scan('list');
    await page.goto(`${LIST}/DM_CHI_NHANH`);
    await expect(page.getByRole('region', { name: 'Các cột của bảng' })).toBeVisible();
    await scan('columns');
    await page.goto(`${LIST}/DM_CHI_NHANH/versions`);
    await expect(page.getByRole('region', { name: 'Phiên bản của bảng' })).toBeVisible();
    await scan('versions');
    await page.goto(`${LIST}/DM_CHI_NHANH/versions/2`);
    await expect(grid(page)).toBeVisible();
    await cell(page, 'Vùng lương tối thiểu', 1).fill('hai');
    await cell(page, 'Vùng lương tối thiểu', 1).press('Tab');
    await scan('data grid with a bad cell');
    await page.getByRole('button', { name: 'Import Excel' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan('import dialog');
  });
});

test.describe('KNOWN BUG', () => {
  test.use({ signedInAs: ADMIN });

  // Pasting several lines over a range that contains a row marked "removed" writes one of the
  // lines into that row: the row stays removed (disabled, struck through) and its pasted values
  // are dropped at save. Expected: removed rows are skipped (or the paste restores the row).
  test.fail('paste over a removed row loses that pasted line', async ({ page, supabase }) => {
    supabase.ref.seed({ code: 'DM_CHI_NHANH', name: 'Danh mục chi nhánh', draft: branchRows(4) });
    await page.goto(`${LIST}/DM_CHI_NHANH/versions/1`);
    await page.getByRole('button', { name: 'Xóa dòng 3' }).click();
    await expect(page.locator('[data-grid-row="2"]')).toHaveAttribute('data-removed', 'true');
    await pasteInto(cell(page, 'Tên chi nhánh', 2), 'Tên A\nTên B\nTên C');
    await page.getByRole('button', { name: 'Lưu draft' }).click();
    await expect(page.getByText('Đã lưu draft v1.')).toBeVisible();
    const names = supabase.ref.draftOf('DM_CHI_NHANH')!.rows.map((r) => r.ten_cn);
    expect(names).toEqual(expect.arrayContaining(['Tên A', 'Tên B', 'Tên C']));
  });
});

test.describe('KNOWN BUG (layout)', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1280, height: 800 } });

  // ImportDialog.tsx: the "Nội dung" cell adds `whitespace-normal` to `denseTdClass`, which
  // already holds `whitespace-nowrap`; `cx` does not merge classes, so the stylesheet order wins
  // (nowrap) and the message is cut at the dialog edge (horizontal scroll to read it).
  test.fail(
    'import report: the message column wraps inside the dialog',
    async ({ page, supabase }) => {
      supabase.ref.seed({ code: 'DM_CHI_NHANH', name: 'Danh mục chi nhánh', draft: branchRows(2) });
      await page.goto(`${LIST}/DM_CHI_NHANH/versions`);
      await page.getByRole('button', { name: 'Import Excel vào draft' }).click();
      const imp = page.getByRole('dialog', { name: 'Import Excel vào draft v1' });
      await imp.getByLabel('Chọn file Excel để import').setInputFiles(
        workbook('danh_muc_chi_nhanh.xlsx', {
          S: [
            [...HEAD, 'Ghi chú'],
            ['CN01', 'A', 1, 'x'],
          ],
        }),
      );
      await expect(imp.getByText('1 cảnh báo')).toBeVisible();
      const message = imp.getByRole('cell', { name: /không có trong bảng/ });
      expect(await message.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('normal');
      const box = message.locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]');
      const [scroll, client] = await box.evaluate((el) => [el.scrollWidth, el.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(client);
    },
  );
});
