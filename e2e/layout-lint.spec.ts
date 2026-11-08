/**
 * Automated layout geometry (spec §29.3 AC-UI-78) on every screen, the main states of
 * `ui-v2.spec.ts` and the config form / tabs of every Designer node type, at 1280×800 and
 * 1024×768 (User screens also 390×844). Rules and the one allowlist: `e2e/layout-lint.ts`.
 * Violations of each test are printed and written to the OS temp dir
 * (`layout-lint-<test>.txt`). Supabase is mocked; fake data only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import {
  employees,
  fixtures,
  rowAction,
  openCreateAccount,
  payroll,
  payrollInput,
  periodButton,
  pickMonth,
  reportCard,
  runToResult,
  timesheetInput,
  uploadFixtures,
} from './helpers';
import { layoutLint, LayoutReport } from './layout-lint';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000779';
const VERSIONS = '/admin/flows/payroll-timesheet/versions';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';

const DESKTOP = { width: 1280, height: 800 };
const LAPTOP = { width: 1024, height: 768 };
const MOBILE = { width: 390, height: 844 };
const size = (v: { width: number; height: number }) => `${v.width}x${v.height}`;
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

/**
 * KNOWN BUG (AC-UI-78): tests that fail on the current code because of real layout violations,
 * keyed by test title, each naming the violation; the full measured list is printed by the test
 * and written to `<tmpdir>/layout-lint-<test>.txt`. Remove an entry once fixed (Playwright then
 * reports "expected to fail but passed"). Empty since the fix round of 2026-11-06.
 */
const KNOWN_BUG: Record<string, string> = {};
test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  const bug = KNOWN_BUG[testInfo.title];
  if (bug) test.fail(true, `KNOWN BUG: ${bug}`);
});

/** v1 published + v2 draft with a formula node whose column title is long. */
function withDraft(supabase: SupabaseMock) {
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  const def = baseFlowDefinition() as Record<string, unknown> & {
    nodes: { id: string; type: string; label?: string; config: Record<string, unknown> }[];
    edges: unknown[];
  };
  def.nodes.push({
    id: 'formula_1',
    type: 'transform.formula',
    label: 'Công thức tính số giờ làm thêm bình quân trên mỗi ngày nghỉ phép',
    config: {
      columns: [
        {
          key: 'ot_moi_phep',
          title: 'Số giờ làm thêm bình quân trên mỗi ngày nghỉ phép có hưởng lương',
          formula: '=IFERROR([ot]/[phep], 0)',
          type: 'auto',
          onError: 'blank',
        },
      ],
    },
  });
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

async function ready(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]:not(dialog)')).toHaveCount(0);
}

// ---- auth + user screens (3 viewports) ---------------------------------------------------------

