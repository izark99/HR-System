/**
 * Custom month / date pickers (MEMORY 2026-10-26 13:48): keyboard operation, focus handling,
 * closing, and fit inside small viewports. MonthPicker is exercised on the run page, DatePicker
 * in the Admin import dialog (a native modal <dialog>).
 */
import { ADMIN, expect, test, type Locator, type Page } from './fixtures';
import { baseFlowDefinition } from './supabase-mock';
import { openFlow, periodButton, pickDate, pickerPopover, textFile } from './helpers';

const focusedLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

// ---------------------------------------------------------------------------------------------
test.describe('MonthPicker (run page)', () => {
  async function openWith(page: Page, month: string) {
    await openFlow(page, month);
    const trigger = periodButton(page);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(pickerPopover(page)).toBeVisible();
    return trigger;
  }

  test('arrows wrap across years, Home/End jump within the row, Page keys move the year', async ({
    page,
  }) => {
    await openWith(page, '2026-09'); // 9 = first column of the 3rd row
    expect(await focusedLabel(page)).toBe('Tháng 9 năm 2026');

    await page.keyboard.press('End');
    expect(await focusedLabel(page)).toBe('Tháng 12 năm 2026');
    await page.keyboard.press('ArrowRight'); // Dec → Jan of next year
    expect(await focusedLabel(page)).toBe('Tháng 1 năm 2027');
    await expect(pickerPopover(page).locator('[aria-live="polite"]')).toHaveText('2027');
    await page.keyboard.press('ArrowLeft'); // Jan → Dec of previous year
    expect(await focusedLabel(page)).toBe('Tháng 12 năm 2026');
    await page.keyboard.press('Home');
    expect(await focusedLabel(page)).toBe('Tháng 9 năm 2026');
    await page.keyboard.press('ArrowUp'); // one row up = 4 months earlier
    expect(await focusedLabel(page)).toBe('Tháng 5 năm 2026');
    await page.keyboard.press('ArrowDown');
    expect(await focusedLabel(page)).toBe('Tháng 9 năm 2026');
    await page.keyboard.press('PageUp');
    expect(await focusedLabel(page)).toBe('Tháng 9 năm 2025');
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    expect(await focusedLabel(page)).toBe('Tháng 9 năm 2027');
    // Top row going up crosses into the previous year.
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    expect(await focusedLabel(page)).toBe('Tháng 5 năm 2027');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await focusedLabel(page)).toBe('Tháng 9 năm 2026');
  });

  test('Enter selects the focused month, closes, and focus returns to the trigger', async ({
    page,
  }) => {
    const trigger = await openWith(page, '2026-09');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('PageUp');
    await page.keyboard.press('Enter');
    await expect(pickerPopover(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('Tháng 10/2025');
  });

  test('Escape closes without changing the value and returns focus; reopening starts at the value', async ({
    page,
  }) => {
    const trigger = await openWith(page, '2026-09');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(pickerPopover(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('Tháng 09/2026');
    await page.keyboard.press('Enter');
    expect(await focusedLabel(page)).toBe('Tháng 9 năm 2026');
  });

  test('click outside closes (value kept, no focus stolen from the clicked control)', async ({
    page,
  }) => {
    const trigger = await openWith(page, '2026-09');
    await page.keyboard.press('ArrowRight');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(pickerPopover(page)).toHaveCount(0);
    await expect(trigger).toContainText('Tháng 09/2026');
    // A second click on the trigger toggles it closed again.
    await trigger.click();
    await expect(pickerPopover(page)).toBeVisible();
    await trigger.click();
    await expect(pickerPopover(page)).toHaveCount(0);
  });

  test('Tab out of the popover closes it', async ({ page }) => {
    await openWith(page, '2026-09');
    for (let i = 0; i < 6 && (await pickerPopover(page).count()) > 0; i++) {
      await page.keyboard.press('Tab');
    }
    await expect(pickerPopover(page)).toHaveCount(0);
  });

  test('year buttons and "Tháng này" work with the mouse; required param has no "Xóa"', async ({
    page,
  }) => {
    await openFlow(page, '2026-09');
    await periodButton(page).click();
    const popover = pickerPopover(page);
    await popover.getByRole('button', { name: 'Năm sau' }).click();
    await expect(popover.locator('[aria-live="polite"]')).toHaveText('2027');
    await expect(popover.getByRole('gridcell', { name: 'Tháng 9 năm 2027' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await popover.getByRole('button', { name: 'Năm trước' }).click();
    await expect(popover.getByRole('gridcell', { name: 'Tháng 9 năm 2026' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(popover.getByRole('button', { name: 'Xóa' })).toHaveCount(0);
    const now = new Date();
    await popover.getByRole('button', { name: 'Tháng này' }).click();
    await expect(periodButton(page)).toContainText(
      `Tháng ${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`,
    );
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('DatePicker (Admin import dialog)', () => {
  test.use({ signedInAs: ADMIN });

  const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Nhập flow từ JSON' });
  const from = (page: Page) => importDialog(page).locator('#import-from');
  const to = (page: Page) => importDialog(page).locator('#import-to');

  async function openImport(page: Page) {
    await page.goto('/admin/flows');
    await page
      .getByLabel('Chọn file flow JSON')
      .setInputFiles(textFile('flow-ngay.json', JSON.stringify(baseFlowDefinition())));
    await expect(importDialog(page)).toBeVisible();
  }

  async function openFrom(page: Page, iso: string) {
    await openImport(page);
    await pickDate(page, from(page), iso);
    await from(page).focus();
    await page.keyboard.press('Enter');
    await expect(pickerPopover(page)).toBeVisible();
  }

  test('week keys (Home/End = Monday/Sunday), arrows (±1/±7), month and year paging', async ({
    page,
  }) => {
    await openFrom(page, '2026-01-31'); // a Saturday
    expect(await focusedLabel(page)).toBe('Ngày 31 tháng 1 năm 2026');
    await page.keyboard.press('Home');
    expect(await focusedLabel(page)).toBe('Ngày 26 tháng 1 năm 2026');
    await page.keyboard.press('End'); // Sunday, already in February
    expect(await focusedLabel(page)).toBe('Ngày 1 tháng 2 năm 2026');
    await expect(pickerPopover(page).locator('[aria-live="polite"]')).toHaveText(
      'Tháng 2 năm 2026',
    );
    await page.keyboard.press('ArrowLeft');
    expect(await focusedLabel(page)).toBe('Ngày 31 tháng 1 năm 2026');
    await page.keyboard.press('ArrowDown');
    expect(await focusedLabel(page)).toBe('Ngày 7 tháng 2 năm 2026');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await focusedLabel(page)).toBe('Ngày 24 tháng 1 năm 2026');
    await page.keyboard.press('PageDown');
    expect(await focusedLabel(page)).toBe('Ngày 24 tháng 2 năm 2026');
    await page.keyboard.press('Shift+PageUp');
    expect(await focusedLabel(page)).toBe('Ngày 24 tháng 2 năm 2025');
    await page.keyboard.press('Shift+PageDown');
    await page.keyboard.press('PageUp');
    expect(await focusedLabel(page)).toBe('Ngày 24 tháng 1 năm 2026');
  });

  test('month paging clamps to the month length; leap day + 1 year → 28 Feb', async ({ page }) => {
    await openFrom(page, '2026-01-31');
    await page.keyboard.press('PageDown');
    expect(await focusedLabel(page)).toBe('Ngày 28 tháng 2 năm 2026');
    await page.keyboard.press('Enter');
    await expect(from(page)).toContainText('28/02/2026');

    await pickDate(page, from(page), '2028-02-29');
    await from(page).focus();
    await page.keyboard.press('Enter');
    expect(await focusedLabel(page)).toBe('Ngày 29 tháng 2 năm 2028');
    await page.keyboard.press('Shift+PageDown');
    expect(await focusedLabel(page)).toBe('Ngày 28 tháng 2 năm 2029');
  });

  test('Enter/Space select; trigger shows dd/MM/yyyy and gets focus back', async ({ page }) => {
    await openFrom(page, '2026-03-10');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(pickerPopover(page)).toHaveCount(0);
    await expect(from(page)).toBeFocused();
    await expect(from(page)).toContainText('11/03/2026');
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(from(page)).toContainText('18/03/2026');
  });

  test('click outside the popover (inside the dialog) closes it; the dialog stays', async ({
    page,
  }) => {
    await openFrom(page, '2026-03-10');
    await importDialog(page).getByRole('heading', { name: 'Nhập flow từ JSON' }).click();
    await expect(pickerPopover(page)).toHaveCount(0);
    await expect(importDialog(page)).toBeVisible();
    await expect(from(page)).toContainText('10/03/2026');
  });

  test('opening the second picker closes the first; optional picker offers "Xóa", required does not', async ({
    page,
  }) => {
    await openImport(page);
    await pickDate(page, to(page), '2027-05-05');
    await expect(to(page)).toContainText('05/05/2027');
    await from(page).click();
    await expect(pickerPopover(page)).toHaveCount(1);
    await expect(pickerPopover(page).getByRole('button', { name: 'Xóa' })).toHaveCount(0);
    await to(page).click(); // pointerdown outside the first picker closes it
    await expect(pickerPopover(page)).toHaveCount(1);
    await pickerPopover(page).getByRole('button', { name: 'Xóa' }).click();
    await expect(to(page)).toContainText('Chọn ngày');
    await expect(to(page)).toBeFocused();
  });

  test('"Hôm nay" picks today', async ({ page }) => {
    await openImport(page);
    await to(page).click();
    await pickerPopover(page).getByRole('button', { name: 'Hôm nay' }).click();
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    await expect(to(page)).toContainText(
      `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    );
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('small viewports: the popover is fully visible', () => {
  async function expectInside(page: Page, popover: Locator, width: number, height: number) {
    // The page / dialog may scroll; what matters is that the whole popover can be brought in view.
    await popover.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
    const box = (await popover.boundingBox())!;
    expect(box, 'popover has a box').not.toBeNull();
    expect(box.x, 'left edge').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(width);
    expect(box.y, 'top edge').toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, 'bottom edge').toBeLessThanOrEqual(height + 1); // sub-pixel rounding
  }

  for (const [width, height] of [
    [320, 700],
    [360, 740],
    [390, 844],
    [500, 844],
  ] as const) {
    test(`month picker on the run page at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openFlow(page, '');
      await periodButton(page).click();
      const popover = pickerPopover(page);
      await expect(popover).toBeVisible();
      await expectInside(page, popover, width, height);
      // The last row of controls is reachable (not clipped).
      await popover.getByRole('button', { name: 'Tháng này' }).click();
      await expect(popover).toHaveCount(0);
    });
  }

  test.describe('date picker next to the right edge (import dialog)', () => {
    test.use({ signedInAs: ADMIN });

    for (const [width, height] of [
      [320, 700],
      [360, 740],
      [390, 844],
      [500, 844], // both pickers share one row: "to" sits near the right edge
    ] as const) {
      for (const which of ['import-from', 'import-to'] as const) {
        test(`${which} at ${width}x${height}`, async ({ page }) => {
          await page.setViewportSize({ width, height });
          await page.goto('/admin/flows');
          await page
            .getByLabel('Chọn file flow JSON')
            .setInputFiles(textFile('flow-ngay.json', JSON.stringify(baseFlowDefinition())));
          const trigger = page.locator(`#${which}`);
          await expect(trigger).toBeVisible();
          await trigger.click();
          const popover = pickerPopover(page);
          await expect(popover).toBeVisible();
          await expectInside(page, popover, width, height);
          // Footer actions are not clipped by the dialog: clicking "Hôm nay" works.
          await popover.getByRole('button', { name: 'Hôm nay' }).click();
          await expect(popover).toHaveCount(0);
        });
      }
    }
  });
});

test.describe('fixed bugs (were KNOWN BUGS)', () => {
  test.use({ signedInAs: ADMIN });

  const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Nhập flow từ JSON' });
  const from = (page: Page) => importDialog(page).locator('#import-from');

  // Was picker-shared.tsx:134-139: Escape was not preventDefault()-ed, so the browser also fired
  // `cancel` on the surrounding modal <dialog> and closed the whole import form.
  test('Escape closes only the picker: the modal dialog stays open and focus returns to the trigger', async ({
    page,
  }) => {
    await page.goto('/admin/flows');
    await page
      .getByLabel('Chọn file flow JSON')
      .setInputFiles(textFile('flow-ngay.json', JSON.stringify(baseFlowDefinition())));
    await pickDate(page, from(page), '2026-03-10');
    await from(page).focus();
    await page.keyboard.press('Enter');
    await expect(pickerPopover(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pickerPopover(page)).toHaveCount(0);
    await expect(importDialog(page)).toBeVisible({ timeout: 2_000 });
    await expect(from(page)).toBeFocused();
    await expect(from(page)).toContainText('10/03/2026'); // value unchanged
    // A second Escape (picker closed) closes the dialog itself.
    await page.keyboard.press('Escape');
    await expect(importDialog(page)).toHaveCount(0);
  });
});
