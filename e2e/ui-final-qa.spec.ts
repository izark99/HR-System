/**
 * Verifier QA of the last UI frame fix round (MEMORY 2026-11-06 18:27, AC-UI-78 rules 15–18):
 * (i) Escape inside the Publish / Create-flow dialogs (popover first, dialog second, focus kept),
 * new nodes from the palette placed in a free, visible spot (`freeSpot`), drop position kept,
 * undo removes the node just added. Supabase mocked; fake data only.
 */
import { ADMIN, expect, test, type Locator, type Page } from './fixtures';
import { rowAction } from './helpers';
import { baseFlowDefinition, flowWithCongTolerance, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1280, height: 800 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';
const POP = '[data-infotip-pop]';

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

const isFocused = (el: Locator) => el.evaluate((n) => n === document.activeElement);

/** Escape #1 closes only the popover (focus stays on its button), Escape #2 the dialog. */
async function escapeTwice(page: Page, dialog: Locator, tip: Locator) {
  await expect(page.locator(POP)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator(POP)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  expect(await isFocused(tip)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test.describe('InfoTip Escape in dialogs', () => {
  test('Publish dialog: (i) by click, Escape twice; focus back on the row', async ({
    page,
    supabase,
  }) => {
    const [v1] = supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
    v1!.change_note = 'Bản đầu tiên';
    supabase.versions.push({
      id: DRAFT_ID,
      flow_id: FLOW_ID,
      version_no: 2,
      status: 'draft',
      effective_from: '',
      effective_to: null,
      definition: flowWithCongTolerance('2'),
      published_at: null,
      updated_at: '2026-10-27T01:00:00.000001+00:00',
    });
    await page.goto('/admin/flows/payroll-timesheet/versions');
    const row = page
      .getByRole('table', { name: 'Danh sách phiên bản' })
      .getByRole('row', { name: /^v2\b/ });
    await rowAction(row, 'Publish v2');
    const dialog = page.getByRole('dialog', { name: 'Publish v2' });
    await dialog.getByLabel(/^Ghi chú thay đổi/).fill('Ghi chú giả');
    const tips = dialog.locator('[data-infotip-button]');
    expect(await tips.count()).toBeGreaterThan(0);
    await tips.first().click();
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^Ghi chú thay đổi/)).toHaveValue('Ghi chú giả');
    // Keyboard: focus the (i) again (opens), Escape closes it only.
    await tips.first().blur();
    await dialog.getByLabel(/^Ghi chú thay đổi/).focus();
    await page.keyboard.press('Shift+Tab');
    for (let i = 0; i < 20 && !(await isFocused(tips.first())); i++)
      await page.keyboard.press('Shift+Tab');
    await escapeTwice(page, dialog, tips.first());
    // Focus returns into the version table (the row's "⋯" trigger), not to <body>.
    const inTable = await page
      .getByRole('table', { name: 'Danh sách phiên bản' })
      .evaluate((t) => t.contains(document.activeElement));
    expect(inTable, 'focus back in the table after the dialog closes').toBe(true);
  });

  test('Create-flow dialog: (i) by keyboard, Escape twice; focus back on the opener', async ({
    page,
  }) => {
    await page.goto('/admin/flows');
    const opener = page.getByRole('button', { name: 'Tạo flow mới' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Tạo flow mới' });
    await dialog.getByLabel('Tên flow').fill('Flow giả');
    const tip = dialog.getByRole('button', { name: 'Giải thích: Tạo flow mới' });
    await tip.click();
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Tên flow')).toHaveValue('Flow giả');
    await tip.click(); // pin again
    await escapeTwice(page, dialog, tip);
    expect(await isFocused(opener)).toBe(true);
  });
});

/** Screen boxes of every node on the canvas. */
async function nodeBoxes(page: Page) {
  return page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.getAttribute('data-id') ?? '', x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
}

async function settle(page: Page) {
  const viewport = page.locator('.react-flow__viewport');
  let last = '';
  await expect
    .poll(
      async () => {
        const now = (await viewport.getAttribute('style')) ?? '';
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [200] },
    )
    .toBe(true);
}

const palette = (page: Page) => page.getByRole('navigation', { name: 'Thêm node' });

test.describe('new node from the palette (freeSpot)', () => {
  test('10 nodes in a row: none overlaps, all in view, zoom within limits; undo removes the last', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await page.goto(DESIGNER);
    await expect(page.getByTestId('rf__node-cmp')).toBeVisible({ timeout: 30_000 });
    await settle(page);
    const before = (await nodeBoxes(page)).map((b) => b.id);
    const added: string[] = [];
    for (let i = 0; i < 10; i++) {
      await palette(page)
        .getByRole('button', { name: /^Sắp xếp/ })
        .click();
      await expect(page.locator('.react-flow__node')).toHaveCount(before.length + i + 1);
      await settle(page);
      const ids = (await nodeBoxes(page)).map((b) => b.id);
      added.push(ids.find((id) => !before.includes(id) && !added.includes(id))!);
    }
    const boxes = await nodeBoxes(page);
    const pane = (await page.locator('.react-flow').boundingBox())!;
    const covers = await page
      .locator('.react-flow__minimap, .react-flow__controls')
      .evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        }),
      );
    const overlap = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number },
    ) =>
      a.x < b.x + b.w - 0.5 &&
      b.x < a.x + a.w - 0.5 &&
      a.y < b.y + b.h - 0.5 &&
      b.y < a.y + a.h - 0.5;
    const issues: string[] = [];
    for (const id of added) {
      const a = boxes.find((b) => b.id === id)!;
      for (const b of boxes)
        if (b.id !== id && overlap(a, b)) issues.push(`${id} overlaps ${b.id}`);
      if (
        a.x < pane.x ||
        a.y < pane.y ||
        a.x + a.w > pane.x + pane.width ||
        a.y + a.h > pane.y + pane.height
      )
        issues.push(`${id} outside the visible canvas`);
      for (const c of covers) if (overlap(a, c)) issues.push(`${id} under minimap/controls`);
    }
    expect(issues).toEqual([]);
    const zoom = await page
      .locator('.react-flow__viewport')
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    expect(zoom).toBeGreaterThanOrEqual(0.2 - 1e-6);
    await page
      .getByRole('button', { name: /^Hoàn tác/ })
      .first()
      .click();
    await expect(page.getByTestId(`rf__node-${added[9]}`)).toHaveCount(0);
    await expect(page.getByTestId(`rf__node-${added[8]}`)).toHaveCount(1);
    await expect(page.locator('.react-flow__node')).toHaveCount(before.length + 9);
  });

  test('drag and drop from the palette lands where it is dropped', async ({ page, supabase }) => {
    withDraft(supabase);
    await page.goto(DESIGNER);
    await expect(page.getByTestId('rf__node-cmp')).toBeVisible({ timeout: 30_000 });
    await settle(page);
    const pane = (await page.locator('.react-flow').boundingBox())!;
    const target = { x: pane.x + 40, y: pane.y + pane.height - 160 };
    const before = (await nodeBoxes(page)).map((b) => b.id);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const item = palette(page).getByRole('button', { name: /^Sắp xếp/ });
    await item.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.locator('.react-flow').dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: target.x,
      clientY: target.y,
    });
    await page.locator('.react-flow').dispatchEvent('drop', {
      dataTransfer: dt,
      clientX: target.x,
      clientY: target.y,
    });
    await expect(page.locator('.react-flow__node')).toHaveCount(before.length + 1);
    const nb = (await nodeBoxes(page)).find((b) => !before.includes(b.id))!;
    const zoom = await page
      .locator('.react-flow__viewport')
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    // Dropped node: centred on the pointer horizontally, its top 30 flow units above it.
    expect(Math.abs(nb.x + nb.w / 2 - target.x)).toBeLessThan(2);
    expect(Math.abs(nb.y + 30 * zoom - target.y)).toBeLessThan(2);
  });
});

