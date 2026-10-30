/**
 * QA (verifier) — transform.formula preview with a sample file must not leak data (spec §12.2,
 * data-privacy rules, AC-B4-20/42/44): no request outside the app/Supabase, no request body,
 * storage, console message or generated-SQL view containing a cell value. Fake data only.
 */
import { ADMIN, expect, SUPABASE_ORIGIN, test, type Page } from './fixtures';
import { fixtures, persistedState, pickMonth, recordRequests, textCellValues } from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
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
        // A constant, a param and cell-derived text: none may reach the SQL view or a warning.
        {
          key: 'nhan',
          title: 'Nhãn',
          formula: '=UPPER([ma_nv])&"-HS-"&PARAM("ky_luong")',
          type: 'string',
          onError: 'blank',
        },
        { key: 'ot_moi_phep', title: 'OT mỗi phép', formula: '=[ot]/[phep]' },
      ],
    },
  });
  def.edges.push({ from: 'in_luong', fromPort: 'table', to: 'formula_1', toPort: 'in' });
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  supabase.versions.push({
    id: '00000000-0000-4000-8000-000000000778',
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
}

test('formula preview with a sample file: no data in network, storage, console or SQL view', async ({
  page,
  supabase,
}) => {
  withFormulaDraft(supabase);
  const requests = recordRequests(page);
  const consoleText: string[] = [];
  page.on('console', (m) => consoleText.push(m.text()));
  const files = fixtures('bang_luong_');
  // Names, IDs, branch codes of the sample files (fake data).
  const values = textCellValues(files, 5);
  expect(values.length).toBeGreaterThan(20);

  await openFormula(page);
  await page.getByRole('button', { name: 'Dữ liệu mẫu và xem trước' }).click();
  const panel = page.getByRole('region', { name: 'Dữ liệu mẫu và xem trước' });
  await panel.getByLabel('File mẫu cho Bảng lương (nhiều chi nhánh)').setInputFiles(files);
  await expect(panel.getByRole('status').filter({ hasText: '75 dòng' })).toHaveCount(1);
  await pickMonth(page, '2026-09', panel.getByRole('button', { name: /Kỳ lương/ }));
  await panel.getByRole('button', { name: 'Xem trước Công thức' }).click();
  await expect(panel.getByRole('columnheader', { name: 'Nhãn' })).toBeVisible({ timeout: 60_000 });
  // A date in & becomes its Excel serial (2026-09-01 = 46266), like Excel.
  await expect(panel).toContainText('NV00001-HS-46266');
  await expect(panel).toContainText('#DIV/0!');

  // The warning shows counts and row numbers only.
  const warningText = (await panel.getByText('các ô này được để trống').allTextContents()).join(
    '\n',
  );
  expect(warningText).not.toEqual('');
  for (const v of values) expect(warningText).not.toContain(v);

  // Generated SQL: placeholders, no constant, no param value, no cell value (AC-B4-42).
  await page.getByRole('button', { name: 'Xem SQL đã sinh' }).first().click();
  const sqlView = page.getByRole('region', { name: 'SQL đã sinh (chỉ đọc)' }).first();
  await expect(sqlView).toContainText('$1');
  const sql = (await sqlView.textContent()) ?? '';
  expect(sql).not.toContain('-HS-');
  expect(sql).not.toContain('2026-09');
  expect(sql).not.toContain('46266');
  for (const v of values) expect(sql).not.toContain(v);

  // Network: nothing outside the app / Supabase; no request body with a cell value.
  for (const r of requests) {
    const url = new URL(r.url);
    if (!['blob:', 'data:'].includes(url.protocol)) {
      expect([new URL(page.url()).origin, SUPABASE_ORIGIN], r.url).toContain(url.origin);
    }
    for (const v of values) expect(r.body, r.url).not.toContain(v);
    for (const v of values) expect(r.url).not.toContain(encodeURIComponent(v));
  }
  // Storage / URL / console.
  const state = await persistedState(page);
  for (const v of values) expect(state).not.toContain(v);
  const logged = consoleText.join('\n');
  for (const v of values) expect(logged).not.toContain(v);
});
