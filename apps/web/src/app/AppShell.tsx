import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../features/auth/auth-context';
import { isAdminPath } from '../features/auth/guard';
import { UserMenu } from './UserMenu';

export function AppShell() {
  const { t } = useTranslation();
  const auth = useAuth();
  const inAdmin = useRouterState({ select: (s) => isAdminPath(s.location.pathname) });
  // From 768px the top bar stays put and only the area below it scrolls (spec §32 AC-SB-07): User
  // screens scroll here, Admin screens in their content column (SideNavLayout), the Designer not
  // at all. Below 768px the whole page scrolls as before.
  return (
    <div
      data-app-shell
      className="min-h-screen bg-page font-sans text-ink md:flex md:h-dvh md:min-h-0 md:flex-col"
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-card focus:border focus:border-line focus:bg-card focus:px-4 focus:py-3 focus:shadow-float"
      >
        {t('app.skipToContent')}
      </a>
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-card px-6 max-sm:px-3">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            aria-label={t('app.home')}
            className="flex min-h-target items-center gap-3 text-title-sm text-ink no-underline hover:text-ink"
          >
            <img src="/favicon.svg" alt="" aria-hidden width={32} height={32} className="size-8" />
            <span className="max-sm:sr-only">{t('app.name')}</span>
          </Link>
          {inAdmin && (
            <span className="rounded-pill bg-blue-tint px-3 py-1 text-caption font-semibold text-blue-text">
              {t('admin.badge')}
            </span>
          )}
        </div>
        {auth.status === 'signedIn' && <UserMenu user={auth.user} />}
      </header>
      <div {...(inAdmin ? {} : { 'data-scroll-frame': '' })} className="md:min-h-0 md:flex-1">
        <Outlet />
      </div>
    </div>
  );
}
