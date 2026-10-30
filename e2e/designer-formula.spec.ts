/**
 * transform.formula in the Designer (spec §12.2, AC-B4-40..46): Monaco editor with column and
 * function suggestions, live error markers, generated SQL without values, function reference,
 * preview with row-error warnings, keyboard and custom Select. Supabase mocked; fake data only.
 */
import { ADMIN, expect, SUPABASE_ORIGIN, test, type Page } from './fixtures';
import { fixtures, pickMonth } from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';

function withFormulaDraft(supabase: SupabaseMock) {
  const def = baseFlowDefinition() as Record<string, unknown> & {
    nodes: unknown[];
    edges: unknown[];
  };
  def.nodes.push({
    id: 'formula_1',
    type: 'transform.formula',
    label: 'Công thức',
    config: {
      columns: [
        {
          key: 'ot_moi_phep',
          title: 'OT mỗi phép',
          formula: '=[ot]/[phep]',
          type: 'auto',
          onError: 'blank',
        },
      ],
    },
  });
  def.edges.push({ from: 'in_luong', fromPort: 'table', to: 'formula_1', toPort: 'in' });
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  supabase.versions.push({
    id: DRAFT_ID,
    flow_id: FLOW_ID,
    version_no: 2,
    status: 'draft',
    effective_from: '',
    effective_to: null,
    definition: def,
    published_at: null,
    updated_at: '2026-10-27T01:00:00.000001+00:00',
  });
}

function watch(page: Page) {
  const external: string[] = [];
  const console: string[] = [];
  page.context().on('request', (r) => {
    const url = new URL(r.url());
    if (
      url.hostname !== 'localhost' &&
      url.origin !== SUPABASE_ORIGIN &&
      !['blob:', 'data:'].includes(url.protocol)
    ) {
      external.push(url.href);
    }
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) console.push(m.text());
  });
  return { external, console };
}

const side = (page: Page) => page.getByRole('complementary', { name: 'Cấu hình' });

async function openFormula(page: Page) {
  await page.goto(DESIGNER);
  const node = page.getByTestId('rf__node-formula_1');
  await expect(node).toBeVisible();
  await expect(async () => {
    await node.click();
    await expect(page.getByTestId('formula-editor-0').locator('.monaco-editor')).toBeVisible({
      timeout: 3000,
    });
  }).toPass({ timeout: 60_000 });
  return page.getByTestId('formula-editor-0');
}

/** Replace the text of a Monaco editor by typing. */
async function retype(page: Page, editor: ReturnType<Page['getByTestId']>, text: string) {
  await editor.locator('.view-lines').click();
  await expect(editor.locator('.monaco-editor.focused')).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}

