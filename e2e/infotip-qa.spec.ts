/**
 * Verifier QA of the (i) button (`InfoTip`, spec §25.5, MEMORY 2026-11-06 14:45) and of the global
 * `position: relative` on scroll areas (AC-UI-78 rule 13): keyboard, mouse, touch, one popover at a
 * time, inside the viewport, read with the control (`aria-describedby`), floating layers (Menu "⋯"
 * on the last Admin row, Select, MonthPicker, minimap) not clipped. Supabase mocked; fake data.
 */
import { ADMIN, expect, test, type Locator, type Page } from './fixtures';
import { openCreateAccount } from './helpers';

const DESIGNER = '/admin/flows/payroll-timesheet/designer';
const POP = '[data-infotip-pop]';

/** The box is fully inside the viewport and is what is painted at its centre (not covered/clipped). */
async function expectOnScreen(page: Page, el: Locator) {
  const box = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
  const hit = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at !== null && (node === at || node.contains(at));
  });
  expect(hit, 'element is painted on top at its centre').toBe(true);
}

/** Keyboard path: from the node name field, Tab until `target` has focus. */
async function tabTo(page: Page, panel: Locator, target: Locator) {
  await panel.getByLabel('Tên node', { exact: true }).focus();
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function openDesignerNode(page: Page, id: string) {
  await page.goto(DESIGNER);
  const node = page.getByTestId(`rf__node-${id}`);
  await expect(node).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await node.click({ timeout: 3000 });
    await expect(node).toHaveClass(/selected/, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  return page.getByRole('complementary', { name: 'Cấu hình' });
}

test.describe('InfoTip: keyboard, mouse, one at a time (Designer, 1280)', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1280, height: 800 } });

  test('Tab opens, Enter / Space pin and toggle, Escape closes and keeps focus', async ({
    page,
  }) => {
    const panel = await openDesignerNode(page, 'cmp');
    const tips = panel.locator('[data-infotip-button]');
    expect(await tips.count()).toBeGreaterThanOrEqual(2);
    const first = tips.first();
    // Reach it by Tab from the element just before it.
    await tabTo(page, panel, first);
    await expect(page.locator(POP)).toHaveCount(1);
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toHaveCount(0);
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    // Enter pins it open, Enter again closes; Space does the same.
    await page.keyboard.press('Enter');
    await expect(page.locator(POP)).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.locator(POP)).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(page.locator(POP)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toHaveCount(0);
    await expect(first).toBeFocused();
    // Leaving by Tab closes it (the next (i), if focused, may open its own).
    await page.keyboard.press('Enter');
    await expect(page.locator(POP)).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(POP)).toHaveCount(
      (await tips.nth(1).evaluate((el) => el === document.activeElement)) ? 1 : 0,
    );
  });

  test('hover opens and leaving closes; a click pins it; a click outside closes', async ({
    page,
  }) => {
    const panel = await openDesignerNode(page, 'cmp');
    const tip = panel.locator('[data-infotip-button]').first();
    await tip.scrollIntoViewIfNeeded();
    await tip.hover();
    await expect(page.locator(POP)).toHaveCount(1);
    await expectOnScreen(page, page.locator(POP));
    await page.mouse.move(5, 400);
    await expect(page.locator(POP)).toHaveCount(0);
    await tip.click();
    await page.mouse.move(5, 400);
    await expect(page.locator(POP)).toHaveCount(1);
    await page
      .getByRole('heading', { level: 1 })
      .or(page.locator('.react-flow__pane'))
      .first()
      .click({
        position: { x: 5, y: 5 },
      });
    await expect(page.locator(POP)).toHaveCount(0);
  });

  test('the popover follows its button when the panel scrolls', async ({ page }) => {
    const panel = await openDesignerNode(page, 'cmp');
    const tip = panel.locator('[data-infotip-button]').first();
    await tip.scrollIntoViewIfNeeded();
    await tip.click();
    const pop = page.locator(POP);
    const before = (await pop.boundingBox())!;
    const b0 = (await tip.boundingBox())!;
    await panel.evaluate((el) => el.scrollBy(0, 40));
    const b1 = (await tip.boundingBox())!;
    if (Math.abs(b1.y - b0.y) > 1) {
      await expect
        .poll(async () => (await pop.boundingBox())!.y)
        .toBeCloseTo(before.y + (b1.y - b0.y), 0);
    }
  });

  test('only one popover at a time: a pinned one and a hovered one', async ({ page }) => {
    const panel = await openDesignerNode(page, 'cmp');
    const tips = panel.locator('[data-infotip-button]');
    await tips.first().scrollIntoViewIfNeeded();
    await tips.first().click();
    await expect(page.locator(POP)).toHaveCount(1);
    await tips.nth(1).scrollIntoViewIfNeeded();
    await tips.nth(1).hover();
    await expect(tips.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(POP)).toHaveCount(1);
  });

  test('only one popover at a time: a pinned one and a click on another', async ({ page }) => {
    const panel = await openDesignerNode(page, 'cmp');
    const tips = panel.locator('[data-infotip-button]');
    await tips.first().scrollIntoViewIfNeeded();
    await tips.first().click();
    await tips.nth(1).scrollIntoViewIfNeeded();
    await tips.nth(1).click();
    await expect(tips.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(tips.first()).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(POP)).toHaveCount(1);
  });

  test('only one popover at a time: keyboard focus on one, mouse over another', async ({
    page,
  }) => {
    const panel = await openDesignerNode(page, 'cmp');
    const tips = panel.locator('[data-infotip-button]');
    await tips.nth(1).scrollIntoViewIfNeeded();
    await tabTo(page, panel, tips.first());
    await expect(tips.first()).toHaveAttribute('aria-expanded', 'true');
    await tips.nth(1).hover();
    await expect(tips.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(POP)).toHaveCount(1);
  });
});

