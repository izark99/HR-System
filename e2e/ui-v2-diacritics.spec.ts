/**
 * Design v2 (spec §25.1): page titles are `page-title` 28/36, `page-title-showcase` 32/40 (24/32
 * mobile). Vietnamese capitals carry stacked marks (Ổ, Ẫ, Ấ) and dots below (Ợ, Ỵ),
 * so a two-line title is the risky case: the marks must not be clipped (no hidden overflow on the
 * title or an ancestor) and the ink of one line must not run into the ink of the line above.
 *
 * Measured, not pixel-compared: each wrapped line's text is measured with canvas `measureText`
 * in the computed font (actual ink ascent/descent), placed on the CSS line box (baseline from the
 * font ascent/descent and the half-leading); the numbers go into the test annotations. A
 * screenshot of each title is kept in test-results/ui-v2/ for manual review. Fake data only.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN, expect, test, type Locator, type Page } from './fixtures';
import { runToResult, uploadFixtures } from './helpers';
import { DESKTOP, freezeClock, MOBILE, settle, SHOTS, shot } from './ui-v2-checks';

/** Fake flow name: longer than one line on 1280px, mixing stacked marks and dots below. */
const LONG_NAME =
  'Ổn định Ấn định Ẫn Ỗ: Đối chiếu bảng lương – chấm công Ủy quyền Ước tính Ỷ Ợ quý gợi ý Ặ';

interface Row {
  /** `eyebrow` or `h1 line N`. */
  name: string;
  text: string;
  /** Ink band (canvas `measureText`), relative to the title top. */
  inkTop: number;
  inkBottom: number;
}

interface Pair {
  rows: string;
  /** Overlap of the two ink bands (positive = the bands overlap vertically, any column). */
  bandOverlap: number;
  /**
   * Smallest vertical distance between the ink of the upper row and the ink of the lower row in
   * the same pixel column (+-1px); negative = the glyphs cross. null = no shared column.
   */
  minColumnGap: number | null;
  /** Pixels painted by both rows (alpha > 96 in both). */
  sharedPixels: number;
}

interface Measure {
  fontSize: number;
  lineHeight: number;
  height: number;
  rows: Row[];
  pairs: Pair[];
  /** Ancestors (or the title) whose non-visible overflow cuts the ink. */
  clipped: string[];
}

/**
 * Renders every text row (the eyebrow above the title, then each wrapped line of the title) on
 * its own canvas layer at its real position, in the computed font, and compares adjacent rows
 * column by column.
 */
