import type { ReactNode } from 'react';
import { cx } from '../ui';

/**
 * Row above a table inside its card (spec §25.5): tabs / filters / search on the left (`children`),
 * a count or one button on the right (`end`); 16px padding and a bottom rule. Plain grouping, not
 * an ARIA `toolbar` (its controls keep their own Tab stops).
 */
export function Toolbar({
  children,
  end,
  className,
}: {
  children?: ReactNode;
  end?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-toolbar
      className={cx(
        'flex flex-wrap items-center justify-between gap-3 border-b border-line p-4',
        className,
      )}
    >
      {/* min-w-min: never narrower than its widest item, so `end` wraps instead of spilling. */}
      <div className="flex min-w-min flex-1 flex-wrap items-center gap-3">{children}</div>
      {end && <div className="flex shrink-0 items-center gap-2">{end}</div>}
    </div>
  );
}
