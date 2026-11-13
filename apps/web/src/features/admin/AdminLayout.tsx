import { Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import {
  FileIcon,
  FlowIcon,
  GridIcon,
  HistoryIcon,
  TableIcon,
  TextIcon,
  UsersIcon,
} from '../../components/icons';
import { PageShell, SideNavLayout, type SideNavItem } from '../../components/layout';
import { appConfig } from '../../lib/env';

type NavItem = {
  key: string;
  icon: ReactNode;
  to?: '/admin/flows' | '/admin/users' | '/admin/ui-text' | '/admin/ref-tables';
};

// Order and labels follow the Admin wireframe; items without `to` come in later steps.
const ITEMS: NavItem[] = [
  { key: 'dashboard', icon: <GridIcon /> },
  { key: 'flows', to: '/admin/flows', icon: <FlowIcon /> },
  { key: 'refTables', to: '/admin/ref-tables', icon: <TableIcon /> },
  { key: 'templates', icon: <FileIcon /> },
  { key: 'users', to: '/admin/users', icon: <UsersIcon /> },
  { key: 'uiText', to: '/admin/ui-text', icon: <TextIcon /> },
  { key: 'logs', icon: <HistoryIcon /> },
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
    icon: item.icon,
    ...(item.to
      ? {
          // The reference tables live under one splat route; `/admin/ref-tables` is its list.
          to: item.to as SideNavItem['to'],
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
