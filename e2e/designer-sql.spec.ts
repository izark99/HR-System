/**
 * AC-B3-48/49: the Monaco SQL editor of code.sql loads from the app origin only (script, editor
 * worker, codicon font), only when an SQL form opens, with no CSP error; autocomplete offers views,
 * columns and $params. Supabase mocked; fake configuration only.
 */
import { ADMIN, expect, SUPABASE_ORIGIN, test, type Page } from './fixtures';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';

function withSqlDraft(supabase: SupabaseMock) {
  const def = baseFlowDefinition() as Record<string, unknown> & {
    nodes: unknown[];
    edges: unknown[];
  };
  def.nodes.push({
    id: 'sql_1',
    type: 'code.sql',
    label: 'Câu SQL',
    config: { inputs: [{ port: 'luong' }], sql: 'SELECT ma_nv\nFROM luong\nORDER BY ma_nv' },
  });
  def.edges.push({ from: 'in_luong', fromPort: 'table', to: 'sql_1', toPort: 'luong' });
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
  const requests: string[] = [];
  const external: string[] = [];
  const console: string[] = [];
  page.context().on('request', (r) => {
    const url = new URL(r.url());
    requests.push(url.pathname);
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
  return { requests, external, console };
}

test('AC-B3-48/49: Monaco from the same origin, lazy, no CSP error; autocomplete views, columns, $params', async ({
  page,
  supabase,
}) => {
  withSqlDraft(supabase);
  const w = watch(page);
  await page.goto('/admin/flows/payroll-timesheet/designer');
  await expect(page.getByTestId('rf__node-cmp')).toBeVisible();
  // Not loaded until an SQL form opens.
  expect(w.requests.filter((p) => /SqlEditor-|editor\.worker|codicon/.test(p))).toEqual([]);

  // Columns of the views come from the design check (DESCRIBE needs DuckDB in the worker).
  await expect(page.getByTestId('rf__node-sql_1')).toContainText('1 cột', { timeout: 60_000 });
  await page.getByTestId('rf__node-sql_1').click();
  const editor = page.getByTestId('sql-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await expect(editor).toContainText('ORDER BY');

  // Type at the end, ask for suggestions.
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await expect(editor.locator('.monaco-editor.focused')).toBeVisible();
  await page.keyboard.type('\nWHERE luong.');
  const suggest = page.locator('.suggest-widget');
  await expect(suggest).toBeVisible();
  await expect(suggest).toContainText('ma_nv');
  await expect(suggest).toContainText('chi_nhanh');
  await page.keyboard.press('Escape');
  await page.keyboard.type('chi_nhanh = $');
  await expect(suggest).toContainText('$ky_luong');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Space');
  await expect(suggest).toContainText('luong');

  // The text reaches the document (unsaved change).
  await expect(page.getByText('Có thay đổi chưa lưu')).toBeVisible();
  await page.keyboard.press('Control+S');
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
  const saved = supabase.versions.find((v) => v.id === DRAFT_ID)!.definition as {
    nodes: { id: string; config: { sql?: string } }[];
  };
  expect(saved.nodes.find((n) => n.id === 'sql_1')!.config.sql).toContain(
    'WHERE luong.chi_nhanh = $',
  );

  expect(w.requests.some((p) => /\/assets\/SqlEditor-/.test(p))).toBe(true);
  expect(w.requests.some((p) => /\/assets\/editor\.worker-/.test(p))).toBe(true);
  expect(w.requests.some((p) => /\/assets\/codicon-.*\.ttf$/.test(p))).toBe(true);
  expect(w.external).toEqual([]);
  expect(w.console).toEqual([]);
});
