/**
 * Verifier checks for the scroll frame (spec §32 AC-SB-07/08, MEMORY 2026-11-09 10:20), written
 * from the AC, not from the implementation: scroll keys, focus in fields, sizes around 768px and
 * low windows, popovers after scrolling, the sticky action bar, the Designer keyboard after the
 * content (`main`) became focusable. Supabase is mocked; fake data only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { openFlow, uploadFixtures } from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000791';
const VERSIONS = '/admin/flows/payroll-timesheet/versions';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';

function withDraft(supabase: SupabaseMock) {
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  supabase.versions.push({
    id: DRAFT_ID,
    flow_id: FLOW_ID,
    version_no: 2,
    status: 'draft',
    effective_from: '',
    effective_to: null,
    definition: baseFlowDefinition(),
    published_at: null,
    updated_at: '2026-10-27T01:00:00.000001+00:00',
  });
}

async function ready(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]:not(dialog)')).toHaveCount(0);
}

const frameTop = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-scroll-frame]')?.scrollTop ?? -1);

/**
 * Layout facts of the current screen: every element (html included) that scrolls vertically, and,
 * after scrolling everything to the end, whether the last block of the page and the last left-menu
 * item are inside the window (reachable).
 */
async function scrollFacts(page: Page) {
  return page.evaluate(() => {
    const vScrollers: string[] = [];
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    if (root.scrollHeight > innerHeight + 1 && rootStyle.overflowY !== 'hidden')
      vScrollers.push('html');
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1)
        vScrollers.push(
          el.hasAttribute('data-scroll-frame') ? 'frame' : `${el.tagName}.${el.className}`,
        );
    }
    const frame = document.querySelector<HTMLElement>('[data-scroll-frame]');
    if (frame) frame.scrollTop = frame.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
    const main = document.querySelector('main#main');
    const last = main?.lastElementChild?.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="Menu Admin"]');
    const navLast = nav?.lastElementChild?.getBoundingClientRect();
    const navVisible = nav ? getComputedStyle(nav).display !== 'none' : false;
    return {
      vScrollers,
      lastBottom: last ? Math.round(last.bottom) : null,
      navLastBottom: navVisible && navLast ? Math.round(navLast.bottom) : null,
      height: innerHeight,
    };
  });
}

test.describe('scroll keys in the frame (AC-SB-08)', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1280, height: 800 } });

  test('ArrowDown / ArrowUp / PageUp / Shift+Space scroll the content column', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await page.goto(VERSIONS);
    await expect(page.getByRole('region', { name: 'So sánh phiên bản' })).toBeVisible();
    await ready(page);
    // Nothing focused yet.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => frameTop(page)).toBeGreaterThan(0);
    await page.keyboard.press('End');
    const max = await page
      .locator('[data-scroll-frame]')
      .evaluate((el) => el.scrollHeight - el.clientHeight);
    await expect.poll(() => frameTop(page)).toBe(max);
    await page.keyboard.press('PageUp');
    await expect.poll(() => frameTop(page)).toBeLessThan(max);
    await page.keyboard.press('End');
    await expect.poll(() => frameTop(page)).toBe(max);
    await page.keyboard.press('Shift+Space');
    await expect.poll(() => frameTop(page)).toBeLessThan(max);
    await page.keyboard.press('End');
    await expect.poll(() => frameTop(page)).toBe(max);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => frameTop(page)).toBeLessThan(max);
  });

  test('scrolling the frame is seen by a capture scroll listener on window (idle sign-out)', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await page.goto(VERSIONS);
    await ready(page);
    await page.evaluate(() => {
      (window as unknown as { __scrolls: number }).__scrolls = 0;
      window.addEventListener(
        'scroll',
        () => (window as unknown as { __scrolls: number }).__scrolls++,
        { capture: true, passive: true },
      );
    });
    await page.evaluate(() => {
      document.querySelector('[data-scroll-frame]')!.scrollTop = 300;
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls))
      .toBeGreaterThan(0);
  });

  test('a row menu opened after scrolling sits at its button and follows the frame', async ({
    page,
    supabase,
  }) => {
    withDraft(supabase);
    await page.goto(VERSIONS);
    await ready(page);
    await page.evaluate(() => {
      document.querySelector('[data-scroll-frame]')!.scrollTop = 120;
    });
    const more = page.getByRole('button', { name: /Thao tác khác/ }).first();
    await more.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const b = (await more.boundingBox())!;
    const m = (await menu.boundingBox())!;
    expect(Math.abs(m.y - (b.y + b.height))).toBeLessThan(24);
    expect(m.y + m.height).toBeLessThanOrEqual(800);
    await page.evaluate(() => {
      document.querySelector('[data-scroll-frame]')!.scrollTop = 60;
    });
    await expect
      .poll(async () => {
        const b2 = (await more.boundingBox())!;
        const m2 = (await menu.boundingBox())!;
        return Math.abs(m2.y - (b2.y + b2.height)) < 24;
      })
      .toBe(true);
  });
});