test('AC-B4-40/41/42/43/46: suggestions, live errors, generated SQL, function table', async ({
  page,
  supabase,
}) => {
  withFormulaDraft(supabase);
  const w = watch(page);
  const editor = await openFormula(page);
  // Stored as [key], shown by title (AC-B4-04).
  await expect(editor).toContainText('=[OT (giờ)]/[Phép]');

  // AC-B4-40: "[" lists the input columns with title, key and type; picking inserts [Title].
  await retype(page, editor, '=[');
  const suggest = page.locator('.suggest-widget');
  await expect(suggest).toBeVisible();
  await expect(suggest).toContainText('Mã NV');
  await expect(suggest).toContainText('ma_nv');
  await expect(suggest).toContainText('Không lương');
  await page.keyboard.type('Công');
  await page.keyboard.press('Enter');
  await expect(editor).toContainText('=[Công]');
  await page.keyboard.type('*RO');
  await expect(suggest).toContainText('ROUND');
  await expect(suggest).toContainText('ROUNDUP');
  await expect(suggest).toContainText('ROUNDDOWN');
  await expect(suggest).toContainText('số_chữ_số');
  await page.keyboard.press('Escape');

  // AC-B4-41: a wrong formula is underlined shortly after typing stops, with a Vietnamese message;
  // fixing it clears the marker.
  await retype(page, editor, '=ROUND([Công];2)');
  await expect(editor.locator('.squiggly-error')).toHaveCount(1, { timeout: 2000 });
  await expect(side(page)).toContainText('dấu ";"', { timeout: 10_000 });
  await retype(page, editor, '=ROUND([Công],2)&"BÍ MẬT"');
  await expect(editor.locator('.squiggly-error')).toHaveCount(0, { timeout: 2000 });
  await expect(side(page)).not.toContainText('dấu ";"', { timeout: 10_000 });

  // The document stores keys.
  await page.keyboard.press('Control+S');
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
  const saved = supabase.versions.find((v) => v.id === DRAFT_ID)!.definition as {
    nodes: { id: string; config: { columns?: { formula: string }[] } }[];
  };
  expect(saved.nodes.find((n) => n.id === 'formula_1')!.config.columns![0]!.formula).toBe(
    '=ROUND([cong],2)&"BÍ MẬT"',
  );

  // AC-B4-42: read-only SQL with $n placeholders, no constant values.
  await side(page).getByRole('button', { name: 'Xem SQL đã sinh' }).click();
  const sql = page.getByTestId('formula-sql');
  await expect(sql).toContainText('$1');
  await expect(sql).toContainText('"cong"');
  await expect(sql).not.toContainText('BÍ MẬT');

  // AC-B4-43: the reference lists all functions by group, with syntax and example.
  await side(page).getByRole('button', { name: 'Hàm hỗ trợ' }).click();
  const fnTable = side(page).getByRole('region', { name: /Hàm hỗ trợ/ });
  await expect(fnTable.locator('tbody tr')).toHaveCount(41);
  await expect(fnTable.getByRole('table', { name: 'Logic' })).toContainText('IFERROR(giá_trị');
  await expect(fnTable.getByRole('table', { name: 'Ngày' })).toContainText('DATEDIF');
  await expect(fnTable).toContainText('Ví dụ');

  expect(w.external).toEqual([]);
  expect(w.console).toEqual([]);
});

test('AC-B4-44/45: preview with row-error warnings; keyboard list editing; custom Select', async ({
  page,
  supabase,
}) => {
  withFormulaDraft(supabase);
  await openFormula(page);
  const form = side(page);

  // AC-B4-45: no native <select>; type and onError use the custom Select.
  await expect(form.locator('select')).toHaveCount(0);
  await form.getByRole('combobox', { name: 'Khi một dòng tính lỗi' }).click();
  await page.getByRole('option', { name: 'Dừng lần chạy' }).click();
  await form.getByRole('combobox', { name: 'Khi một dòng tính lỗi' }).click();
  await page.getByRole('option', { name: 'Để trống ô và cảnh báo' }).click();
  await expect(form.getByRole('combobox', { name: 'Kiểu kết quả' })).toContainText(
    'Tự động (Số thập phân)',
  );

  // Add with the keyboard, reorder and remove with labelled buttons.
  const add = form.getByRole('button', { name: 'Thêm cột công thức' });
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(form.getByRole('group', { name: 'cot_2' })).toBeVisible();
  await form.getByRole('button', { name: 'Đưa cot_2 lên' }).focus();
  await page.keyboard.press('Enter');
  await expect(form.locator('[role="group"][aria-label]').first()).toHaveAttribute(
    'aria-label',
    'cot_2',
  );
  await form.getByRole('button', { name: 'Xóa cot_2' }).focus();
  await page.keyboard.press('Enter');
  await expect(form.getByRole('group', { name: 'cot_2' })).toHaveCount(0);

  // AC-B4-44: preview of the formula node with a sample file shows the new column and the
  // row-error warning (counts and row numbers, no cell value).
  await page.getByRole('button', { name: 'Dữ liệu mẫu và xem trước' }).click();
  const panel = page.getByRole('region', { name: 'Dữ liệu mẫu và xem trước' });
  await panel
    .getByLabel('File mẫu cho Bảng lương (nhiều chi nhánh)')
    .setInputFiles(fixtures('bang_luong_'));
  await expect(panel.getByRole('status').filter({ hasText: '75 dòng' })).toHaveCount(1);
  await pickMonth(page, '2026-09', panel.getByRole('button', { name: /Kỳ lương/ }));
  await panel.getByRole('button', { name: 'Xem trước Công thức' }).click();
  await expect(panel.getByRole('columnheader', { name: 'OT mỗi phép' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(panel).toContainText('#DIV/0!');
  await expect(panel).toContainText('các ô này được để trống');
});
