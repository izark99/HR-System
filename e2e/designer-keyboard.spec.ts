/**
 * Keyboard edge linking in the Designer (spec §15 "Bàn phím", AC-UI-76): select a node with the
 * keyboard, "Nối tới…" (Ctrl+E) opens a searchable list of the ports it can be connected to
 * (grouped by target node), Enter connects (undoable, draft marked as changed), Escape closes and
 * gives focus back; a live region announces the edge. The acceptance flow wired only with the
 * keyboard saves the same JSON as the flow wired with the mouse. Supabase is mocked; fake flow
 * configuration only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';

interface Edge {
  from: string;
  fromPort?: string;
  to: string;
  toPort: string;
}

function withDraft(supabase: SupabaseMock, definition: unknown) {
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

const draft = (supabase: SupabaseMock) =>
  structuredClone(supabase.versions.find((v) => v.id === DRAFT_ID)!.definition) as Record<
    string,
    unknown
  > & { edges: Edge[] };
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Thao tác trên flow' });
const connectButton = (page: Page) => toolbar(page).getByRole('button', { name: 'Nối tới…' });
const menu = (page: Page) => page.locator('[data-connect-menu]');
const search = (page: Page) => menu(page).getByRole('combobox', { name: 'Tìm node hoặc cổng' });
const canvasNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const edge = (page: Page, e: Required<Edge>) =>
  page.locator(`[data-testid="rf__edge-${e.from}.${e.fromPort}>${e.to}.${e.toPort}"]`);
const savedBadge = (page: Page) => page.getByText('Đã lưu', { exact: true });
const dirtyBadge = (page: Page) => page.getByText('Có thay đổi chưa lưu', { exact: true });

async function open(page: Page) {
  await page.goto(DESIGNER);
  await expect(canvasNode(page, 'cmp')).toBeVisible();
  await expect(page.getByRole('button', { name: /lỗi · / })).toBeVisible();
}

/** Tab (only the keyboard) until the canvas node `id` has focus, then Enter selects it. */
async function selectNode(page: Page, id: string) {
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(
      () => document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
    );
    if (focused === id) {
      await page.keyboard.press('Enter');
      await expect(canvasNode(page, id)).toHaveClass(/selected/);
      return;
    }
  }
  throw new Error(`node ${id} not reached with Tab`);
}

/** Text of the active option and of its group header. */
async function activeOption(page: Page): Promise<{ group: string; option: string }> {
  return search(page).evaluate((input) => {
    const id = input.getAttribute('aria-activedescendant');
    const el = id ? document.getElementById(id) : null;
    const group = el?.closest('[role="group"]');
    const header = group ? document.getElementById(group.getAttribute('aria-labelledby')!) : null;
    return { group: header?.textContent?.trim() ?? '', option: el?.textContent?.trim() ?? '' };
  });
}

/** Type in the search box, then ArrowDown until the wanted option is active, then Enter. */
async function pick(page: Page, query: string, want: { group?: string; option: string }) {
  await page.keyboard.type(query);
  for (let i = 0; i < 20; i++) {
    const a = await activeOption(page);
    if (a.option === want.option && (want.group === undefined || a.group === want.group)) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`option ${JSON.stringify(want)} not found for "${query}"`);
}

const LABEL: Record<string, string> = {
  in_luong: 'Bảng lương',
  in_cc: 'Chấm công',
  cmp: 'Đối chiếu',
  out: 'File đối chiếu',
};

test('the acceptance flow wired with the keyboard only saves the same JSON as with the mouse', async ({
  page,
  supabase,
}) => {
  test.setTimeout(120_000);
  // Reference: the acceptance flow as the Designer saves it (edges drawn with the mouse).
  withDraft(supabase, baseFlowDefinition());
  await open(page);
  await page.keyboard.press('Control+S');
  await expect(savedBadge(page)).toBeVisible();
  await expect.poll(() => supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft').length).toBe(1);
  const reference = draft(supabase);
  const edges = reference.edges.map((e) => ({ ...e, fromPort: e.fromPort ?? 'table' }));
  expect(edges).toHaveLength(6);

  // Same flow without any edge.
  const row = supabase.versions.find((v) => v.id === DRAFT_ID)!;
  row.definition = { ...reference, edges: [] };
  await open(page);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);

  // No node selected / a node without output port: the button is disabled.
  await expect(connectButton(page)).toBeDisabled();
  await expect(connectButton(page)).toHaveAttribute('aria-keyshortcuts', 'Control+E');
  await selectNode(page, 'out');
  await expect(connectButton(page)).toBeDisabled();
  await page.keyboard.press('Control+E');
  await expect(menu(page)).toHaveCount(0);

  for (const [n, e] of edges.entries()) {
    await selectNode(page, e.from);
    await page.keyboard.press('Control+E');
    await expect(menu(page)).toBeVisible();
    await expect(search(page)).toBeFocused();
    if (e.from === 'cmp') {
      // Several output ports: the source port comes first.
      await expect(menu(page)).toContainText('Chọn cổng ra của Đối chiếu');
      await pick(page, e.fromPort, { option: `Cổng ra ${e.fromPort}` });
      await expect(search(page)).toBeFocused();
      await expect(search(page)).toHaveValue('');
    }
    // Ports already connected (or closing a cycle) are not offered.
    for (const done of edges.slice(0, n)) {
      await expect(
        menu(page)
          .getByRole('group', { name: LABEL[done.to] })
          .getByRole('option', {
            name: `Cổng vào ${done.toPort}`,
            exact: true,
          }),
      ).toHaveCount(0);
    }
    await pick(page, e.toPort, {
      group: LABEL[e.to]!,
      option: `Cổng vào ${e.toPort}`,
    });
    await expect(menu(page)).toHaveCount(0);
    await expect(connectButton(page)).toBeFocused();
    await expect(edge(page, e)).toHaveCount(1);
    await expect(page.locator('[data-connect-announce]')).toHaveText(
      `Đã nối ${LABEL[e.from]}.${e.fromPort} → ${LABEL[e.to]}.${e.toPort}.`,
    );
    await expect(dirtyBadge(page)).toBeVisible();

    if (n === 0) {
      // Undoable like a mouse connection; Escape closes the list and gives focus back.
      await page.keyboard.press('Control+Z');
      await expect(edge(page, e)).toHaveCount(0);
      await page.keyboard.press('Control+Y');
      await expect(edge(page, e)).toHaveCount(1);
      await expect(connectButton(page)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(search(page)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu(page)).toHaveCount(0);
      await expect(connectButton(page)).toBeFocused();
      await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    }
  }

  await page.keyboard.press('Control+S');
  await expect(savedBadge(page)).toBeVisible();
  await expect.poll(() => supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft').length).toBe(2);
  expect(draft(supabase)).toEqual(reference);
});
