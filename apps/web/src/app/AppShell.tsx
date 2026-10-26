import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-card focus:px-4 focus:py-3 focus:shadow-card"
      >
        {t('app.skipToContent')}
      </a>
      <header className="flex h-16 items-center justify-between gap-3 bg-card px-6 shadow-header">
        <Link
          to="/"
          aria-label={t('app.home')}
          className="flex min-h-target items-center gap-2.5 text-lg font-extrabold tracking-[-0.3px] text-ink no-underline hover:text-ink"
        >
          <img src="/favicon.svg" alt="" aria-hidden width={32} height={32} className="size-8" />
          {t('app.name')}
        </Link>
      </header>
      <Outlet />
    </div>
  );
}
