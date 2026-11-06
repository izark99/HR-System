/**
 * Independent checks of keyboard edge linking (AC-UI-76, spec §15 "Bàn phím"): the Ctrl+E
 * shortcut must not take the key from a text field, the list follows the selected node, and odd
 * orders of operations leave the draft consistent. Supabase is mocked; fake flow configuration
 * only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000778';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';

function withDraft(supabase: SupabaseMock, edges: unknown[] = []) {
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  supabase.versions.push({
    id: DRAFT_ID,
    flow_id: FLOW_ID,
    version_no: 2,
    status: 'draft',
    effective_from: '',
    effective_to: null,
    definition: { ...baseFlowDefinition(), edges },
    published_at: null,
    updated_at: '2026-10-27T01:00:00.000001+00:00',
  });
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Thao tác trên flow' });
const connectButton = (page: Page) => toolbar(page).getByRole('button', { name: 'Nối tới…' });
const menu = (page: Page) => page.locator('[data-connect-menu]');
const search = (page: Page) => menu(page).getByRole('combobox', { name: 'Tìm node hoặc cổng' });
const canvasNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);

async function open(page: Page) {
  await page.goto(DESIGNER);
  await expect(canvasNode(page, 'cmp')).toBeVisible();
}

async function clickNode(page: Page, id: string) {
  await canvasNode(page, id).click();
  await expect(canvasNode(page, id)).toHaveClass(/selected/);
}

test('Ctrl+E typed in a text field of the config panel does not open the list nor move focus', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await open(page);
  await clickNode(page, 'in_luong');
  const name = page.getByLabel('Tên node', { exact: true });
  await name.click();
  await expect(name).toBeFocused();
  await page.keyboard.press('Control+E');
  await expect(menu(page)).toHaveCount(0);
  await expect(name).toBeFocused();
});

test('selecting another node while the list is open closes it; reopening starts over', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await open(page);
  await clickNode(page, 'cmp');
  await connectButton(page).click();
  await expect(menu(page)).toContainText('Chọn cổng ra của Đối chiếu');
  // Pick a source port, then go to another node: the list must not keep cmp's state.
  await search(page).press('Enter');
  await expect(menu(page)).not.toContainText('Chọn cổng ra');
  await clickNode(page, 'in_luong');
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.press('Control+E');
  // Opened from the canvas selection with the keyboard shortcut.
  await expect(menu(page)).toBeVisible();
  await expect(menu(page)).not.toContainText('Chọn cổng ra');
  await expect(menu(page).getByRole('group', { name: 'Bảng lương' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  // Back on cmp: step 1 (source port) again.
  await clickNode(page, 'cmp');
  await page.keyboard.press('Control+E');
  await expect(menu(page)).toContainText('Chọn cổng ra của Đối chiếu');
});

test('fuzz: connect, undo while the list is open, connect again — one edge, no duplicate', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await open(page);
  await clickNode(page, 'in_luong');
  for (let round = 0; round < 3; round++) {
    await page.keyboard.press('Control+E');
    await expect(search(page)).toBeFocused();
    await page.keyboard.press('Enter'); // first offered target
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    // Reopen, then undo from inside the search box: the edge goes, the list must offer it again.
    await page.keyboard.press('Control+E');
    await expect(search(page)).toBeFocused();
    const before = await menu(page).getByRole('option').count();
    await page.keyboard.press('Control+Z');
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
    await expect.poll(() => menu(page).getByRole('option').count()).toBeGreaterThan(before);
    await page.keyboard.press('Escape');
    await expect(connectButton(page)).toBeFocused();
  }
  // Same edge twice through the list: the second offer of the same port must not exist.
  await page.keyboard.press('Control+E');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+E');
  await page.keyboard.press('Enter');
  const ids = await page
    .locator('.react-flow__edge')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBeLessThanOrEqual(2);
});

test('Ctrl+E typed in the Monaco SQL editor does not open the list nor move focus', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  const row = supabase.versions.find((v) => v.id === DRAFT_ID)!;
  const def = row.definition as { nodes: unknown[]; edges: unknown[] };
  def.nodes.push({
    id: 'sql_1',
    type: 'code.sql',
    label: 'Câu SQL',
    config: { inputs: [{ port: 'luong' }], sql: 'SELECT ma_nv\nFROM luong' },
  });
  await open(page);
  await clickNode(page, 'sql_1');
  const editor = page.getByTestId('sql-editor');
  await editor.locator('.view-lines').click();
  await expect(editor.locator('.monaco-editor.focused')).toBeVisible();
  await page.keyboard.press('Control+E');
  await expect(menu(page)).toHaveCount(0);
  await expect(editor.locator('.monaco-editor.focused')).toBeVisible();
});
