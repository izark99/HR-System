/**
 * Design v2 checks for `ui-v2.spec.ts` (spec §25, §28 AC-UI-03..11, AC-UI-20/30/31): screenshots
 * for manual review (no pixel comparison), real computed-style assertions and an axe scan.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Locator, type Page } from './fixtures';

export const SHOTS = resolve(import.meta.dirname, '../test-results/ui-v2');

export const DESKTOP = { width: 1280, height: 800 };
export const MOBILE = { width: 390, height: 844 };

export const C = {
  ink: 'rgb(31, 42, 68)',
  teal: 'rgb(15, 118, 110)',
  tealTint: 'rgb(221, 245, 239)',
  line: 'rgb(226, 232, 240)',
  lineInput: 'rgb(71, 85, 105)',
  coralText: 'rgb(194, 65, 12)',
  page: 'rgb(247, 250, 249)',
  white: 'rgb(255, 255, 255)',
};
export const FLOAT_SHADOW = 'rgba(31, 42, 68, 0.12) 0px 8px 28px 0px';

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** Fonts loaded, animations finished: stable frame for a screenshot. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
  expect(await page.evaluate(() => document.fonts.check('16px "Be Vietnam Pro"'))).toBe(true);
}

/** `test-results/ui-v2/index.html` listing every PNG, grouped by screen (name prefix). */
function writeIndex(): void {
  const files = readdirSync(SHOTS)
    .filter((f) => f.endsWith('.png'))
    .sort();
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const screen = f.split('--')[0]!;
    groups.set(screen, [...(groups.get(screen) ?? []), f]);
  }
  const sections = [...groups]
    .map(
      ([screen, list]) =>
        `<section><h2>${screen}</h2>${list
          .map(
            (f) =>
              `<figure><a href="${f}"><img src="${f}" alt="${f}" loading="lazy"></a><figcaption>${f}</figcaption></figure>`,
          )
          .join('')}</section>`,
    )
    .join('\n');
  writeFileSync(
    join(SHOTS, 'index.html'),
    `<!doctype html><html lang="vi"><meta charset="utf-8"><title>UI v2 – ảnh chụp</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#f7faf9;color:#1f2a44}
section{margin-bottom:32px}figure{display:inline-block;margin:0 16px 16px 0;vertical-align:top}
img{max-width:640px;border:1px solid #e2e8f0}figcaption{font-size:13px}</style>
<h1>Design v2 – ${files.length} ảnh (dữ liệu giả)</h1>
${sections}</html>`,
  );
}

/**
 * Browser clock for the screenshot specs (spec §30.3 AC-TL-11): dates shown on screen (month
 * picker, version timeline) do not depend on the day the suite runs. After every fixed timestamp
 * of the Supabase mock and before any real run date, so mocked sessions stay valid.
 */
export const FROZEN_NOW = new Date('2026-11-02T09:00:00+07:00');

export async function freezeClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(FROZEN_NOW);
}

/**
 * Full-page PNG `<screen>--<state>--<w>x<h>.png` in test-results/ui-v2 (+ index.html) for the
 * manual review page, then compared with the committed baseline in e2e/__screenshots__
 * (spec §30.3; update with `CI=1 pnpm test:e2e e2e/ui-v2 --update-snapshots`).
 */
export async function shot(
  page: Page,
  screen: string,
  state: string,
  // false: a state that changes while it is shown (a run in progress) — kept for manual review only.
  { compare = true }: { compare?: boolean } = {},
): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  const { width, height } = page.viewportSize()!;
  const name = `${screen}--${state}--${width}x${height}.png`;
  const expanded = await expandScrollFrame(page);
  try {
    await page.screenshot({
      path: join(SHOTS, name),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
    writeIndex();
    if (compare) await compareShot(page, name);
  } finally {
    if (expanded) await restoreScrollFrame(page);
  }
}

/**
 * From 768px the window does not scroll, the frame below the top bar does (spec §32 AC-SB-07), so
 * a full-page shot would only hold one window of content. For the shot only, the app frame grows
 * to its content (inline `height: auto`, removed right after) and the frame keeps its layout
 * (scrollbar room included): the image shows the whole screen as before (AC-SB-09). The scroll
 * position is put back afterwards.
 */
async function expandScrollFrame(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('[data-scroll-frame]');
    if (!frame || !/(auto|scroll)/.test(getComputedStyle(frame).overflowY)) return false;
    frame.dataset.e2eScrollTop = String(frame.scrollTop);
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('[data-app-shell], [data-scroll-frame]'),
    ))
      el.style.setProperty('height', 'auto', 'important');
    return true;
  });
}