/** Draft whose union / groupBy / compare / formula configs each fail their schema. */
function brokenDefinition(): Record<string, unknown> {
  const d = baseFlowDefinition() as {
    nodes: Array<{ id: string; type: string; label?: string; config: Record<string, unknown> }>;
    edges: unknown[];
  };
  const cmp = d.nodes.find((n) => n.id === 'cmp')!;
  const metrics = cmp.config.metrics as Array<Record<string, unknown>>;
  metrics[1] = { ...metrics[1], left: 'Sai Key' };
  d.nodes.push(
    {
      id: 'uni',
      type: 'transform.union',
      label: 'Gộp hai bảng',
      config: { inputCount: 2, sourceColumn: { key: 'nguon', labels: ['A'] } },
    },
    {
      id: 'grp',
      type: 'transform.groupBy',
      label: 'Tổng theo chi nhánh',
      config: { by: ['chi_nhanh'], aggregations: [{ key: 'tong', fn: 'sum' }] },
    },
    {
      id: 'fx',
      type: 'transform.formula',
      label: 'Cột tính',
      config: { columns: [] },
    },
  );
  d.edges.push(
    { from: 'in_luong', to: 'uni', toPort: 'in_1' },
    { from: 'in_cc', to: 'uni', toPort: 'in_2' },
    { from: 'uni', to: 'grp' },
    { from: 'grp', to: 'fx' },
  );
  return d;
}

