/**
 * Spec §32 AC-SB-01/02 (MEMORY 2026-11-09 09:06): a long tab (scrolls) and a short one (does not)
 * put the content at the same x — every vertical scroll area keeps room for its scrollbar.
 * AC-SB-07..09 (MEMORY 2026-11-09 10:20): from 768px the top bar stays put and only the area below
 * it scrolls (Admin: the content column, the left menu stays put); below 768px the page scrolls.
 * Supabase is mocked; fake data only.
 */
import { existsSync } from 'node:fs';
import { ADMIN, expect, test, USER, type Page } from './fixtures';
import { runToResult, uploadFixtures } from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000781';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';
const DESKTOP = { width: 1280, height: 800 };
const LAPTOP = { width: 1024, height: 768 };
const PHONE = { width: 390, height: 844 };
const size = (v: { width: number; height: number }) => `${v.width}x${v.height}`;

// Playwright's headless Chromium runs with --hide-scrollbars (the page's own bar is never drawn):
// these tests use real scrollbars, as a person sees them, so a missing gutter shows as a shift.
const PREINSTALLED = '/opt/pw-browsers/chromium';
const realScrollbars = {
  ignoreDefaultArgs: ['--hide-scrollbars'],
  ...((process.env.PW_CHROMIUM_PATH ?? (existsSync(PREINSTALLED) ? PREINSTALLED : undefined))
    ? { executablePath: process.env.PW_CHROMIUM_PATH ?? PREINSTALLED }
    : {}),
};

test.use({ launchOptions: realScrollbars });

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

/** Room the page (`html`) keeps for its scrollbar: window width minus the body's width. */
const pageRoom = (page: Page) =>
  page.evaluate(() => innerWidth - Math.round(document.body.getBoundingClientRect().width));

/** Room kept by the scroll frame for its vertical scrollbar (it has no border). */
const frameRoom = (page: Page) =>
  page
    .locator('[data-scroll-frame]')
    .evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth);

/** Scroll position of the scroll frame and of the page. */
const scrollTops = (page: Page) =>
  page.evaluate(() => ({
    frame: document.querySelector('[data-scroll-frame]')?.scrollTop ?? -1,
    page: Math.round(scrollY),
  }));

/** Left / right edges of the elements of `sel`, rounded to the pixel. */
const edges = (page: Page, sel: string | ReturnType<Page['locator']>) =>
  (typeof sel === 'string' ? page.locator(sel) : sel).evaluateAll((els) =>
    els.map((e) => {
      const b = e.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.right)];
    }),
  );