async function restoreScrollFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('[data-app-shell], [data-scroll-frame]'),
    ))
      el.style.removeProperty('height');
    const frame = document.querySelector<HTMLElement>('[data-scroll-frame]');
    if (frame) {
      frame.scrollTop = Number(frame.dataset.e2eScrollTop ?? 0);
      delete frame.dataset.e2eScrollTop;
    }
  });
}

async function compareShot(page: Page, name: string): Promise<void> {
  // Run duration ("· 0,04 giây") differs on every run: pinned in the DOM before the comparison
  // (spec §30.3 AC-TL-11). Masking is not enough: its box width follows the text.
  await page.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (/\d giây/.test(n.nodeValue ?? '')) {
        n.nodeValue = n.nodeValue!.replace(/[\d.,]+ giây/g, '0,00 giây');
      }
    }
  });
  await expect(page).toHaveScreenshot(name, { fullPage: true });
}

/** Results of every axe scan, for the run report (serious/critical must be 0). */
export const axeLog: { state: string; violations: { id: string; impact: string; n: number }[] }[] =
  [];

/**
 * axe-core, WCAG 2.1 A/AA: no serious/critical violation. `exclude` lists selectors left out of
 * the scan, each with the reason (library markup we do not control).
 */
export async function axe(
  page: Page,
  state: string,
  exclude: { selector: string; reason: string }[] = [],
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  for (const e of exclude) builder = builder.exclude(e.selector);
  const result = await builder.analyze();
  const violations = result.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? 'unknown',
    n: v.nodes.length,
    targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  axeLog.push({ state, violations });
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, `axe serious/critical on ${state}`).toEqual([]);
}

/** Computed style of one element (subset). */
async function style(loc: Locator) {
  return loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      color: cs.color,
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage,
      radius: cs.borderTopLeftRadius,
      borderTop: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      borderLeft: `${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}`,
      borderBottom: `${cs.borderBottomWidth} ${cs.borderBottomStyle} ${cs.borderBottomColor}`,
      shadow: cs.boxShadow,
      height: r.height,
      width: r.width,
      paddingLeft: cs.paddingLeft,
      paddingTop: cs.paddingTop,
      maxWidth: cs.maxWidth,
    };
  });
}

/**
 * Checks valid on every screen (AC-UI-03/05/06/12):
 * - no text in weight 800; h1–h3 in 600;
 * - uppercase only on eyebrows and Select group headers;
 * - no gradient background anywhere;
 * - at most one primary (teal) button per region (table row/card/dialog/toolbar/form);
 * - no horizontal page scroll.
 */