/** Internal keys / config paths that must not show in an issue text. */
const INTERNAL =
  /\b(sourceColumn|labels|aggregations|metrics|columns|inputCount|carryColumns|sideLabels)\b|\b[a-z]+\.\d+(\.[a-z]+)?\b|"(left|right|column|key)"/;

test.describe('issue text names fields by their labels (issue-text.ts)', () => {
  test('union / groupBy / compare / formula: status bar list and node panels', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase, brokenDefinition());
    await page.goto(DESIGNER);
    await expect(page.getByTestId('rf__node-uni')).toBeVisible({ timeout: 30_000 });
    const status = page.getByRole('button', { name: /lỗi · / });
    await expect(status).not.toContainText('0 lỗi', { timeout: 30_000 });
    await status.click();
    const items = page.getByRole('button', { name: /^(Lỗi|Cảnh báo) / });
    await expect(items.first()).toBeVisible();
    const listText = (await items.allInnerTexts()).join('\n');
    console.log('STATUS LIST:\n' + listText);
    expect(listText).not.toMatch(INTERNAL);
    for (const name of ['Gộp hai bảng', 'Tổng theo chi nhánh', 'Cột tính']) {
      expect(listText).toContain(name);
    }
    await page.keyboard.press('Escape');
    for (const [id, expected] of [
      ['grp', 'Giá trị chưa hợp lệ hoặc còn thiếu.'],
      ['cmp', 'Bảng lương không có cột "Sai Key".'],
      ['fx', 'Giá trị chưa hợp lệ hoặc còn thiếu.'],
    ] as const) {
      const texts = await panelIssueText(page, id);
      expect(texts).toContain(expected);
      expect(texts).not.toMatch(INTERNAL);
      expect(texts).not.toMatch(/Node "/);
    }
  });
});

/** Issue texts (coral) shown in the config panel of node `id`, without the delete button. */
async function panelIssueText(page: Page, id: string): Promise<string> {
  const node = page.getByTestId(`rf__node-${id}`);
  await expect(async () => {
    await node.click({ timeout: 3000 });
    await expect(node).toHaveClass(/selected/, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const panel = page.getByRole('complementary', { name: 'Cấu hình' });
  return (await panel.locator('.text-coral-text, [role="status"]').allInnerTexts()).join('\n');
}

test.describe('union panel', () => {
  test('a "sourceColumn.labels" issue (labels count ≠ inputCount) shows in the union panel', async ({
    page,
    supabase,
  }) => {
    // The schema reports the issue on the whole list `sourceColumn.labels`: shown under the first
    // label field (was missing from the panel before).
    withDraft(supabase, brokenDefinition());
    await page.goto(DESIGNER);
    await expect(page.getByTestId('rf__node-uni')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /lỗi · / })).not.toContainText('0 lỗi', {
      timeout: 30_000,
    });
    await expect.poll(() => panelIssueText(page, 'uni'), { timeout: 5000 }).toMatch(/chưa hợp lệ/);
  });
});
