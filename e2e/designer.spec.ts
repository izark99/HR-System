/**
 * Flow Designer (spec §15.3, AC-B3-30..47). Supabase is mocked (e2e/supabase-mock.ts); fake flow
 * configurations only.
 */
import { readFileSync } from 'node:fs';
import { ADMIN, expect, test, USER, type Page } from './fixtures';
import { chooseOption } from './helpers';
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

const canvasNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const statusBar = (page: Page) => page.getByRole('button', { name: /lỗi · / });

test('smoke: the draft opens on the canvas, checked without errors', async ({ page, supabase }) => {
  withDraft(supabase);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(DESIGNER);
  await expect(canvasNode(page, 'in_luong')).toBeVisible();
  await expect(canvasNode(page, 'cmp')).toBeVisible();
  await expect(statusBar(page)).toContainText('0 lỗi');
  await page.screenshot({ path: '/tmp/claude-0/shots/designer.png' });
  await canvasNode(page, 'cmp').click();
  await page.screenshot({ path: '/tmp/claude-0/shots/designer-compare.png' });
  expect(errors).toEqual([]);
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Cấu hình' });
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Thao tác trên flow' });
const palette = (page: Page) => page.getByRole('navigation', { name: 'Thêm node' });
const handle = (page: Page, nodeId: string, port: string) =>
  page.locator(`.react-flow__handle[data-nodeid="${nodeId}"][data-handleid="${port}"]`);
const edge = (page: Page, from: string, fromPort: string, to: string, toPort: string) =>
  page.locator(`[data-testid="rf__edge-${from}.${fromPort}>${to}.${toPort}"]`);
const draftDefinition = (supabase: SupabaseMock) =>
  supabase.versions.find((v) => v.id === DRAFT_ID)!.definition as {
    nodes: { id: string; type: string }[];
    edges: unknown[];
    ui?: { notes?: { text: string }[] };
  };

async function open(page: Page) {
  await page.goto(DESIGNER);
  await expect(canvasNode(page, 'cmp')).toBeVisible();
  await expect(statusBar(page)).toContainText('0 lỗi');
}

test.describe('AC-B3-30: Users cannot reach the Designer', () => {
  test.use({ signedInAs: USER });
  test('redirected, and the Designer chunk is never requested', async ({ page }) => {
    const chunks: string[] = [];
    page.on('request', (r) => {
      if (/\/assets\/(DesignerPage|AdminLayout)-/.test(r.url())) chunks.push(r.url());
    });
    await page.goto(DESIGNER);
    await expect(page).not.toHaveURL(/designer/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(chunks).toEqual([]);
  });
});

test('AC-B3-31: a taken flow code is refused with a clear message', async ({ page, supabase }) => {
  withDraft(supabase);
  await page.goto('/admin/flows');
  await page.getByRole('button', { name: 'Tạo flow mới' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo flow mới' });
  await dialog.getByRole('button', { name: 'Tạo và mở Designer' }).click();
  await expect(dialog.getByText('Mã flow chưa đúng định dạng.')).toBeVisible();
  await expect(dialog.getByText('Hãy nhập tên flow.')).toBeVisible();
  await dialog.getByLabel('Mã flow').fill('payroll-timesheet');
  await dialog.getByLabel('Tên flow').fill('Trùng mã');
  await dialog.getByRole('button', { name: 'Tạo và mở Designer' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Mã flow này đã có');
  await expect(page).toHaveURL(/\/admin\/flows$/);
});

test('AC-B3-32/42: add, wire, refuse a doubled input port, delete, undo/redo', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await open(page);
  await palette(page)
    .getByRole('button', { name: /^Sắp xếp/ })
    .click();
  await palette(page)
    .getByRole('button', { name: /^Ghép bảng/ })
    .click();
  await toolbar(page).getByRole('button', { name: 'Tự sắp xếp' }).click();
  await handle(page, 'in_luong', 'table').dragTo(handle(page, 'sort_1', 'in'));
  await expect(edge(page, 'in_luong', 'table', 'sort_1', 'in')).toHaveCount(1);
  // A second edge into the same input port.
  await handle(page, 'in_cc', 'table').dragTo(handle(page, 'sort_1', 'in'));
  await expect(page.getByRole('alert')).toContainText('Cổng vào này đã có dây nối');
  await expect(edge(page, 'in_cc', 'table', 'sort_1', 'in')).toHaveCount(0);
  await toolbar(page).getByRole('button', { name: 'Tự sắp xếp' }).click();
  await handle(page, 'sort_1', 'out').dragTo(handle(page, 'join_1', 'left'));
  await expect(edge(page, 'sort_1', 'out', 'join_1', 'left')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);

  // Delete a node with the keyboard, then undo / redo (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y).
  await canvasNode(page, 'join_1').click();
  await page.keyboard.press('Delete');
  await expect(canvasNode(page, 'join_1')).toHaveCount(0);
  await expect(edge(page, 'sort_1', 'out', 'join_1', 'left')).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await expect(canvasNode(page, 'join_1')).toBeVisible();
  await expect(edge(page, 'sort_1', 'out', 'join_1', 'left')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+Z');
  await expect(canvasNode(page, 'join_1')).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Y');
  await expect(canvasNode(page, 'join_1')).toHaveCount(0);
  // Undo the auto-layout and node additions all the way back: nothing to save.
  const undoButton = toolbar(page).getByRole('button', { name: 'Hoàn tác' });
  while (await undoButton.isEnabled()) await undoButton.click();
  await expect(canvasNode(page, 'sort_1')).toHaveCount(0);
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
});

test('AC-B3-32: a cycle is refused with a message', async ({ page, supabase }) => {
  withDraft(supabase);
  await open(page);
  await palette(page)
    .getByRole('button', { name: /^Sắp xếp/ })
    .click();
  await palette(page)
    .getByRole('button', { name: /^Ghép bảng/ })
    .click();
  await toolbar(page).getByRole('button', { name: 'Tự sắp xếp' }).click();
  await handle(page, 'join_1', 'out').dragTo(handle(page, 'sort_1', 'in'));
  await expect(edge(page, 'join_1', 'out', 'sort_1', 'in')).toHaveCount(1);
  await toolbar(page).getByRole('button', { name: 'Tự sắp xếp' }).click();
  await handle(page, 'sort_1', 'out').dragTo(handle(page, 'join_1', 'left'));
  await expect(page.getByRole('alert')).toContainText('vòng lặp');
  await expect(edge(page, 'sort_1', 'out', 'join_1', 'left')).toHaveCount(0);
});

test('AC-B3-34/35/37/38: slot/param errors on the field, renamed key breaks compare (coral, tooltip, status bar)', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await open(page);
  const p = panel(page);

  // AC-B3-35: a second as-of date param is an error on that param.
  await p.getByRole('button', { name: 'Thêm tham số' }).click();
  const second = p
    .getByRole('group', { name: 'Tham số', exact: true })
    .locator(':scope > [role="group"]')
    .nth(1);
  await chooseOption(second.getByLabel('Kiểu', { exact: true }), 'Ngày');
  await second.getByRole('checkbox', { name: 'Dùng làm ngày hiệu lực' }).check();
  await expect(second).toContainText('flow chỉ được có 1 tham số làm ngày hiệu lực');
  await chooseOption(second.getByLabel('Kiểu', { exact: true }), 'Danh sách chọn');
  await expect(second).toContainText('cần ít nhất 1 lựa chọn');
  await second.getByRole('button', { name: 'Thêm lựa chọn' }).click();
  await second.getByLabel('Giá trị').fill('CN01');
  await expect(second).not.toContainText('cần ít nhất 1 lựa chọn');
  await toolbar(page).getByRole('button', { name: 'Hoàn tác' }).click();
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Z');
  await expect(statusBar(page)).toContainText('0 lỗi');

  // AC-B3-34: cross-field rules shown on the field.
  await p.getByRole('tab', { name: 'Input slot' }).click();
  const dataStart = p.getByLabel('Dòng dữ liệu đầu tiên');
  await dataStart.fill('3');
  await expect(dataStart).toHaveAttribute('aria-invalid', 'true');
  await expect(p).toContainText('dòng dữ liệu đầu tiên phải nằm sau các dòng tiêu đề');
  await dataStart.fill('5');
  await expect(dataStart).not.toHaveAttribute('aria-invalid', 'true');

  // AC-B3-37: rename the key column of the timesheet slot.
  await chooseOption(p.getByLabel('Mục upload đang sửa'), 'Chấm công (nhiều chi nhánh)');
  const cols = p.getByRole('group', { name: 'Các cột', exact: true });
  const key = cols.locator(':scope > [role="group"]').nth(0).getByLabel('Mã cột');
  await key.fill('ma_nhan_vien');
  await expect(
    p.getByRole('status').filter({ hasText: 'mã cũ "ma_nv" đang được dùng ở: Đối chiếu' }),
  ).toBeVisible();
  await expect(statusBar(page)).toContainText('1 lỗi');
  const card = canvasNode(page, 'cmp').locator('> div');
  await expect(card).toHaveCSS('border-top-color', 'rgb(249, 115, 98)');
  // AC-B3-38: tooltip on keyboard focus and on hover.
  await canvasNode(page, 'cmp').focus();
  const tip = canvasNode(page, 'cmp').getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('ma_nv');
  await canvasNode(page, 'cmp').blur();
  await canvasNode(page, 'in_cc').hover();
  await canvasNode(page, 'cmp').hover();
  await expect(tip).toBeVisible();
  // The status bar lists the problem and jumps to the node.
  await statusBar(page).click();
  await page.getByRole('button', { name: /^Lỗi.*ma_nv/ }).click();
  await expect(p.getByRole('heading', { name: 'Đối chiếu' })).toBeVisible();
  await expect(p.getByText(/ma_nv/).first()).toBeVisible();
});

test('AC-B3-39/40: save, then leave without prompt; unsaved changes prompt in-app and on close', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await open(page);
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
  await canvasNode(page, 'cmp').click();
  await panel(page).getByLabel('Tên node').fill('Đối chiếu công');
  await expect(page.getByText('Có thay đổi chưa lưu')).toBeVisible();

  await page.getByRole('link', { name: 'Về màn Phiên bản' }).click();
  const leave = page.getByRole('dialog', { name: 'Rời trang khi chưa lưu?' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Ở lại' }).click();
  await expect(page).toHaveURL(/designer$/);

  await toolbar(page).getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
  const saved = draftDefinition(supabase);
  expect(saved.nodes.find((n) => n.id === 'cmp')).toMatchObject({ label: 'Đối chiếu công' });
  expect(supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft')[0]).toMatchObject({
    p_version_id: DRAFT_ID,
    p_expected_updated_at: '2026-10-27T01:00:00.000001+00:00',
  });

  // Dirty again: closing the tab asks (beforeunload).
  await panel(page).getByLabel('Tên node').fill('Đối chiếu 2');
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs).toEqual(['beforeunload']);
});

test('AC-B3-41: a draft saved elsewhere is not overwritten; export or reload', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await open(page);
  // "Tab A" saves first.
  const row = supabase.versions.find((v) => v.id === DRAFT_ID)!;
  row.updated_at = '2026-10-28T03:04:00.000001+00:00';
  const before = JSON.stringify(row.definition);
  await canvasNode(page, 'cmp').click();
  await panel(page).getByLabel('Tên node').fill('Bản của tab B');
  await page.keyboard.press('Control+S');
  const dialog = page.getByRole('dialog', { name: 'Bản nháp vừa được lưu ở nơi khác' });
  await expect(dialog).toContainText(/lúc \d\d:\d\d 28\/10\/2026/);
  expect(JSON.stringify(row.definition)).toBe(before);
  await expect(dialog.getByRole('button', { name: /ghi đè/i })).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Xuất JSON thay đổi của tôi' }).click(),
  ]);
  const mine = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
    nodes: { id: string; label?: string }[];
  };
  expect(mine.nodes.find((n) => n.id === 'cmp')!.label).toBe('Bản của tab B');
  await dialog.getByRole('button', { name: 'Tải bản mới nhất' }).click();
  await expect(canvasNode(page, 'cmp')).toContainText('Đối chiếu');
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
});

test('AC-B3-43/45/46: copy/paste keeps inner edges; notes saved in ui.notes; export JSON', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await open(page);
  await canvasNode(page, 'in_luong').click();
  await canvasNode(page, 'cmp').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');
  await expect(canvasNode(page, 'input_1')).toBeVisible();
  await expect(canvasNode(page, 'compare_1')).toBeVisible();
  await expect(edge(page, 'input_1', 'table', 'compare_1', 'left')).toHaveCount(1);
  await expect(page.locator('[data-testid^="rf__edge-in_cc.table>compare_1"]')).toHaveCount(0);
  await expect(
    page.locator('[data-testid*=">compare_1."][data-testid^="rf__edge-in_"]'),
  ).toHaveCount(0);

  await toolbar(page).getByRole('button', { name: 'Thêm ghi chú' }).click();
  await panel(page).getByLabel('Nội dung ghi chú').fill('Kiểm tra lại ngưỡng OT');
  await expect(canvasNode(page, 'note_1')).toContainText('Kiểm tra lại ngưỡng OT');
  await page.keyboard.press('Control+S');
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
  const saved = draftDefinition(supabase);
  expect(saved.ui?.notes).toEqual([
    expect.objectContaining({ id: 'note_1', text: 'Kiểm tra lại ngưỡng OT' }),
  ]);
  expect(saved.nodes.map((n) => n.id)).toEqual([
    'in_luong',
    'in_cc',
    'cmp',
    'out',
    'input_1',
    'compare_1',
  ]);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    toolbar(page).getByRole('button', { name: 'Xuất JSON' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('payroll-timesheet_v2.json');
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8')) as unknown;
  expect(exported).toEqual(saved);
});

test('AC-B3-47: a published version opens read-only with "Tạo draft từ version này"', async ({
  page,
  supabase,
}) => {
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  await page.goto('/admin/flows/payroll-timesheet/versions');
  await page.getByRole('link', { name: 'Xem trong Designer v1' }).click();
  await expect(page).toHaveURL(/designer\?version=/);
  await expect(page.getByText('Chỉ xem:')).toBeVisible();
  await expect(palette(page)).toHaveCount(0);
  await expect(toolbar(page).getByRole('button', { name: 'Lưu' })).toHaveCount(0);
  await canvasNode(page, 'cmp').click();
  await expect(panel(page).getByLabel('Tên node')).toBeDisabled();
  await page.keyboard.press('Delete');
  await expect(canvasNode(page, 'cmp')).toBeVisible();
  await page.getByRole('button', { name: 'Tạo draft từ version này' }).click();
  await expect(page.getByText('Chỉ xem:')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('v2');
  expect(supabase.bodiesOf('/rest/v1/rpc/admin_create_draft_from_version')).toHaveLength(1);
});
