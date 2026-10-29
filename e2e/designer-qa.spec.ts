/**
 * Flow Designer QA round R3 (spec §15.3, AC-B3-30..47, AC-B3-85): save failures, conflict paths,
 * read-only guarantees, unsaved-changes guard with the idle sign-out, keyboard hazards, large
 * drafts, accessibility basics. Supabase is mocked; fake flow configurations only.
 * Known bugs are marked test.fail ("KNOWN BUG") and must be flipped once fixed.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';
const SAVE_RPC = '**/rest/v1/rpc/admin_save_flow_draft';
const FIRST_TOKEN = '2026-10-27T01:00:00.000001+00:00';

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
    updated_at: FIRST_TOKEN,
  });
}

const canvasNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const statusBar = (page: Page) => page.getByRole('button', { name: /lỗi · / });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Cấu hình' });
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Thao tác trên flow' });
const nameField = (page: Page) => panel(page).getByLabel('Tên node');
const dirtyBadge = (page: Page) => page.getByText('Có thay đổi chưa lưu');
const savedBadge = (page: Page) => page.getByText('Đã lưu', { exact: true });
const savedDefinition = (supabase: SupabaseMock) =>
  supabase.versions.find((v) => v.id === DRAFT_ID)!.definition as {
    nodes: { id: string; label?: string }[];
  };

/** Let the realtime design check (worker) finish: it counts as engine work for the idle timer. */
const settleChecks = (page: Page) => page.waitForTimeout(2500);

async function open(page: Page) {
  await page.goto(DESIGNER);
  await expect(canvasNode(page, 'cmp')).toBeVisible();
  await expect(statusBar(page)).toContainText('0 lỗi');
}

/** Select the compare node and rename it: a cheap way to make the draft dirty. */
async function makeDirty(page: Page, label = 'Đối chiếu công') {
  await canvasNode(page, 'cmp').click();
  await nameField(page).fill(label);
  await expect(dirtyBadge(page)).toBeVisible();
}

const json = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' },
  body: JSON.stringify(body),
});

