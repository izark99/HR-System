import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cx, navItemClass } from '../../components/ui';
import { appConfig } from '../../lib/env';

type NavItem = { key: string; to?: '/admin/flows' | '/admin/users' };

// Order and labels follow the Admin wireframe; items without `to` come in later steps.
const ITEMS: NavItem[] = [
  { key: 'dashboard' },
  { key: 'flows', to: '/admin/flows' },
  { key: 'refTables' },
  { key: 'templates' },
  { key: 'users', to: '/admin/users' },
  { key: 'logs' },
];

export function AdminLayout() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });

  // The Designer needs the whole width (desktop only, spec §15.3): no side menu, no padding.
  if (/^\/admin\/flows\/[^/]+\/designer\/?$/.test(path)) {
    return (
      <main id="main" className="flex min-w-0 flex-col">
        {appConfig.mode === 'supabase' ? (
          <Outlet />
        ) : (
          <p className="m-0 p-6 text-muted">{t('admin.localMode')}</p>
        )}
      </main>
    );
  }

  return (
    <div className="flex flex-wrap">
      <nav
        aria-label={t('admin.nav.label')}
        className="flex max-w-64 flex-[1_1_220px] flex-col gap-1.5 px-3.5 py-6"
      >
        {ITEMS.map((item) => {
          // Sub-pages (e.g. /admin/flows/:code/versions) keep their section highlighted.
          const active =
            item.to !== undefined && (path === item.to || path.startsWith(`${item.to}/`));
          return item.to ? (
            <Link
              key={item.key}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={navItemClass(active)}
            >
              {t(`admin.nav.${item.key}`)}
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
              {t(`admin.nav.${item.key}`)}
              <span className="text-caption">{t('admin.nav.soon')}</span>
            </span>
          );
        })}
      </nav>
      <main
        id="main"
        className="flex min-w-0 flex-[999_1_560px] flex-col gap-6 px-4 pt-8 pb-12 md:pr-8 md:pl-4"
      >
        {appConfig.mode === 'supabase' ? (
          <Outlet />
        ) : (
          <p className="m-0 text-muted">{t('admin.localMode')}</p>
        )}
      </main>
    </div>
  );
}
