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

/** Full-page PNG `<screen>--<state>--<w>x<h>.png` in test-results/ui-v2 (+ index.html). */
export async function shot(page: Page, screen: string, state: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  const { width, height } = page.viewportSize()!;
  await page.screenshot({
    path: join(SHOTS, `${screen}--${state}--${width}x${height}.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
  writeIndex();
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
 * - at most one primary (teal) button per region (card/dialog/toolbar/form);
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
          el.closest('dialog, [role="dialog"], [role="toolbar"], section, article, form, header') ??
          document.body;
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

/** Page title (AC-UI-10): 48px/500 on desktop, 32px on mobile; eyebrow above it (AC-UI-06). */
export async function titleChecks(page: Page, opts: { eyebrow?: boolean } = {}): Promise<void> {
  const h1 = await style(page.getByRole('heading', { level: 1 }).first());
  expect(h1.fontSize).toBe(isMobile(page) ? '32px' : '48px');
  expect(h1.fontWeight).toBe('500');
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

/** Text-like controls (AC-UI-04): 48px, 6px radius, 1px #475569 border. */
export async function inputChecks(controls: Locator): Promise<void> {
  const n = await controls.count();
  expect(n, 'controls').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const c = controls.nth(i);
    if (!(await c.isVisible())) continue;
    const s = await style(c);
    const label = (await c.getAttribute('aria-label')) ?? (await c.getAttribute('id')) ?? `${i}`;
    expect(Math.round(s.height), `height ${label}`).toBe(48);
    expect(s.radius, `radius ${label}`).toBe('6px');
    const invalid = (await c.getAttribute('aria-invalid')) === 'true';
    expect(s.borderLeft, `border ${label}`).toBe(
      `1px solid ${invalid ? C.coralText : C.lineInput}`,
    );
    expect(s.fontSize, `font ${label}`).toBe(isMobile(page(c)) ? '16px' : '18px');
  }
}

function page(loc: Locator): Page {
  return loc.page();
}

/** Standard buttons (AC-UI-05/10): 48px, radius 12px, `button` type 18px/600 (16px mobile). */
export async function buttonChecks(buttons: Locator): Promise<void> {
  const n = await buttons.count();
  expect(n, 'buttons').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    if (!(await b.isVisible())) continue;
    const s = await style(b);
    const label = (await b.textContent())?.trim().slice(0, 30);
    expect(Math.round(s.height), `height ${label}`).toBeGreaterThanOrEqual(48);
    expect(s.radius, `radius ${label}`).toBe('12px');
    expect(s.fontWeight, `weight ${label}`).toBe('600');
    expect(s.fontSize, `size ${label}`).toBe(isMobile(page(b)) ? '16px' : '18px');
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

export { style };
