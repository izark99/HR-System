import type { ReactNode } from 'react';
import { cx } from '../ui';

export type PageWidth = 'content' | 'fluid' | 'narrow' | 'bleed';

const WIDTH: Record<PageWidth, string> = {
  // Every User screen: at most 1280px (padding included, as before), centred.
  content: 'mx-auto w-full max-w-320',
  // Admin screens beside the left menu: the rest of the row.
  fluid: 'w-full min-w-0 flex-1',
  // Sign-in, change password, single forms: at most 488px, centred.
  narrow: 'mx-auto w-full max-w-122',
  // Designer (spec §25.5 "Workspace"): full width, no padding, no gap.
  bleed: 'w-full min-w-0',
};

/**
 * The page frame of every screen (spec §25.5, AC-UI-63): the app's only `<main id="main">` (target
 * of the "Bỏ qua tới nội dung" link in the top bar), with the page padding (`page-top` above,
 * `page-x` on the sides, 48px below) and `section` between its blocks. Screens never write
 * `<main>` themselves (`design-tokens.test.ts`).
 */
export function PageShell({
  width = 'content',
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main
      id="main"
      // Target of the skip link: focused (not only scrolled to), so Tab and the scroll keys carry
      // on from the content (spec §32 AC-SB-08). No ring: it is not a control. Not on the
      // full-bleed Designer: a click on its empty canvas must leave the focus on the body, where
      // the canvas shortcuts (copy, paste, delete) listen.
      tabIndex={width === 'bleed' ? undefined : -1}
      data-page-width={width}
      className={cx(
        'flex flex-col focus:outline-none',
        width !== 'bleed' && 'gap-section px-page-x pt-page-top pb-12',
        WIDTH[width],
        className,
      )}
    >
      {children}
    </main>
  );
}
