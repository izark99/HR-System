import type { ReactNode } from 'react';
import { cx } from '../ui';

/**
 * Bar stuck to the bottom of the viewport (spec §25.5, Wizard screens): white, top rule, 12px
 * `page-x` padding; a note on the left, buttons on the right in reading order with the primary
 * one last (outer edge). `label` names the region for screen readers.
 */
export function StickyActionBar({
  label,
  note,
  children,
  className,
}: {
  label: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      data-sticky-actions
      className={cx(
        'sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-card px-page-x py-3',
        className,
      )}
    >
      <div className="min-w-0 text-caption text-muted">{note}</div>
      <div className="flex flex-wrap items-center justify-end gap-3">{children}</div>
    </div>
  );
}
