/**
 * Tab "Văn bản giao diện" (spec §33, AC-TX-01..11): Admins edit UI texts; the edited texts apply
 * to every user (also before sign-in), to the lazily loaded Designer texts and to the engine
 * worker's messages. Fake data only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import {
  employees,
  fixtures,
  openFlow,
  payroll,
  payrollInput,
  payrollList,
  reportCard,
  timesheetInput,
  timesheetList,
} from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

const URL = '/admin/ui-text';
const STAMP = '2026-11-09T02:30:00+00:00';

function preset(supabase: SupabaseMock, rows: Record<string, string | null>): void {
  supabase.uiTexts = Object.entries(rows).map(([key, value]) => ({
    key,
    value,
    updated_by: ADMIN.id,
    updated_at: STAMP,
  }));
}

const card = (page: Page) => page.getByRole('region', { name: 'Danh sách văn bản' });
const table = (page: Page) => page.getByRole('region', { name: 'Văn bản giao diện' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Sửa văn bản' });
const rowOf = (page: Page, code: string) =>
  table(page)
    .locator('tbody tr')
    .filter({ has: page.getByRole('button', { name: `Sửa ${code}`, exact: true }) });

async function search(page: Page, text: string): Promise<void> {
  await card(page).getByLabel('Tìm').fill(text);
}

test.describe('Admin', () => {
  test.use({ signedInAs: ADMIN });

  test('menu item, every text listed, search without diacritics, filter by screen', async ({
    page,
  }) => {
    await page.goto('/admin/users');
    const nav = page.getByRole('navigation', { name: 'Menu Admin' });
    await nav.getByRole('link', { name: 'Văn bản giao diện' }).click();
    await expect(page).toHaveURL(/\/admin\/ui-text$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sửa câu chữ trên giao diện');
    const count = card(page).locator('[data-ui-text-count]');
    await expect(count).toHaveText(/^1\.\d{3} \/ 1\.\d{3} dòng · 0 đã sửa$/);
    await expect(page.getByRole('button', { name: 'Khôi phục tất cả' })).toBeDisabled();

    await search(page, 'dang nhap');
    await expect(rowOf(page, 'auth.login.title')).toBeVisible();
    // Search by code too.
    await search(page, 'formula.fn.IF.desc');
    await expect(rowOf(page, 'designer:formula.fn.IF.desc')).toContainText('Bảng tra hàm');
    await search(page, 'chữ không tồn tại ở đâu cả');
    await expect(card(page)).toContainText('Không có dòng nào khớp.');
    await expect(count).toHaveText(/^0 \/ 1\.\d{3} dòng · 0 đã sửa$/);

    await search(page, '');
    await card(page).getByRole('combobox', { name: 'Màn' }).click();
    await page.getByRole('option', { name: 'Kiểm tra file' }).click();
    await expect(rowOf(page, 'engine:validation.required')).toBeVisible();
    await expect(rowOf(page, 'auth.login.title')).toHaveCount(0);
  });

  test('edit: toast, the tab shows the new text at once, stored with author', async ({
    page,
    supabase,
  }) => {
    await page.goto(URL);
    await search(page, 'admin.nav.uiText');
    const row = rowOf(page, 'admin.nav.uiText');
    await expect(row).toContainText('Mặc định');
    await expect(
      row.getByRole('button', { name: 'Khôi phục mặc định admin.nav.uiText' }),
    ).toBeDisabled();
    await row.getByRole('button', { name: 'Sửa admin.nav.uiText' }).click();
    const d = dialog(page);
    await expect(d).toContainText('admin.nav.uiText · Chung');
    const box = d.getByLabel('Chữ mới');
    await expect(box).toBeFocused();
    const save = d.getByRole('button', { name: 'Lưu' });
    await expect(save).toBeDisabled(); // unchanged
    await box.fill('Câu chữ giao diện');
    await expect(d).toContainText('Câu chữ giao diện'); // preview
    await save.click();
    await expect(d).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toContainText(
      'Đã lưu "admin.nav.uiText". Người dùng thấy chữ mới ở lần mở trang sau.',
    );
    // This tab: the menu label changed without a reload.
    await expect(
      page
        .getByRole('navigation', { name: 'Menu Admin' })
        .getByRole('link', { name: 'Câu chữ giao diện' }),
    ).toBeVisible();
    await expect(row).toContainText('Đã sửa');
    await expect(row).toContainText(/admin · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(supabase.uiTexts).toEqual([
      expect.objectContaining({
        key: 'common:admin.nav.uiText',
        value: 'Câu chữ giao diện',
        updated_by: ADMIN.id,
      }),
    ]);
    // Esc closes the dialog and gives the focus back to the pencil.
    await row.getByRole('button', { name: 'Sửa admin.nav.uiText' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(row.getByRole('button', { name: 'Sửa admin.nav.uiText' })).toBeFocused();
  });

  test('variables: missing / extra / HTML block Save; {{count}} keeps the default format', async ({
    page,
    supabase,
  }) => {
    await page.goto(URL);
    await search(page, 'flows.runNamed');
    await rowOf(page, 'flows.runNamed').getByRole('button', { name: 'Sửa flows.runNamed' }).click();
    const d = dialog(page);
    const box = d.getByLabel('Chữ mới');
    const save = d.getByRole('button', { name: 'Lưu' });
    await expect(d.locator('[data-var-chip="ok"]')).toContainText('{{name}}');
    await box.fill('Chạy ngay');
    await expect(d).toContainText('Thiếu biến {{name}}');
    await expect(d.locator('[data-var-chip="missing"]')).toHaveCount(1);
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    await expect(save).toBeDisabled();
    await box.fill('Chạy {{name}} {{ten}}');
    await expect(d).toContainText('Biến {{ten}} không có trong bản gốc');
    await expect(save).toBeDisabled();
    await box.fill('Chạy <b>{{name}}</b>');
    await expect(d).toContainText('không nhận thẻ HTML');
    await expect(save).toBeDisabled();
    await box.fill('');
    await expect(d).toContainText('Chữ không được để trống');
    await box.fill('x'.repeat(60) + '{{name}}');
    await expect(d).toContainText('Dài quá 40 ký tự');
    await expect(save).toBeDisabled();
    await d.getByRole('button', { name: 'Hủy' }).click();

    // AC-TX-11: typed without the format, stored with the default's format.
    await search(page, 'result.titleMismatched');
    await rowOf(page, 'result.titleMismatched')
      .getByRole('button', { name: 'Sửa result.titleMismatched' })
      .click();
    await dialog(page).getByLabel('Chữ mới').fill('{{count}} người lệch kỳ {{period}}');
    await dialog(page).getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect
      .poll(() => supabase.uiTexts.map((r) => r.value))
      .toEqual(['{{count, number}} người lệch kỳ {{period}}']);
  });

  test('restore one row (table and dialog) and restore all with a confirmation', async ({
    page,
    supabase,
  }) => {
    preset(supabase, {
      'common:auth.login.title': 'Đăng nhập hệ thống',
      'common:flows.title': 'Chọn flow',
      'designer:palette.title': 'Thêm bước',
      'common:nav.runFlows': null, // restored earlier: shows as default
    });
    await page.goto(URL);
    const count = card(page).locator('[data-ui-text-count]');
    await expect(count).toContainText('· 3 đã sửa');
    await card(page).getByRole('checkbox', { name: 'Chỉ dòng đã sửa' }).check();
    await expect(table(page).locator('tbody tr')).toHaveCount(3);

    await rowOf(page, 'flows.title')
      .getByRole('button', { name: 'Khôi phục mặc định flows.title' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã khôi phục' })).toContainText(
      'Đã khôi phục mặc định "flows.title".',
    );
    await expect(count).toContainText('· 2 đã sửa');
    expect(supabase.uiTexts.find((r) => r.key === 'common:flows.title')?.value).toBeNull();

    await rowOf(page, 'designer:palette.title')
      .getByRole('button', { name: 'Sửa designer:palette.title' })
      .click();
    await dialog(page).getByRole('button', { name: 'Khôi phục mặc định' }).click();
    await expect(count).toContainText('· 1 đã sửa');

    await page.getByRole('button', { name: 'Khôi phục tất cả' }).click();
    const confirm = page.getByRole('dialog', { name: 'Khôi phục 1 dòng về mặc định?' });
    await expect(confirm).toContainText('Không hoàn tác được.');
    await expect(confirm.getByRole('button', { name: 'Hủy' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Khôi phục tất cả' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'về mặc định' })).toContainText(
      'Đã khôi phục 1 dòng về mặc định.',
    );
    await expect(card(page)).toContainText('Không có dòng nào khớp.');
    await expect(page.getByRole('button', { name: 'Khôi phục tất cả' })).toBeDisabled();
    // Rows are kept with value null (never removed, AC-TX-06).
    expect(supabase.uiTexts.map((r) => r.value)).toEqual([null, null, null, null]);
    expect(supabase.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  test('edited Designer texts apply when the Designer namespace loads', async ({
    page,
    supabase,
  }) => {
    preset(supabase, { 'designer:toolbar.label': 'Công cụ của flow' });
    supabase.versions.push({
      id: '00000000-0000-4000-8000-000000000777',
      flow_id: '00000000-0000-4000-8000-0000000000f1',
      version_no: 4,
      status: 'draft',
      effective_from: '',
      effective_to: null,
      definition: baseFlowDefinition(),
      published_at: null,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/flows/payroll-timesheet/designer');
    await expect(page.getByRole('toolbar', { name: 'Công cụ của flow' })).toBeVisible();
  });

  test('another tab sees an edited text after a reload', async ({ page, supabase, context }) => {
    await page.goto(URL);
    await search(page, 'flows.title');
    await rowOf(page, 'flows.title').getByRole('button', { name: 'Sửa flows.title' }).click();
    await dialog(page).getByLabel('Chữ mới').fill('Hôm nay chạy flow nào?');
    await dialog(page).getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog(page)).toBeHidden();
    const other = await context.newPage();
    await supabase.signInAs(other, ADMIN);
    await other.goto('/');
    await expect(other.getByRole('heading', { level: 1 })).toHaveText('Hôm nay chạy flow nào?');
    expect(supabase.uiTexts).toHaveLength(1);
  });
});

test.describe('every user', () => {
  test.use({ signedInAs: null });

  test('the login page shows the edited text before sign-in (anon read)', async ({
    page,
    supabase,
  }) => {
    preset(supabase, { 'common:auth.login.title': 'Đăng nhập HR Data Flow' });
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập HR Data Flow');
    const read = supabase.calls.find((c) => c.path.startsWith('/rest/v1/ui_text_overrides'))!;
    expect(decodeURIComponent(read.path)).toContain('select=key,value');
    expect(decodeURIComponent(read.path)).not.toContain('updated_by');
  });

  test('read failure: defaults, the app still opens', async ({ page, supabase }) => {
    supabase.uiTextFailure = { status: 500, code: 'XX000', sticky: true };
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
  });

  test('a slow read does not block the app for long (defaults first)', async ({
    page,
    supabase,
  }) => {
    supabase.uiTextDelayMs = 10_000;
    preset(supabase, { 'common:auth.login.title': 'Muộn' });
    const start = Date.now();
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
    expect(Date.now() - start).toBeLessThan(8_000);
  });
});

test('file check messages from the engine worker use the edited text', async ({
  page,
  supabase,
}) => {
  preset(supabase, {
    'engine:validation.unique':
      'Trùng "{{column}}": "{{value}}" ({{file}} dòng {{row}}) và "{{otherValue}}" ({{otherFile}} dòng {{otherRow}}).',
  });
  await openFlow(page);
  await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
  await expect(timesheetList(page).getByTestId('file-status')).toHaveText([
    /\d+ dòng/,
    /\d+ dòng/,
    /\d+ dòng/,
  ]);
  await payrollInput(page).setInputFiles([
    payroll('luong_A.xlsx', employees(5, 1)),
    payroll('luong_B.xlsx', employees(3, 5, 'CN02')),
  ]);
  await expect(payrollList(page).getByTestId('file-status')).toHaveText(['1 lỗi', '1 lỗi']);
  await expect(reportCard(page).locator('tbody tr').first()).toContainText(
    'Trùng "Mã NV": "NV00005" (luong_B.xlsx dòng 5) và "NV00005" (luong_A.xlsx dòng 9).',
  );
});