for (const viewport of [DESKTOP, LAPTOP]) {
  test.describe(`tabs keep their x ${size(viewport)}`, () => {
    test.use({ signedInAs: ADMIN, viewport });

    test(`users ↔ groups, page scroll room kept ${size(viewport)}`, async ({ page }) => {
      await page.goto('/admin/users');
      await expect(page.getByRole('table', { name: 'Danh sách tài khoản' })).toBeVisible();
      await ready(page);
      const sel = 'main h1, main [role="tablist"], main [role="tabpanel"]';
      const before = await edges(page, sel);
      await page.getByRole('tab', { name: /^Nhóm/ }).click();
      await expect(page.getByRole('table', { name: 'Danh sách nhóm' })).toBeVisible();
      expect(await edges(page, sel)).toEqual(before);
      // The page itself keeps no room (it does not scroll): the white top bar reaches the window's
      // right edge (AC-SB-07). The room is kept by the content column, the page's scroll area.
      expect(await pageRoom(page)).toBe(0);
      expect((await edges(page, 'header'))[0]).toEqual([0, viewport.width]);
      expect(await frameRoom(page)).toBe(10);
    });

    test(`result: mismatch ↔ summary ${size(viewport)}`, async ({ page }) => {
      test.setTimeout(120_000);
      await uploadFixtures(page);
      await runToResult(page);
      await ready(page);
      const sel = 'main h1, main [role="tablist"], main [role="tabpanel"]';
      const before = await edges(page, sel);
      await page.getByRole('tab', { name: 'Tổng hợp' }).click();
      await expect(page.getByRole('tab', { selected: true })).toHaveText('Tổng hợp');
      expect(await edges(page, sel)).toEqual(before);
    });

    test(`designer: Tham số ↔ Input slot panel ${size(viewport)}`, async ({ page, supabase }) => {
      withDraft(supabase);
      await page.goto(DESIGNER);
      await expect(page.getByTestId('rf__node-in_luong')).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      const panel = page.getByRole('complementary', { name: 'Cấu hình' });
      // Full-bleed Designer: no page scroll, so no room kept at the page edge.
      expect(
        await page.evaluate(
          () => innerWidth - Math.round(document.body.getBoundingClientRect().width),
        ),
      ).toBe(0);
      await panel.getByRole('tab', { name: 'Tham số' }).click();
      const sel = panel.locator('[role="tablist"], [role="tabpanel"]');
      const short = await edges(page, sel);
      await panel.getByRole('tab', { name: 'Input slot' }).click();
      await expect(panel.getByRole('tab', { name: 'Input slot' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(await edges(page, sel)).toEqual(short);
    });
  });
}

for (const viewport of [DESKTOP, LAPTOP]) {
  test.describe(`scroll frame ${size(viewport)} (AC-SB-07/08)`, () => {
    test.use({ signedInAs: ADMIN, viewport });

    test(`admin: the content column scrolls, top bar and left menu stay put ${size(viewport)}`, async ({
      page,
      supabase,
    }) => {
      // Version list + diff: longer than the window at both sizes.
      withDraft(supabase);
      await page.goto('/admin/flows/payroll-timesheet/versions');
      await expect(page.getByRole('region', { name: 'So sánh phiên bản' })).toBeVisible();
      await ready(page);
      const frame = page.locator('[data-scroll-frame]');
      await expect(frame.locator('main#main')).toHaveCount(1);
      const fixed = 'header, nav[aria-label="Menu Admin"]';
      const box = () =>
        page.locator(fixed).evaluateAll((els) =>
          els.map((e) => {
            const b = e.getBoundingClientRect();
            return [Math.round(b.left), Math.round(b.top), Math.round(b.right)];
          }),
        );
      const before = await box();
      // Mouse wheel over the content column.
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, 400);
      await expect.poll(async () => (await scrollTops(page)).frame).toBeGreaterThan(0);
      expect((await scrollTops(page)).page).toBe(0);
      expect(await box()).toEqual(before);
      // Nothing focused yet (right after loading): End still scrolls the content column.
      await page.reload();
      await expect(page.getByRole('region', { name: 'So sánh phiên bản' })).toBeVisible();
      await ready(page);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
      await page.keyboard.press('End');
      await expect.poll(async () => (await scrollTops(page)).frame).toBeGreaterThan(0);
      // Keyboard (focus in the page): End / Home / PageDown / Space scroll the content column.
      await page.getByRole('heading', { level: 1 }).click();
      await page.keyboard.press('Home');
      await expect.poll(async () => (await scrollTops(page)).frame).toBe(0);
      await page.keyboard.press('End');
      const max = await frame.evaluate((el) => el.scrollHeight - el.clientHeight);
      await expect.poll(async () => (await scrollTops(page)).frame).toBe(max);
      await page.keyboard.press('Home');
      await expect.poll(async () => (await scrollTops(page)).frame).toBe(0);
      await page.keyboard.press('PageDown');
      await expect.poll(async () => (await scrollTops(page)).frame).toBeGreaterThan(0);
      await page.keyboard.press('Home');
      await expect.poll(async () => (await scrollTops(page)).frame).toBe(0);
      await page.keyboard.press('Space');
      await expect.poll(async () => (await scrollTops(page)).frame).toBeGreaterThan(0);
      expect(await box()).toEqual(before);
      // A new screen starts at the top of the frame.
      await page.mouse.wheel(0, 400);
      await page.getByRole('link', { name: 'Flows' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flow và phiên bản');
      await expect.poll(async () => (await scrollTops(page)).frame).toBe(0);
    });

    test(`user screens: the area below the top bar scrolls ${size(viewport)}`, async ({ page }) => {
      test.setTimeout(120_000);
      await uploadFixtures(page);
      await runToResult(page);
      await ready(page);
      const header = () => page.locator('header').boundingBox();
      const before = await header();
      expect(before).toMatchObject({ x: 0, y: 0, width: viewport.width });
      expect(await pageRoom(page)).toBe(0);
      expect(await frameRoom(page)).toBe(10);
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, 600);
      await expect.poll(async () => (await scrollTops(page)).frame).toBeGreaterThan(0);
      expect((await scrollTops(page)).page).toBe(0);
      expect(await header()).toEqual(before);
    });

    test(`skip link focuses the content ${size(viewport)}`, async ({ page }) => {
      await page.goto('/admin/users');
      await ready(page);
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Bỏ qua, tới nội dung chính' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('main#main')).toBeFocused();
    });
  });
}

test.describe(`below 768px the whole page scrolls ${size(PHONE)} (AC-SB-07)`, () => {
  test.use({ signedInAs: USER, viewport: PHONE });

  test('the top bar scrolls away with the page', async ({ page }) => {
    test.setTimeout(120_000);
    await uploadFixtures(page);
    await runToResult(page);
    await ready(page);
    const top = async () => (await page.locator('header').boundingBox())!.y;
    expect(await top()).toBe(0);
    await page.mouse.move(PHONE.width / 2, PHONE.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => (await scrollTops(page)).page).toBeGreaterThan(0);
    expect((await scrollTops(page)).frame).toBe(0);
    expect(await top()).toBeLessThan(0);
  });
});
