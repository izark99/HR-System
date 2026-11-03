/**
 * Design language v2 (spec §25, §28 AC-UI-03..13, 20, 30, 31): screenshots of every screen state
 * for Harold's manual review (test-results/ui-v2/, with index.html; no pixel comparison, MEMORY
 * 2026-11-03 09:07), computed-style checks and an axe WCAG 2.1 A/AA scan on each state.
 * Supabase is mocked; data is the fake fixture set only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import {
  employees,
  fixtures,
  openCreateAccount,
  payroll,
  payrollInput,
  periodButton,
  pickMonth,
  reportCard,
  runButton,
  runToResult,
  timesheet,
  timesheetInput,
  uploadFixtures,
} from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';
import {
  adminTableChecks,
  axe,
  axeLog,
  buttonChecks,
  C,
  cardChecks,
  commonChecks,
  denseTableChecks,
  designerToolbarChecks,
  DESKTOP,
  floatChecks,
  inputChecks,
  labelChecks,
  MOBILE,
  navChecks,
  paletteChecks,
  pillChecks,
  primaryChecks,
  rowActionsChecks,
  rowMenuChecks,
  shot,
  style,
  titleChecks,
  topBarChecks,
} from './ui-v2-checks';

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';
const VERSIONS = '/admin/flows/payroll-timesheet/versions';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';

test.afterAll(() => {
  // Summary of every axe scan in this worker (minor/moderate findings are reported, not blocking).
  const other = axeLog.flatMap((s) =>
    s.violations.map((v) => `${s.state}: ${v.id} (${v.impact}) x${v.n}`),
  );
  console.log(`[ui-v2] axe scans: ${axeLog.length}; non-blocking findings: ${other.length}`);
  for (const line of other) console.log(`[ui-v2]   ${line}`);
});

/** v1 published + v2 draft with the "Công" tolerance changed and a formula node. */
function withDraft(supabase: SupabaseMock) {
  const [v1] = supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  v1!.change_note = 'Bản đầu tiên';
  v1!.published_by = ADMIN.id;
  const def = baseFlowDefinition() as Record<string, unknown> & {
    nodes: { id: string; type: string; config: Record<string, unknown> }[];
    edges: unknown[];
  };
  const cmp = def.nodes.find((n) => n.type === 'control.compare');
  const metrics = cmp?.config.metrics as { tolerance?: string }[] | undefined;
  if (metrics?.[0]) metrics[0].tolerance = '2';
  def.nodes.push({
    id: 'formula_1',
    type: 'transform.formula',
    label: 'Công thức',
    config: {
      columns: [
        {
          key: 'ot_moi_phep',
          title: 'OT mỗi phép',
          formula: '=[ot]/[phep]',
          type: 'auto',
          onError: 'blank',
        },
      ],
    },
  } as never);
  def.edges.push({ from: 'in_luong', fromPort: 'table', to: 'formula_1', toPort: 'in' });
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

for (const viewport of [DESKTOP, MOBILE]) {
  const size = `${viewport.width}x${viewport.height}`;
  const mobile = viewport.width < 768;

  test.describe(`auth screens ${size}`, () => {
    test.use({ signedInAs: null, viewport });

    test('login (empty + error)', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
      await commonChecks(page);
      await titleChecks(page);
      const card = page.locator('form');
      const s = await style(card);
      expect(s.radius).toBe('12px');
      expect(s.borderTop).toBe(`1px solid ${C.line}`);
      expect(s.shadow).toBe('none');
      expect(s.paddingTop).toBe(mobile ? '24px' : '32px');
      expect(s.width).toBeLessThanOrEqual(440);
      expect((await style(page.locator('body > div > div').first())).bg).toBe(C.page);
      await inputChecks(page.locator('input'));
      await labelChecks(page.locator('form label'));
      await buttonChecks(page.getByRole('button', { name: 'Đăng nhập' }));
      await primaryChecks(page.getByRole('button', { name: 'Đăng nhập' }));
      await axe(page, `login-empty ${size}`);
      await shot(page, '01-login', 'empty');

      await page.getByLabel('Tên đăng nhập').fill('hr.nv01');
      await page.getByLabel('Mật khẩu').fill('sai-mat-khau');
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await commonChecks(page);
      await axe(page, `login-error ${size}`);
      await shot(page, '01-login', 'error');
    });
  });

  test.describe(`user screens ${size}`, () => {
    test.use({ viewport });

    test('change password', async ({ page }) => {
      await page.goto('/change-password');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đặt mật khẩu mới');
      await commonChecks(page);
      await titleChecks(page);
      await inputChecks(page.locator('form input'));
      await buttonChecks(page.locator('form button, form a'));
      // The save button is the dark variant (§25.3), the second one an outline button.
      expect((await style(page.getByRole('button', { name: 'Lưu mật khẩu' }))).bg).toBe(C.ink);
      await axe(page, `change-password ${size}`);
      await shot(page, '02-change-password', 'default');
    });

    test('flow list', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Chọn quy trình cần chạy hôm nay',
      );
      await expect(page.getByText('2 đầu vào · Phiên bản v3')).toBeVisible();
      await commonChecks(page);
      await titleChecks(page);
      await topBarChecks(page);
      await cardChecks(page.locator('main [data-card]'));
      await inputChecks(page.locator('#flow-search'));
      await pillChecks(page.getByRole('group', { name: 'Lọc theo nhóm' }).getByRole('button'));
      if (!mobile) await navChecks(page.getByRole('navigation', { name: 'Menu chính' }));
      await axe(page, `flow-list ${size}`);
      await shot(page, '03-flow-list', 'default');
    });

    test('run: empty, month picker open, validation errors + warnings, running', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.goto('/run/payroll-timesheet');
      await expect(periodButton(page)).toBeVisible();
      await commonChecks(page);
      await titleChecks(page);
      await cardChecks(page.locator('main [data-card]'));
      await inputChecks(periodButton(page));
      await labelChecks(page.locator('main label[for^="param-"]'));
      const drop = await style(page.getByText(/Kéo thả file vào đây/).first());
      expect(drop.radius).toBe('12px');
      expect(drop.borderTop).toBe('2px dashed rgb(153, 224, 210)');
      await axe(page, `run-empty ${size}`);
      await shot(page, '04-run', 'empty');

      // Month picker open (custom, popover level 2).
      await periodButton(page).click();
      const popover = page.locator('[role="dialog"][aria-modal="false"]');
      await expect(popover).toBeVisible();
      await floatChecks(popover);
      await axe(page, `month-picker ${size}`);
      await shot(page, '05-month-picker', 'open');
      await page.keyboard.press('Escape');
      await pickMonth(page, '2026-09');

      // Validation: one ambiguous number (warning) + a duplicate key across two files (error).
      const rows = employees(3);
      rows[1]![4] = '1,500';
      await payrollInput(page).setInputFiles([
        payroll('luong_A.xlsx', rows),
        payroll('luong_B.xlsx', employees(2, 3, 'CN02')),
      ]);
      await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
      await expect(reportCard(page).locator('tbody tr')).toHaveCount(2, { timeout: 30_000 });
      await expect(runButton(page)).toBeDisabled();
      await commonChecks(page);
      await pillChecks(page.locator('main [data-chip]'));
      await axe(page, `run-validation ${size}`);
      await shot(page, '04-run', 'validation');

      // Running: a run large enough to be caught mid-way (12k rows per side).
      await page.reload();
      await pickMonth(page, '2026-09');
      await payrollInput(page).setInputFiles([payroll('bang_luong_lon.xlsx', employees(12_000))]);
      await timesheetInput(page).setInputFiles([
        timesheet('cham_cong_lon.xlsx', employees(12_000, 1, 'CN01', 24)),
      ]);
      await expect(runButton(page)).toHaveText('Chạy', { timeout: 30_000 });
      await runButton(page).click();
      const cancel = page.getByRole('button', { name: 'Hủy', exact: true });
      await expect(cancel).toBeVisible({ timeout: 5_000 });
      await shot(page, '04-run', 'running');
      await axe(page, `run-running ${size}`);
      await commonChecks(page);
    });

    test('result: summary tab and mismatch tab', async ({ page }) => {
      test.setTimeout(120_000);
      await uploadFixtures(page);
      await runToResult(page);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveText('Kỳ 09/2026 có 15 nhân viên cần xử lý');
      // AC-UI-09: exactly one dark card, KPI cards with a 4px top bar and display-xl numbers.
      await commonChecks(page, { darkCards: 1 });
      await titleChecks(page);
      const dark = await style(page.getByTestId('conclusion'));
      expect(dark.bg).toBe(C.ink);
      expect(dark.color).toBe(C.white);
      expect(dark.radius).toBe('12px');
      await expect(page.getByTestId('conclusion')).toContainText('Cần xử lý 15 nhân viên');
      const kpis = page.getByTestId('kpi');
      await expect(kpis).toHaveCount(4);
      await cardChecks(kpis);
      const tops = ['rgb(20, 184, 166)', 'rgb(249, 115, 98)', 'rgb(251, 191, 36)'];
      for (let i = 0; i < 4; i++) {
        const s = await style(kpis.nth(i));
        expect(s.borderTop).toBe(`4px solid ${tops[Math.min(i, 2)]}`);
        expect((await style(kpis.nth(i).locator('dd'))).fontSize).toBe(mobile ? '36px' : '56px');
      }
      await pillChecks(page.getByRole('tab'));
      await denseTableChecks(page.getByRole('region', { name: 'Lệch' }).locator('table'));
      await axe(page, `result-mismatch ${size}`);
      await shot(page, '06-result', 'mismatch-tab');

      await page.getByRole('tab', { name: 'Tổng hợp' }).click();
      await expect(page.getByRole('tab', { selected: true })).toHaveText('Tổng hợp');
      await commonChecks(page, { darkCards: 1 });
      await axe(page, `result-summary ${size}`);
      await shot(page, '06-result', 'summary-tab');
    });
  });
}

