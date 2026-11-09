import { RouterProvider } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/layout';
import { ToastProvider } from '../components/Toast';
import { AuthProvider } from '../features/auth/auth-context';
import { RunStoreProvider } from '../features/runner/run-context';
import { router } from './router';
import { createServices } from './services';

const services = createServices();

/** The first render waits for the texts edited by Admins (at most ~1.5 s, never fails). */
export const appReady: Promise<unknown> = services?.ready ?? Promise.resolve();

/** Shown when the build has no (or an unsafe) Supabase configuration. */
function ConfigError() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <PageShell width="narrow" className="pt-16">
        <h1 className="m-0 text-page-title text-ink">{t('config.title')}</h1>
        <p className="m-0 text-body text-muted">{t('config.text')}</p>
      </PageShell>
    </div>
  );
}

export function App() {
  if (!services) return <ConfigError />;
  return (
    <AuthProvider service={services.auth}>
      <RunStoreProvider source={services.source} logger={services.logger}>
        {/* One toast region for the whole app (spec §25.5). */}
        <ToastProvider>
          <RouterProvider router={router} context={{ auth: services.auth }} />
        </ToastProvider>
      </RunStoreProvider>
    </AuthProvider>
  );
}
