import { Link, type LinkProps } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronIcon, MenuIcon } from '../icons';
import { Tooltip } from '../Tooltip';
import { buttonClass, cx, navItemClass, OneLine } from '../ui';
import { PageShell } from './PageShell';

export interface SideNavItem {
  key: string;
  label: string;
  /** Route of the item; without it the item is shown disabled with "Sắp có". */
  to?: LinkProps['to'];
  active?: boolean;
  /** Shown alone when the menu is collapsed (from 768px), next to nothing when expanded. */
  icon?: ReactNode;
}

/**
 * Admin frame (spec §25.5): left menu (items per §25.3 "Menu trái") + `PageShell fluid` holding
 * the page. From 768px the menu is 320px wide (room for the longest label + "Sắp ra mắt") and can
 * be collapsed to a 64px rail of icons with tooltips (MEMORY 2026-11-13 07:58); the choice lives in
 * this tab's memory only (no browser storage) and survives moving between Admin screens. From 768px the menu stays put and the page column is the scroll area (spec §32
 * AC-SB-07); below 768px the whole page scrolls and the menu folds behind a disclosure button
 * named `label`.
 */
export function SideNavLayout({
  label,
  items,
  children,
}: {
  /** Accessible name of the `<nav>` and text of the mobile toggle (e.g. "Menu quản trị"). */
  label: string;
  items: SideNavItem[];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navId = useId();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useCollapsed();
  return (
    <div className="flex flex-col md:h-full md:flex-row">
      <div className="px-page-x pt-page-top md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => setOpen((o) => !o)}
          className={buttonClass('outline', 'sm')}
        >
          <MenuIcon />
          {label}
        </button>
      </div>
      <nav
        id={navId}
        aria-label={label}
        className={cx(
          'flex flex-col gap-1 px-3 py-6 md:shrink-0',
          collapsed ? 'md:w-16 md:px-2' : 'md:w-80',
          !open && 'max-md:hidden',
        )}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={navId}
          aria-label={collapsed ? t('common.navExpand') : t('common.navCollapse')}
          title={collapsed ? t('common.navExpand') : t('common.navCollapse')}
          onClick={() => setCollapsed((c) => !c)}
          className={cx(
            'max-md:hidden mb-2 inline-flex size-target items-center justify-center rounded-input text-ink-soft hover:bg-neutral hover:text-ink',
            collapsed ? 'self-center' : 'self-end',
          )}
        >
          <ChevronIcon dir={collapsed ? 'right' : 'left'} size={20} />
        </button>
        {items.map((item) =>
          collapsed ? (
            <RailItem key={item.key} item={item} soon={t('common.soon')} />
          ) : item.to !== undefined ? (
            <Link
              key={item.key}
              to={item.to}
              aria-current={item.active ? 'page' : undefined}
              className={navItemClass(item.active ?? false)}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.key}
              aria-disabled="true"
              className={cx(
                navItemClass(false),
                'justify-between gap-2 text-muted hover:bg-transparent hover:text-muted',
              )}
            >
              {/* Cut with "…" + tooltip when the "Sắp ra mắt" badge leaves too little room. */}
              <OneLine text={item.label} />
              <span className="shrink-0 rounded-pill bg-neutral px-2 py-0.5 text-caption whitespace-nowrap">
                {t('common.soon')}
              </span>
            </span>
          ),
        )}
      </nav>
      {/* From 768px the menu stays put and only this column scrolls (spec §32 AC-SB-07). A plain
          block around the page: the page's own blocks never shrink to fit the column. */}
      <div data-scroll-frame className="min-w-0 flex-1 md:min-h-0">
        <PageShell width="fluid">{children}</PageShell>
      </div>
    </div>
  );
}

/**
 * Collapsed state shared by every SideNavLayout of the tab: module memory, so it survives moving
 * between Admin screens (the layout remounts per route) but never reaches browser storage.
 */
let collapsedInTab = false;
function useCollapsed(): [boolean, (f: (c: boolean) => boolean) => void] {
  const [collapsed, setState] = useState(collapsedInTab);
  return [
    collapsed,
    (f) =>
      setState((c) => {
        collapsedInTab = f(c);
        return collapsedInTab;
      }),
  ];
}

/** One item of the collapsed rail (from 768px): the icon alone, its name in a tooltip. */
function RailItem({ item, soon }: { item: SideNavItem; soon: string }) {
  const tip = item.to !== undefined ? item.label : `${item.label} · ${soon}`;
  const box = 'flex size-12 items-center justify-center rounded-input border-l-3';
  return (
    <Tooltip text={tip} side="right" className="max-md:hidden flex justify-center">
      {item.to !== undefined ? (
        <Link
          to={item.to}
          aria-current={item.active ? 'page' : undefined}
          aria-label={item.label}
          className={cx(
            box,
            item.active
              ? 'border-teal-strong bg-teal-tint text-teal-strong'
              : 'border-transparent text-ink-soft hover:bg-neutral hover:text-ink',
          )}
        >
          {item.icon}
        </Link>
      ) : (
        <span aria-disabled="true" className={cx(box, 'border-transparent text-muted')}>
          {item.icon}
          <span className="sr-only">{tip}</span>
        </span>
      )}
    </Tooltip>
  );
}