export async function commonChecks(page: Page, opts: { darkCards?: number } = {}): Promise<void> {
  const report = await page.evaluate(() => {
    const out = {
      heavy: [] as string[],
      headings: [] as string[],
      uppercase: [] as string[],
      gradients: [] as string[],
      primaries: new Map<Element, string[]>(),
      dark: [] as string[],
    };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const ownText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '',
      );
      if (ownText && Number(cs.fontWeight) >= 800) out.heavy.push(name(el));
      if (/^H[1-3]$/.test(el.tagName) && !['500', '600', '700'].includes(cs.fontWeight)) {
        out.headings.push(`${name(el)} ${cs.fontWeight}`);
      }
      // Monaco paints its own UI (suggest widget etc.) — not app text.
      if (
        ownText &&
        cs.textTransform === 'uppercase' &&
        !el.closest('[data-eyebrow], [role="listbox"], .monaco-editor, .react-flow__attribution')
      ) {
        out.uppercase.push(name(el));
      }
      if (cs.backgroundImage.includes('gradient') && !el.closest('.monaco-editor')) {
        out.gradients.push(name(el));
      }
      const interactive = el.matches('button, a[href]');
      if (
        interactive &&
        cs.backgroundColor === 'rgb(15, 118, 110)' &&
        !el.closest('[role="grid"]') // month/day cells: the selected cell is teal by spec
      ) {
        const region =
          // A table row is its own region (AC-UI-54: a draft row of the Version table has its own
          // "Publish" primary next to the row's other actions).
          el.closest(
            'tr, dialog, [role="dialog"], [role="toolbar"], section, article, form, header',
          ) ?? document.body;
        out.primaries.set(region, [...(out.primaries.get(region) ?? []), name(el)]);
      }
      if (!interactive && cs.backgroundColor === 'rgb(31, 42, 68)' && el.closest('main')) {
        out.dark.push(name(el));
      }
    }
    return {
      ...out,
      primaries: [...out.primaries.values()].filter((l) => l.length > 1),
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyFont: getComputedStyle(document.body).fontSize,
    };
  });
  expect(report.heavy, 'weight 800').toEqual([]);
  expect(report.headings, 'headings outside 500/600/700').toEqual([]);
  expect(report.uppercase, 'uppercase outside eyebrow').toEqual([]);
  expect(report.gradients, 'gradients').toEqual([]);
  expect(report.primaries, 'more than one primary button in a region').toEqual([]);
  expect(report.dark.length, `dark cards: ${report.dark.join(', ')}`).toBe(opts.darkCards ?? 0);
  expect(report.scroll, 'horizontal page scroll').toBeLessThanOrEqual(0);
  expect(report.bodyFont).toBe('16px');
}

/**
 * Page title (§25.1, AC-UI-60/62): `PageHeader workspace` 28/36/600, `showcase` 32/40/600, both
 * 24/32 on mobile; the variant is read from the header (`data-page-header`). Eyebrow above it
 * (AC-UI-06) unless the header has a back link instead (`eyebrow: false`).
 */
export async function titleChecks(page: Page, opts: { eyebrow?: boolean } = {}): Promise<void> {
  const header = page.locator('[data-page-header]').first();
  await expect(header, 'PageHeader').toHaveAttribute('data-page-header', /^(workspace|showcase)$/);
  const variant = await header.getAttribute('data-page-header');
  const h1 = await style(header.getByRole('heading', { level: 1 }));
  const mobile = isMobile(page);
  const [size, lh] = mobile
    ? ['24px', '32px']
    : variant === 'showcase'
      ? ['32px', '40px']
      : ['28px', '36px'];
  expect(h1.fontSize, `h1 ${variant}`).toBe(size);
  expect(h1.lineHeight, `h1 ${variant}`).toBe(lh);
  expect(h1.fontWeight).toBe('600');
  // AC-UI-62: eyebrow + title + subtitle within 96px (a header with a 44px back link instead of
  // the eyebrow is not that composition).
  if (variant === 'workspace' && !mobile && (await header.locator('[data-eyebrow]').count()) > 0) {
    const box = await header.boundingBox();
    expect(box!.height, 'workspace header height (AC-UI-62)').toBeLessThanOrEqual(96);
  }
  if (opts.eyebrow === false) return;
  const eyebrows = page.locator('main [data-eyebrow], body > div [data-eyebrow]');
  const count = await eyebrows.count();
  expect(count, 'eyebrow').toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const s = await style(eyebrows.nth(i));
    expect(s.textTransform).toBe('uppercase');
    expect(s.letterSpacing).toBe('1px');
    expect(s.fontWeight).toBe('500');
    expect(s.fontSize).toBe(isMobile(page) ? '13px' : '14px');
    expect(s.bg).toBe('rgba(0, 0, 0, 0)');
  }
}

/** Level-1 surfaces (AC-UI-04): 12px radius, 1px #E2E8F0 border, no shadow. */
export async function cardChecks(cards: Locator): Promise<void> {
  const n = await cards.count();
  expect(n, 'cards').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const s = await style(cards.nth(i));
    expect(s.radius, `card ${i}`).toBe('12px');
    expect(s.borderLeft, `card ${i}`).toBe(`1px solid ${C.line}`);
    expect(s.shadow, `card ${i}`).toBe('none');
  }
}