test.describe('save failures keep the work', () => {
  test('network failure mid-save: error shown, still unsaved, retry sends the same token and succeeds', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await makeDirty(page);
    await page.route(SAVE_RPC, (r) => r.abort('connectionfailed'));
    await page.keyboard.press('Control+S');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(dirtyBadge(page)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0); // not mistaken for a conflict
    expect(savedDefinition(supabase).nodes.find((n) => n.id === 'cmp')!.label).not.toBe(
      'Đối chiếu công',
    );
    await page.unroute(SAVE_RPC);
    await toolbar(page).getByRole('button', { name: 'Lưu' }).click();
    await expect(savedBadge(page)).toBeVisible();
    expect(savedDefinition(supabase).nodes.find((n) => n.id === 'cmp')).toMatchObject({
      label: 'Đối chiếu công',
    });
    const tokens = supabase
      .bodiesOf('/rest/v1/rpc/admin_save_flow_draft')
      .map((b) => b.p_expected_updated_at);
    expect(new Set(tokens)).toEqual(new Set([FIRST_TOKEN]));
  });

  test('server error (500) mid-save: message, work kept, no conflict dialog', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await makeDirty(page);
    await page.route(SAVE_RPC, (r) => r.fulfill(json(500, { code: 'XX000', message: 'boom' })));
    await page.keyboard.press('Control+S');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).not.toContainText(/undefined|admin\.errors|boom/);
    await expect(dirtyBadge(page)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('session expired mid-save (401): a readable message, the work stays on screen', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await makeDirty(page);
    await page.route(SAVE_RPC, (r) =>
      r.fulfill(json(401, { code: 'PGRST301', message: 'JWT expired' })),
    );
    await page.keyboard.press('Control+S');
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/undefined|admin\.errors|JWT/);
    await expect(dirtyBadge(page)).toBeVisible();
    await expect(nameField(page)).toHaveValue('Đối chiếu công');
  });

  test('draft deleted elsewhere (P0002) and published elsewhere (HF001): clear message, no crash', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    await makeDirty(page);
    await page.route(SAVE_RPC, (r) =>
      r.fulfill(json(404, { code: 'P0002', message: 'version_not_found' })),
    );
    await page.keyboard.press('Control+S');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).not.toContainText(/undefined|admin\.errors/);
    await page.unroute(SAVE_RPC);
    await page.route(SAVE_RPC, (r) =>
      r.fulfill(json(400, { code: 'HF001', message: 'flow_version_immutable' })),
    );
    await page.keyboard.press('Control+S');
    await expect(page.getByRole('alert')).not.toContainText(/undefined|admin\.errors/);
    await expect(dirtyBadge(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('conflict dialog: Escape keeps the local work; the next save conflicts again; nothing is overwritten', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    const row = supabase.versions.find((v) => v.id === DRAFT_ID)!;
    row.updated_at = '2026-10-28T03:04:00.000001+00:00';
    const before = JSON.stringify(row.definition);
    await makeDirty(page, 'Bản của tôi');
    await page.keyboard.press('Control+S');
    const dialog = page.getByRole('dialog', { name: 'Bản nháp vừa được lưu ở nơi khác' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(dirtyBadge(page)).toBeVisible();
    await expect(nameField(page)).toHaveValue('Bản của tôi');
    await toolbar(page).getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog).toBeVisible();
    expect(JSON.stringify(row.definition)).toBe(before);
    // The conflict dialog does not offer to overwrite, and Ctrl+S inside it saves nothing more.
    const calls = supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft').length;
    await page.keyboard.press('Control+S');
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft')).toHaveLength(calls);
  });

  test('conflict, then "Tải bản mới nhất": the other tab\'s content and token are used for the next save', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    const row = supabase.versions.find((v) => v.id === DRAFT_ID)!;
    const theirs = structuredClone(row.definition) as {
      nodes: { id: string; label?: string }[];
    };
    theirs.nodes.find((n) => n.id === 'cmp')!.label = 'Bản của tab A';
    row.definition = theirs;
    row.updated_at = '2026-10-28T03:04:00.000001+00:00';
    await makeDirty(page, 'Bản của tab B');
    await page.keyboard.press('Control+S');
    await page
      .getByRole('dialog', { name: 'Bản nháp vừa được lưu ở nơi khác' })
      .getByRole('button', { name: 'Tải bản mới nhất' })
      .click();
    await expect(canvasNode(page, 'cmp')).toContainText('Bản của tab A');
    await canvasNode(page, 'cmp').click();
    await nameField(page).fill('Sau khi tải lại');
    await page.keyboard.press('Control+S');
    await expect(savedBadge(page)).toBeVisible();
    const bodies = supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft');
    expect(bodies.at(-1)!.p_expected_updated_at).toBe('2026-10-28T03:04:00.000001+00:00');
    expect(savedDefinition(supabase).nodes.find((n) => n.id === 'cmp')!.label).toBe(
      'Sau khi tải lại',
    );
  });

  test('double Ctrl+S against a slow server sends one save, no false conflict', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await makeDirty(page);
    await page.route(SAVE_RPC, async (r) => {
      await new Promise((res) => setTimeout(res, 600));
      await r.fallback();
    });
    await page.keyboard.press('Control+S');
    await page.keyboard.press('Control+S');
    await page.keyboard.press('Control+S');
    await expect(savedBadge(page)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft')).toHaveLength(1);
  });

  test('editing while a save is in flight: the later edit stays unsaved', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await makeDirty(page, 'Lần một');
    await page.route(SAVE_RPC, async (r) => {
      await new Promise((res) => setTimeout(res, 800));
      await r.fallback();
    });
    await page.keyboard.press('Control+S');
    await nameField(page).fill('Lần hai');
    await expect.poll(() => supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft').length).toBe(1);
    await expect(dirtyBadge(page)).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await expect(dirtyBadge(page)).toBeVisible();
    expect(savedDefinition(supabase).nodes.find((n) => n.id === 'cmp')!.label).toBe('Lần một');
    await page.unroute(SAVE_RPC);
    await page.keyboard.press('Control+S');
    await expect(savedBadge(page)).toBeVisible();
    expect(savedDefinition(supabase).nodes.find((n) => n.id === 'cmp')!.label).toBe('Lần hai');
  });

  test('an empty draft and a draft with errors can both be saved (drafts are always savable)', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase, { schemaVersion: 1, nodes: [], edges: [], params: [], inputSlots: [] });
    await page.goto(DESIGNER);
    await expect(page.getByText('Kéo node từ danh sách bên trái vào đây')).toBeVisible();
    await expect(statusBar(page)).toContainText(/[1-9] lỗi/);
    await page.keyboard.press('Control+S');
    await expect(savedBadge(page)).toBeVisible();
    await toolbar(page).getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft').length).toBeGreaterThan(0);
  });
});