test.describe('admin screens 1280x800', () => {
  test.use({ signedInAs: ADMIN, viewport: DESKTOP });

  test('users: table, Select open, temporary password dialog', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('table', { name: 'Danh sách tài khoản' })).toBeVisible();
    await commonChecks(page);
    await titleChecks(page);
    await topBarChecks(page);
    await navChecks(page.getByRole('navigation', { name: 'Menu Admin' }));
    await cardChecks(page.locator('main [data-card]'));
    await adminTableChecks(page.getByRole('table', { name: 'Danh sách tài khoản' }));
    await inputChecks(page.locator('main input[type="text"], main [role="combobox"]'));
    await labelChecks(page.locator('main label[for]'));
    await pillChecks(page.getByRole('tab'));
    // AC-UI-54: shared action column, one line, aligned; menu by keyboard; left menu "Sắp có".
    const users = page.getByRole('table', { name: 'Danh sách tài khoản' });
    await rowActionsChecks(users);
    // AC-UI-55: full width, no horizontal scroll in the table region at 1280x800.
    const noScroll = (t: typeof users) =>
      t.evaluate((el) => {
        const r = el.closest('[role="region"]')!;
        return r.scrollWidth - r.clientWidth;
      });
    expect(await noScroll(users)).toBeLessThanOrEqual(0);
    await soonChecks(page);
    await axe(page, 'admin-users 1280x800');
    await shot(page, '07-admin-users', 'table');
    await rowMenuChecks(page, users.getByRole('row', { name: /^hr\./ }).first());
    await commonChecks(page);
    await axe(page, 'admin-users-row-menu 1280x800');
    await shot(page, '07-admin-users', 'row-menu-open');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: /^Nhóm/ }).click();
    const groups = page.getByRole('table', { name: 'Danh sách nhóm' });
    await expect(groups).toBeVisible();
    await rowActionsChecks(groups);
    expect(await noScroll(groups)).toBeLessThanOrEqual(0);
    await commonChecks(page);
    await axe(page, 'admin-groups 1280x800');
    await shot(page, '07-admin-users', 'groups-table');
    await page.getByRole('tab', { name: /^Tài khoản/ }).click();

    // Custom Select open: popover level 2, eyebrow group headers (uppercase allowed there).
    const trigger = page.getByRole('combobox', { name: 'Gán cho' });
    await trigger.click();
    const list = page.getByRole('listbox', { name: 'Gán cho' });
    await expect(list).toBeVisible();
    await floatChecks(list.locator('..'));
    const header = list.getByText('Tài khoản', { exact: true });
    expect((await style(header)).fontSize).toBe('14px');
    await axe(page, 'select-open 1280x800');
    await shot(page, '08-select', 'open');
    await page.keyboard.press('Escape');

    // AC-UI-55: create form in a dialog (level 2), focus on the first field, Esc returns focus.
    const createDialog = await openCreateAccount(page);
    await floatChecks(createDialog);
    // Username has focus (teal border + ring); the other text field has the resting style.
    expect((await style(createDialog.locator('#new-username'))).borderLeft).toBe(
      `1px solid ${C.teal}`,
    );
    await inputChecks(createDialog.locator('#new-fullname'));
    await labelChecks(createDialog.locator('label[for]'));
    await buttonChecks(createDialog.getByRole('button', { name: 'Tạo và hiện mật khẩu tạm' }));
    await commonChecks(page);
    await axe(page, 'admin-users-create-dialog 1280x800');
    await shot(page, '07-admin-users', 'create-dialog');
    await page.keyboard.press('Escape');
    await expect(createDialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ Tạo tài khoản' })).toBeFocused();
    await openCreateAccount(page);
    await page.getByLabel(/^Username/).fill('hr.cn05');
    await page.getByRole('button', { name: 'Tạo và hiện mật khẩu tạm' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mật khẩu tạm của hr.cn05' });
    await expect(dialog).toBeVisible();
    await floatChecks(dialog);
    expect((await style(dialog.getByRole('heading', { level: 2 }))).fontSize).toBe('20px');
    await commonChecks(page);
    await axe(page, 'admin-users-dialog 1280x800');
    await shot(page, '07-admin-users', 'temp-password-dialog');
  });

  test('flows list', async ({ page, supabase }) => {
    withDraft(supabase);
    await page.goto('/admin/flows');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flow và phiên bản');
    await commonChecks(page);
    await titleChecks(page);
    await cardChecks(page.locator('main [data-card]'));
    await adminTableChecks(page.locator('main table').first());
    await rowActionsChecks(page.locator('main table').first());
    await axe(page, 'admin-flows 1280x800');
    await shot(page, '09-admin-flows', 'list');
    await rowMenuChecks(page, page.locator('main tbody tr').first());
    await axe(page, 'admin-flows-row-menu 1280x800');
    await shot(page, '09-admin-flows', 'row-menu-open');
    await page.keyboard.press('Escape');
  });

  test('versions: list + diff', async ({ page, supabase }) => {
    withDraft(supabase);
    await page.goto(VERSIONS);
    await expect(page.getByRole('table', { name: 'Danh sách phiên bản' })).toBeVisible();
    await commonChecks(page);
    await titleChecks(page);
    await cardChecks(page.locator('main [data-card]'));
    const table = page.getByRole('table', { name: 'Danh sách phiên bản' });
    await adminTableChecks(table);
    await rowActionsChecks(table);
    // Draft row: visible "Mở Designer" + "Publish" (primary); published row: "Xem trong Designer".
    const draft = table.getByRole('row', { name: /^v2/ });
    await expect(draft.getByRole('link', { name: 'Mở Designer v2' })).toBeVisible();
    await primaryChecks(draft.getByRole('button', { name: 'Publish v2' }));
    await expect(
      table.getByRole('row', { name: /^v1/ }).getByRole('link', { name: 'Xem trong Designer v1' }),
    ).toBeVisible();
    const diff = page.getByRole('region', { name: 'So sánh phiên bản' });
    await expect(diff.getByRole('heading', { name: /^Node/ })).toBeVisible();
    // JSON diff is a code area: 14px.
    expect((await style(diff.locator('td.font-mono').first())).fontSize).toBe('14px');
    await axe(page, 'versions 1280x800');
    await shot(page, '10-versions', 'list-and-diff');
    const menu = await rowMenuChecks(page, table.getByRole('row', { name: /^v1/ }));
    await expect(menu.getByRole('menuitem').last()).toHaveAccessibleName('Retire v1');
    await axe(page, 'versions-row-menu 1280x800');
    await shot(page, '10-versions', 'row-menu-open');
    await page.keyboard.press('Escape');
    await diff.scrollIntoViewIfNeeded();
    await shot(page, '10-versions', 'diff');
  });

  test('designer: canvas, formula node panel, preview', async ({ page, supabase }) => {
    test.setTimeout(120_000);
    withDraft(supabase);
    await page.goto(DESIGNER);
    const node = page.getByTestId('rf__node-formula_1');
    await expect(node).toBeVisible({ timeout: 30_000 });
    await settleCanvas(page);
    // AC-UI-13: palette, canvas, config panel and status bar all visible at 1280x800.
    await expect(page.getByRole('heading', { name: 'Thêm node' })).toBeVisible();
    await expect(page.locator('.react-flow')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Cấu hình' })).toBeVisible();
    const canvas = await page.locator('.react-flow').boundingBox();
    test.info().annotations.push({
      type: 'canvas-area',
      description: `${Math.round(canvas!.width)}x${Math.round(canvas!.height)}`,
    });
    // Node cards: 12px, 1px border, no shadow; node text stays 14px.
    const card = node.locator('> div').first();
    const s = await style(card);
    expect(s.radius).toBe('12px');
    expect(s.shadow).toBe('none');
    expect((await style(node.locator('p').first())).fontSize).toBe('14px');
    await commonChecks(page);
    await designerToolbarChecks(page);
    await paletteChecks(page);
    await axe(page, 'designer-canvas 1280x800', REACT_FLOW_EXCLUDE);
    await shot(page, '11-designer', 'canvas');

    await expect(async () => {
      await node.click();
      await expect(page.getByTestId('formula-editor-0').locator('.monaco-editor')).toBeVisible({
        timeout: 3000,
      });
    }).toPass({ timeout: 60_000 });
    // Side form keeps 14px labels (high-density exception).
    const side = page.getByRole('complementary', { name: 'Cấu hình' });
    expect((await style(side.locator('label').first())).fontSize).toBe('14px');
    await commonChecks(page);
    await axe(page, 'designer-formula 1280x800', REACT_FLOW_EXCLUDE);
    await shot(page, '11-designer', 'formula-panel');

    await page.getByRole('button', { name: 'Dữ liệu mẫu và xem trước' }).click();
    const panel = page.getByRole('region', { name: 'Dữ liệu mẫu và xem trước' });
    await panel
      .getByLabel('File mẫu cho Bảng lương (nhiều chi nhánh)')
      .setInputFiles(fixtures('bang_luong_'));
    await expect(panel.getByRole('status').filter({ hasText: '75 dòng' })).toHaveCount(1);
    await pickMonth(page, '2026-09', panel.getByRole('button', { name: /Kỳ lương/ }));
    await panel.getByRole('button', { name: 'Xem trước Công thức' }).click();
    await expect(panel.getByRole('columnheader', { name: 'OT mỗi phép' })).toBeVisible({
      timeout: 60_000,
    });
    expect((await style(panel.locator('tbody td').first())).fontSize).toBe('14px');
    await commonChecks(page);
    await axe(page, 'designer-preview 1280x800', REACT_FLOW_EXCLUDE);
    await shot(page, '11-designer', 'preview');
  });
});

