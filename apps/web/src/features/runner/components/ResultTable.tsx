import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Callout, cx } from '../../../components/ui';
import type {
  CellValue,
  ColumnInfo,
  RowFilter,
  RowPage,
  SheetInfo,
} from '../../../engine/protocol';
import { formatCell, isNumericType } from '../../../lib/format';
import { useRunStore } from '../run-context';

/** Rows fetched from the worker per request; only visible pages are ever requested. */
const PAGE_SIZE = 200;
const ROW_HEIGHT = 44;

interface RowData {
  index: number;
  cells: CellValue[] | undefined;
  highlights: readonly string[];
}

function columnWidth(c: ColumnInfo): number {
  const byTitle = c.title.length * 9 + 32;
  return Math.min(320, Math.max(isNumericType(c.type) ? 130 : 150, byTitle));
}

/**
 * Virtualized result table (TanStack Table for columns/cells, TanStack Virtual for rows).
 * Data stays in the worker; this component asks for row pages around the visible window.
 * Mount with `key` = sheet + filters so a new query starts from a clean state.
 */
export type SortState = { column: string; direction: 'asc' | 'desc' } | null;

export function ResultTable({
  sheet,
  filters,
  label,
  sort = null,
  search = '',
  onSort,
}: {
  sheet: SheetInfo;
  filters: RowFilter[];
  label: string;
  /** Sort and search run in the worker (spec §12.1.10); mount with a new `key` when they change. */
  sort?: SortState;
  search?: string;
  onSort?: (sort: SortState) => void;
}) {
  const { t } = useTranslation();
  const store = useRunStore();
  const [total, setTotal] = useState<number | null>(null);
  const [pages, setPages] = useState<ReadonlyMap<number, RowPage>>(new Map());
  const requested = useRef(new Set<number>());
  /** A page request failed; no automatic refetch until the User retries (avoids a request loop). */
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API
  const virtualizer = useVirtualizer({
    count: total ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const firstPage = Math.floor((items[0]?.index ?? 0) / PAGE_SIZE);
  const lastPage = Math.floor((items[items.length - 1]?.index ?? 0) / PAGE_SIZE);

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (failed) return;
    const wanted: number[] = [];
    if (total === null) wanted.push(0);
    else for (let p = firstPage; p <= lastPage; p++) wanted.push(p);
    for (const p of wanted) {
      if (requested.current.has(p)) continue;
      requested.current.add(p);
      const query = {
        offset: p * PAGE_SIZE,
        limit: PAGE_SIZE,
        filters,
        ...(sort ? { sort } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      };
      void store.getRows(sheet.id, query).then(
        (page) => {
          if (!mounted.current) return;
          setTotal(page.total);
          setPages((prev) => new Map(prev).set(p, page));
        },
        () => {
          // Forget the page so a retry asks for it again.
          requested.current.delete(p);
          if (mounted.current) setFailed(true);
        },
      );
    }
  }, [store, sheet.id, filters, sort, search, total, firstPage, lastPage, failed]);

  const columns = useMemo<ColumnDef<RowData>[]>(
    () =>
      sheet.columns.map((c, ci) => ({
        id: c.key,
        header: c.title,
        size: columnWidth(c),
        cell: (ctx) => {
          const v = ctx.row.original.cells?.[ci];
          return v === undefined ? '' : formatCell(v, c.type, t);
        },
      })),
    [sheet.columns, t],
  );

  const data = items.map((vi): RowData => {
    const p = Math.floor(vi.index / PAGE_SIZE);
    const page = pages.get(p);
    const local = vi.index - p * PAGE_SIZE;
    return { index: vi.index, cells: page?.rows[local], highlights: page?.highlights[local] ?? [] };
  });

  // `data` is the visible window and changes on every scroll. Without autoResetAll: false the
  // table queues a pagination reset (a state update) on each data change, which re-renders,
  // rebuilds `data` and loops forever.
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    autoResetAll: false,
    manualPagination: true,
  });
  const totalWidth = table.getTotalSize();

  const errorState = failed && (
    <Callout tone="coral" label={t('result.rowsFailedLabel')} role="alert">
      <span className="flex flex-wrap items-center gap-3">
        {t('result.rowsFailed')}
        <Button onClick={() => setFailed(false)}>{t('result.retry')}</Button>
      </span>
    </Callout>
  );

  if (total === null && failed) return <div className="px-5 pb-5">{errorState}</div>;

  if (total === 0) {
    return (
      <p className="m-0 px-5 pb-5 text-label text-muted">
        {search.trim() ? t('result.noMatch') : t('result.empty')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-5 pb-5">
      {errorState}
      <div
        ref={scrollRef}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="max-h-140 overflow-auto rounded-control border border-line"
      >
        <table
          className="grid border-collapse text-label text-body"
          style={{ width: Math.max(totalWidth, 0), minWidth: '100%' }}
          aria-rowcount={(total ?? 0) + 1}
          aria-colcount={sheet.columns.length}
        >
          <thead className="sticky top-0 z-10 grid bg-page">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} aria-rowindex={1} className="flex w-full border-b border-line">
                {hg.headers.map((h, ci) => {
                  const col = sheet.columns[ci]!;
                  const dir = sort?.column === col.key ? sort.direction : null;
                  const header = flexRender(h.column.columnDef.header, h.getContext());
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={
                        dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined
                      }
                      style={{ width: h.getSize() }}
                      className={cx(
                        'flex shrink-0 items-center px-2 py-0 font-semibold text-muted',
                        isNumericType(col.type) ? 'justify-end text-right' : 'text-left',
                      )}
                    >
                      {onSort ? (
                        <button
                          type="button"
                          onClick={() =>
                            onSort(
                              dir === null
                                ? { column: col.key, direction: 'asc' }
                                : dir === 'asc'
                                  ? { column: col.key, direction: 'desc' }
                                  : null,
                            )
                          }
                          title={t('result.sortHint')}
                          className="flex min-h-target items-center gap-1 rounded-control px-1 font-semibold text-muted hover:bg-card"
                        >
                          {header}
                          {dir && (
                            <svg
                              viewBox="0 0 12 12"
                              width="10"
                              height="10"
                              aria-hidden
                              fill="currentColor"
                            >
                              <path d={dir === 'asc' ? 'M6 2l4 6H2z' : 'M6 10L2 4h8z'} />
                            </svg>
                          )}
                        </button>
                      ) : (
                        header
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
            {table.getRowModel().rows.map((row, i) => {
              const vi = items[i]!;
              return (
                <tr
                  key={vi.key}
                  aria-rowindex={vi.index + 2}
                  className="absolute flex w-full border-b border-line"
                  style={{ transform: `translateY(${vi.start}px)`, height: ROW_HEIGHT }}
                >
                  {row.getVisibleCells().map((cell, ci) => {
                    const col = sheet.columns[ci]!;
                    const hot = row.original.highlights.includes(col.key);
                    const v = row.original.cells?.[ci];
                    const text = v === undefined ? '' : formatCell(v, col.type, t);
                    return (
                      <td
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        title={text}
                        className={cx(
                          'flex shrink-0 items-center truncate px-2',
                          isNumericType(col.type) && 'justify-end text-right tabular-nums',
                          hot && 'bg-coral-tint font-bold text-coral-text',
                        )}
                      >
                        <span className="truncate">{text}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total !== null && (
        <p className="m-0 text-small text-muted" aria-live="polite">
          {t('result.showing', { count: total })}
        </p>
      )}
    </div>
  );
}
