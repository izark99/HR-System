/**
 * Reference tables on the run page (spec §34 round 2): the acceptance flow plus an
 * `input.refTable` node per table (the branch list feeds an `output.preview`), a list param taken
 * from the branch list, and fake reference data. Never personal data.
 */
import { expect, type Page } from './fixtures';
import { pickMonth } from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';
import { branchRows, type MockRefRow } from './supabase-mock-ref';

export const REF_FLOW_VERSION = '00000000-0000-4000-8000-000000000203';

export function refFlowDefinition(): Record<string, unknown> {
  const def = baseFlowDefinition() as Record<string, unknown> & {
    params: Record<string, unknown>[];
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
  def.params.push({
    key: 'chi_nhanh',
    label: 'Chi nhánh',
    type: 'select',
    options: { fromRefTable: 'DM_CHI_NHANH', valueColumn: 'ma_cn', labelColumn: 'ten_cn' },
  });
  def.nodes.push(
    {
      id: 'ref_cn',
      type: 'input.refTable',
      label: 'Danh mục chi nhánh',
      config: { refTable: 'DM_CHI_NHANH' },
    },
    {
      id: 'ref_hs',
      type: 'input.refTable',
      label: 'Hệ số phụ cấp',
      config: { refTable: 'HE_SO_PHU_CAP' },
    },
    { id: 'xem_cn', type: 'output.preview', config: { title: 'Chi nhánh', maxRows: 1000 } },
  );
  def.edges.push({ from: 'ref_cn', to: 'xem_cn' });
  return def;
}

export const HE_SO_COLUMNS = [
  { key: 'bac', title: 'Bậc', type: 'integer' as const, aliases: [], isKey: true },
  { key: 'he_so', title: 'Hệ số', type: 'decimal' as const, aliases: [], isKey: false },
];

function heSoRows(): MockRefRow[] {
  return Array.from({ length: 7 }, (_, i) => ({ bac: i + 1, he_so: `${1 + i / 10}` }));
}

/**
 * Flow v3 effective from 2025-01-01; branch list v1 [2025-01-01, 2026-07-01) 20 rows and v2 from
 * 2026-07-01 (126 rows); allowance rates only from 2026-01-01 (v1). `heSo`: rows of the rates
 * version (e.g. cells that no longer fit the column type).
 */
export function seedRefRun(supabase: SupabaseMock, heSo: MockRefRow[] = heSoRows()): void {
  supabase.setVersions([{ no: 3, from: '2025-01-01', definition: refFlowDefinition() }]);
  supabase.ref.seed({
    code: 'DM_CHI_NHANH',
    name: 'Danh mục chi nhánh',
    published: [
      { from: '2025-01-01', to: '2026-07-01', rows: branchRows(20) },
      { from: '2026-07-01', rows: branchRows(126) },
    ],
  });
  supabase.ref.seed({
    code: 'HE_SO_PHU_CAP',
    name: 'Hệ số phụ cấp theo bậc',
    columns: HE_SO_COLUMNS,
    published: [{ from: '2026-01-01', rows: heSo }],
    draft: [{ bac: 1, he_so: '9' }],
  });
}

export const refBox = (page: Page) => page.locator('[data-ref-versions]');

export async function openRefFlow(page: Page, period: string): Promise<void> {
  await page.goto('/run/payroll-timesheet');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Đối chiếu bảng lương/);
  await pickMonth(page, period);
  await expect(refBox(page)).not.toContainText('Đang tải');
}

export const REF_DRAFT_ID = '00000000-0000-4000-8000-000000000781';

/** `seedRefRun` + a v4 draft of the same definition, opened in the Designer. */
export function seedRefDraft(supabase: SupabaseMock): void {
  seedRefRun(supabase);
  supabase.versions.push({
    id: REF_DRAFT_ID,
    flow_id: '00000000-0000-4000-8000-0000000000f1',
    version_no: 4,
    status: 'draft',
    effective_from: '',
    effective_to: null,
    definition: refFlowDefinition(),
    published_at: null,
    updated_at: '2026-10-27T01:00:00.000001+00:00',
  });
}

/** Designer of the draft with the reference table nodes, checked. */
export async function openRefDesigner(page: Page): Promise<void> {
  await page.goto('/admin/flows/payroll-timesheet/designer');
  await expect(page.getByTestId('rf__node-ref_cn')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /lỗi · |Không có lỗi/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