for (const viewport of [DESKTOP, LAPTOP, MOBILE]) {
  test.describe(`auth ${size(viewport)}`, () => {
    test.use({ signedInAs: null, viewport });
    test(`login: empty + error ${size(viewport)}`, async ({ page }) => {
      const r = new LayoutReport(page);
      await page.goto('/login');
      await ready(page);
      await r.check('login empty');
      await page.getByLabel('Tên đăng nhập').fill('hr.nv01');
      await page.getByLabel('Mật khẩu').fill('sai-mat-khau');
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await r.check('login error');
      r.assertClean(`login-${size(viewport)}`);
    });
  });

  test.describe(`user screens ${size(viewport)}`, () => {
    test.use({ viewport });

    test(`change password ${size(viewport)}`, async ({ page }) => {
      const r = new LayoutReport(page);
      await page.goto('/change-password');
      await ready(page);
      await r.check('change password');
      r.assertClean(`change-password-${size(viewport)}`);
    });

    test(`flow list ${size(viewport)}`, async ({ page }) => {
      const r = new LayoutReport(page);
      await page.goto('/');
      await ready(page);
      await expect(page.getByText('2 đầu vào · Phiên bản v3')).toBeVisible();
      await r.check('flow list');
      // (i) of "Lần chạy gần đây": opened by a tap / click, inside the viewport.
      await openInfoTip(page, page.getByRole('button', { name: 'Giải thích: Lần chạy gần đây' }));
      await r.check('flow list (i) open');
      r.assertClean(`flow-list-${size(viewport)}`);
    });

    test(`run: empty, validation ${size(viewport)}`, async ({ page }) => {
      test.setTimeout(120_000);
      const r = new LayoutReport(page);
      await page.goto('/run/payroll-timesheet');
      await expect(periodButton(page)).toBeVisible();
      await ready(page);
      await r.check('run empty');
      await pickMonth(page, '2026-09');
      const rows = employees(3);
      rows[1]![4] = '1,500';
      await payrollInput(page).setInputFiles([
        payroll('luong_chi_nhanh_mien_nam_thang_09.xlsx', rows),
        payroll('luong_B.xlsx', employees(2, 3, 'CN02')),
      ]);
      await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
      await expect(reportCard(page).locator('tbody tr')).toHaveCount(2, { timeout: 30_000 });
      if (process.env.LL_SHOTS)
        await page.locator('[data-stepper]').screenshot({
          path: `${process.env.LL_SHOTS}/stepper-${size(viewport)}.png`,
        });
      await r.check('run validation');
      // Long file names stay on one line ("…" in the middle + tooltip): every file row one height.
      const heights = await page
        .locator('main ul[aria-live] > li')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
      expect(heights.length).toBeGreaterThanOrEqual(5);
      expect(new Set(heights).size, `file row heights ${heights.join(', ')}`).toBe(1);
      if (process.env.LL_SHOTS)
        await page
          .locator('main ul[aria-live]')
          .first()
          .screenshot({
            path: `${process.env.LL_SHOTS}/run-files-${size(viewport)}.png`,
          });
      r.assertClean(`run-${size(viewport)}`);
    });

    test(`result: mismatch + summary tabs ${size(viewport)}`, async ({ page }) => {
      test.setTimeout(120_000);
      const r = new LayoutReport(page);
      await uploadFixtures(page);
      await runToResult(page);
      await ready(page);
      await r.check('result mismatch tab');
      await page.getByRole('tab', { name: 'Tổng hợp' }).click();
      await expect(page.getByRole('tab', { selected: true })).toHaveText('Tổng hợp');
      await r.check('result summary tab');
      r.assertClean(`result-${size(viewport)}`);
    });
  });
}

// ---- admin screens (1280, 1024) --------------------------------------------------------------

