/**
 * Spec §32 AC-SB-01/02 (MEMORY 2026-11-09 09:06): a long tab (scrolls) and a short one (does not)
 * put the content at the same x — the page and every vertical scroll area keep room for their
 * scrollbar. Supabase is mocked; fake data only.
 */
import { existsSync } from 'node:fs';
import { ADMIN, expect, test, type Page } from './fixtures';
import { runToResult, uploadFixtures } from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000781';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';
const DESKTOP = { width: 1280, height: 800 };
const LAPTOP = { width: 1024, height: 768 };
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
      // The room is kept whether the page scrolls or not: the body is narrower than the window by
      // exactly one 10px bar (clientWidth of the root ignores an unused gutter, the body does not).
      const room = await page.evaluate(
        () => innerWidth - Math.round(document.body.getBoundingClientRect().width),
      );
      expect(room).toBe(10);
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
