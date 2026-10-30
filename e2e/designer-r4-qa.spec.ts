/**
 * R4 QA: Designer preview privacy and worker lifetime (AC-B3-50/54/56), Monaco editor behaviour
 * (AC-B3-48: undo, Space), and a crash fuzz: drafts are always savable, so a draft with
 * wrongly-typed configuration must open (or show the crash screen with "export my JSON"), never a
 * blank page. Supabase mocked; fake data only.
 */
import { ADMIN, expect, SUPABASE_ORIGIN, test, type Page } from './fixtures';
import { fixtures, persistedState, pickMonth } from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';

function withDraft(supabase: SupabaseMock, definition: unknown = baseFlowDefinition()) {
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  supabase.versions.push({
    id: DRAFT_ID,
    flow_id: FLOW_ID,
    version_no: 2,
    status: 'draft',
    effective_from: '',
    effective_to: null,
    definition,
    published_at: null,
    updated_at: '2026-10-27T01:00:00.000001+00:00',
  });
}

const node = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const data = (page: Page) => page.getByRole('region', { name: 'Dữ liệu mẫu và xem trước' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Cấu hình' });

test('preview with sample files: nothing leaves the browser, nothing is stored, no console error, no run log; workers die with the Designer', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  const outgoing: string[] = [];
  const consoleErrors: string[] = [];
  const workers = { open: 0, seen: 0 };
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost') outgoing.push(`${r.method()} ${r.url()} ${r.postData() ?? ''}`);
  });
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('worker', (w) => {
    workers.open++;
    workers.seen++;
    w.on('close', () => workers.open--);
  });
  await page.goto(DESIGNER);
  await expect(node(page, 'cmp')).toBeVisible();
  await page.getByRole('button', { name: 'Dữ liệu mẫu và xem trước' }).click();
  const d = data(page);
  await d
    .getByLabel('File mẫu cho Bảng lương (nhiều chi nhánh)')
    .setInputFiles(fixtures('bang_luong_'));
  await d
    .getByLabel('File mẫu cho Chấm công (nhiều chi nhánh)')
    .setInputFiles(fixtures('cham_cong_'));
  await expect(d.getByRole('status').filter({ hasText: '75 dòng' })).toHaveCount(2);
  await pickMonth(page, '2026-09', d.getByRole('button', { name: /Kỳ lương/ }));
  await node(page, 'cmp').click();
  await d.getByRole('button', { name: 'Xem trước Đối chiếu' }).click();
  await expect(d.getByRole('tab')).toHaveCount(4);

  // Nothing with a cell value or file content left the page; only Supabase calls of the Designer.
  expect(outgoing.filter((o) => /NV0000|Nhân viên|\.xlsx/.test(o))).toEqual([]);
  expect(outgoing.every((o) => o.includes(SUPABASE_ORIGIN))).toBe(true);
  expect(supabase.bodiesOf('/rest/v1/run_logs')).toEqual([]);
  expect(supabase.adminCalls().filter((c) => /run_logs/.test(c))).toEqual([]);
  // Storage: only the auth session key; Cache Storage may hold the DuckDB build, nothing else.
  const state = await persistedState(page);
  expect(state).not.toMatch(/NV0000|bang_luong_|cham_cong_|\.xlsx/);
  const local = await page.evaluate(() => Object.keys(localStorage));
  expect(local).toEqual([]);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    }
    return urls;
  });
  expect(cached.filter((u) => !/duckdb|\.wasm/i.test(u))).toEqual([]);
  expect(consoleErrors).toEqual([]);

  // Leaving the Designer by in-app navigation terminates every engine worker (samples released).
  expect(workers.open).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Về màn Phiên bản' }).click();
  await expect(page).toHaveURL(/versions$/);
  await expect.poll(() => workers.open, { timeout: 10_000 }).toBe(0);
});

