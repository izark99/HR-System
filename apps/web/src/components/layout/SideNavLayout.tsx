import { Link, type LinkProps } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuIcon } from '../icons';
import { buttonClass, cx, navItemClass, OneLine } from '../ui';
import { PageShell } from './PageShell';

export interface SideNavItem {
  key: string;
  label: string;
  /** Route of the item; without it the item is shown disabled with "Sắp có". */
  to?: LinkProps['to'];
  active?: boolean;
}

/**
 * Admin frame (spec §25.5): 240px left menu (items per §25.3 "Menu trái") + `PageShell fluid`
 * holding the page. From 768px the menu stays put and the page column is the scroll area (spec §32
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
          'flex flex-col gap-1 px-3 py-6 md:w-60 md:shrink-0',
          !open && 'max-md:hidden',
        )}
      >
        {items.map((item) =>
          item.to !== undefined ? (
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
              {/* Cut with "…" + tooltip when the "Sắp có" badge leaves too little room. */}
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