/** Level-2 floating layer (AC-UI-04): 12px radius + the float shadow. */
export async function floatChecks(layer: Locator): Promise<void> {
  const s = await style(layer);
  expect(s.radius).toBe('12px');
  expect(s.shadow).toContain(FLOAT_SHADOW);
}

/** Text-like controls (AC-UI-04, AC-UI-62): 44px, 6px radius, 1px #475569 border, 16px text. */
export async function inputChecks(controls: Locator): Promise<void> {
  const n = await controls.count();
  expect(n, 'controls').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const c = controls.nth(i);
    if (!(await c.isVisible())) continue;
    const s = await style(c);
    const label = (await c.getAttribute('aria-label')) ?? (await c.getAttribute('id')) ?? `${i}`;
    expect(Math.round(s.height), `height ${label}`).toBe(44);
    expect(s.radius, `radius ${label}`).toBe('6px');
    const invalid = (await c.getAttribute('aria-invalid')) === 'true';
    expect(s.borderLeft, `border ${label}`).toBe(
      `1px solid ${invalid ? C.coralText : C.lineInput}`,
    );
    expect(s.fontSize, `font ${label}`).toBe('16px');
  }
}

/** Standard buttons (AC-UI-05/10, AC-UI-62): 44px, radius 12px, `button` type 16px/600. */
export async function buttonChecks(buttons: Locator): Promise<void> {
  const n = await buttons.count();
  expect(n, 'buttons').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    if (!(await b.isVisible())) continue;
    const s = await style(b);
    const label = (await b.textContent())?.trim().slice(0, 30);
    expect(Math.round(s.height), `height ${label}`).toBeGreaterThanOrEqual(44);
    expect(s.radius, `radius ${label}`).toBe('12px');
    expect(s.fontWeight, `weight ${label}`).toBe('600');
    expect(s.fontSize, `size ${label}`).toBe('16px');
  }
}

/** Primary button colors (AC-UI-05): #0F766E with white text. */
export async function primaryChecks(button: Locator): Promise<void> {
  const s = await style(button);
  expect(s.bg).toBe(C.teal);
  expect(s.color).toBe(C.white);
}

/** Labels (AC-UI-10): 16px / 600. */
export async function labelChecks(labels: Locator): Promise<void> {
  const n = await labels.count();
  expect(n, 'labels').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const s = await style(labels.nth(i));
    expect(s.fontSize).toBe('16px');
    expect(s.fontWeight).toBe('600');
  }
}

/** Top bar (AC-UI-07): white, 1px #E2E8F0 bottom border, no shadow. */
export async function topBarChecks(page: Page): Promise<void> {
  const s = await style(page.locator('body > div header').first());
  expect(s.bg).toBe(C.white);
  expect(s.borderBottom).toBe(`1px solid ${C.line}`);
  expect(s.shadow).toBe('none');
}

/** Left menu (AC-UI-07): 44px items, 6px radius; the current one tinted with a 3px teal bar. */
export async function navChecks(nav: Locator): Promise<void> {
  const current = nav.locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  const s = await style(current);
  expect(s.height).toBeGreaterThanOrEqual(44);
  expect(s.radius).toBe('6px');
  expect(s.bg).toBe(C.tealTint);
  expect(s.color).toBe(C.teal);
  expect(s.fontWeight).toBe('600');
  expect(s.borderLeft).toBe(`3px solid ${C.teal}`);
}

/** High-density data table (AC-UI-11): 14px cells, 13px/600 header, 12px cell padding. */
export async function denseTableChecks(table: Locator): Promise<void> {
  const cell = await style(table.locator('tbody td').first());
  expect(cell.fontSize).toBe('14px');
  expect(cell.lineHeight).toBe('20px');
  expect(cell.paddingLeft).toBe('12px');
  const head = await style(table.locator('thead th').first());
  expect(head.fontSize).toBe('13px');
  expect(head.fontWeight).toBe('600');
}