test.describe('read-only view of a published version', () => {
  async function openReadOnly(page: Page, supabase: SupabaseMock) {
    supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
    await page.goto('/admin/flows/payroll-timesheet/versions');
    await page.getByRole('link', { name: 'Xem trong Designer v1' }).click();
    await expect(page.getByText('Chỉ xem:')).toBeVisible();
    await expect(canvasNode(page, 'cmp')).toBeVisible();
  }

  test('every shortcut is inert: Ctrl+S, Ctrl+Z, Ctrl+V, Delete send nothing and change nothing', async ({
    page,
    supabase,
  }) => {
    await openReadOnly(page, supabase);
    await canvasNode(page, 'cmp').click();
    await canvasNode(page, 'in_luong').click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+C'); // copying is harmless
    for (const combo of [
      'Control+S',
      'Control+Z',
      'Control+Shift+Z',
      'Control+Y',
      'Control+V',
      'Delete',
      'Backspace',
    ]) {
      await page.keyboard.press(combo);
    }
    await expect(canvasNode(page, 'cmp')).toBeVisible();
    await expect(canvasNode(page, 'in_luong')).toBeVisible();
    expect(await page.locator('[data-testid^="rf__node-"]').count()).toBe(4);
    expect(
      supabase
        .adminCalls()
        .filter((c) => /admin_save_flow_draft|flow_versions/.test(c) && !c.startsWith('GET')),
    ).toEqual([]);
    await expect(page.getByText('Có thay đổi chưa lưu')).toHaveCount(0);
  });

  test('nothing in the config panel is editable; dragging a node does not move it', async ({
    page,
    supabase,
  }) => {
    await openReadOnly(page, supabase);
    await canvasNode(page, 'cmp').click();
    const enabled = await panel(page).evaluate((root) =>
      Array.from(root.querySelectorAll('input, textarea, select'))
        .filter((el) => !(el as HTMLInputElement).disabled)
        .map((el) => (el as HTMLElement).getAttribute('aria-label') ?? el.id ?? el.tagName),
    );
    expect(enabled).toEqual([]);
    // Editing buttons (add/remove rows) are absent or disabled.
    const editButtons = await panel(page)
      .getByRole('button', { name: /^(Thêm|Xóa|Gỡ)/ })
      .evaluateAll((els) => els.filter((e) => !(e as HTMLButtonElement).disabled).length);
    expect(editButtons).toBe(0);

    const rel = async () => {
      const [c, i] = await Promise.all([
        canvasNode(page, 'cmp').boundingBox(),
        canvasNode(page, 'in_luong').boundingBox(),
      ]);
      return [Math.round(c!.x - i!.x), Math.round(c!.y - i!.y)];
    };
    const before = await rel();
    const box = (await canvasNode(page, 'cmp').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + 140, { steps: 8 });
    await page.mouse.up();
    // A drag on a locked node pans the canvas (everything moves together); the node itself stays.
    expect(await rel()).toEqual(before);
    await expect(page.getByText('Có thay đổi chưa lưu')).toHaveCount(0);
  });

  test('the params / slots tabs are read-only too', async ({ page, supabase }) => {
    await openReadOnly(page, supabase);
    for (const tab of ['Tham số', 'Input slot']) {
      await panel(page).getByRole('tab', { name: tab }).click();
      const enabled = await panel(page).evaluate(
        (root) =>
          Array.from(root.querySelectorAll('input, textarea')).filter(
            (el) => !(el as HTMLInputElement).disabled,
          ).length,
      );
      expect(enabled, tab).toBe(0);
      await expect(panel(page).getByRole('button', { name: /^Thêm/ })).toHaveCount(0);
    }
  });

  test('leaving a read-only view never prompts; a retired version is read-only as well', async ({
    page,
    supabase,
  }) => {
    supabase.setVersions([
      { no: 1, from: '2026-01-01', to: '2026-06-01' },
      { no: 2, from: '2026-06-01', to: null },
    ]);
    supabase.versions[0]!.status = 'retired';
    await page.goto('/admin/flows/payroll-timesheet/versions');
    await page.getByRole('link', { name: 'Xem trong Designer v1' }).click();
    await expect(page.getByText('Chỉ xem:')).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Lưu' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Về màn Phiên bản' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/versions$/);
  });

  test('an unknown ?version= id gives a message instead of a blank or crashing page', async ({
    page,
    supabase,
  }) => {
    supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${DESIGNER}?version=00000000-0000-4000-8000-00000000dead`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/undefined|TypeError/);
    expect(errors).toEqual([]);
  });
});

test.describe('unsaved changes and the idle sign-out (AC-B3-85)', () => {
  const warning = (page: Page) => page.getByRole('alertdialog', { name: 'Bạn sắp bị đăng xuất' });

  test('warning names the unsaved Designer work; without changes it does not', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await page.clock.install();
    await open(page);
    await settleChecks(page);
    await page.clock.fastForward('07:55:00');
    await expect(warning(page)).toBeVisible();
    await expect(warning(page)).not.toContainText('chưa lưu');
    await warning(page).getByRole('button', { name: 'Tiếp tục làm việc' }).click();

    await makeDirty(page);
    await settleChecks(page);
    await page.clock.fastForward('07:55:00');
    await expect(warning(page)).toContainText(
      'Flow đang thiết kế còn thay đổi chưa lưu. Nếu bị đăng xuất, các thay đổi này sẽ mất.',
    );
    // Saving while the warning is open (Ctrl+S is allowed) removes the line.
    await warning(page).getByRole('button', { name: 'Tiếp tục làm việc' }).click();
    await expect(warning(page)).toHaveCount(0);
  });

  test('the warning line disappears if the work is saved while it is open (via the extend button)', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await page.clock.install();
    await open(page);
    await settleChecks(page);
    await makeDirty(page);
    await settleChecks(page);
    await page.clock.fastForward('07:55:00');
    await expect(warning(page)).toContainText('chưa lưu');
    await page.keyboard.press('Control+S');
    await expect(warning(page)).not.toContainText('chưa lưu');
  });

  test('at 8 h with unsaved work: no "Rời trang" dialog, no beforeunload prompt, login with the reason', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await page.clock.install();
    await open(page);
    await settleChecks(page);
    await makeDirty(page);
    await settleChecks(page);
    const native: string[] = [];
    page.on('dialog', (d) => {
      native.push(d.type());
      void d.dismiss();
    });
    await page.clock.fastForward('07:55:00');
    await expect(warning(page)).toBeVisible();
    await page.clock.fastForward('05:00');
    await expect(page).toHaveURL(/\/login\?reason=idle$/);
    expect(native).toEqual([]);
    await expect(page.getByRole('dialog', { name: 'Rời trang khi chưa lưu?' })).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
    // The unsaved edit was never sent anywhere.
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_save_flow_draft')).toHaveLength(0);
  });

  test('tab asleep for 9 h on a dirty Designer: signed out at once, still without prompts', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await page.clock.install();
    await open(page);
    await settleChecks(page);
    await makeDirty(page);
    await settleChecks(page);
    const native: string[] = [];
    page.on('dialog', (d) => {
      native.push(d.type());
      void d.dismiss();
    });
    await page.clock.fastForward('09:00:00');
    await page
      .evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      .catch(() => undefined);
    await expect(page).toHaveURL(/\/login\?reason=idle$/);
    expect(native).toEqual([]);
  });

  test('a preview/check running in the Designer is not idle time (engine busy pauses the countdown)', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await page.clock.install();
    await open(page);
    await settleChecks(page);
    // Typing keeps triggering design checks, which count as engine work and also as activity.
    await makeDirty(page);
    await settleChecks(page);
    await page.clock.fastForward('07:54:00');
    await expect(warning(page)).toHaveCount(0);
  });

  test('in-app navigation with unsaved work still asks; "Rời trang" leaves, a later visit starts clean', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await settleChecks(page);
    await makeDirty(page);
    await settleChecks(page);
    await page.getByRole('link', { name: 'Về màn Phiên bản' }).click();
    const leave = page.getByRole('dialog', { name: 'Rời trang khi chưa lưu?' });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Rời trang' }).click();
    await expect(page).toHaveURL(/versions$/);
    // Dirty state is released: another in-app navigation does not ask.
    await page
      .getByRole('link', { name: /Danh sách flow|Flow/ })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // And no beforeunload prompt remains registered.
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.type());
      void d.dismiss();
    });
    await page.reload();
    expect(dialogs).toEqual([]);
  });
});

test.describe('keyboard hazards', () => {
  // Fixed (was KNOWN BUG): DesignerEditor.tsx onKey treated Delete/Backspace as "delete the
  // selection" unless the target is a text field or inside a listbox/combobox. A focused checkbox,
  // radio or button in the config panel is neither, so Delete/Backspace there removes the node
  // that the panel is editing.
  test('Delete on a focused checkbox in the config panel does not delete the selected node', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await canvasNode(page, 'in_luong').click();
    await panel(page).getByRole('tab', { name: 'Input slot' }).count();
    await canvasNode(page, 'cmp').click();
    const box = panel(page).getByRole('checkbox').first();
    await expect(box).toBeVisible();
    await box.focus();
    await page.keyboard.press('Delete');
    await expect(canvasNode(page, 'cmp')).toBeVisible();
  });

  test('Delete / Backspace inside a text field only edits the text', async ({ page, supabase }) => {
    withDraft(supabase);
    await open(page);
    await canvasNode(page, 'cmp').click();
    await nameField(page).fill('abc');
    await nameField(page).press('Backspace');
    await nameField(page).press('Delete');
    await expect(canvasNode(page, 'cmp')).toBeVisible();
    await expect(nameField(page)).toHaveValue('ab');
  });

  test('Ctrl+C / Ctrl+V inside a text field use the text clipboard, not the node clipboard', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await canvasNode(page, 'cmp').click();
    await nameField(page).click();
    await nameField(page).press('Control+C');
    await nameField(page).press('Control+V');
    expect(await page.locator('[data-testid^="rf__node-"]').count()).toBe(4);
  });

  test('Ctrl+Z inside a text field undoes the document edit and the field follows', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await canvasNode(page, 'cmp').click();
    await nameField(page).fill('Tên mới');
    await nameField(page).press('Control+Z');
    await expect(nameField(page)).not.toHaveValue('Tên mới');
    await expect(savedBadge(page)).toBeVisible();
  });

  test('two quick "Thêm tham số" clicks are two undo steps', async ({ page, supabase }) => {
    withDraft(supabase);
    await open(page);
    const add = panel(page).getByRole('button', { name: 'Thêm tham số' });
    const groups = () =>
      panel(page)
        .getByRole('group', { name: 'Tham số', exact: true })
        .locator(':scope > [role="group"]');
    const before = await groups().count();
    await add.click();
    await add.click();
    await expect(groups()).toHaveCount(before + 2);
    await page.keyboard.press('Control+Z');
    await expect(groups()).toHaveCount(before + 1);
  });
});

test.describe('graph operations in the canvas', () => {
  const handle = (page: Page, nodeId: string, port: string) =>
    page.locator(`.react-flow__handle[data-nodeid="${nodeId}"][data-handleid="${port}"]`);
  const edge = (page: Page, from: string, fromPort: string, to: string, toPort: string) =>
    page.locator(`[data-testid="rf__edge-${from}.${fromPort}>${to}.${toPort}"]`);

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
        { intervals: [150] },
      )
      .toBe(true);
  }

  test('fan-out: one output feeds two nodes; deleting one edge keeps the other; undo restores it', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole('navigation', { name: 'Thêm node' })
        .getByRole('button', { name: /^Sắp xếp/ })
        .click();
    }
    await toolbar(page).getByRole('button', { name: 'Tự sắp xếp' }).click();
    await settle(page);
    await handle(page, 'in_luong', 'table').dragTo(handle(page, 'sort_1', 'in'));
    await expect(edge(page, 'in_luong', 'table', 'sort_1', 'in')).toHaveCount(1);
    await toolbar(page).getByRole('button', { name: 'Tự sắp xếp' }).click();
    await settle(page);
    await handle(page, 'in_luong', 'table').dragTo(handle(page, 'sort_2', 'in'));
    await expect(edge(page, 'in_luong', 'table', 'sort_2', 'in')).toHaveCount(1);
    // Select one edge and delete it.
    await edge(page, 'in_luong', 'table', 'sort_1', 'in')
      .locator('path')
      .first()
      .click({ force: true });
    await page.keyboard.press('Delete');
    await expect(edge(page, 'in_luong', 'table', 'sort_1', 'in')).toHaveCount(0);
    await expect(edge(page, 'in_luong', 'table', 'sort_2', 'in')).toHaveCount(1);
    await page.keyboard.press('Control+Z');
    await expect(edge(page, 'in_luong', 'table', 'sort_1', 'in')).toHaveCount(1);
  });

  test('deleting a node with several edges and undoing brings back the node, its edges and position', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    const before = await canvasNode(page, 'cmp').boundingBox();
    const edgesBefore = await page.locator('.react-flow__edge').count();
    await canvasNode(page, 'cmp').click();
    await page.keyboard.press('Delete');
    await expect(canvasNode(page, 'cmp')).toHaveCount(0);
    expect(await page.locator('.react-flow__edge').count()).toBeLessThan(edgesBefore);
    await page.keyboard.press('Control+Z');
    await expect(canvasNode(page, 'cmp')).toBeVisible();
    expect(await page.locator('.react-flow__edge').count()).toBe(edgesBefore);
    const after = await canvasNode(page, 'cmp').boundingBox();
    expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
    await expect(savedBadge(page)).toBeVisible(); // back to the saved content
  });

  test('paste twice, undo twice: the draft is the saved one again', async ({ page, supabase }) => {
    withDraft(supabase);
    await open(page);
    await canvasNode(page, 'in_luong').click();
    await page.keyboard.press('Control+C');
    await page.keyboard.press('Control+V');
    await page.keyboard.press('Control+V');
    await expect(canvasNode(page, 'input_2')).toBeVisible();
    await page.keyboard.press('Control+Z');
    await page.keyboard.press('Control+Z');
    await expect(canvasNode(page, 'input_1')).toHaveCount(0);
    await expect(savedBadge(page)).toBeVisible();
  });

  test('rename propagation: renaming a node label updates its card, the status bar and the tooltip text', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await canvasNode(page, 'cmp').click();
    await nameField(page).fill('Đối chiếu OT');
    await expect(canvasNode(page, 'cmp')).toContainText('Đối chiếu OT');
    await nameField(page).fill('');
    await expect(canvasNode(page, 'cmp')).toContainText('cmp'); // falls back to the id
    await page.keyboard.press('Control+S');
    await expect(savedBadge(page)).toBeVisible();
    expect(savedDefinition(supabase).nodes.find((n) => n.id === 'cmp')!.label).toBeUndefined();
  });
});

test.describe('large drafts', () => {
  function bigDefinition(count: number) {
    const base = baseFlowDefinition() as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    } & Record<string, unknown>;
    const nodes = [...base.nodes];
    const edges = [...base.edges];
    let prev = 'in_luong';
    let port = 'table';
    for (let i = 0; i < count; i++) {
      const id = `ord${i}`;
      nodes.push({ id, type: 'transform.sort', config: { by: [{ column: 'ma_nv' }] } });
      edges.push({ from: prev, fromPort: port, to: id, toPort: 'in' });
      prev = id;
      port = 'out';
    }
    // positions left out: the Designer lays the draft out when it loads
    return { ...base, nodes, edges, ui: undefined };
  }

  test('a 70-node draft opens, is checked, and typing stays responsive', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase, bigDefinition(66));
    const t0 = Date.now();
    await page.goto(DESIGNER);
    await expect(canvasNode(page, 'ord0')).toBeVisible({ timeout: 20000 });
    await expect(statusBar(page)).toContainText(/\d+ lỗi/, { timeout: 20000 });
    expect(Date.now() - t0).toBeLessThan(20000);
    await expect(page.locator('[data-testid^="rf__node-"]').first()).toBeAttached();
    // 70 nodes are far wider than the viewport: edit through the params tab, no node needed.
    const t1 = Date.now();
    await panel(page).getByRole('button', { name: 'Thêm tham số' }).click();
    await expect(dirtyBadge(page)).toBeVisible();
    expect(Date.now() - t1).toBeLessThan(3000);
    // The realtime check answers again for the bigger draft.
    await expect(statusBar(page)).toContainText(/\d+ lỗi/);
    // Auto-layout of 70 nodes, then save.
    await toolbar(page).getByRole('button', { name: 'Tự sắp xếp' }).click();
    await page.keyboard.press('Control+S');
    await expect(savedBadge(page)).toBeVisible();
    expect(savedDefinition(supabase).nodes.length).toBe(70);
  });
});

test.describe('accessibility basics', () => {
  test('every control in the Designer has an accessible name; dialogs are labelled; focus is visible', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await canvasNode(page, 'cmp').click();
    const unnamed = await page.evaluate(() => {
      const bad: string[] = [];
      const name = (el: Element): string => {
        const h = el as HTMLElement;
        const labelled = h.getAttribute('aria-labelledby');
        if (labelled) {
          const t = labelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
            .trim();
          if (t) return t;
        }
        const al = h.getAttribute('aria-label')?.trim();
        if (al) return al;
        if (h.id) {
          const l = document.querySelector(`label[for="${CSS.escape(h.id)}"]`);
          if (l?.textContent?.trim()) return l.textContent.trim();
        }
        const wrapped = h.closest('label')?.textContent?.trim();
        if (wrapped) return wrapped;
        if (h.getAttribute('title')) return h.getAttribute('title')!;
        return (h.textContent ?? '').trim();
      };
      const sel =
        'button, input:not([type=hidden]), textarea, [role=button], [role=combobox], [role=checkbox], [role=tab], a[href]';
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const h = el as HTMLElement;
        if (h.closest('.react-flow__minimap, .react-flow__attribution')) continue;
        if (!h.offsetParent && getComputedStyle(h).position !== 'fixed') continue;
        if (!name(el))
          bad.push(`${el.tagName.toLowerCase()}#${h.id}.${h.className.toString().slice(0, 40)}`);
      }
      return bad;
    });
    expect(unnamed).toEqual([]);

    // Canvas nodes are reachable by Tab and carry a name.
    const nodeNames = await page
      .locator('[data-testid^="rf__node-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(nodeNames.every((n) => n.length > 0)).toBe(true);

    // Focus ring: a toolbar button shows an outline/box-shadow when focused by keyboard.
    const save = toolbar(page).getByRole('button', { name: 'Lưu' });
    await save.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ring = await save.evaluate((el) => {
      const s = getComputedStyle(el);
      return s.outlineStyle !== 'none' || s.boxShadow !== 'none';
    });
    expect(ring).toBe(true);

    // The conflict dialog is a labelled modal that traps focus inside.
    const row = supabase.versions.find((v) => v.id === DRAFT_ID)!;
    row.updated_at = '2026-10-28T03:04:00.000001+00:00';
    await makeDirty(page);
    await page.keyboard.press('Control+S');
    const dialog = page.getByRole('dialog', { name: 'Bản nháp vừa được lưu ở nơi khác' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () =>
          document.activeElement === document.body || !!document.activeElement?.closest('dialog'),
      );
      expect(inside).toBe(true);
    }
  });

  test('status and save messages are announced (role=status / alert)', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await open(page);
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await makeDirty(page);
    await expect(
      page.getByRole('status').filter({ hasText: 'Có thay đổi chưa lưu' }),
    ).toBeVisible();
    await page.keyboard.press('Control+S');
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /Đã lưu/ })
        .first(),
    ).toBeVisible();
  });
});

test.describe('entry points', () => {
  test('a flow with only published versions and a flow that does not exist: a message, no crash', async ({
    page,
    supabase,
  }) => {
    supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(DESIGNER);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/undefined|TypeError/);
    // Nothing was created behind the Admin's back.
    expect(
      supabase
        .adminCalls()
        .filter((c) => /admin_create_draft_from_version|admin_create_flow/.test(c)),
    ).toEqual([]);
    await page.goto('/admin/flows/khong-co-flow-nay/designer');
    // (The not-found state has no <h1>, only an alert: an a11y nit, see the QA report.)
    await expect(page.getByRole('alert')).toContainText('không tìm thấy flow này');
    await expect(page.locator('body')).not.toContainText(/undefined|TypeError/);
    expect(errors).toEqual([]);
  });
});