async function measure(el: Locator): Promise<Measure> {
  await settle(el.page());
  return el.evaluate((h) => {
    const box = h.getBoundingClientRect();
    const PAD = 40;
    const W = Math.ceil(box.width) + 2 * PAD;
    const H = Math.ceil(box.height) + 4 * PAD;
    type Layer = {
      name: string;
      text: string;
      inkTop: number;
      inkBottom: number;
      a: Uint8ClampedArray;
    };

    function layers(source: Element, label: string): Layer[] {
      const cs = getComputedStyle(source);
      const lh = parseFloat(cs.lineHeight);
      const upper = cs.textTransform === 'uppercase';
      const groups: { top: number; left: number; text: string }[] = [];
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const s = n.textContent ?? '';
        for (let i = 0; i < s.length; i++) {
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          const r = range.getClientRects()[0];
          if (!r) continue;
          const top = r.top;
          const g = groups.find((x) => Math.abs(x.top - top) < lh / 2);
          if (g) g.text += s[i];
          else groups.push({ top, left: r.left, text: s[i]! });
        }
      }
      const srcBox = source.getBoundingClientRect();
      return groups
        .sort((a, b) => a.top - b.top)
        .map((g, idx) => {
          const canvas = new OffscreenCanvas(W, H);
          const ctx = canvas.getContext('2d')!;
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
          const text = upper ? g.text.toLocaleUpperCase('vi') : g.text;
          const m = ctx.measureText(text);
          // CSS line box: top of the line = group top snapped to the source's line grid.
          // Line boxes start at the content box (the one-line title has padding that keeps
          // the marks inside its clipping box).
          const contentTop = srcBox.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
          const lineTop =
            contentTop + Math.round((g.top - contentTop) / lh) * lh - box.top + 2 * PAD;
          const content = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
          const baseline = lineTop + (lh - content) / 2 + m.fontBoundingBoxAscent;
          ctx.fillStyle = '#000';
          ctx.fillText(text, g.left - box.left + PAD, baseline);
          const data = ctx.getImageData(0, 0, W, H).data;
          const a = new Uint8ClampedArray(W * H);
          for (let i = 0; i < W * H; i++) a[i] = data[i * 4 + 3]!;
          return {
            name: groups.length > 1 ? `${label} line ${idx + 1}` : label,
            text: text.trim(),
            inkTop: baseline - m.actualBoundingBoxAscent - 2 * PAD,
            inkBottom: baseline + m.actualBoundingBoxDescent - 2 * PAD,
            a,
          };
        });
    }

    // The one-line title sits in a tooltip wrapper: the eyebrow is a sibling of that wrapper.
    const eyebrow =
      h.parentElement?.querySelector('[data-eyebrow]') ??
      h.parentElement?.parentElement?.querySelector(':scope > [data-eyebrow]');
    const all = [...(eyebrow ? layers(eyebrow, 'eyebrow') : []), ...layers(h, 'h1')];
    const INK = 96;
    const pairs = all.slice(1).map((lower, i) => {
      const upperRow = all[i]!;
      let minColumnGap: number | null = null;
      let sharedPixels = 0;
      for (let x = 0; x < W; x++) {
        let bottom = -1;
        for (let y = H - 1; y >= 0; y--) {
          if (upperRow.a[y * W + x]! > INK) {
            bottom = y;
            break;
          }
        }
        if (bottom < 0) continue;
        let top = -1;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          for (let y = 0; y < H; y++) {
            if (lower.a[y * W + xx]! > INK) {
              if (top < 0 || y < top) top = y;
              break;
            }
          }
        }
        if (top >= 0) {
          const gap = top - bottom - 1;
          if (minColumnGap === null || gap < minColumnGap) minColumnGap = gap;
        }
        for (let y = 0; y < H; y++) {
          if (upperRow.a[y * W + x]! > INK && lower.a[y * W + x]! > INK) sharedPixels++;
        }
      }
      return {
        rows: `${upperRow.name} / ${lower.name}`,
        bandOverlap: upperRow.inkBottom - lower.inkTop,
        minColumnGap,
        sharedPixels,
      };
    });

    // The title's own box only has to hold the title's ink; ancestors hold the eyebrow too.
    const own = all.filter((r) => r.name.startsWith('h1'));
    const band = (rows: typeof all) => ({
      top: Math.min(...rows.map((r) => r.inkTop)) + box.top,
      bottom: Math.max(...rows.map((r) => r.inkBottom)) + box.top,
    });
    const clipped: string[] = [];
    for (let a: Element | null = h; a && a !== document.documentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
      const ink = band(a === h ? own : all);
      const r = a.getBoundingClientRect();
      if (r.top > ink.top || r.bottom < ink.bottom) {
        clipped.push(`${a.tagName.toLowerCase()}.${a.className} overflow ${acs.overflow}`);
      }
    }
    const cs = getComputedStyle(h);
    return {
      fontSize: parseFloat(cs.fontSize),
      lineHeight: parseFloat(cs.lineHeight),
      height: box.height,
      rows: all.map(({ name, text, inkTop: t, inkBottom: b }) => ({
        name,
        text,
        inkTop: t,
        inkBottom: b,
      })),
      pairs,
      clipped,
    };
  });
}

function report(m: Measure): string {
  const f = (n: number) => n.toFixed(1);
  return [
    `h1 ${m.fontSize}px / lh ${m.lineHeight}px, box height ${f(m.height)}px`,
    ...m.rows.map((r) => `${r.name} "${r.text}": ink ${f(r.inkTop)}..${f(r.inkBottom)}`),
    ...m.pairs.map(
      (p) =>
        `${p.rows}: ink bands overlap ${f(p.bandOverlap)}px, min same-column gap ${p.minColumnGap ?? 'n/a'}px, shared pixels ${p.sharedPixels}`,
    ),
    `clipped by: ${m.clipped.length ? m.clipped.join(', ') : 'none'}`,
  ].join('\n');
}

/** Screenshot of the title with room above and below, so cut or colliding marks are visible. */
async function crop(page: Page, name: string): Promise<void> {
  const b = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
  const { width, height } = page.viewportSize()!;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({
    path: join(SHOTS, `13-diacritics--${name}-crop--${width}x${height}.png`),
    clip: { x: 0, y: Math.max(0, b.y - 60), width, height: b.height + 100 },
    animations: 'disabled',
    caret: 'hide',
  });
}

/** `lines`: exact number of title lines, or a minimum (`{ min }`) for wrapping titles. */
async function checkTitle(
  page: Page,
  name: string,
  lines: number | { min: number },
): Promise<void> {
  const m = await measure(page.getByRole('heading', { level: 1 }));
  test.info().annotations.push({ type: `diacritics ${name}`, description: report(m) });
  console.log(`[ui-v2 diacritics] ${name}\n${report(m)}`);
  const count = m.rows.filter((r) => r.name.startsWith('h1')).length;
  if (typeof lines === 'number') expect(count).toBe(lines);
  else expect(count).toBeGreaterThanOrEqual(lines.min);
  // §25.1 (MEMORY 2026-11-04 14:12): page-title 28/36, page-title-showcase 32/40, mobile 24/32.
  const LINE: Record<number, number> = { 24: 32, 28: 36, 32: 40 };
  expect(LINE[m.fontSize], `title size ${m.fontSize}px is a §25.1 page title`).toBeDefined();
  expect(m.lineHeight, 'title line height (28/36, 32/40, 24/32)').toBe(LINE[m.fontSize]);
  expect(m.clipped, 'marks clipped by overflow').toEqual([]);
  for (const p of m.pairs) {
    expect(p.sharedPixels, `${p.rows}: glyphs overlap`).toBe(0);
    expect(p.minColumnGap ?? 0, `${p.rows}: glyphs cross`).toBeGreaterThanOrEqual(0);
  }
}