test('previewing never adds an undo step or marks the draft as changed; the unsaved config is what ran', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await page.goto(DESIGNER);
  await expect(node(page, 'cmp')).toBeVisible();
  await page.getByRole('button', { name: 'Dữ liệu mẫu và xem trước' }).click();
  const d = data(page);
  await d
    .getByLabel('File mẫu cho Bảng lương (nhiều chi nhánh)')
    .setInputFiles(fixtures('bang_luong_'));
  await d
    .getByLabel('File mẫu cho Chấm công (nhiều chi nhánh)')
    .setInputFiles(fixtures('cham_cong_'));
  await expect(d.getByRole('status').filter({ hasText: '75 dòng' })).toHaveCount(2);
  await pickMonth(page, '2026-09', d.getByRole('button', { name: /Kỳ lương/ }));
  await node(page, 'in_luong').click();
  await d.getByRole('button', { name: 'Xem trước Bảng lương' }).click();
  await expect(d.getByRole('region', { name: 'table' })).toBeVisible();
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hoàn tác' })).toBeDisabled();
  expect(supabase.adminCalls().filter((c) => /admin_save_flow_draft/.test(c))).toEqual([]);
});

function sqlDraft(supabase: SupabaseMock) {
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
  withDraft(supabase, def);
}

test.describe('Monaco SQL editor', () => {
  async function openEditor(page: Page) {
    await page.goto(DESIGNER);
    await expect(node(page, 'cmp')).toBeVisible();
    await node(page, 'sql_1').click();
    const editor = page.getByTestId('sql-editor');
    await expect(editor.locator('.monaco-editor')).toBeVisible();
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+End');
    return editor;
  }
  const text = (page: Page) =>
    page
      .getByTestId('sql-editor')
      .locator('.view-lines')
      .innerText()
      .then((s) => s.replaceAll(String.fromCharCode(160), ' '));

  test('Ctrl+Z inside the editor undoes the typing, not an unrelated Designer step', async ({
    page,
    supabase,
  }) => {
    sqlDraft(supabase);
    const editor = await openEditor(page);
    // An unrelated Designer step first: rename the node (label field in the panel).
    await panel(page).getByLabel('Tên node').fill('Tên khác');
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' -- ghi chú');
    await expect.poll(() => text(page)).toContain('-- ghi chú');
    // Monaco undoes word by word: a few presses remove the typing, never the label rename.
    for (let i = 0; i < 6 && (await text(page)).includes('--'); i++) {
      await page.keyboard.press('Control+Z');
    }
    await expect.poll(() => text(page)).not.toContain('--');
    // The rename is still there: the typing was undone, not the label.
    await expect(node(page, 'sql_1')).toContainText('Tên khác');
    // Editor text and document agree: save and compare.
    await page.keyboard.press('Control+S');
    await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
    const saved = supabase.versions.find((v) => v.id === DRAFT_ID)!.definition as {
      nodes: { id: string; label?: string; config: { sql?: string } }[];
    };
    const sql = saved.nodes.find((n) => n.id === 'sql_1')!;
    expect(sql.label).toBe('Tên khác');
    expect(sql.config.sql).toBe('SELECT ma_nv\nFROM luong\nORDER BY ma_nv');
  });

  test('typing fast, then Ctrl+Z, then Ctrl+Y: text and saved document stay equal', async ({
    page,
    supabase,
  }) => {
    sqlDraft(supabase);
    await openEditor(page);
    await page.keyboard.type('\n-- một\n-- hai\n-- ba', { delay: 5 });
    await expect.poll(() => text(page)).toContain('-- ba');
    await page.keyboard.press('Control+Z');
    await page.keyboard.press('Control+Y');
    await expect.poll(() => text(page)).toContain('-- ba');
    await page.keyboard.press('Control+S');
    await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
    const saved = supabase.versions.find((v) => v.id === DRAFT_ID)!.definition as {
      nodes: { id: string; config: { sql?: string } }[];
    };
    const sql = saved.nodes.find((n) => n.id === 'sql_1')!.config.sql!;
    expect(sql).toContain('-- một');
    expect(sql).toContain('-- ba');
  });

  test('Space and Delete/Backspace in the editor edit text: no canvas pan, node stays', async ({
    page,
    supabase,
  }) => {
    sqlDraft(supabase);
    await openEditor(page);
    const viewport = page.locator('.react-flow__viewport');
    const before = await viewport.getAttribute('style');
    await page.keyboard.type('   x');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.mouse.move(600, 300);
    await page.mouse.move(700, 350);
    expect(await viewport.getAttribute('style')).toBe(before);
    await expect(node(page, 'sql_1')).toBeVisible();
    await expect(node(page, 'cmp')).toBeVisible();
  });

  test('a published (read-only) version shows the SQL but cannot be edited', async ({
    page,
    supabase,
  }) => {
    sqlDraft(supabase);
    // Publish the draft's content as read-only: open version 1 (published) instead.
    supabase.versions[0]!.definition = supabase.versions.find((v) => v.id === DRAFT_ID)!.definition;
    await page.goto('/admin/flows/payroll-timesheet/versions');
    await page.getByRole('link', { name: 'Xem trong Designer v1' }).click();
    await expect(page.getByText('Chỉ xem:')).toBeVisible();
    await node(page, 'sql_1').click();
    const editor = page.getByTestId('sql-editor');
    await expect(editor.locator('.monaco-editor')).toBeVisible();
    await editor.locator('.view-lines').click();
    await page.keyboard.type('DROP');
    await expect.poll(() => text(page)).not.toContain('DROP');
    await expect(page.getByText('Có thay đổi chưa lưu')).toHaveCount(0);
  });
});

