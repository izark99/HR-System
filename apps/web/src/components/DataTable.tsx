import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from './EmptyState';
import { pinnedRightClass, rowActionsCellBaseClass } from './RowActions';
import { LoadingRegion, TableSkeleton } from './Skeleton';
import { Button, Callout, cx, toneTint, type Tone } from './ui';

export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Numbers are right-aligned. */
  align?: 'left' | 'right';
  /** The cell naming the row (`<th scope="row">`, ink 600), usually the first column. */
  rowHeader?: boolean;
}

/** Header cell: 44px row on #F1F5F9, `caption` 600 #475569, one line. */
const thClass =
  'h-target border-b border-line bg-neutral px-4 text-caption font-semibold whitespace-nowrap text-muted';
/** Body cell: 48px row, one line in full (never cut, AC-UI-57), vertically centred. */
const tdClass = 'border-b border-line px-4 align-middle whitespace-nowrap';

/**
 * Header and body cells of the dense data tables (result sheets, Designer preview; MEMORY
 * 2026-10-30 13:29): 14px text, 13px/600 header, 8px 12px padding. Those tables keep their own
 * component (virtual rows) but share these cells.
 */
export const denseThClass =
  'border-b border-line bg-neutral px-3 py-2 text-left text-dense-head whitespace-nowrap text-muted';
export const denseTdClass =
  'border-b border-line px-3 py-2 align-middle text-dense whitespace-nowrap';

/**
 * Admin table (spec §25.5 "DataTable", AC-UI-65) inside its card: columns from configuration,
 * 44px header, 48px rows with one full line per cell; a table wider than its card scrolls sideways
 * inside a focusable region named `caption`, with the action column (`actions`, `RowActions`)
 * pinned to the right edge (AC-UI-57/58). States: `loading` (skeleton of the table), `error`
 * (coral callout + "Thử lại"), `empty` (when there is no row). The `<caption>` is for screen
 * readers only.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowTone,
  actions,
  loading = false,
  error,
  empty,
}: {
  /** Name of the table: hidden caption and label of the scroll region. */
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Tint of a row needing attention (e.g. amber: must change password). */
  rowTone?: (row: Row) => Tone | undefined;
  /** Pinned "Thao tác" column. */
  actions?: { header: string; cell: (row: Row) => ReactNode };
  loading?: boolean;
  /** Load failure: message + retry. */
  error?: { message: string; onRetry: () => void } | null;
  /** Shown instead of the table when `rows` is empty. */
  empty: { title: string; text?: ReactNode; action?: ReactNode };
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <LoadingRegion>
        <TableSkeleton columns={columns.length} />
      </LoadingRegion>
    );
  }
  if (error) {
    return (
      <div data-table-state="error" className="flex flex-col items-start gap-3 p-4">
        <Callout tone="coral" label={t('common.errorLabel')} role="alert">
          {error.message}
        </Callout>
        <Button size="sm" onClick={error.onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (rows.length === 0) return <EmptyState {...empty} />;

  const align = (c: DataTableColumn<Row>) => (c.align === 'right' ? 'text-right' : 'text-left');
  return (
    <div
      className="overflow-x-auto"
      role="region"
      tabIndex={0}
      aria-label={caption}
      data-data-table
    >
      <table className="w-full border-collapse text-body text-ink-soft">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col" className={cx(thClass, align(c))}>
                {c.header}
              </th>
            ))}
            {actions && (
              <th scope="col" className={cx(thClass, 'text-right', pinnedRightClass)}>
                {actions.header}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = rowTone?.(row);
            return (
              <tr key={rowKey(row)} className={cx('h-row', tone ? toneTint[tone] : 'bg-card')}>
                {columns.map((c) =>
                  c.rowHeader ? (
                    <th
                      key={c.id}
                      scope="row"
                      className={cx(tdClass, align(c), 'font-semibold text-ink')}
                    >
                      {c.cell(row)}
                    </th>
                  ) : (
                    <td key={c.id} className={cx(tdClass, align(c))}>
                      {c.cell(row)}
                    </td>
                  ),
                )}
                {actions && <td className={rowActionsCellBaseClass}>{actions.cell(row)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
