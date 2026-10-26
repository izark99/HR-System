import { RouterProvider } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from '../features/auth/auth-context';
import { RunStoreProvider } from '../features/runner/run-context';
import { router } from './router';
import { createServices } from './services';

const services = createServices();

/** Shown when the build has no (or an unsafe) Supabase configuration. */
function ConfigError() {
  const { t } = useTranslation();
  return (
    <main id="main" className="mx-auto flex max-w-160 flex-col gap-3 px-4 py-16 font-sans text-ink">
      <h1 className="m-0 text-page-title">{t('config.title')}</h1>
      <p className="m-0 text-copy text-muted">{t('config.text')}</p>
    </main>
  );
}

export function App() {
  if (!services) return <ConfigError />;
  return (
    <AuthProvider service={services.auth}>
      <RunStoreProvider source={services.source} logger={services.logger}>
        <RouterProvider router={router} />
      </RunStoreProvider>
    </AuthProvider>
  );
}
