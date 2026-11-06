import { Link, type LinkProps } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuIcon } from '../icons';
import { buttonClass, cx, navItemClass } from '../ui';
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
 * holding the page. Below 768px the menu folds behind a disclosure button named `label`.
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
    <div className="flex flex-col md:flex-row">
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
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="shrink-0 rounded-pill bg-neutral px-2 py-0.5 text-caption whitespace-nowrap">
                {t('common.soon')}
              </span>
            </span>
          ),
        )}
      </nav>
      <PageShell width="fluid">{children}</PageShell>
    </div>
  );
}