for (const viewport of [DESKTOP, LAPTOP]) {
  test.describe(`admin ${size(viewport)}`, () => {
    test.use({ signedInAs: ADMIN, viewport });

    test(`users: table, groups, create + temp password dialogs ${size(viewport)}`, async ({
      page,
    }) => {
      const r = new LayoutReport(page);
      await page.goto('/admin/users');
      await expect(page.getByRole('table', { name: 'Danh sách tài khoản' })).toBeVisible();
      await ready(page);
      await r.check('users table');
      await page.getByRole('tab', { name: /^Nhóm/ }).click();
      await expect(page.getByRole('table', { name: 'Danh sách nhóm' })).toBeVisible();
      await r.check('groups table');
      await page.getByRole('tab', { name: /^Tài khoản/ }).click();
      const create = await openCreateAccount(page);
      await r.check('create account dialog');
      await create.getByLabel(/^Username/).fill('hr.cn05');
      await create.getByRole('button', { name: 'Tạo và hiện mật khẩu tạm' }).click();
      await expect(page.getByRole('dialog', { name: 'Mật khẩu tạm của hr.cn05' })).toBeVisible();
      await r.check('temp password dialog');
      r.assertClean(`admin-users-${size(viewport)}`);
    });

    test(`flows + versions (list, diff) ${size(viewport)}`, async ({ page, supabase }) => {
      withDraft(supabase);
      const r = new LayoutReport(page);
      await page.goto('/admin/flows');
      await ready(page);
      await expect(page.locator('main tbody tr').first()).toBeVisible();
      await r.check('flows list');
      await page.goto(VERSIONS);
      await expect(page.getByRole('table', { name: 'Danh sách phiên bản' })).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'So sánh phiên bản' }).getByRole('heading', {
          name: /^Node/,
        }),
      ).toBeVisible();
      await r.check('versions list + diff');
      await rowAction(
        page
          .getByRole('table', { name: 'Danh sách phiên bản' })
          .getByRole('row', { name: /^v2\b/ }),
        'Publish v2',
      );
      const publish = page.getByRole('dialog', { name: 'Publish v2' });
      await expect(publish.getByLabel(/^Ghi chú thay đổi/)).toBeVisible();
      await r.check('publish dialog');
      await openInfoTip(page, publish.getByRole('button', { name: /^Giải thích: / }).first());
      await r.check('publish dialog (i) open');
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-infotip-pop]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(publish).toHaveCount(0);
      await page.goto('/admin/flows');
      await ready(page);
      await page.getByRole('button', { name: 'Tạo flow mới' }).click();
      const create = page.getByRole('dialog', { name: 'Tạo flow mới' });
      await expect(create.getByLabel('Mã flow', { exact: true })).toBeVisible();
      await r.check('create flow dialog');
      await openInfoTip(page, create.getByRole('button', { name: 'Giải thích: Tạo flow mới' }));
      await r.check('create flow dialog (i) open');
      r.assertClean(`admin-flows-versions-${size(viewport)}`);
    });

    test(`designer: flow tabs (Tham số, Input slot) ${size(viewport)}`, async ({
      page,
      supabase,
    }) => {
      withDraft(supabase);
      const r = new LayoutReport(page);
      await openDesigner(page);
      const panel = page.getByRole('complementary', { name: 'Cấu hình' });
      await panel.getByRole('tab', { name: 'Tham số' }).click();
      await r.check('designer flow tab Tham số');
      const shot = async (name: string) => {
        if (process.env.LL_SHOTS)
          await page.screenshot({
            path: `${process.env.LL_SHOTS}/tab-${name}-${size(viewport)}.png`,
          });
      };
      await shot('tham-so');
      await panel.getByRole('tab', { name: 'Input slot' }).click();
      await expect(panel.getByRole('tab', { name: 'Input slot' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await r.check('designer flow tab Input slot');
      await shot('input-slot');
      // The longest state of the tab: scrolled to the end of the slot form.
      await page
        .getByRole('complementary', { name: 'Cấu hình' })
        .evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await r.check('designer flow tab Input slot scrolled to the end');
      await shot('input-slot-end');
      await openInfoTip(
        page,
        panel.getByRole('button', { name: 'Giải thích: Mục upload đang sửa' }),
      );
      await r.check('designer flow tab Input slot (i) open');
      r.assertClean(`designer-tabs-${size(viewport)}`);
    });

    test(`designer: data panel with a compare preview ${size(viewport)}`, async ({
      page,
      supabase,
    }) => {
      test.setTimeout(120_000);
      withDraft(supabase);
      const r = new LayoutReport(page);
      await openDesigner(page);
      await page.getByRole('button', { name: 'Dữ liệu mẫu và xem trước' }).click();
      const data = page.getByRole('region', { name: 'Dữ liệu mẫu và xem trước' });
      await data
        .getByLabel('File mẫu cho Bảng lương (nhiều chi nhánh)')
        .setInputFiles(fixtures('bang_luong_'));
      await data
        .getByLabel('File mẫu cho Chấm công (nhiều chi nhánh)')
        .setInputFiles(fixtures('cham_cong_'));
      await expect(data.getByRole('status').filter({ hasText: '75 dòng' })).toHaveCount(2, {
        timeout: 30_000,
      });
      await pickMonth(page, '2026-09', data.getByRole('button', { name: /Kỳ lương/ }));
      await selectNode(page, 'cmp');
      await data.getByRole('button', { name: /^Xem trước / }).click();
      await expect(data.getByRole('tab', { name: /^Lệch/ })).toBeVisible({ timeout: 30_000 });
      await data.getByRole('tab', { name: /^Lệch/ }).click();
      await r.check('designer data panel preview');
      // Minimap only on a canvas at least 360px high (MEMORY 2026-11-06 18:27); zoom buttons stay.
      const canvasH = await page
        .getByRole('region', { name: 'Canvas của flow' })
        .evaluate((el) => el.clientHeight);
      await expect(page.locator('.react-flow__minimap')).toHaveCount(canvasH < 360 ? 0 : 1);
      await expect(page.locator('.react-flow__controls')).toBeVisible();
      // Rule 15 on the real tab list: forced to 3 columns (the 3 + 1 of before 2026-11-06) it fails.
      const tabs = data
        .getByRole('tablist')
        .filter({ has: page.getByRole('tab', { name: /^Lệch/ }) });
      await expect(tabs.getByRole('tab')).toHaveCount(4);
      const rows = await tabs.evaluate((el) => {
        const tops = new Set(
          Array.from(el.querySelectorAll('[role="tab"]')).map((t) =>
            Math.round(t.getBoundingClientRect().top),
          ),
        );
        return tops.size;
      });
      expect([1, 2]).toContain(rows);
      await tabs.evaluate((el) => {
        el.setAttribute('data-ll-style', el.getAttribute('style') ?? '');
        (el as HTMLElement).style.gridAutoFlow = 'row';
        (el as HTMLElement).style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
      });
      const forced = (await layoutLint(page)).filter((v) => v.rule === 15);
      expect(forced.map((v) => v.detail)).toEqual([expect.stringContaining('3 + 1')]);
      await tabs.evaluate((el) => {
        el.setAttribute('style', el.getAttribute('data-ll-style') ?? '');
        el.removeAttribute('data-ll-style');
      });
      if (process.env.LL_SHOTS)
        await page.screenshot({ path: `${process.env.LL_SHOTS}/data-panel-${size(viewport)}.png` });
      r.assertClean(`designer-data-${size(viewport)}`);
    });

    test(`designer: node forms of the acceptance flow ${size(viewport)}`, async ({
      page,
      supabase,
    }) => {
      test.setTimeout(120_000);
      withDraft(supabase);
      const r = new LayoutReport(page);
      await openDesigner(page);
      for (const id of ['in_luong', 'cmp', 'out', 'formula_1']) {
        await selectNode(page, id);
        await r.check(`designer node ${id}`);
      }
      // "Nối tới…" list open.
      await selectNode(page, 'in_cc');
      await page.keyboard.press('Control+E');
      await expect(page.locator('[data-connect-menu]')).toBeVisible();
      await r.check('designer connect list');
      r.assertClean(`designer-nodes-${size(viewport)}`);
    });

    test(`designer: every palette node type, wired and with a long name ${size(viewport)}`, async ({
      page,
      supabase,
    }) => {
      test.setTimeout(240_000);
      withDraft(supabase);
      const r = new LayoutReport(page);
      await openDesigner(page);
      const items = page.locator('[data-palette-item]');
      const count = await items.count();
      expect(count).toBeGreaterThanOrEqual(13);
      for (let i = 0; i < count; i++) {
        const type = (await items
          .nth(i)
          .locator('span')
          .nth(1)
          .locator('span')
          .first()
          .textContent())!;
        await items.nth(i).click();
        const selected = page.locator('.react-flow__node.selected');
        await expect(selected).toHaveCount(1);
        const id = (await selected.getAttribute('data-id'))!;
        // A node added from the palette covers no node already there (MEMORY 2026-11-06 18:27).
        const covered = await page.evaluate((newId) => {
          const box = (el: Element) => el.getBoundingClientRect();
          const all = Array.from(document.querySelectorAll('.react-flow__node'));
          const mine = all.find((n) => n.getAttribute('data-id') === newId);
          if (!mine) return ['missing'];
          const a = box(mine);
          return all
            .filter((n) => n !== mine)
            .filter((n) => {
              const b = box(n);
              return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            })
            .map((n) => n.getAttribute('data-id'));
        }, id);
        expect(covered, `new node ${id} covers`).toEqual([]);
        const panel = page.getByRole('complementary', { name: 'Cấu hình' });
        const longName = `Bước kiểm tra bố cục số ${i + 1} với tên hiển thị rất dài để xuống dòng`;
        await panel.getByLabel('Tên node', { exact: true }).fill(longName);
        // Wire it from the payroll input when it has an input port (column pickers appear).
        await selectNode(page, 'in_luong');
        await page.keyboard.press('Control+E');
        const menu = page.locator('[data-connect-menu]');
        await expect(menu).toBeVisible();
        await menu.getByRole('combobox').fill(`số ${i + 1} với`);
        if ((await menu.getByRole('option').count()) > 0) await page.keyboard.press('Enter');
        else await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await selectNode(page, id);
        // Open one row of every list of the form (key pairs, columns, rules…).
        const adds = panel.getByRole('button', { name: /^Thêm/ });
        const n = await adds.count();
        for (let k = n - 1; k >= 0; k--) {
          if (await adds.nth(k).isEnabled()) await adds.nth(k).click();
        }
        if (process.env.LL_SHOTS)
          await page.screenshot({
            path: `${process.env.LL_SHOTS}/palette-${i}-${size(viewport)}.png`,
          });
        await r.check(`designer palette node ${slug(type)}`);
        if (process.env.LL_SHOTS) {
          await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
          await page.screenshot({
            path: `${process.env.LL_SHOTS}/palette-${i}-end-${size(viewport)}.png`,
          });
        }
      }
      r.assertClean(`designer-palette-${size(viewport)}`);
    });
  });
}