/** Admin table header (AC-UI-10): 14px / 600 on #F1F5F9. */
export async function adminTableChecks(table: Locator): Promise<void> {
  const head = await style(table.locator('thead th').first());
  expect(head.fontSize).toBe('14px');
  expect(head.fontWeight).toBe('600');
  expect(head.bg).toBe('rgb(241, 245, 249)');
  const cell = await style(table.locator('tbody td').first());
  expect(cell.fontSize).toBe('16px');
}

/** Pills (AC-UI-06): status chips and tabs are 999px. */
export async function pillChecks(pills: Locator): Promise<void> {
  const n = await pills.count();
  expect(n, 'pills').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    expect((await style(pills.nth(i))).radius).toBe('999px');
  }
}

/**
 * Action column of an Admin table (AC-UI-54/58): every row has the same layout (visible icon
 * button + "⋯" menu button) on ONE line, the menu buttons line up in a column,
 * small buttons are 36px; chips and buttons do not wrap.
 */
export async function rowActionsChecks(table: Locator): Promise<void> {
  const report = await table.evaluate((t) => {
    const rows = Array.from(t.querySelectorAll('tbody tr'));
    return {
      rows: rows.length,
      cells: rows.map((r) => {
        const box = r.querySelector('[data-row-actions]');
        const menu = box?.querySelector('[data-menu-button]');
        const buttons = box ? Array.from(box.querySelectorAll('a, button')) : [];
        const tops = buttons.map((b) => Math.round(b.getBoundingClientRect().top));
        // The action cell is pinned (sticky) inside the scrolling region: always fully in view.
        const region = (t.closest('[role="region"]') ?? t).getBoundingClientRect();
        const cell = box?.getBoundingClientRect();
        return {
          inView: !!cell && cell.left >= region.left - 1 && cell.right <= region.right + 1,
          has: !!box && !!menu,
          menuLabel: menu?.getAttribute('aria-label') ?? '',
          menuRight: menu ? Math.round(menu.getBoundingClientRect().right) : -1,
          oneLine: tops.every((y) => Math.abs(y - tops[0]!) <= 1),
          heights: buttons.map((b) => Math.round(b.getBoundingClientRect().height)),
          // Icon buttons (AC-UI-58): 36x36, no border, ink icon, named by aria-label, an SVG.
          looks: buttons.map((b) => {
            const cs = getComputedStyle(b);
            const r = b.getBoundingClientRect();
            return {
              name: b.getAttribute('aria-label') ?? '',
              icon:
                Math.round(r.width) === 36 &&
                Math.round(r.height) === 36 &&
                cs.borderTopWidth === '0px' &&
                cs.color === 'rgb(31, 42, 68)' &&
                !!b.querySelector('svg') &&
                (b.textContent ?? '').trim() === '',
            };
          }),
        };
      }),
      wrapped: Array.from(t.querySelectorAll('[data-chip], button, a')).flatMap((el) => {
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
        const r = el.getBoundingClientRect();
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        // Taller than one line of text (+ padding) = the label wrapped. Buttons are min 36px tall.
        const oneLine = Math.max(lh + pad + borders, 36);
        return r.height > oneLine + 2
          ? [`${el.tagName} "${el.textContent?.trim()}" ${r.height}`]
          : [];
      }),
    };
  });
  expect(report.rows, 'table rows').toBeGreaterThan(0);
  for (const c of report.cells) {
    expect(c.has, 'row has the shared action cell').toBe(true);
    expect(c.menuLabel).toMatch(/^Thao tác khác cho .+/);
    expect(c.oneLine, `actions on one line (${c.menuLabel})`).toBe(true);
    expect(c.inView, `actions in view without scrolling (${c.menuLabel})`).toBe(true);
    for (const h of c.heights) expect(h, `small button height (${c.menuLabel})`).toBe(36);
    for (const l of c.looks) {
      expect(l.name, 'icon action has an accessible name').not.toBe('');
      expect(l.icon, `icon button: ${l.name}`).toBe(true);
    }
  }
  const rights = new Set(report.cells.map((c) => c.menuRight));
  expect(rights.size, 'menu buttons aligned in one column').toBe(1);
  expect(report.wrapped, 'chip/button label wrapped').toEqual([]);
}

/**
 * APG menu button keyboard model + look of the open menu (AC-UI-54): Enter opens on the first
 * item, arrows move (wrapping), Home/End, Escape closes and returns focus, ArrowDown on the
 * button opens, Tab closes. Danger items are last and coral. Returns with the menu open.
 */
