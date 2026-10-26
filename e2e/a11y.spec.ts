/**
 * Accessibility smoke (spec §18 WCAG 2.1 AA for the User part, §25): keyboard-only flow, names
 * on every control, focus visibility, touch targets, primary button contrast, and no horizontal
 * page scroll at 390px.
 */
import { expect, test, type Page } from './fixtures';
import {
  contrastRatio,
  fixtures,
  FLOW_URL,
  openFlow,
  periodButton,
  pickMonth,
  runButton,
  runToResult,
  uploadFixtures,
} from './helpers';

/** Press Tab until the focused element matches `name` (accessible-ish name), max 60 stops. */
async function tabTo(page: Page, name: RegExp): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const current = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return '';
      return (
        el.getAttribute('aria-label') ??
        (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
        el.textContent ??
        ''
      ).trim();
    });
    if (name.test(current)) return;
  }
  throw new Error(`could not reach ${name} with Tab`);
}

/**
 * With the period trigger focused: Enter opens the month grid on the current month; PageUp/
 * PageDown move years, arrows move months, Enter selects (focus returns to the trigger).
 */
async function keyboardPickMonth(page: Page, year: number, month: number): Promise<void> {
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  const m = /^Tháng (\d+) năm (\d+)$/.exec(label);
  expect(m, `focused cell: ${label}`).not.toBeNull();
  const [cur, curYear] = [Number(m![1]), Number(m![2])];
  for (let y = curYear; y !== year; y += y < year ? 1 : -1) {
    await page.keyboard.press(y < year ? 'PageDown' : 'PageUp');
  }
  for (let i = cur; i !== month; i += i < month ? 1 : -1) {
    await page.keyboard.press(i < month ? 'ArrowRight' : 'ArrowLeft');
  }
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', `Tháng ${month} năm ${year}`);
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
}

/** Interactive elements without any accessible name source. */
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [role=tab], [tabindex]:not([tabindex="-1"])',
      ),
    );
    for (const el of els) {
      const labelledby = el.getAttribute('aria-labelledby');
      const name =
        el.getAttribute('aria-label') ??
        (labelledby
          ? labelledby
              .split(' ')
              .map((id: string) => document.getElementById(id)?.textContent ?? '')
              .join(' ')
          : null) ??
        (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
        el.closest('label')?.textContent ??
        el.getAttribute('title') ??
        el.textContent;
      if (!name?.trim()) out.push(el.outerHTML.slice(0, 120));
    }
    return out;
  });
}

/** Controls whose rendered box is under the 44px touch target (spec §25.4). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(
        'main a[href], main button, main select, main input:not(.sr-only), [role=tab]',
      ),
    );
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 44 || r.width < 24) {
        out.push(
          `${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
    }
    return out;
  });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `page scrollWidth ${scroll} > viewport ${client}`).toBeLessThanOrEqual(client);
}

/** Computed colors once transitions have finished. */
async function settledColors(page: Page) {
  const button = runButton(page);
  await button.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return button.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color, disabled: (el as HTMLButtonElement).disabled };
  });
}

