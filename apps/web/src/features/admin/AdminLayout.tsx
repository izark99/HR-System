import { Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageShell, SideNavLayout, type SideNavItem } from '../../components/layout';
import { appConfig } from '../../lib/env';

type NavItem = { key: string; to?: '/admin/flows' | '/admin/users' | '/admin/ui-text' };

// Order and labels follow the Admin wireframe; items without `to` come in later steps.
const ITEMS: NavItem[] = [
  { key: 'dashboard' },
  { key: 'flows', to: '/admin/flows' },
  { key: 'refTables' },
  { key: 'templates' },
  { key: 'users', to: '/admin/users' },
  { key: 'uiText', to: '/admin/ui-text' },
  { key: 'logs' },
];

export function AdminLayout() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const content =
    appConfig.mode === 'supabase' ? (
      <Outlet />
    ) : (
      <p className="m-0 text-muted">{t('admin.localMode')}</p>
    );

  // The Designer needs the whole width (desktop only, spec §15.3): no side menu, no padding.
  if (/^\/admin\/flows\/[^/]+\/designer\/?$/.test(path)) {
    return <PageShell width="bleed">{content}</PageShell>;
  }

  const items: SideNavItem[] = ITEMS.map((item) => ({
    key: item.key,
    label: t(`admin.nav.${item.key}`),
    ...(item.to
      ? {
          to: item.to,
          // Sub-pages (e.g. /admin/flows/:code/versions) keep their section highlighted.
          active: path === item.to || path.startsWith(`${item.to}/`),
        }
      : {}),
  }));
  return (
    <SideNavLayout label={t('admin.nav.label')} items={items}>
      {content}
    </SideNavLayout>
  );
}
