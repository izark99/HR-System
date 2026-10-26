import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from '../../components/ui';

/** Full-page gradient with decorative circles (spec §25.2, wireframe "Đăng nhập"). */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="relative flex min-h-screen flex-col items-center gap-8 overflow-hidden bg-linear-135 from-teal-tint-soft via-sky-tint to-coral-tint px-4 py-14 font-sans text-ink">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-36 size-105 rounded-full bg-teal opacity-35"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -bottom-28 size-75 rounded-full bg-coral opacity-35"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-15 right-[18%] size-45 rounded-full bg-blue opacity-25"
      />
      <header className="relative flex flex-col items-center gap-2.5 text-center">
        <Eyebrow>{t('auth.eyebrow')}</Eyebrow>
        <p className="m-0 text-[40px] leading-tight font-extrabold tracking-[-1px]">
          {t('app.name')}
        </p>
        <p className="m-0 text-base text-muted">{t('auth.tagline')}</p>
      </header>
      <main id="main" className="relative flex w-full max-w-105 flex-col">
        {children}
      </main>
    </div>
  );
}

export const authCardClass =
  'flex flex-col gap-4.5 rounded-card-lg bg-card p-9 shadow-card max-sm:p-6';
export const authInputClass =
  'h-11.5 rounded-control border border-line-input bg-card px-3.5 text-copy text-ink';