export async function rowMenuChecks(page: Page, row: Locator): Promise<Locator> {
  const button = row.locator('[data-menu-button]');
  const menu = row.getByRole('menu');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(n > 1 ? 1 : 0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await button.focus();
  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await floatChecks(menu);
  // Danger items: last, coral text.
  const colors = await items.evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  const firstDanger = colors.indexOf(C.coralText);
  if (firstDanger >= 0) {
    expect(
      colors.slice(firstDanger).every((c) => c === C.coralText),
      'danger items last',
    ).toBe(true);
  }
  for (let i = 0; i < n; i++) {
    expect((await style(items.nth(i))).height, 'menu item target').toBeGreaterThanOrEqual(44);
  }
  return menu;
}

/**
 * Designer top bar (AC-UI-52): title and toolbar on one row at 1280px; toolbar buttons 36px;
 * undo/redo/copy/paste/delete are icon buttons with an accessible name and a tooltip.
 */
export async function designerToolbarChecks(page: Page): Promise<void> {
  const toolbar = page.getByRole('toolbar', { name: 'Thao tác trên flow' });
  const h1 = page.getByRole('heading', { level: 1 });
  const tb = (await toolbar.boundingBox())!;
  const hb = (await h1.boundingBox())!;
  expect(tb.height, 'toolbar on one row').toBeLessThanOrEqual(40);
  expect(
    Math.abs(hb.y + hb.height / 2 - (tb.y + tb.height / 2)),
    'title and toolbar row',
  ).toBeLessThan(6);
  const buttons = toolbar.getByRole('button');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    expect(Math.round((await style(buttons.nth(i))).height)).toBe(36);
  }
  for (const name of ['Hoàn tác', 'Làm lại', 'Sao chép', 'Dán', 'Xóa']) {
    const b = toolbar.getByRole('button', { name, exact: true });
    await expect(b).toHaveCount(1);
    expect((await b.textContent())?.trim(), `${name}: icon only`).toBe('');
    expect(Math.round((await style(b)).width), `${name}: square`).toBe(36);
    expect(Math.round((await style(b.locator('svg'))).width), `${name}: icon drawn`).toBe(18);
    await b.locator('..').hover();
    await expect(page.locator('[data-tooltip]')).toContainText(name);
  }
  await page.mouse.move(640, 500);
  // Spacing between buttons (target spacing): at least 4px.
  const gaps = await toolbar.evaluate((t) => {
    const bs = Array.from(t.querySelectorAll('button')).map((b) => b.getBoundingClientRect());
    return bs.slice(1).map((b, i) => b.left - bs[i]!.right);
  });
  for (const g of gaps) expect(g).toBeGreaterThanOrEqual(4);
}

/**
 * Node palette (AC-UI-53): all items the same size; name and description one line each, cut
 * with "…"; the description is part of the accessible name and shows in a tooltip.
 */
