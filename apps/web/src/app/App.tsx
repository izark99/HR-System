import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{t('app.title')}</h1>
      <p className="text-slate-600">{t('app.tagline')}</p>
      <p className="text-sm text-slate-400">{t('app.status')}</p>
    </main>
  );
}