async function openDesigner(page: Page) {
  await page.goto(DESIGNER);
  await expect(page.getByTestId('rf__node-formula_1')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /lỗi · |Không có lỗi/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Opens an (i) popover by a click and checks it is fully inside the viewport. */
async function openInfoTip(page: Page, button: ReturnType<Page['locator']>) {
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const pop = page.locator('[data-infotip-pop]');
  await expect(pop).toBeVisible();
  const box = (await pop.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  if (process.env.LL_SHOTS)
    await page.screenshot({
      path: `${process.env.LL_SHOTS}/infotip-${slug((await button.getAttribute('aria-label'))!)}-${size(vp)}.png`,
    });
}

/** Whether the node's centre lies inside the canvas pane (not under the header or a panel). */
async function inCanvas(page: Page, id: string): Promise<boolean> {
  return page.evaluate((nodeId) => {
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
    const box = document
      .querySelector(`[data-testid="rf__node-${nodeId}"]`)
      ?.getBoundingClientRect();
    if (!pane || !box) return false;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    return x > pane.left && x < pane.right && y > pane.top && y < pane.bottom;
  }, id);
}

async function selectNode(page: Page, id: string) {
  const node = page.getByTestId(`rf__node-${id}`);
  await node.scrollIntoViewIfNeeded().catch(() => undefined);
  await expect(async () => {
    // A node added from the palette pans the canvas to it, so an older node may be off view
    // (under the header): bring every node in view first, as a user would.
    if (!(await node.isVisible()) || !(await inCanvas(page, id))) {
      await page.locator('.react-flow__controls-fitview').click();
    }
    await node.click({ timeout: 3000 });
    await expect(node).toHaveClass(/selected/, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  // Lazy forms (Monaco for formula / SQL) settle before measuring.
  await page.waitForTimeout(300);
}

// ---- self-test: a page with one deliberate fault per rule ---------------------------------------

test.describe('layout-lint self-test', () => {
  test.use({ signedInAs: null, viewport: DESKTOP });

  test('each rule catches its deliberate fault, a clean page has none', async ({ page }) => {
    const css = `body{margin:0;font:16px/20px sans-serif} .card{border:1px solid #ccc;width:300px;padding:8px;margin:8px}
      .row{display:flex;gap:8px;align-items:flex-start} input,button{box-sizing:border-box;height:44px;margin:0}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px} .f{display:flex;flex-direction:column;gap:4px;min-width:0}`;
    await page.setContent(`<style>${css}</style>
      <div class="card" data-card id="clean"><div class="row"><input aria-label="a"><button>OK</button></div>
      <div class="grid" data-field-grid><div class="f">c1</div><div class="f">c2</div><div class="f">c3</div><div class="f">c4</div></div>
      <div data-form-field><input aria-label="c5" style="width:200px"></div><div data-form-field><input aria-label="c6" style="width:200px"></div>
      <div data-checkbox style="display:flex"><label><input type="checkbox">c7</label><span data-infotip><button data-infotip-button aria-label="i" style="height:20px;width:44px;padding:0 0 0 4px;border:0;display:flex"><svg width="20" height="20"></svg></button></span></div></div>`);
    expect(await layoutLint(page)).toEqual([]);

    await page.setContent(`<style>${css}</style>
      <div class="card"><div class="row"><input aria-label="r1 input"><button style="height:36px">r1 nút</button></div></div>
      <div class="card"><div class="row"><div style="width:400px;flex-shrink:0;height:20px">r2 rộng</div></div></div>
      <div class="card"><div style="height:20px;margin-bottom:-10px">r3 a</div><div style="height:20px">r3 b</div></div>
      <div class="card"><div class="row" style="gap:0"><button style="margin-right:4px">A</button><button style="margin-right:12px">B</button><button>C</button></div></div>
      <div class="card"><div role="tablist" class="row"><button role="tab">T1</button><button role="tab" style="height:40px">T2</button></div></div>
      <div class="card"><div class="grid"><div class="f"><label for="x1">Nhãn rất dài rất dài rất dài rất dài xuống dòng</label><input id="x1"></div><div class="f"><label for="x2">Ngắn</label><input id="x2"></div></div></div>
      <div class="card"><div style="width:80px;overflow:hidden;white-space:nowrap">r7 chữ dài bị cắt mất không có dấu</div></div>
      <div class="card" data-card><input aria-label="r8 ô"><p>r8</p><button style="height:40px">r8 nút 40</button><button data-size="sm" style="height:36px">r8 nhỏ</button></div>
      <div class="card"><div role="tablist" data-tabs="dense" class="row"><button role="tab" style="height:44px">r9 a</button><button role="tab" style="height:44px">r9 tab dài hơn</button></div></div>
      <div class="card" data-card><label><input type="checkbox" style="width:20px;height:20px">r10 a</label><label><input type="checkbox" style="width:14px;height:14px">r10 b</label></div>
      <div class="card"><div style="display:flex;flex-direction:column;gap:16px"><div data-form-field>r11 a</div><div data-form-field style="margin-bottom:8px">r11 b</div><div data-checkbox>r11 c</div><h3 style="margin:0">r11 nhóm</h3><div data-form-field>r11 d</div></div></div>
      <div class="card"><div data-form-field style="width:90px"><label data-field-label>r12 nhãn dài xuống dòng</label></div></div>
      <div class="card"><div id="r13-outer" style="height:60px;overflow-y:auto"><div id="r13-inner" style="height:100px;overflow-y:auto"><div style="height:200px">r13</div></div></div></div>
      <div class="card" data-card><p data-hint>r14 gợi ý đánh dấu</p><p style="color:#475569;font-size:14px;margin:0">r14 đoạn giải thích</p><p data-note style="color:#475569;font-size:14px;margin:0">r14 meta</p></div>
      <div class="card"><div role="tablist" data-tabs="dense" aria-label="r15 tabs" style="display:flex;flex-wrap:wrap;gap:8px;width:200px"><button role="tab" style="width:60px">a</button><button role="tab" style="width:60px">b</button><button role="tab" style="width:60px">c</button><button role="tab" style="width:60px">d</button></div></div>
      <div class="card"><div class="grid" data-field-grid aria-label="r15 grid"><div class="f">g1</div><div class="f">g2</div><div class="f">g3</div></div></div>
      <div class="card"><div role="tablist" aria-label="r15 plain" style="display:flex;flex-wrap:wrap;gap:8px;width:200px"><button role="tab" style="width:90px">p1</button><button role="tab" style="width:90px">p2</button><button role="tab" style="width:180px">p3</button><button role="tab" style="width:180px">p4</button></div></div>
      <div class="card" data-card><div data-form-field><input aria-label="r16 chọn" style="width:192px"></div><div data-form-field><input aria-label="r16 tìm" style="width:240px"></div></div>
      <div class="card" data-card><label data-checkbox style="display:flex;width:120px"><input type="checkbox">r17 nhãn checkbox dài xuống dòng</label>
        <div data-checkbox style="display:flex;justify-content:space-between;width:280px"><label><input type="checkbox">r17b</label><span data-infotip><button data-infotip-button aria-label="r17 i" style="height:20px;width:44px;padding:0 0 0 4px;border:0;display:flex"><svg width="20" height="20"></svg></button></span></div></div>
      <span data-infotip-pop aria-label="r18 a" style="position:fixed;top:4px;right:4px;width:40px;height:20px"></span><span data-infotip-pop aria-label="r18 b" style="position:fixed;top:30px;right:4px;width:40px;height:20px"></span>`);
    const found = await layoutLint(page);
    const rules = new Set(found.map((v) => v.rule));
    expect([...rules].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    const r15 = found.filter((v) => v.rule === 15);
    expect(r15).toHaveLength(3);
    // Plain tabs too (Kết quả at 390: 2 + 1 + 1 before 2026-11-06 18:27).
    expect(r15.some((v) => v.target.includes('r15 plain') && v.detail.includes('2 + 1 + 1'))).toBe(
      true,
    );
    const r16 = found.filter((v) => v.rule === 16);
    expect(r16).toHaveLength(1);
    expect(r16[0]!.detail).toMatch(/"r16 chọn" w=192px above input "r16 tìm" w=240px/);
    const r17 = found.filter((v) => v.rule === 17).map((v) => v.detail);
    expect(r17).toHaveLength(2);
    expect(r17.some((d) => /label on [2-9] lines/.test(d))).toBe(true);
    expect(r17.some((d) => /\(i\) icon .* after the label text/.test(d))).toBe(true);
    expect(found.filter((v) => v.rule === 18).map((v) => v.detail)).toEqual([
      '2 (i) popovers open at once',
    ]);
    expect(r15.some((v) => v.target.includes('r15 tabs') && v.detail.includes('3 + 1'))).toBe(true);
    expect(r15.some((v) => v.target.includes('r15 grid') && v.detail.includes('2 + 1'))).toBe(true);
    const r8 = found.filter((v) => v.rule === 8).map((v) => v.detail);
    expect(r8.some((d) => d.includes('"r8 nút 40"') && d.includes('h=40px'))).toBe(true);
    // The marked small button (36px) is not a fault.
    expect(r8.some((d) => d.includes('r8 nhỏ'))).toBe(false);
    const r9 = found.find((v) => v.rule === 9)!.detail;
    expect(r9).toMatch(/widths .* \/ /);
    expect(r9).toMatch(/tabs span/);
    expect(found.find((v) => v.rule === 10)!.detail).toMatch(/20pxx20px .*14pxx14px/);
    const r11 = found.filter((v) => v.rule === 11);
    expect(r11).toHaveLength(1);
    // 16px then 24px (a margin added under r11 b); the heading before r11 d is not a field block.
    expect(r11[0]!.detail).toMatch(/16px between .*24px between/);
    expect(r11[0]!.detail).not.toContain('r11 nhóm');
    expect(found.find((v) => v.rule === 1)!.detail).toContain('differ by 8px');
    expect(found.find((v) => v.rule === 4)!.detail).toMatch(/uneven gaps 4px \/ 12px/);
    expect(found.find((v) => v.rule === 6)!.target).toContain('Nhãn rất dài');
    expect(found.find((v) => v.rule === 12)!.target).toContain('r12 nhãn');
    const r13 = found.filter((v) => v.rule === 13);
    expect(r13).toHaveLength(1);
    expect(r13[0]!.detail).toMatch(/scrolls vertically inside div/);
    const r14 = found.filter((v) => v.rule === 14).map((v) => v.target);
    expect(r14).toHaveLength(2);
    expect(r14.some((x) => x.includes('r14 gợi ý đánh dấu'))).toBe(true);
    expect(r14.some((x) => x.includes('r14 đoạn giải thích'))).toBe(true);

    // Rule 13 on the full-bleed Designer: screen-reader text far down a panel that is not its
    // containing block makes the page scroll around the scrolling panel (the bug of 2026-11-06).
    const bleed = (fixed: boolean) => `<style>body{margin:0}</style>
      <div class="hr-designer" style="height:100vh;display:flex">
        <aside style="height:100%;overflow-y:auto;width:300px${fixed ? ';position:relative' : ''}">
          <div style="height:2000px">panel</div>
          <span style="position:absolute;width:1px;height:1px;overflow:hidden">sr</span>
        </aside></div>`;
    await page.setContent(bleed(false));
    const page13 = (await layoutLint(page)).filter((v) => v.rule === 13);
    expect(page13).toHaveLength(1);
    expect(page13[0]!.detail).toMatch(/inside the page/);
    await page.setContent(bleed(true));
    expect(await layoutLint(page)).toEqual([]);
  });
});