test('keyboard only: params, file pickers, run, tabs, filter and download', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Skip link is the first Tab stop.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Bỏ qua, tới nội dung chính' })).toBeFocused();
  await tabTo(page, /^Chạy flow Đối chiếu/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${FLOW_URL}$`));
  await expect(periodButton(page)).toBeVisible();

  await tabTo(page, /Kỳ lương/);
  await keyboardPickMonth(page, 2026, 9);
  await expect(periodButton(page)).toContainText('Tháng 09/2026');
  await expect(periodButton(page)).toBeFocused();

  // "chọn file" buttons open the native picker from the keyboard.
  await tabTo(page, /^chọn file$/);
  const [payrollChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Enter'),
  ]);
  expect(payrollChooser.isMultiple()).toBe(true);
  await payrollChooser.setFiles(fixtures('bang_luong_'));
  await tabTo(page, /^chọn file$/);
  const [timesheetChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Space'),
  ]);
  await timesheetChooser.setFiles(fixtures('cham_cong_'));
  await expect(runButton(page)).toHaveText('Chạy');

  await tabTo(page, /^Chạy$/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/result$/);

  await tabTo(page, /^Lệch \(9\)$/);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Chỉ có trong lương (3)');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Chỉ có trong chấm công (3)');
  await expect(page.getByRole('tab', { selected: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Tổng hợp');
  // aria-controls only on the selected tab, pointing at the panel that exists.
  const tabs = page.getByRole('tab');
  await expect(tabs.and(page.locator('[aria-controls]'))).toHaveCount(1);
  const controls = await tabs.first().getAttribute('aria-controls');
  await expect(page.locator(`[id="${controls}"]`)).toHaveAttribute('role', 'tabpanel');
  await page.keyboard.press('ArrowRight'); // back to "Lệch"
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Lệch (9)');
  await tabTo(page, /^Chi nhánh/);
  await page.keyboard.press('ArrowDown'); // first branch
  await expect(page.getByLabel('Chi nhánh')).toHaveValue('CN01');
  await expect(page.getByRole('region', { name: 'Lệch' }).getByRole('row')).toHaveCount(1 + 3);

  // The scrollable result table is focusable (keyboard scrolling).
  await tabTo(page, /^Lệch$/);
  await expect(page.getByRole('region', { name: 'Lệch' })).toBeFocused();

  await page.getByRole('button', { name: 'Tải Excel (4 sheet)' }).focus();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Enter'),
  ]);
  expect(download.suggestedFilename()).toBe('DoiChieu_2026-09.xlsx');
});

test('every control has an accessible name (flow list, wizard with errors, result)', async ({
  page,
}) => {
  await page.goto('/');
  expect(await unnamedControls(page)).toEqual([]);
  await openFlow(page);
  await page.getByLabel(/^Chọn file cho Bảng lương/).setInputFiles(fixtures('bang_luong_'));
  await page.getByLabel(/^Chọn file cho Chấm công/).setInputFiles(fixtures('bang_luong_')); // wrong slot → errors
  await expect(runButton(page)).toBeDisabled();
  expect(await unnamedControls(page)).toEqual([]);
  await page.getByLabel(/^Chọn file cho Chấm công/).setInputFiles(fixtures('cham_cong_'));
  for (const f of fixtures('bang_luong_')) {
    const name = f.split('/').pop()!;
    const items = page.getByRole('list', { name: /Chấm công/ }).getByRole('button', {
      name: `Bỏ file ${name}`,
    });
    await items.click();
  }
  await expect(runButton(page)).toBeEnabled();
  await runToResult(page);
  expect(await unnamedControls(page)).toEqual([]);
  // Landmarks / structure
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('tablist', { name: 'Sheet kết quả' })).toBeVisible();
});

test('focus is visible on buttons, tabs, links and selects', async ({ page }) => {
  await uploadFixtures(page);
  await runToResult(page);
  const missing: string[] = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const visible =
        (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
      return { visible, what: `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 25)}` };
    });
    if (info && !info.visible) missing.push(info.what);
  }
  expect(missing).toEqual([]);
});

test('touch targets are at least 44px high (wizard + result)', async ({ page }) => {
  await uploadFixtures(page);
  expect(await smallTargets(page)).toEqual([]);
  await runToResult(page);
  expect(await smallTargets(page)).toEqual([]);
});

test('primary "Chạy" button: disabled vs enabled colors and contrast', async ({ page }) => {
  await openFlow(page);
  const disabled = await settledColors(page);
  expect(disabled.disabled).toBe(true);
  test.info().annotations.push({
    type: 'disabled-colors',
    description: `${disabled.fg} on ${disabled.bg} = ${contrastRatio(disabled.fg, disabled.bg).toFixed(2)}:1`,
  });

  await page.getByLabel(/^Chọn file cho Bảng lương/).setInputFiles(fixtures('bang_luong_'));
  await page.getByLabel(/^Chọn file cho Chấm công/).setInputFiles(fixtures('cham_cong_'));
  await expect(runButton(page)).toBeEnabled();
  await page.mouse.move(0, 0); // not hovered
  const enabled = await settledColors(page);
  expect(enabled.disabled).toBe(false);
  // Spec §25.2/§25.3: primary = #0F766E with white text (5.47:1).
  expect(enabled.bg).toBe('rgb(15, 118, 110)');
  expect(enabled.fg).toBe('rgb(255, 255, 255)');
  const ratio = contrastRatio(enabled.fg, enabled.bg);
  test.info().annotations.push({
    type: 'enabled-colors',
    description: `${enabled.fg} on ${enabled.bg} = ${ratio.toFixed(2)}:1`,
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  // Disabled text is still readable even though WCAG exempts disabled controls.
  expect(contrastRatio(disabled.fg, disabled.bg)).toBeGreaterThanOrEqual(4.5);
});

test('primary "Chạy" button is not mid-transition right after it becomes enabled', async ({
  page,
}) => {
  // The pale-teal Run button in screenshot 04-run-valid.png: check what a screenshot right after
  // enabling captures (a 150ms color transition from the grey disabled state).
  await openFlow(page);
  await page.getByLabel(/^Chọn file cho Bảng lương/).setInputFiles(fixtures('bang_luong_'));
  await page.getByLabel(/^Chọn file cho Chấm công/).setInputFiles(fixtures('cham_cong_'));
  await expect(runButton(page)).toBeEnabled();
  const early = await runButton(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  const after = await settledColors(page);
  test.info().annotations.push({
    type: 'run-button-transition',
    description: `immediately: ${early}; settled: ${after.bg}`,
  });
  expect(after.bg).toBe('rgb(15, 118, 110)');
});

test.describe('mobile 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('no horizontal page scroll on list, wizard (with errors) and result', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noHorizontalScroll(page);

    await openFlow(page);
    await noHorizontalScroll(page);
    await page.getByLabel(/^Chọn file cho Bảng lương/).setInputFiles(fixtures('bang_luong_'));
    await page.getByLabel(/^Chọn file cho Chấm công/).setInputFiles(fixtures('bang_luong_'));
    await expect(runButton(page)).toBeDisabled();
    await expect(page.getByText(/không tìm thấy sheet/).first()).toBeVisible();
    await noHorizontalScroll(page);

    await page.getByLabel(/^Chọn file cho Chấm công/).setInputFiles(fixtures('cham_cong_'));
    for (const f of fixtures('bang_luong_')) {
      await page
        .getByRole('list', { name: /Chấm công/ })
        .getByRole('button', { name: `Bỏ file ${f.split('/').pop()!}` })
        .click();
    }
    await expect(runButton(page)).toBeEnabled();
    await runToResult(page);
    await noHorizontalScroll(page);
    await page.getByRole('tab', { name: 'Tổng hợp' }).click();
    await noHorizontalScroll(page);
  });
});

test.describe('month picker (MEMORY 13:48: custom picker, keyboard operable)', () => {
  test('keyboard: grid roving focus, Home/End, PageUp/PageDown, Escape returns focus', async ({
    page,
  }) => {
    await openFlow(page, '');
    const trigger = periodButton(page);
    await expect(trigger).toContainText('Chọn tháng');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /Kỳ lương/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'false');
    // Exactly one cell is in the tab order (roving tabindex), and it has focus.
    await expect(dialog.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    await expect(dialog.locator('[role="gridcell"][tabindex="0"]')).toBeFocused();
    await expect(dialog.getByRole('gridcell')).toHaveCount(12);
    await expect(dialog.getByRole('gridcell').first()).toHaveText('Th 1');

    // Jump to a known place: End of the row then PageUp/PageDown change only the year.
    await page.keyboard.press('Home');
    const start = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(start).toMatch(/^Tháng (1|5|9) năm \d{4}$/);
    const year = Number(/năm (\d{4})/.exec(start!)![1]);
    await page.keyboard.press('PageUp');
    await expect(page.locator(':focus')).toHaveAttribute(
      'aria-label',
      start!.replace(String(year), String(year - 1)),
    );
    await expect(dialog.getByText(String(year - 1), { exact: true })).toBeVisible();
    await page.keyboard.press('PageDown');
    await page.keyboard.press('End');
    const end = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(end).toMatch(/^Tháng (4|8|12) năm \d{4}$/);

    // Escape closes without changing the value and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('Chọn tháng');

    // Space selects too; the selected cell is marked and styled teal-strong.
    await page.keyboard.press('Enter');
    await page.keyboard.press(' ');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toContainText(/Tháng \d{2}\/\d{4}/);
    await page.keyboard.press('Enter');
    const selected = dialog.locator('[aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    const colors = await selected.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, fg: cs.color };
    });
    expect(contrastRatio(colors.fg, colors.bg)).toBeGreaterThanOrEqual(4.5);
    // Required param: no "Xóa" action; "Tháng này" is there.
    await expect(dialog.getByRole('button', { name: 'Xóa' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Tháng này' })).toBeVisible();
    // Click outside closes.
    await page.getByRole('heading', { level: 1 }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('changing the period re-resolves the version; callout shows it (wireframe)', async ({
    page,
    supabase,
  }) => {
    await openFlow(page, '2026-09');
    await expect(page.getByRole('status').filter({ hasText: 'Phiên bản áp dụng:' })).toContainText(
      'v3, hiệu lực từ 01/01/2026, theo kỳ đã chọn',
    );
    const asOf = () =>
      supabase.calls
        .filter((c) => c.path === '/rest/v1/rpc/resolve_flow_version')
        .map((c) => (JSON.parse(c.body) as { p_as_of: string }).p_as_of);
    expect(asOf()).toContain('2026-09-01');
    await pickMonth(page, '2025-03');
    await expect(page.getByRole('alert')).toContainText(
      'flow chưa có phiên bản hiệu lực cho kỳ 03/2025',
    );
    expect(asOf()).toContain('2025-03-01');
    await expect(runButton(page)).toHaveText('Chạy (chưa có phiên bản cho kỳ này)');
    await expect(runButton(page)).toBeDisabled();
  });

  test('popover fits a 390px viewport and cells are 44px targets', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFlow(page, '');
    await periodButton(page).click();
    const box = await page.getByRole('dialog').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    for (const cell of await page.getByRole('gridcell').all()) {
      const b = (await cell.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
    }
  });
});
