import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cardClass, cx } from './ui';

/**
 * Loading placeholders (spec §25.3 "Skeleton", AC-UI-56). A block is `#F1F5F9` with a light
 * sweep every ~1.5 s (`.hr-skeleton` in index.css; static under `prefers-reduced-motion`).
 * Placeholders are decorative: the surrounding `LoadingRegion` is the `role="status"` that
 * screen readers announce as "Đang tải…".
 */
export function Skeleton({
  className,
  shape = 'line',
}: {
  className?: string;
  /** `line` = text line (6px radius), `card` = card / button area (12px), `pill` = chip. */
  shape?: 'line' | 'card' | 'pill';
}) {
  return (
    <span
      aria-hidden
      data-skeleton
      className={cx(
        'hr-skeleton block bg-neutral',
        shape === 'card' ? 'rounded-card' : shape === 'pill' ? 'rounded-pill' : 'rounded-input',
        className,
      )}
    />
  );
}

/** Wait before showing the placeholders: a fast answer never flashes a skeleton. */
export const SKELETON_DELAY_MS = 200;

/**
 * `role="status"` container with a screen-reader "Đang tải…"; the visual placeholders appear
 * only after `delayMs` (200 ms by default).
 */
export function LoadingRegion({
  children,
  className,
  delayMs = SKELETON_DELAY_MS,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) return;
    const id = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(id);
  }, [delayMs]);
  return (
    <div role="status" data-loading className={className}>
      <span className="sr-only">{t('common.loading')}</span>
      {shown && (
        <div aria-hidden className="contents">
          {children}
        </div>
      )}
    </div>
  );
}

/** Eyebrow + page title (+ subtitle) block, the shape of `PageHeader`. */
export function HeaderSkeleton({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-3.5 w-40" />
      <Skeleton className="h-12 w-full max-w-2xl max-md:h-8" />
      {subtitle && <Skeleton className="h-5 w-full max-w-xl" />}
    </div>
  );
}

/** Rows of an admin table inside its card. */
export function TableSkeleton({ rows = 4, columns = 5 }: { rows?: number; columns?: number }) {
  const widths = ['w-24', 'w-36', 'w-20', 'w-28', 'w-16', 'w-32'];
  return (
    <div className="flex flex-col">
      <div className="flex gap-6 border-b border-line bg-neutral px-4 py-3.5">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className={cx('h-3.5 bg-line', widths[c % widths.length])} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 border-b border-line px-4 py-4">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cx('h-4', widths[(c + r) % widths.length])} />
          ))}
          <Skeleton className="ml-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}

/** A card holding a title line and a table. */
export function TableCardSkeleton({ rows, columns }: { rows?: number; columns?: number }) {
  return (
    <div className={cx(cardClass, 'flex flex-col gap-4 p-6')}>
      <Skeleton className="h-7 w-56" />
      <TableSkeleton {...(rows ? { rows } : {})} {...(columns ? { columns } : {})} />
    </div>
  );
}

/** Flow cards in the same grid as the flow list. */
export function FlowCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cx(cardClass, 'flex flex-col gap-3 p-6')}>
          <Skeleton shape="pill" className="h-6 w-24" />
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton shape="card" className="mt-2 h-12 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Simple list lines (recent runs). */
export function LinesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cx('h-5', i % 2 ? 'w-3/4' : 'w-full')} />
      ))}
    </div>
  );
}

/** Whole page: header + one content card (app start, route chunk loading, run page). */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-col gap-6', className)}>
      <HeaderSkeleton />
      <div className={cx(cardClass, 'flex flex-col gap-4 p-6')}>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton shape="card" className="h-32 w-full" />
      </div>
    </div>
  );
}

/** Designer: palette column, canvas, side panel. */
export function DesignerSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-64px)] min-h-150 flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-card px-3.5 py-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-6 w-72" />
        <Skeleton shape="card" className="ml-auto h-9 w-80" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-62 flex-col gap-3 border-r border-line p-3.5">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} shape="card" className="h-15 w-full" />
          ))}
        </div>
        <Skeleton shape="card" className="m-6 flex-1" />
        <div className="flex w-100 flex-col gap-3 border-l border-line p-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}