test.describe('InfoTip: read with its control', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1024, height: 768 } });

  test('Username field of the create-account dialog is described by its hint', async ({ page }) => {
    await page.goto('/admin/users');
    const dialog = await openCreateAccount(page);
    const input = dialog.getByLabel(/^Username/);
    await expect(input).toHaveAccessibleDescription(/3-32 ký tự: chữ thường không dấu/);
    // The hint is not shown as text until (i) opens it.
    await expect(dialog.locator('[data-hint]:not(.sr-only)')).toHaveCount(0);
    const tip = dialog.getByRole('button', { name: /^Giải thích: Username/ });
    await expect(tip).toHaveAccessibleDescription(/3-32 ký tự/);
    await tip.click();
    await expectOnScreen(page, page.locator(POP));
    await tip.click();
    await expect(page.locator(POP)).toHaveCount(0);
  });
});

test.describe('InfoTip in a modal dialog', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1024, height: 768 } });

  test('Escape on an open (i) in a modal dialog closes only the popover, not the dialog', async ({
    page,
  }) => {
    // Like Select: the first Escape closes the hint (keydown preventDefault, no "cancel"), the
    // second one closes the dialog.
    await page.goto('/admin/users');
    const dialog = await openCreateAccount(page);
    await dialog.getByLabel(/^Username/).fill('hr.cn09');
    await dialog.getByRole('button', { name: /^Giải thích: Username/ }).click();
    await expect(page.locator(POP)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator(POP)).toHaveCount(0);
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog.getByLabel(/^Username/)).toHaveValue('hr.cn09');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('InfoTip on a touch screen (390)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tap opens inside the viewport, tap outside closes', async ({ page }) => {
    await page.goto('/');
    const tip = page.getByRole('button', { name: 'Giải thích: Lần chạy gần đây' });
    await tip.scrollIntoViewIfNeeded();
    await tip.tap();
    await expect(page.locator(POP)).toHaveCount(1);
    await expectOnScreen(page, page.locator(POP));
    await page.getByRole('heading', { level: 1 }).tap();
    await expect(page.locator(POP)).toHaveCount(0);
    // Tap again on the button toggles open then closed.
    await tip.tap();
    await expect(page.locator(POP)).toHaveCount(1);
    await tip.tap();
    await expect(page.locator(POP)).toHaveCount(0);
  });
});

test.describe('floating layers inside scroll areas (position: relative on .overflow-*)', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1024, height: 768 } });

  test('"⋯" menu of the last Admin row is on screen and not clipped', async ({ page }) => {
    await page.goto('/admin/users');
    const table = page.getByRole('table', { name: 'Danh sách tài khoản' });
    await expect(table.locator('tbody tr').first()).toBeVisible();
    const last = table.locator('tbody tr').last();
    await last.scrollIntoViewIfNeeded();
    const more = last.getByRole('button', { name: /Thao tác khác/ });
    await expectOnScreen(page, more);
    await more.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expectOnScreen(page, menu);
    for (const item of await menu.getByRole('menuitem').all()) await expectOnScreen(page, item);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
  });

  test('sticky Thao tác column stays at the right edge while the table scrolls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 768 });
    await page.goto('/admin/users');
    const table = page.getByRole('table', { name: 'Danh sách tài khoản' });
    await expect(table.locator('tbody tr').first()).toBeVisible();
    const region = page.getByRole('region').filter({ has: table }).last();
    const cell = table.locator('tbody tr').first().locator('td').last();
    const r0 = (await region.boundingBox())!;
    await region.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    const c1 = (await cell.boundingBox())!;
    expect(Math.abs(c1.x + c1.width - (r0.x + r0.width))).toBeLessThanOrEqual(16);
    await region.evaluate((el) => el.scrollTo({ left: 0 }));
    const c0 = (await cell.boundingBox())!;
    expect(Math.abs(c0.x + c0.width - (r0.x + r0.width))).toBeLessThanOrEqual(16);
    await expectOnScreen(page, cell.getByRole('button').first());
  });

  test('Designer: minimap and controls on the canvas; a Select near the panel bottom opens on screen', async ({
    page,
  }) => {
    await page.goto(DESIGNER);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 });
    const panel = page.getByRole('complementary', { name: 'Cấu hình' });
    await panel.getByRole('tab', { name: 'Input slot' }).click();
    await expectOnScreen(page, page.locator('.react-flow__minimap'));
    await expectOnScreen(page, page.locator('.react-flow__controls'));
    const selects = panel.locator('[role="combobox"]:not([disabled])');
    expect(await selects.count()).toBeGreaterThan(0);
    const last = selects.last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    const list = page.getByRole('listbox');
    await expect(list).toBeVisible();
    await list.scrollIntoViewIfNeeded();
    await expectOnScreen(page, list.getByRole('option').first());
    await page.keyboard.press('Escape');
  });
});
