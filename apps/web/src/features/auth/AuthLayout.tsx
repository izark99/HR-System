import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cardClass, cx, Eyebrow, inputClass } from '../../components/ui';

/** Flat full page (spec §25.2–25.3 "Trang đăng nhập", design v2): no gradient, no decoration. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center gap-8 bg-page px-4 py-14 font-sans text-ink max-sm:py-8">
      <header className="flex flex-col items-center gap-3 text-center">
        <Eyebrow>{t('auth.eyebrow')}</Eyebrow>
        <p className="m-0 text-title-md text-ink">{t('app.name')}</p>
        <p className="m-0 text-body text-muted">{t('auth.tagline')}</p>
      </header>
      <main id="main" className="flex w-full max-w-110 flex-col">
        {children}
      </main>
    </div>
  );
}

/** Login / change-password card: max 440px, 1px border, 32px padding (24px mobile), no shadow. */
export const authCardClass = cx(cardClass, 'flex flex-col gap-5 p-8 max-sm:p-6');
export const authInputClass = inputClass;
