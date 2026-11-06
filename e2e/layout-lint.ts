/**
 * Automated layout geometry checks (spec §29.3 AC-UI-78). Measures the rendered page with
 * `getBoundingClientRect` / `getComputedStyle` and reports, per state:
 *  (1) controls (input, Select, picker, button) of one row with different heights or tops/bottoms
 *      more than 1px apart;
 *  (2) elements spilling out of the card / panel / dialog / scroll area holding them, and
 *      horizontal scrolling that is not an intended scroll region (also the page itself);
 *  (3) in-flow sibling elements overlapping;
 *  (4) uneven gaps (> 1px) between the items of one row, or gaps off the §25.5 scale;
 *  (5) tabs of one tablist with different heights;
 *  (6) a long label or hint wrapping and pushing the controls of a row out of line;
 *  (7) text clipped without "…" and a tooltip;
 *  (8) in one panel / card / dialog, an interactive control (input, Select, picker, standard
 *      button) not 44px high; only a small button marked as such (`data-size="sm"` from
 *      `<Button size="sm">`, or the `*-control-sm` height token) may be 36px;
 *  (9) tabs of a dense tablist (`Tabs dense`) not sharing its width equally (one size, filling
 *      the row) or with their text off centre;
 *  (10) checkboxes / radios of one panel / card / dialog of different sizes (> 0.5px);
 *  (11) uneven vertical gaps (> 1px) between adjacent field blocks of one form column, or a gap
 *      off the token (`stack` 16px; Designer dense forms `stack-dense` 12px). Measured from the
 *      bottom of what a block shows (text lines and controls, hint / error included; empty padding
 *      of its box does not count) to the top of the next; only field blocks
 *      (`FormField`, `FieldGrid`, checkbox, `[data-field-block]`) count, so group headings, nested
 *      cards and an add button at the end of a list are left out;
 *  (12) a field label (`FormField` label, `[data-field-label]`) taller than one line;
 *  (13) two nested scroll areas scrolling the same way: an element that scrolls (overflow auto /
 *      scroll and content larger than its box) inside another one that scrolls on the same axis;
 *      on the full-bleed Designer the page itself scrolling counts as the outer one. Floating
 *      layers (fixed / absolute popovers, dialogs, listboxes) start a new stack;
 *  (14) a hint / explanation shown as text in a form, card, panel or dialog: an element marked
 *      `data-hint` (only allowed as screen-reader text or inside an open (i) popover), or a
 *      paragraph that looks like one (muted colour, ≤ 14px, not a status / live region, not marked
 *      `data-note` as status / metadata text).
 * Only rows of one flex/grid parent are compared; hidden / zero-size elements are skipped.
 * Exceptions live in `LAYOUT_ALLOW` only, each with its reason.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from './fixtures';

export type LayoutRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface LayoutViolation {
  rule: LayoutRule;
  /** Short, readable name of the element (tag, accessible name / text, landmark). */
  target: string;
  /** What was measured. */
  detail: string;
}

export interface LayoutAllow {
  /** CSS selector; an element matching it (or inside it, see `subtree`) is exempt. */
  selector: string;
  /** Rules the exception covers. */
  rules: LayoutRule[];
  /** Also exempt everything inside the matched element. */
  subtree?: boolean;
  reason: string;
}

/**
 * The single list of exceptions. Keep it short: each entry needs a reason a reviewer accepts.
 */
export const LAYOUT_ALLOW: LayoutAllow[] = [
  {
    selector: '.react-flow',
    rules: [1, 2, 3, 4, 6, 7],
    subtree: true,
    reason:
      'React Flow canvas: nodes, edges, handles and controls are positioned by the library on a pannable plane (spills / overlaps are the canvas itself); node cards are checked by ui-v2 style checks',
  },
  {
    selector: '.monaco-editor, [data-testid^="formula-editor"], [data-testid="sql-editor"]',
    rules: [1, 2, 3, 4, 6, 7],
    subtree: true,
    reason: 'Monaco editor internals (library DOM: virtual lines, overlays, minimap)',
  },
  {
    selector: '[role="region"]:has(> table), [role="region"]:has(> div > table)',
    rules: [2],
    reason:
      'Admin / result table regions scroll sideways on purpose (MEMORY 2026-11-03 16:06: wider table scrolls inside its card, Thao tác column sticky)',
  },
  {
    selector: '[data-one-line]',
    rules: [2, 3],
    reason:
      'OneLine uses -my-5 py-5 so stacked Vietnamese marks are not clipped (cancels out, no layout change)',
  },
  {
    selector: '[data-palette-item]',
    rules: [8],
    reason:
      'Designer palette items are two-line list entries (name + description, MEMORY 2026-11-03 10:49: all items one size), not form controls',
  },
  {
    selector: '[data-infotip-button]',
    rules: [2],
    reason:
      'InfoTip (i): a transparent 44px touch target over a one-line label (-my-3, like the enlarged checkbox area); only the 20px icon is painted, nothing shows outside the line',
  },
  {
    selector: '.sr-only',
    rules: [1, 2, 3, 4, 6, 7],
    subtree: true,
    reason: 'screen-reader only text (1px clip box)',
  },
];