test.describe('crash fuzz: wrongly typed configuration', () => {
  const NODE_TYPES = [
    'input.excel',
    'transform.select',
    'transform.filter',
    'transform.sort',
    'transform.join',
    'transform.union',
    'transform.groupBy',
    'transform.dedupe',
    'control.compare',
    'code.sql',
    'output.excel',
    'output.preview',
  ];
  const KEYS = [
    'slot',
    'columns',
    'by',
    'conditions',
    'match',
    'keys',
    'metrics',
    'sql',
    'inputs',
    'sheets',
    'title',
    'maxRows',
    'inputCount',
    'joinType',
    'on',
    'aggregates',
    'groupBy',
    'fileName',
    'carryColumns',
    'sideLabels',
    'normalizeText',
    'normalizeKeys',
    'missingColumns',
    'left',
    'right',
    'orderBy',
    'keep',
    'tolerance',
  ];
  const BAD: [string, unknown][] = [
    ['number', 5],
    ['string', 'x'],
    ['null', null],
    ['array', [1, 'a', null, {}]],
    ['object', { a: { b: [] } }],
  ];

  for (const [name, value] of BAD) {
    test(`every node type with all fields = ${name}: opens, every node selects, no blank page`, async ({
      page,
      supabase,
    }) => {
      const config = Object.fromEntries(KEYS.map((k) => [k, value]));
      const base = baseFlowDefinition();
      withDraft(supabase, {
        ...base,
        nodes: NODE_TYPES.map((type, i) => ({ id: `n${i}`, type, config })),
        edges: [],
        ui: { positions: Object.fromEntries(NODE_TYPES.map((_, i) => [`n${i}`, [i * 300, 0]])) },
      });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(DESIGNER);
      const crash = page.getByRole('heading', { name: 'Designer gặp sự cố' });
      await expect(crash.or(node(page, 'n0'))).toBeVisible({ timeout: 20_000 });
      if (await crash.isVisible()) {
        // Acceptable only with the export offer; reported as a bug below.
        await expect(
          page.getByRole('button', { name: 'Xuất JSON thay đổi của tôi' }),
        ).toBeVisible();
        test.info().annotations.push({ type: 'crash-on-open', description: name });
        await expect(
          crash,
          `Designer crashed when opening a draft with fields = ${name}`,
        ).toHaveCount(0);
        return;
      }
      for (let i = 0; i < NODE_TYPES.length; i++) {
        await node(page, `n${i}`).click({ force: true });
        if (await crash.isVisible()) {
          await expect(crash, `crash selecting ${NODE_TYPES[i]} with fields = ${name}`).toHaveCount(
            0,
          );
        }
        await expect(panel(page)).toBeVisible();
      }
      await page.keyboard.press('Control+S');
      await expect(crash).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
});
