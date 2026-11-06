import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { columnsFor } from './FormField';
import { useTranslation } from 'react-i18next';
import { tabIds, tabKeyTarget } from './tabs-logic';
import { cx, toneText, toneTint, type Tone } from './ui';

export { tabIds } from './tabs-logic';

export interface TabItem {
  id: string;
  label: string;
  /** Shown after the label: "Lệch (9)". */
  count?: number;
  /** Colour of the selected pill (default teal). */
  tone?: Tone;
  /** Small extra element after the label (e.g. a "Chỉ xem" badge). */
  badge?: ReactNode;
  disabled?: boolean;
}

/**
 * Pill tabs (spec §25.3 "Tab", §25.5, AC-UI-64) following the WAI-ARIA APG tabs pattern with
 * automatic activation: one Tab stop (the selected tab), ArrowLeft / ArrowRight move and select
 * (wrapping), Home / End jump to the ends. Each tab names its panel (`TabPanel` with the same
 * `id`). `panels="selected"` (default) when only the selected panel is in the DOM, `"all"` when
 * every panel stays mounted (hidden): `aria-controls` then points at each of them.
 *
 * `dense`: 14px variant for the Designer side panels (MEMORY 2026-10-30 13:29); its tabs share the
 * width equally, one size, text centred (MEMORY 2026-11-06 13:05, AC-UI-78 rule 9). Plain tabs keep
 * their own widths on one row. When the row is too narrow (a dense share for the longest label, or
 * plain tabs side by side), both wrap into an equal grid of fewer columns whose rows are all full
 * (measured, like `FieldGrid`; MEMORY 2026-11-06 18:27, AC-UI-78 rule 15), never cutting a label.
 */
export function Tabs({
  id,
  label,
  items,
  selected,
  onChange,
  dense = false,
  panels = 'selected',
  className,
}: {
  /** Base of the tab / panel ids; unique on the page. */
  id: string;
  /** Accessible name of the tab list. */
  label: string;
  items: TabItem[];
  selected: string;
  onChange: (id: string) => void;
  dense?: boolean;
  panels?: 'selected' | 'all';
  className?: string;
}) {
  const { t } = useTranslation();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const list = useRef<HTMLDivElement>(null);
  // Columns of the equal grid (`items.length`: one row). Plain tabs keep their own widths while
  // they fit on one row; else both kinds wrap into equal full rows (AC-UI-78 rules 9, 15).
  const [fit, setFit] = useState(items.length);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => setFit((cur) => tabColumns(el, items.length, dense, cur >= items.length));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  });
  // Unknown `selected`: fall back to the first enabled tab, so the tab list keeps a Tab stop.
  const found = items.findIndex((i) => i.id === selected);
  const current =
    found >= 0
      ? found
      : Math.max(
          0,
          items.findIndex((i) => !i.disabled),
        );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = tabKeyTarget(e.key, current, items.length, (i) => !!items[i]!.disabled);
    if (target === null) return;
    e.preventDefault();
    const next = items[target]!;
    if (next.id !== selected) onChange(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      data-tabs={dense ? 'dense' : 'default'}
      data-tabs-cols={fit < items.length ? fit : undefined}
      className={cx(
        dense
          ? fit >= items.length
            ? 'grid auto-cols-fr grid-flow-col gap-1'
            : 'grid gap-1'
          : fit >= items.length
            ? 'flex flex-wrap gap-2'
            : 'grid w-full gap-2',
        className,
      )}
      style={
        fit < items.length ? { gridTemplateColumns: `repeat(${fit}, minmax(0, 1fr))` } : undefined
      }
    >
      {items.map((item, i) => {
        const active = i === current;
        const ids = tabIds(id, item.id);
        const tone = item.tone ?? 'teal';
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[item.id] = el;
            }}
            id={ids.tab}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={active || panels === 'all' ? ids.panel : undefined}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cx(
              'inline-flex min-h-target items-center gap-2 rounded-pill font-semibold whitespace-nowrap',
              dense ? 'min-w-0 justify-center px-3 text-dense' : 'px-4 text-body',
              !dense && fit < items.length && 'min-w-0 justify-center',
              active
                ? cx(toneTint[tone], toneText[tone])
                : 'text-muted hover:bg-neutral disabled:cursor-not-allowed disabled:hover:bg-transparent',
            )}
          >
            {item.count === undefined
              ? item.label
              : t('common.tabCount', { label: item.label, count: item.count })}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

/** Panel of one tab: named by its tab, focusable (APG) unless it starts with a control. */
export function TabPanel({
  tabsId,
  item,
  hidden = false,
  focusable = true,
  className,
  children,
}: {
  tabsId: string;
  item: string;
  /** For `panels="all"`: keep the panel mounted but hidden. */
  hidden?: boolean;
  focusable?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ids = tabIds(tabsId, item);
  return (
    <div
      role="tabpanel"
      id={ids.panel}
      aria-labelledby={ids.tab}
      tabIndex={focusable ? 0 : undefined}
      hidden={hidden}
      className={className}
    >
      {children}
    </div>
  );
}

/** Gaps of a tab list (`gap-1` dense, `gap-2` plain). */
const DENSE_GAP = 4;
const PLAIN_GAP = 8;

/**
 * Columns of a tab list: `count` (one row) when the tabs fit side by side — dense ones in equal
 * shares, plain ones at their own widths — else the most columns whose equal share holds the
 * widest tab on one line and that fill every row (`columnsFor`: no lone tab on the last row).
 * Plain tabs on one row (`row`) are sized by their content: they no longer fit when they wrap; the
 * grid then takes the full width and is measured again from there.
 */
function tabColumns(list: HTMLElement, count: number, dense: boolean, row: boolean): number {
  const width = list.clientWidth;
  if (width <= 0) return count;
  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
  if (!dense && row) {
    const tops = tabs.map((tab) => Math.round(tab.getBoundingClientRect().top));
    return tops.every((top) => top === tops[0]) ? count : count - 1;
  }
  const gap = dense ? DENSE_GAP : PLAIN_GAP;
  let need = 0;
  let sum = 0;
  tabs.forEach((tab) => {
    const cs = getComputedStyle(tab);
    const range = document.createRange();
    range.selectNodeContents(tab);
    const w =
      range.getBoundingClientRect().width +
      (parseFloat(cs.paddingLeft) || 0) +
      (parseFloat(cs.paddingRight) || 0);
    need = Math.max(need, w);
    sum += Math.ceil(w);
  });
  if (!dense && sum + (count - 1) * gap <= width) return count;
  return columnsFor(width, Math.ceil(need), count, gap, count);
}