interface RawViolation {
  rule: LayoutRule;
  target: string;
  detail: string;
  /** `data-ll` ids of the elements involved (for the allowlist check). */
  ids: number[];
  /** Rule 7 candidates needing a hover to see whether a tooltip appears. */
  hover?: boolean;
}

/** In-page measurement. Kept self-contained: it is serialised into `page.evaluate`. */
function measure(
  allow: { selector: string; rules: number[]; subtree?: boolean }[],
): RawViolation[] {
  const SCALE = [0, 4, 8, 12, 16, 24, 32, 48, 64];
  const TOL = 1;
  const out: RawViolation[] = [];
  let nextId = 1;
  const idOf = (el: Element): number => {
    const v = el.getAttribute('data-ll');
    if (v) return Number(v);
    const id = nextId++;
    el.setAttribute('data-ll', String(id));
    return id;
  };
  document.querySelectorAll('[data-ll]').forEach((e) => e.removeAttribute('data-ll'));

  const allowed = (el: Element, rule: number): boolean =>
    allow.some(
      (a) =>
        a.rules.includes(rule) &&
        (el.matches(a.selector) || (a.subtree === true && el.closest(a.selector) !== null)),
    );

  const visible = (el: Element): boolean => {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const inFlow = (el: Element): boolean => {
    const p = getComputedStyle(el).position;
    return p !== 'absolute' && p !== 'fixed' && p !== 'sticky';
  };
  /** Element children, flattening `display: contents`. */
  const kids = (el: Element): Element[] =>
    el instanceof SVGElement
      ? []
      : Array.from(el.children)
          .filter((c) => c instanceof HTMLElement || c.tagName.toLowerCase() === 'svg')
          .flatMap((c) => (getComputedStyle(c).display === 'contents' ? kids(c) : [c]));

  const name = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const label =
      el.getAttribute('aria-label') ??
      (el.getAttribute('aria-labelledby')
        ? (document.getElementById(el.getAttribute('aria-labelledby')!.split(' ')[0]!)
            ?.textContent ?? '')
        : '') ??
      '';
    const forLabel =
      el.id && (el instanceof HTMLInputElement || el.getAttribute('role') === 'combobox')
        ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? '')
        : '';
    const text = (label || forLabel || el.textContent || '').replace(/\s+/g, ' ').trim();
    const where = el.closest('aside[aria-label], [role="dialog"], dialog, main, header, nav');
    const place = where
      ? ` in ${where.tagName.toLowerCase()}${where.getAttribute('aria-label') ? ` "${where.getAttribute('aria-label')}"` : ''}`
      : '';
    return `${tag}${role ? `[role=${role}]` : ''}${text ? ` "${text.slice(0, 48)}"` : ''}${place}`;
  };
  const px = (n: number) => `${Math.round(n * 10) / 10}px`;

  const CONTROL =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]):not([type="range"]), select, button, [role="combobox"]';
  // The (i) button of an InfoTip is not a form control: a 44px target over a one-line label
  // (checked by the a11y touch-target test), not part of the row of controls.
  const isControl = (el: Element) =>
    el.matches(CONTROL) &&
    !el.matches(
      '[role="tab"], [role="option"], [role="menuitem"], [role="menuitemradio"], [data-infotip-button]',
    );
  /** The one control a row item stands for: itself, or the single control of a form field. */
  const controlOf = (item: Element): Element | null => {
    if (isControl(item)) return item;
    const isField = item.matches('[data-form-field]') || item.querySelector('label') !== null;
    if (!isField) return null;
    const cs = Array.from(item.querySelectorAll(CONTROL)).filter(
      (c) => isControl(c) && visible(c) && !c.parentElement?.closest(CONTROL),
    );
    return cs.length === 1 ? cs[0]! : null;
  };

  const all = Array.from(document.body.querySelectorAll('*')).filter(
    (el) => !el.closest('[data-tooltip], script, style, svg *') && visible(el),
  );

  // ---- rows (rules 1, 4, 6) ---------------------------------------------------------------
  for (const parent of all) {
    if (parent instanceof SVGElement) continue;
    const cs = getComputedStyle(parent);
    const flexRow = /flex/.test(cs.display) && cs.flexDirection.startsWith('row');
    const grid = /grid/.test(cs.display);
    if (!flexRow && !grid) continue;
    const items = kids(parent).filter((c) => visible(c) && inFlow(c));
    if (items.length < 2) continue;
    // Lines: items whose vertical ranges overlap by at least half the smaller height.
    const lines: { el: Element; r: DOMRect }[][] = [];
    for (const el of items) {
      const r = el.getBoundingClientRect();
      const line = lines.find((l) =>
        l.some(({ r: o }) => {
          const ov = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
          return ov >= Math.min(r.height, o.height) / 2;
        }),
      );
      if (line) line.push({ el, r });
      else lines.push([{ el, r }]);
    }
    for (const line of lines) {
      if (line.length < 2) continue;
      // Rules 1 / 6: controls of the line.
      const ctl = line
        .map(({ el, r }) => ({ item: el, ir: r, c: controlOf(el) }))
        .filter((x): x is { item: Element; ir: DOMRect; c: Element } => x.c !== null)
        .filter(({ c }) => !allowed(c, 1));
      if (ctl.length >= 2) {
        const rs = ctl.map(({ c }) => c.getBoundingClientRect());
        const hs = rs.map((r) => r.height);
        const tops = rs.map((r) => r.top);
        const bottoms = rs.map((r) => r.bottom);
        const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
        const desc = ctl
          .map(({ c }, i) => `${name(c)} h=${px(hs[i]!)} top=${px(tops[i]!)}`)
          .join(' | ');
        if (spread(hs) > TOL) {
          out.push({
            rule: 1,
            target: name(parent),
            detail: `control heights differ by ${px(spread(hs))}: ${desc}`,
            ids: ctl.map(({ c }) => idOf(c)),
          });
        } else if (spread(tops) > TOL || spread(bottoms) > TOL) {
          // Same heights, not in line: a wrapping label / hint above or a different hint below
          // (rule 6) when the row items themselves start together, else plain misalignment.
          const itemTops = ctl.map(({ ir }) => ir.top);
          const wrapped = spread(itemTops) <= TOL;
          out.push({
            rule: wrapped ? 6 : 1,
            target: name(parent),
            detail: `control tops differ by ${px(spread(tops))}${wrapped ? ' (label/hint wraps, items start together)' : ''}: ${desc}`,
            ids: ctl.map(({ c }) => idOf(c)),
          });
        }
      }
      // Rule 4: gaps between consecutive items of the line.
      const sorted = [...line].sort((a, b) => a.r.left - b.r.left);
      const gaps: { g: number; a: Element; b: Element }[] = [];
      const colGap = parseFloat(cs.columnGap) || 0;
      // Free space handed out by justify-content: space-* is layout, not an item gap.
      const spaced = /space/.test(cs.justifyContent);
      for (let i = 1; i < sorted.length && !spaced; i++) {
        const a = sorted[i - 1]!;
        const b = sorted[i]!;
        const g = b.r.left - a.r.right;
        // Only the distance the CSS puts between the two items (gap + margins); a larger one
        // comes from free space (auto margin, grid track wider than its item, centring).
        const structural =
          colGap +
          (parseFloat(getComputedStyle(a.el).marginRight) || 0) +
          (parseFloat(getComputedStyle(b.el).marginLeft) || 0);
        if (g >= -TOL && Math.abs(g - structural) <= TOL && g <= 64 + TOL)
          gaps.push({ g, a: a.el, b: b.el });
      }
      const counted = gaps.filter(({ a, b }) => !allowed(a, 4) && !allowed(b, 4));
      const off = counted.filter(({ g }) => !SCALE.some((s) => Math.abs(g - s) <= TOL));
      if (off.length > 0)
        out.push({
          rule: 4,
          target: name(parent),
          detail: `gap off the 4·8·12·16·24·32·48·64 scale: ${off.map(({ g, a, b }) => `${px(g)} between ${name(a)} and ${name(b)}`).join('; ')}`,
          ids: [idOf(parent)],
        });
      if (counted.length >= 2) {
        const gs = counted.map(({ g }) => g);
        if (Math.max(...gs) - Math.min(...gs) > TOL)
          out.push({
            rule: 4,
            target: name(parent),
            detail: `uneven gaps ${gs.map(px).join(' / ')} between ${sorted.map(({ el }) => name(el)).join(', ')}`,
            ids: [idOf(parent)],
          });
      }
    }
  }

  // ---- containment (rule 2) ---------------------------------------------------------------
  const isScroller = (el: Element) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY);
  };
  const bordered = (el: Element) => {
    const cs = getComputedStyle(el);
    return (
      parseFloat(cs.borderLeftWidth) >= 1 &&
      parseFloat(cs.borderRightWidth) >= 1 &&
      cs.borderLeftStyle !== 'none' &&
      !el.matches(CONTROL)
    );
  };
  const isBox = (el: Element) =>
    el.matches('[data-card], dialog, aside, [role="dialog"], [data-connect-menu], fieldset') ||
    bordered(el) ||
    isScroller(el) ||
    /(hidden|clip)/.test(getComputedStyle(el).overflowX);
  for (const el of all) {
    if (allowed(el, 2)) continue;
    if (
      !inFlow(el) &&
      !el.matches(
        'dialog, [role="dialog"], [role="listbox"], [data-connect-menu], [data-infotip-pop]',
      )
    )
      continue;
    // The box holding it: nearest ancestor card / panel / dialog / scroll or clip area.
    let box: Element | null = el.parentElement;
    while (box && box !== document.body && !isBox(box)) box = box.parentElement;
    const r = el.getBoundingClientRect();
    if (!box || box === document.body) {
      // Against the viewport (no page-level horizontal spill).
      const vw = document.documentElement.clientWidth;
      if (r.right > vw + TOL || r.left < -TOL)
        out.push({
          rule: 2,
          target: name(el),
          detail: `outside the viewport: left=${px(r.left)} right=${px(r.right)} viewport=${px(vw)}`,
          ids: [idOf(el)],
        });
      continue;
    }
    // Open popovers / dialogs are checked against the viewport only.
    if (!inFlow(el)) continue;
    const b = box.getBoundingClientRect();
    const inner = {
      left: b.left + box.clientLeft,
      right: b.left + box.clientLeft + box.clientWidth,
      top: b.top + box.clientTop,
      bottom: b.top + box.clientTop + box.clientHeight,
    };
    const scroller = isScroller(box);
    const overX = Math.max(inner.left - r.left, r.right - inner.right);
    const overY = Math.max(inner.top - r.top, r.bottom - inner.bottom);
    // Inside a scroll area the content may extend (that is what scrolling is for).
    if (!scroller && overX > TOL)
      out.push({
        rule: 2,
        target: name(el),
        detail: `spills ${px(overX)} sideways out of ${name(box)}`,
        ids: [idOf(el)],
      });
    else if (!scroller && overY > TOL && !/(hidden|clip)/.test(getComputedStyle(box).overflowY))
      out.push({
        rule: 2,
        target: name(el),
        detail: `spills ${px(overY)} vertically out of ${name(box)}`,
        ids: [idOf(el)],
      });
  }
  // Out of the parent's box sideways (e.g. a Select wider than its grid column), and content
  // wider than its own box (e.g. a label wider than its button).
  for (const el of all) {
    if (allowed(el, 2) || !inFlow(el) || el instanceof SVGElement) continue;
    // A `display: contents` wrapper has no box of its own: compare with the box around it.
    let parent = el.parentElement;
    while (parent && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
    if (parent && parent !== document.body && !isScroller(parent) && !allowed(parent, 2)) {
      const r = el.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      const over = Math.max(p.left - r.left, r.right - p.right);
      if (over > TOL && getComputedStyle(parent).display !== 'inline')
        out.push({
          rule: 2,
          target: name(el),
          detail: `spills ${px(over)} sideways out of its parent ${name(parent)} (${px(r.left)}–${px(r.right)} vs ${px(p.left)}–${px(p.right)})`,
          ids: [idOf(el)],
        });
    }
    const cs = getComputedStyle(el);
    if (
      cs.overflowX === 'visible' &&
      cs.display !== 'inline' &&
      el.clientWidth > 0 &&
      el.scrollWidth > el.clientWidth + TOL &&
      !el.matches('table, tr, td, th, thead, tbody') &&
      // Text of its own wider than the box (children spilling are reported above).
      Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '',
      ) &&
      Array.from(el.children).every((c) => {
        const r = c.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        return r.left >= b.left - TOL && r.right <= b.right + TOL;
      })
    )
      out.push({
        rule: 2,
        target: name(el),
        detail: `content ${px(el.scrollWidth)} wider than its box ${px(el.clientWidth)}`,
        ids: [idOf(el)],
      });
  }
  // Unintended horizontal scrolling (scroll areas and the page).
  for (const el of all) {
    if (!isScroller(el) || allowed(el, 2)) continue;
    if (!/(auto|scroll)/.test(getComputedStyle(el).overflowX)) continue;
    const extra = el.scrollWidth - el.clientWidth;
    if (extra > TOL)
      out.push({
        rule: 2,
        target: name(el),
        detail: `scrolls sideways by ${px(extra)} (not a declared scroll region)`,
        ids: [idOf(el)],
      });
  }
  const pageExtra = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (pageExtra > TOL)
    out.push({
      rule: 2,
      target: 'page',
      detail: `page scrolls sideways by ${px(pageExtra)}`,
      ids: [],
    });

  // ---- overlap (rule 3) ---------------------------------------------------------------------
  for (const parent of all) {
    const items = kids(parent).filter((c) => visible(c) && inFlow(c) && !allowed(c, 3));
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!.getBoundingClientRect();
        const b = items[j]!.getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > TOL && h > TOL)
          out.push({
            rule: 3,
            target: `${name(items[i]!)} / ${name(items[j]!)}`,
            detail: `siblings overlap ${px(w)} x ${px(h)}`,
            ids: [idOf(items[i]!), idOf(items[j]!)],
          });
      }
  }

  // ---- tabs (rule 5) --------------------------------------------------------------------------
  for (const list of Array.from(document.querySelectorAll('[role="tablist"]'))) {
    if (!visible(list) || allowed(list, 5)) continue;
    const tabs = Array.from(list.querySelectorAll('[role="tab"]')).filter(visible);
    if (tabs.length < 2) continue;
    const rs = tabs.map((t) => t.getBoundingClientRect());
    const hs = rs.map((r) => r.height);
    const tops = rs.map((r) => r.top);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    // Wrapped tabs (narrow screens) may sit on several lines; on one line they must line up.
    const lineTops = tops.filter((t) => Math.abs(t - (tops[0] ?? 0)) < (hs[0] ?? 0) / 2);
    if (spread(hs) > TOL || spread(lineTops) > TOL)
      out.push({
        rule: 5,
        target: name(list),
        detail: `tab heights/tops differ: ${tabs.map((t, i) => `${name(t)} h=${px(hs[i]!)} top=${px(tops[i]!)}`).join(' | ')}`,
        ids: tabs.map(idOf),
      });
  }

  // ---- one control height per panel / card / dialog (rule 8) ----------------------------------
  const CONTROL_H = 44;
  const SMALL_H = 36;
  const PANEL = '[data-card], dialog, [role="dialog"], aside';
  const markedSmall = (el: Element) =>
    el.getAttribute('data-size') === 'sm' ||
    /(^|\s)(min-h|h|size)-control-sm(\s|$)/.test(el.getAttribute('class') ?? '');
  const perPanel = new Map<Element, { c: Element; h: number; want: number }[]>();
  for (const el of all) {
    if (!isControl(el) || allowed(el, 8) || el.parentElement?.closest(CONTROL)) continue;
    const panel = el.closest(PANEL);
    if (!panel) continue;
    const h = el.getBoundingClientRect().height;
    const want = markedSmall(el) ? SMALL_H : CONTROL_H;
    if (Math.abs(h - want) <= TOL) continue;
    const list = perPanel.get(panel) ?? [];
    list.push({ c: el, h, want });
    perPanel.set(panel, list);
  }
  for (const [panel, list] of perPanel)
    out.push({
      rule: 8,
      target: name(panel),
      detail: `controls not at the panel height (44px, marked small 36px): ${list.map(({ c, h, want }) => `${name(c)} h=${px(h)} want ${want}px`).join(' | ')}`,
      ids: list.map(({ c }) => idOf(c)),
    });

  // ---- dense tabs share the width (rule 9) -------------------------------------------------------
  for (const list of Array.from(document.querySelectorAll('[role="tablist"][data-tabs="dense"]'))) {
    if (!visible(list) || allowed(list, 9)) continue;
    const tabs = Array.from(list.querySelectorAll('[role="tab"]')).filter(visible);
    if (tabs.length < 2) continue;
    const rs = tabs.map((t) => t.getBoundingClientRect());
    const ws = rs.map((r) => r.width);
    const lr = list.getBoundingClientRect();
    const lcs = getComputedStyle(list);
    const inner = {
      left: lr.left + list.clientLeft + (parseFloat(lcs.paddingLeft) || 0),
      right: lr.left + list.clientLeft + list.clientWidth - (parseFloat(lcs.paddingRight) || 0),
    };
    const problems: string[] = [];
    if (Math.max(...ws) - Math.min(...ws) > TOL) problems.push(`widths ${ws.map(px).join(' / ')}`);
    const left = Math.min(...rs.map((r) => r.left));
    const right = Math.max(...rs.map((r) => r.right));
    if (left - inner.left > TOL || inner.right - right > TOL)
      problems.push(`tabs span ${px(left)}–${px(right)} of ${px(inner.left)}–${px(inner.right)}`);
    tabs.forEach((t, i) => {
      const range = document.createRange();
      range.selectNodeContents(t);
      const tr = range.getBoundingClientRect();
      const off = (tr.left + tr.right) / 2 - (rs[i]!.left + rs[i]!.right) / 2;
      if (tr.width > 0 && Math.abs(off) > TOL)
        problems.push(`${name(t)} text off centre by ${px(off)}`);
    });
    if (problems.length > 0)
      out.push({
        rule: 9,
        target: name(list),
        detail: `dense tabs do not share the row equally: ${problems.join('; ')}`,
        ids: tabs.map(idOf),
      });
  }

  // ---- one checkbox size per panel (rule 10) ---------------------------------------------------
  const boxes = new Map<Element, Element[]>();
  for (const el of all) {
    if (!el.matches('input[type="checkbox"], input[type="radio"]') || allowed(el, 10)) continue;
    const panel = el.closest(PANEL);
    if (!panel) continue;
    boxes.set(panel, [...(boxes.get(panel) ?? []), el]);
  }
  for (const [panel, list] of boxes) {
    if (list.length < 2) continue;
    const rs = list.map((b) => b.getBoundingClientRect());
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    if (spread(rs.map((r) => r.width)) > 0.5 || spread(rs.map((r) => r.height)) > 0.5)
      out.push({
        rule: 10,
        target: name(panel),
        detail: `checkbox / radio sizes differ: ${list.map((b, i) => `${name(b.closest('label') ?? b)} ${px(rs[i]!.width)}x${px(rs[i]!.height)}`).join(' | ')}`,
        ids: list.map(idOf),
      });
  }

  // ---- vertical rhythm of a form column (rule 11) -------------------------------------------
  const BLOCK =
    '[data-form-field], [data-field-grid], [data-field-block], [data-check-field], [data-checkbox]';
  for (const parent of all) {
    if (parent instanceof SVGElement || allowed(parent, 11)) continue;
    const cs = getComputedStyle(parent);
    if (!/flex/.test(cs.display) || !cs.flexDirection.startsWith('column')) continue;
    const items = kids(parent).filter((c) => visible(c) && inFlow(c));
    const want = parent.closest('.hr-designer') ? 12 : 16;
    // What the eye sees of a block: its text lines and controls, not empty padding of its box.
    const ink = (block: Element): { top: number; bottom: number } => {
      let top = Infinity;
      let bottom = -Infinity;
      const add = (r: DOMRect) => {
        if (r.width <= 0 || r.height <= 0) return;
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
      };
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (
          !n.textContent!.trim() ||
          !visible(n.parentElement!) ||
          n.parentElement!.closest('.sr-only, [data-infotip-pop], [data-tooltip]')
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        // Each line as its line box (line-height), not the glyph box.
        const lh = parseFloat(getComputedStyle(n.parentElement!).lineHeight);
        for (const r of Array.from(range.getClientRects())) {
          const mid = (r.top + r.bottom) / 2;
          const half = Number.isFinite(lh) ? lh / 2 : r.height / 2;
          add(new DOMRect(r.left, mid - half, r.width, half * 2));
        }
      }
      // The (i) button's 44px target reaches over its line on purpose; its label line counts.
      const INK =
        'input, textarea, select, button, [role="combobox"], [data-testid^="formula-editor"], [data-testid="sql-editor"]';
      block.querySelectorAll(INK).forEach((c) => {
        if (visible(c) && !c.matches('[data-infotip-button]')) add(c.getBoundingClientRect());
      });
      if (top === Infinity) {
        const r = block.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      }
      return { top, bottom };
    };
    const gaps: { g: number; a: Element; b: Element }[] = [];
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1]!;
      const b = items[i]!;
      if (!a.matches(BLOCK) || !b.matches(BLOCK) || allowed(a, 11) || allowed(b, 11)) continue;
      gaps.push({ g: ink(b).top - ink(a).bottom, a, b });
    }
    if (gaps.length === 0) continue;
    const gs = gaps.map(({ g }) => g);
    const off = gaps.filter(({ g }) => Math.abs(g - want) > TOL);
    if (off.length > 0 || Math.max(...gs) - Math.min(...gs) > TOL)
      out.push({
        rule: 11,
        target: name(parent),
        detail: `field blocks not ${want}px apart: ${gaps.map(({ g, a, b }) => `${px(g)} between ${name(a)} and ${name(b)}`).join('; ')}`,
        ids: [idOf(parent)],
      });
  }

  // ---- one-line field labels (rule 12) ---------------------------------------------------------
  for (const el of all) {
    if (!el.matches('[data-form-field] label, [data-field-label]') || allowed(el, 12)) continue;
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set<number>();
    for (const r of Array.from(range.getClientRects()))
      if (r.width > 0 && r.height > 0 && !(r.width <= 1 && r.height <= 1))
        tops.add(Math.round(r.top));
    const h = el.getBoundingClientRect().height;
    const lines = Array.from(tops).sort((a, b) => a - b);
    const multi =
      (Number.isFinite(lh) && h > lh * 1.5) ||
      (lines.length > 1 &&
        lines[lines.length - 1]! - lines[0]! > (Number.isFinite(lh) ? lh / 2 : 8));
    if (multi)
      out.push({
        rule: 12,
        target: name(el),
        detail: `field label wraps: ${px(h)} high, line height ${px(lh)}`,
        ids: [idOf(el)],
      });
  }

  // ---- nested scroll areas on one axis (rule 13) --------------------------------------------
  const scrolls = (el: Element, axis: 'x' | 'y') => {
    const cs = getComputedStyle(el);
    const o = axis === 'y' ? cs.overflowY : cs.overflowX;
    if (!/(auto|scroll)/.test(o)) return false;
    return axis === 'y'
      ? el.scrollHeight > el.clientHeight + TOL
      : el.scrollWidth > el.clientWidth + TOL;
  };
  const layer = (el: Element) => {
    const p = getComputedStyle(el).position;
    return (
      p === 'fixed' ||
      p === 'absolute' ||
      el.matches('dialog, [role="dialog"], [role="listbox"], [role="menu"], [data-connect-menu]')
    );
  };
  const fullBleed = document.querySelector('.hr-designer') !== null;
  const docEl = document.scrollingElement ?? document.documentElement;
  for (const el of all) {
    if (el instanceof SVGElement || allowed(el, 13)) continue;
    for (const axis of ['y', 'x'] as const) {
      if (!scrolls(el, axis)) continue;
      let outer: Element | null = null;
      let a: Element | null = layer(el) ? null : el.parentElement;
      while (a && a !== document.body && a !== document.documentElement) {
        if (scrolls(a, axis) && !allowed(a, 13)) {
          outer = a;
          break;
        }
        if (layer(a)) break;
        a = a.parentElement;
      }
      const reached = a === document.body || a === document.documentElement || a === null;
      const page =
        !outer &&
        reached &&
        !layer(el) &&
        fullBleed &&
        (axis === 'y'
          ? docEl.scrollHeight > docEl.clientHeight + TOL
          : docEl.scrollWidth > docEl.clientWidth + TOL);
      if (outer || page)
        out.push({
          rule: 13,
          target: name(el),
          detail: `scrolls ${axis === 'y' ? 'vertically' : 'sideways'} inside ${outer ? name(outer) : 'the page'}, which also scrolls that way (${axis === 'y' ? `${px(el.scrollHeight)} in ${px(el.clientHeight)}` : `${px(el.scrollWidth)} in ${px(el.clientWidth)}`})`,
          ids: outer ? [idOf(el), idOf(outer)] : [idOf(el)],
        });
    }
  }

  // ---- no hint shown as text (rule 14) ------------------------------------------------------
  const HOLDER = '[data-card], dialog, [role="dialog"], aside, form, fieldset, [data-form-field]';
  const MUTED = ['rgb(71, 85, 105)'];
  for (const el of all) {
    if (allowed(el, 14) || el.closest('[data-infotip-pop], [data-tooltip], .sr-only')) continue;
    if (el.matches('[data-hint]')) {
      out.push({
        rule: 14,
        target: name(el),
        detail: 'hint shown as text (use the (i) button: InfoTip)',
        ids: [idOf(el)],
      });
      continue;
    }
    if (!el.matches('p') || !el.closest(HOLDER)) continue;
    if (
      el.closest(
        '[data-note], [role="status"], [role="alert"], [aria-live], [data-empty-state], [role="listbox"], [role="menu"], [data-connect-menu]',
      )
    )
      continue;
    const cs = getComputedStyle(el);
    if (!MUTED.includes(cs.color) || parseFloat(cs.fontSize) > 14.5) continue;
    if (!(el.textContent ?? '').trim()) continue;
    out.push({
      rule: 14,
      target: name(el),
      detail:
        'looks like a hint paragraph shown by default (muted, small); move it behind an (i) button or mark status / metadata text `data-note`',
      ids: [idOf(el)],
    });
  }

  // ---- clipped text (rule 7) ------------------------------------------------------------------
  for (const el of all) {
    if (allowed(el, 7) || el.matches('input, textarea, select')) continue;
    const cs = getComputedStyle(el);
    if (!/(hidden|clip)/.test(cs.overflowX)) continue;
    const hasText = Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '',
    );
    if (!hasText) continue;
    if (el.scrollWidth <= el.clientWidth + TOL) continue;
    const ellipsis = cs.textOverflow === 'ellipsis';
    const tip =
      el.hasAttribute('title') ||
      el.closest('[title]') !== null ||
      el.hasAttribute('data-cut') ||
      el.closest('[data-cut]') !== null;
    if (ellipsis && tip) continue;
    out.push({
      rule: 7,
      target: name(el),
      detail: `text clipped (${px(el.scrollWidth)} in ${px(el.clientWidth)})${ellipsis ? ', "…" but no tooltip marker' : ', no "…"'}`,
      ids: [idOf(el)],
      hover: ellipsis && !tip,
    });
  }

  // De-duplicate (same rule + target + detail).
  const seen = new Set<string>();
  return out.filter((v) => {
    const k = `${v.rule}|${v.target}|${v.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Runs every rule on the current page; rule-7 "…" candidates are hovered to find a tooltip. */
export async function layoutLint(page: Page): Promise<LayoutViolation[]> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
  const raw = await page.evaluate(measure, LAYOUT_ALLOW);
  const result: LayoutViolation[] = [];
  for (const v of raw) {
    if (v.hover && v.ids.length === 1) {
      const el = page.locator(`[data-ll="${v.ids[0]}"]`);
      let tooltip = false;
      try {
        await el.hover({ timeout: 2000 });
        tooltip = await page
          .locator('[data-tooltip]')
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        await page.mouse.move(0, 0);
      } catch {
        // not hoverable: no tooltip
      }
      if (tooltip) continue;
    }
    result.push({ rule: v.rule, target: v.target, detail: v.detail });
  }
  return result;
}

export const formatViolations = (state: string, list: LayoutViolation[]): string[] =>
  list.map((v) => `${state} :: [rule ${v.rule}] ${v.target} — ${v.detail}`);

/** Collects the violations of several states of one test; `assertClean` fails with all of them. */
export class LayoutReport {
  readonly lines: string[] = [];
  constructor(private readonly page: Page) {}

  async check(state: string): Promise<void> {
    const { width, height } = this.page.viewportSize()!;
    const list = await layoutLint(this.page);
    this.lines.push(...formatViolations(`${state} ${width}x${height}`, list));
  }

  /** Writes the list to the OS temp dir (input for the fix round) and asserts it is empty. */
  assertClean(file: string): void {
    if (this.lines.length > 0) {
      writeFileSync(join(tmpdir(), `layout-lint-${file}.txt`), this.lines.join('\n') + '\n');
      console.log(this.lines.map((l) => `[layout-lint] ${l}`).join('\n'));
    }
    expect(this.lines, 'layout-lint violations').toEqual([]);
  }
}
