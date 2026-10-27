import { Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../features/auth/auth-context';
import { CHANGE_PASSWORD_PATH, LOGIN_PATH, resolveGuard } from '../features/auth/guard';
import { IdleLogout } from '../features/auth/idle/IdleLogout';
import { AppShell } from './AppShell';

function Redirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    void router.navigate({ href, replace: true });
  }, [href, router]);
  return null;
}

/**
 * Applies the route guard and picks the layout: auth screens are full-page, everything else is
 * inside the app shell. When the signed-in account goes away without a page load (session
 * expired, locked, another account), the page is reloaded so no file or result of the previous
 * session survives in memory.
 */
export function RootLayout() {
  const { t } = useTranslation();
  const auth = useAuth();
  const location = useRouterState({ select: (s) => s.location });
  // Path of the route actually rendered by <Outlet>. During a navigation `location` already points
  // to the next page while the old route is still mounted; both must pass the guard, otherwise a
  // protected page could render (and fetch) for a frame, e.g. right after a redirect to /login.
  const renderedPath = useRouterState({ select: (s) => s.matches.at(-1)?.pathname ?? null });
  const userId = auth.status === 'signedIn' ? auth.user.id : null;
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const prev = previous.current;
    previous.current = userId;
    if (prev && prev !== userId) {
      const reason = auth.status === 'signedOut' ? auth.reason : undefined;
      window.location.assign(reason ? `${LOGIN_PATH}?reason=${reason}` : LOGIN_PATH);
    }
  }, [userId, auth]);

  const decision = resolveGuard(location.pathname, auth, location.searchStr);
  if (decision.kind === 'wait') {
    return (
      <p role="status" className="m-0 p-8 font-sans text-muted">
        {t('common.loading')}
      </p>
    );
  }
  if (decision.kind === 'redirect') return <Redirect href={decision.href} />;
  if (renderedPath !== null && resolveGuard(renderedPath, auth).kind !== 'allow') return null;
  // Auto sign-out after 8 hours without interaction, for every signed-in screen (spec §6.1).
  const idle = auth.status === 'signedIn' ? <IdleLogout key={auth.user.id} /> : null;
  if (location.pathname === LOGIN_PATH || location.pathname === CHANGE_PASSWORD_PATH) {
    return (
      <>
        <Outlet />
        {idle}
      </>
    );
  }
  return (
    <>
      <AppShell />
      {idle}
    </>
  );
}
