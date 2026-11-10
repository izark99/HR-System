/**
 * Reference tables in the Designer (spec §34 AC-RT-07, 08, 10, AC-RT-02 design check): palette
 * node, table form with the preview version, preview with the sample period, list params taken
 * from a table, errors for a missing table / column. Supabase mocked; fake data only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { pickMonth } from './helpers';
import { openRefDesigner, REF_DRAFT_ID, refFlowDefinition, seedRefDraft } from './ref-run-helpers';
import type { SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const panel = (page: Page) => page.getByRole('complementary', { name: 'Cấu hình' });
const data = (page: Page) => page.getByRole('region', { name: 'Dữ liệu mẫu và xem trước' });

async function select(page: Page, id: string) {
  await expect(async () => {
    await page.getByTestId(`rf__node-${id}`).click();
    await expect(panel(page).getByLabel('Tên node', { exact: true })).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 30_000 });
}

/** Replace the draft definition (before the Designer opens). */
function editDraft(supabase: SupabaseMock, edit: (def: Record<string, unknown>) => void) {
  const draft = supabase.versions.find((v) => v.id === REF_DRAFT_ID)!;
  const def = refFlowDefinition();
  edit(def);
  draft.definition = def;
}

test('palette, table form with columns and the version a preview uses', async ({
  page,
  supabase,
}) => {
  test.setTimeout(90_000);
  seedRefDraft(supabase);
  await openRefDesigner(page);
  const palette = page.getByRole('navigation', { name: 'Thêm node' });
  await expect(
    palette.getByRole('region', { name: 'Đầu vào' }).getByText('Bảng tham chiếu', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('rf__node-ref_cn')).not.toContainText('lỗi');

  await select(page, 'ref_cn');
  const p = panel(page);
  await expect(p.getByRole('combobox', { name: 'Bảng' })).toHaveText(
    /DM_CHI_NHANH — Danh mục chi nhánh/,
  );
  await expect(p.locator('[data-ref-preview]')).toHaveText(
    'Xem trước dùng v2 · hiệu lực từ 01/07/2026 (hôm nay)',
  );
  await expect(p.getByText('Cột ra (3)')).toBeVisible();
  for (const key of ['ma_cn', 'ten_cn', 'vung']) await expect(p.getByText(key)).toBeVisible();

  // Sample period of the data panel decides the version (AC-RT-08).
  await page.getByRole('button', { name: 'Dữ liệu mẫu và xem trước' }).click();
  await pickMonth(page, '2026-03', data(page).getByRole('button', { name: /Kỳ lương/ }));
  await expect(p.locator('[data-ref-preview]')).toHaveText(
    'Xem trước dùng v1 · hiệu lực từ 01/01/2025 (kỳ mẫu 03/2026)',
  );
  await data(page).getByRole('button', { name: 'Xem trước Danh mục chi nhánh' }).click();
  await expect(data(page).getByText('Hiển thị 20 / 20 dòng đầu.')).toBeVisible({
    timeout: 30_000,
  });
  await pickMonth(page, '2026-09', data(page).getByRole('button', { name: /Kỳ lương/ }));
  await data(page).getByRole('button', { name: 'Xem trước Danh mục chi nhánh' }).click();
  await expect(data(page).getByText('Hiển thị 126 / 126 dòng đầu.')).toBeVisible({
    timeout: 30_000,
  });
});

test('list param from a table: form fields; a column that no longer exists is an error', async ({
  page,
  supabase,
}) => {
  seedRefDraft(supabase);
  editDraft(supabase, (def) => {
    const param = (def.params as { key: string; options?: Record<string, string> }[]).find(
      (x) => x.key === 'chi_nhanh',
    )!;
    param.options!.labelColumn = 'ten_cu';
  });
  await openRefDesigner(page);
  const p = panel(page);
  await p.getByRole('tab', { name: 'Tham số' }).click();
  await expect(p.getByRole('combobox', { name: 'Lấy lựa chọn từ' })).toHaveText('Bảng tham chiếu');
  await expect(p.getByRole('combobox', { name: 'Bảng', exact: true })).toHaveText(
    /DM_CHI_NHANH — Danh mục chi nhánh/,
  );
  await expect(p.getByRole('combobox', { name: 'Cột giá trị' })).toHaveText('ma_cn');
  await expect(
    p.getByText('Tham số "Chi nhánh": bảng "Danh mục chi nhánh" không còn cột "ten_cu".'),
  ).toBeVisible();
  await p.getByRole('combobox', { name: 'Cột nhãn' }).click();
  await page.getByRole('option', { name: 'ten_cn' }).click();
  await expect(p.getByText(/không còn cột/)).toHaveCount(0);
});

test('a table that does not exist, a table without a published version', async ({
  page,
  supabase,
}) => {
  seedRefDraft(supabase);
  supabase.ref.seed({ code: 'MAP_MA_CA', name: 'Mapping mã ca làm việc', draft: [] });
  editDraft(supabase, (def) => {
    (def.nodes as Record<string, unknown>[]).push(
      { id: 'ref_x', type: 'input.refTable', label: 'Bảng cũ', config: { refTable: 'KHONG_CO' } },
      { id: 'ref_ca', type: 'input.refTable', label: 'Mã ca', config: { refTable: 'MAP_MA_CA' } },
    );
  });
  await openRefDesigner(page);
  await select(page, 'ref_x');
  await expect(panel(page).getByText('Bảng tham chiếu "KHONG_CO" không tồn tại.')).toBeVisible();
  await select(page, 'ref_ca');
  await expect(
    panel(page).getByText(
      'Bảng tham chiếu "Mapping mã ca làm việc" chưa có phiên bản nào được publish; flow chưa chạy được.',
    ),
  ).toBeVisible();
});