/**
 * The h1 is cut with an ellipsis (one line), keeps the full name for assistive tech, and shows
 * the full name in a tooltip on hover and on keyboard focus.
 */
async function checkCut(page: Page, full: string): Promise<void> {
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveAccessibleName(full);
  const s = await h1.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      cut: el.scrollWidth > el.clientWidth,
      ellipsis: cs.textOverflow,
      wrap: cs.whiteSpace,
      tabIndex: (el as HTMLElement).tabIndex,
    };
  });
  expect(s).toEqual({ cut: true, ellipsis: 'ellipsis', wrap: 'nowrap', tabIndex: 0 });
  const tip = page.locator('[data-tooltip]');
  await h1.hover();
  await expect(tip).toHaveText(full);
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);
  await h1.focus();
  // Playwright focus() does not set :focus-visible; a Tab from the previous element does.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(h1).toBeFocused();
  await expect(tip).toHaveText(full);
  await expect(tip).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
}

// Dates on screen must not depend on the run day (pixel comparison, spec §30.3).
test.beforeEach(({ page }) => freezeClock(page));

for (const viewport of [DESKTOP, MOBILE]) {
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(`titles with Vietnamese marks ${size}`, () => {
    test.use({ viewport });

    test('run page: acceptance flow name as h1', async ({ page }) => {
      await page.goto('/run/payroll-timesheet');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Đối chiếu bảng lương – chấm công',
      );
      await crop(page, 'run-title');
      // A user-given name stays on one line (AC-UI-50), cut with "…" when it does not fit.
      await checkTitle(page, `run ${size}`, 1);
      if (viewport === MOBILE) await checkCut(page, 'Đối chiếu bảng lương – chấm công');
    });

    test('run page: long Vietnamese flow name is one line, cut with "…", full name on hover/focus (AC-UI-50)', async ({
      page,
      supabase,
    }) => {
      supabase.flows[0]!.name = LONG_NAME;
      await page.goto('/run/payroll-timesheet');
      await expect(page.getByRole('heading', { level: 1, name: LONG_NAME })).toBeVisible();
      await shot(page, '13-diacritics', 'run-long-title');
      await crop(page, 'run-long-title');
      await checkTitle(page, `run long name ${size}`, 1);
      await checkCut(page, LONG_NAME);
    });

    test('result page: conclusion title', async ({ page }) => {
      test.setTimeout(120_000);
      await uploadFixtures(page);
      await runToResult(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Kỳ 09/2026 có 15 nhân viên cần xử lý',
      );
      await shot(page, '13-diacritics', 'result-title');
      await crop(page, 'result-title');
      // Not a user-given name: the conclusion sentence may wrap.
      await checkTitle(page, `result ${size}`, viewport === MOBILE ? { min: 2 } : 1);
    });
  });
}

test.describe('admin title with a user-given name 1280x800', () => {
  test.use({ viewport: DESKTOP, signedInAs: ADMIN });

  test('versions page: long flow name in the title is one line, cut (AC-UI-50)', async ({
    page,
    supabase,
  }) => {
    supabase.flows[0]!.name = LONG_NAME;
    await page.goto('/admin/flows/payroll-timesheet/versions');
    const title = `${LONG_NAME}: đang áp dụng v3`;
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await crop(page, 'versions-long-title');
    await checkTitle(page, 'versions long name 1280x800', 1);
    await checkCut(page, title);
  });

  test('designer: long flow name in the top bar is one line, cut, toolbar stays on the row', async ({
    page,
    supabase,
  }) => {
    // Read-only view: the toolbar holds two icon buttons only, so the name needs to be longer
    // than the other titles to be cut at 1280px.
    const name2 = `${LONG_NAME} – bản tổng hợp toàn quốc`;
    supabase.flows[0]!.name = name2;
    await page.goto('/admin/flows/payroll-timesheet/designer');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toContainText(name2);
    const name = h1.locator('[data-one-line]');
    await expect(name).toHaveAttribute('data-cut', 'true');
    const toolbar = page.getByRole('toolbar', { name: 'Thao tác trên flow' });
    const [hb, tb] = [await h1.boundingBox(), await toolbar.boundingBox()];
    expect(Math.abs(hb!.y + hb!.height / 2 - (tb!.y + tb!.height / 2))).toBeLessThan(6);
    await name.hover();
    await expect(page.locator('[data-tooltip]')).toHaveText(name2);
  });
});
