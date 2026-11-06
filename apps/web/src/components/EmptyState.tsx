import type { ReactNode } from 'react';
import { InboxIcon } from './icons';
import { cx } from './ui';

/**
 * Nothing to show yet (spec §25.5 "EmptyState", AC-UI-69): a 48px icon tile on #F1F5F9, an 18px/600
 * title, one sentence telling what to do and at most one action (usually a small outline
 * button); 48px 24px padding. `inline`: one line of #475569 text for narrow areas.
 */
export function EmptyState({
  title,
  text,
  action,
  icon,
  variant = 'block',
  className,
}: {
  title: string;
  text?: ReactNode;
  /** At most one control. */
  action?: ReactNode;
  icon?: ReactNode;
  variant?: 'block' | 'inline';
  className?: string;
}) {
  if (variant === 'inline') {
    return (
      <p data-empty-state="inline" className={cx('m-0 text-body text-muted', className)}>
        {title}
        {text && <> {text}</>}
      </p>
    );
  }
  return (
    <div
      data-empty-state="block"
      className={cx('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}
    >
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-card bg-neutral text-muted"
      >
        {icon ?? <InboxIcon />}
      </span>
      <p className="m-0 text-title-xs text-ink">{title}</p>
      {text && <p className="m-0 max-w-120 text-body text-muted">{text}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
