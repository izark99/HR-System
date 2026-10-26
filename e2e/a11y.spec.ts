/**
 * Accessibility smoke (spec §18 WCAG 2.1 AA for the User part, §25): keyboard-only flow, names
 * on every control, focus visibility, touch targets, primary button contrast, and no horizontal
 * page scroll at 390px.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  contrastRatio,
  fixtures,
  FLOW_URL,
  openFlow,
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
  // Skip link is the first Tab stop.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Bỏ qua, tới nội dung chính' })).toBeFocused();
  await tabTo(page, /^Chạy flow Đối chiếu/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${FLOW_URL}$`));
  await expect(page.getByLabel(/Kỳ lương/)).toBeVisible();

  await tabTo(page, /Kỳ lương/);
  // Chromium month field (vi-VN): month segment takes arrows, Tab moves to the year segment.
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  await page.keyboard.type('2026');
  await expect(page.getByLabel(/Kỳ lương/)).toHaveValue('2026-09');

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
