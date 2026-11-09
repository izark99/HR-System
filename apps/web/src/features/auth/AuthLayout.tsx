import type { ReactNode } from 'react';
import { PageShell } from '../../components/layout';
import { cardClass, cx } from '../../components/ui';

/**
 * Full-page frame of the sign-in and change-password screens (spec §25.5 "Form"): flat #F7FAF9
 * page (§25.2 "Trang đăng nhập", no gradient, no decoration) holding a `PageShell narrow`.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    // From 768px this frame is the page's scroll area (spec §32 AC-SB-07), as below the top bar of
    // the other screens.
    <div data-scroll-frame className="min-h-screen bg-page font-sans text-ink md:h-dvh md:min-h-0">
      <PageShell width="narrow" className="pt-16 max-sm:pt-8">
        {children}
      </PageShell>
    </div>
  );
}

/** Login / change-password card: max 440px, 1px border, 32px padding (24px mobile), no shadow. */
export const authCardClass = cx(
  cardClass,
  'flex w-full max-w-110 flex-col gap-stack p-8 max-sm:p-6',
);