test.describe('idle sign-out warning', () => {
  test.use({ viewport: DESKTOP });

  test('dialog', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.clock.fastForward('07:55:00');
    const warning = page.getByRole('alertdialog', { name: 'Bạn sắp bị đăng xuất' });
    await expect(warning).toBeVisible();
    await floatChecks(warning);
    await buttonChecks(warning.getByRole('button'));
    await commonChecks(page);
    await axe(page, 'idle-dialog 1280x800');
    await shot(page, '12-idle-logout', 'dialog');
  });
});

/**
 * React Flow renders the canvas viewport and the attribution link itself; axe findings inside
 * them are library markup. Our node cards are checked by the style assertions instead.
 */
const REACT_FLOW_EXCLUDE = [
  { selector: '.react-flow__renderer', reason: 'React Flow canvas markup (library)' },
];

/** Left menu (AC-UI-54): "Sắp có" is a small chip on the same line as its label. */
async function soonChecks(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Menu Admin' });
  const items = nav.locator('[aria-disabled="true"]');
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    expect((await style(items.nth(i))).height, 'disabled item on one line').toBeLessThanOrEqual(44);
    expect((await style(items.nth(i).locator('span').last())).radius).toBe('999px');
  }
}

async function settleCanvas(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

test.describe('admin screens at 1024px: no horizontal page scroll (AC-UI-12)', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1024, height: 768 } });

  test('users, flows, versions', async ({ page, supabase }) => {
    withDraft(supabase);
    for (const url of ['/admin/users', '/admin/flows', VERSIONS]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('main table').first()).toBeVisible();
      await commonChecks(page);
      await rowActionsChecks(page.locator('main table').first());
    }
    await shot(page, '10-versions', 'list-1024');
  });
});

test.describe('zoom 200% (640px wide): run and result stay usable (AC-UI-23)', () => {
  test.use({ viewport: { width: 640, height: 400 } });

  test('run + result', async ({ page }) => {
    test.setTimeout(120_000);
    await uploadFixtures(page);
    await commonChecks(page);
    await runToResult(page);
    await commonChecks(page, { darkCards: 1 });
    await expect(page.getByRole('button', { name: /Tải Excel/ })).toBeVisible();
    await shot(page, '06-result', 'zoom-200');
  });
});