export async function paletteChecks(page: Page): Promise<void> {
  const items = page.locator('[data-palette-item]');
  const report = await items.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const lines = Array.from(el.querySelectorAll('span.truncate')).map((s) => {
        const cs = getComputedStyle(s);
        return {
          oneLine: s.getBoundingClientRect().height <= parseFloat(cs.lineHeight) + 1,
          ellipsis: cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap',
        };
      });
      return { w: Math.round(r.width), h: Math.round(r.height), lines };
    }),
  );
  expect(report.length).toBeGreaterThan(5);
  expect(new Set(report.map((r) => r.w)).size, 'same width').toBe(1);
  expect(new Set(report.map((r) => r.h)).size, 'same height').toBe(1);
  for (const r of report) {
    expect(r.lines).toHaveLength(2);
    for (const l of r.lines) expect(l).toEqual({ oneLine: true, ellipsis: true });
  }
  const first = items.first();
  const desc = (await first.locator('span.truncate').nth(1).textContent())!.trim();
  await expect(first).toHaveAccessibleName(new RegExp(desc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await first.hover();
  await expect(page.locator('[data-tooltip]')).toContainText(desc);
  await page.mouse.move(640, 500);
}

export { style };

/**
 * Admin table rows (AC-UI-57): every body row has the same height (within 1px), every cell
 * holds ONE line of text (text-node line boxes share one top; screen-reader-only text is
 * ignored), the action column has its 1px #E2E8F0 separator (`::before`) in the header and in
 * every row. Text is never cut (no ellipsis, 2026-11-03 16:06): a wider table scrolls inside its
 * region, and scrolled to the end the pinned action column does not cover the column before it.
 * `noScroll`: the table also fits its region without scrolling.
 */
export async function tableRowChecks(table: Locator, opts: { noScroll?: boolean } = {}) {
  const r = await table.evaluate((t) => {
    const rows = Array.from(t.querySelectorAll('tbody tr'));
    const lines = (cell: Element) => {
      const tops = new Set<number>();
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim()) continue;
        if (n.parentElement?.closest('.sr-only')) continue; // read by screen readers only
        range.selectNodeContents(n);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width <= 1 || rect.height <= 1) continue;
          tops.add(Math.round(rect.top + rect.height / 2));
        }
      }
      // Items on one line can differ a few px in centre (chip vs text): bucket by 8px.
      const sorted = [...tops].sort((a, b) => a - b);
      return sorted.filter((y, i) => i === 0 || y - sorted[i - 1]! > 8).length;
    };
    const sep = (el: Element | null) => {
      if (!el) return 'missing';
      const cs = getComputedStyle(el, '::before');
      return `${cs.width} ${cs.backgroundColor}`;
    };
    const region = t.closest('[role="region"]');
    const cut = Array.from(t.querySelectorAll('th, td, th *, td *'))
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          !el.closest('.sr-only') &&
          (cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden') &&
          el.scrollWidth > el.clientWidth + 1
        );
      })
      .map((el) => (el.textContent ?? '').trim().slice(0, 30));
    // Scrolled fully right, the pinned last column must not cover the one before it.
    const before = region?.scrollLeft ?? 0;
    if (region) region.scrollLeft = region.scrollWidth;
    const coveredAtEnd = rows.flatMap((row, i) => {
      const cells = Array.from(row.children);
      const last = cells.at(-1)!.getBoundingClientRect();
      const prev = cells.at(-2)!.getBoundingClientRect();
      return last.left < prev.right - 1 ? [`row ${i + 1}`] : [];
    });
    if (region) region.scrollLeft = before;
    return {
      cut,
      coveredAtEnd,
      heights: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
      multi: rows.flatMap((row, i) =>
        Array.from(row.children)
          .map((c, j) => ({ j, n: lines(c), text: c.textContent?.trim().slice(0, 30) }))
          .filter((c) => c.n > 1)
          .map((c) => `row ${i + 1} col ${c.j + 1} "${c.text}": ${c.n} lines`),
      ),
      seps: [
        sep(t.querySelector('thead tr')?.lastElementChild ?? null),
        ...rows.map((row) => sep(row.lastElementChild)),
      ],
      covered: rows.flatMap((row, i) => {
        const cells = Array.from(row.children);
        const last = cells.at(-1)!.getBoundingClientRect();
        const prev = cells.at(-2)!.getBoundingClientRect();
        return last.left < prev.right - 1 ? [`row ${i + 1}`] : [];
      }),
      scroll: region ? region.scrollWidth - region.clientWidth : 0,
    };
  });
  expect(r.heights.length, 'rows').toBeGreaterThan(0);
  expect(
    Math.max(...r.heights) - Math.min(...r.heights),
    `row heights ${r.heights.join(', ')}`,
  ).toBeLessThanOrEqual(1);
  expect(r.multi, 'cells on more than one line').toEqual([]);
  expect(r.cut, 'cut cell text').toEqual([]);
  expect(r.coveredAtEnd, 'action column covers a column (scrolled to the end)').toEqual([]);
  for (const s of r.seps) expect(s, 'action column separator').toBe(`1px ${C.line}`);
  if (opts.noScroll) {
    expect(r.scroll, 'table scrolls horizontally').toBeLessThanOrEqual(0);
    expect(r.covered, 'action column covers a column').toEqual([]);
  }
}