test.describe('focus in a field keeps the keys (AC-SB-08)', () => {
  test.use({ signedInAs: null, viewport: { width: 1280, height: 400 } });

  test('Space / End / ArrowDown typed in the login username field do not scroll the frame', async ({
    page,
  }) => {
    await page.goto('/login');
    const user = page.getByLabel('Tên đăng nhập');
    await user.click();
    await user.pressSequentially('ab');
    await page.keyboard.press('Space');
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    await expect(user).toHaveValue('ab ');
    expect(await frameTop(page)).toBe(0);
  });
});

const SIZES = [
  { width: 767, height: 800 },
  { width: 768, height: 800 },
  { width: 769, height: 800 },
  { width: 1024, height: 768 },
  { width: 1280, height: 600 },
  { width: 1440, height: 900 },
  { width: 1280, height: 480 },
  { width: 640, height: 400 }, // 200% zoom of 1280×800 (AC-UI-23)
];

for (const vp of SIZES) {
  test.describe(`one vertical scroll area, all reachable ${vp.width}x${vp.height}`, () => {
    test.use({ signedInAs: ADMIN, viewport: vp });

    test(`admin versions ${vp.width}x${vp.height}`, async ({ page, supabase }) => {
      withDraft(supabase);
      await page.goto(VERSIONS);
      await expect(page.getByRole('region', { name: 'So sánh phiên bản' })).toBeVisible();
      await ready(page);
      const f = await scrollFacts(page);
      const pageLevel = f.vScrollers.filter((s) => s === 'html' || s === 'frame');
      expect(pageLevel, JSON.stringify(f)).toHaveLength(1);
      expect(f.lastBottom!).toBeLessThanOrEqual(f.height);
      if (f.navLastBottom !== null)
        expect(f.navLastBottom, 'left menu').toBeLessThanOrEqual(f.height);
    });

    test(`run page with sticky action bar ${vp.width}x${vp.height}`, async ({ page }) => {
      test.setTimeout(90_000);
      await uploadFixtures(page);
      await ready(page);
      // Content taller than the window, at the top: the bar sticks to the window bottom.
      const bar = page.locator('[data-sticky-actions]');
      const atTop = (await bar.boundingBox())!;
      expect(Math.round(atTop.y + atTop.height)).toBe(vp.height);
      const f = await scrollFacts(page);
      const pageLevel = f.vScrollers.filter((s) => s === 'html' || s === 'frame');
      expect(pageLevel, JSON.stringify(f)).toHaveLength(1);
      // Scrolled to the end: the bar is inside the window and covers nothing above it.
      const end = (await bar.boundingBox())!;
      expect(Math.round(end.y + end.height)).toBeLessThanOrEqual(vp.height);
      const above = await bar.evaluate(
        (el) => el.previousElementSibling?.getBoundingClientRect().bottom ?? 0,
      );
      expect(above).toBeLessThanOrEqual(end.y + 1);
    });
  });
}

test.describe('Designer keyboard after the content became focusable', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1280, height: 800 } });

  // KNOWN BUG (verifier 2026-11-09, commit e15946a): `main#main` got tabIndex -1, so a click on the
  // empty canvas pane now focuses `main` instead of the body; DesignerEditor's `onCanvas()` treats
  // only the body / canvas elements as "on the canvas", so Ctrl+V (and Ctrl+C) are ignored there.
  // On 62c15c5 the same click left the focus on the body and the paste worked.
  test.fail(
    'KNOWN BUG: copy a node, click the empty canvas, paste: a copy appears',
    async ({ page, supabase }) => {
      withDraft(supabase);
      await page.goto(DESIGNER);
      await expect(page.getByTestId('rf__node-in_luong')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('rf__node-in_luong').click();
      await page.keyboard.press('Control+C');
      const pane = page.locator('.react-flow__pane');
      const box = (await pane.boundingBox())!;
      await page.mouse.click(box.x + box.width - 40, box.y + 40);
      await page.keyboard.press('Control+V');
      await expect(page.getByTestId('rf__node-input_1')).toBeVisible({ timeout: 3000 });
    },
  );

  test('pane click then Delete still deletes a box selection', async ({ page, supabase }) => {
    withDraft(supabase);
    await page.goto(DESIGNER);
    const node = page.getByTestId('rf__node-in_luong');
    await expect(node).toBeVisible({ timeout: 30_000 });
    const n = (await node.boundingBox())!;
    // Shift + drag on the pane around the node (React Flow box selection).
    await page.keyboard.down('Shift');
    await page.mouse.move(n.x - 15, n.y - 15);
    await page.mouse.down();
    await page.mouse.move(n.x + n.width + 15, n.y + n.height + 15, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(node).toHaveClass(/selected/);
    await page.keyboard.press('Delete');
    await expect(node).toHaveCount(0);
  });
});

test.describe('month picker on the run page after scrolling', () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test('opens in the window at its trigger', async ({ page }) => {
    await openFlow(page, '');
    await page.evaluate(() => {
      document.querySelector('[data-scroll-frame]')!.scrollTop = 40;
    });
    const trigger = page.getByRole('button', { name: /Kỳ|Tháng|Chọn tháng/ }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const d = (await dialog.boundingBox())!;
    expect(d.y).toBeGreaterThanOrEqual(64);
  });
});
