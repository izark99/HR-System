import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '../../../components/ui';
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
export function ResultTable({
  sheet,
  filters,
  label,
}: {
  sheet: SheetInfo;
  filters: RowFilter[];
  label: string;
}) {
  const { t } = useTranslation();
  const store = useRunStore();
  const [total, setTotal] = useState<number | null>(null);
  const [pages, setPages] = useState<ReadonlyMap<number, RowPage>>(new Map());
  const requested = useRef(new Set<number>());
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
    const wanted: number[] = [];
    if (total === null) wanted.push(0);
    else for (let p = firstPage; p <= lastPage; p++) wanted.push(p);
    for (const p of wanted) {
      if (requested.current.has(p)) continue;
      requested.current.add(p);
      void store
        .getRows(sheet.id, { offset: p * PAGE_SIZE, limit: PAGE_SIZE, filters })
        .then((page) => {
          if (!mounted.current) return;
          setTotal(page.total);
          setPages((prev) => new Map(prev).set(p, page));
        });
    }
  }, [store, sheet.id, filters, total, firstPage, lastPage]);

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

  if (total === 0) {
    return <p className="m-0 px-5 pb-5 text-label text-muted">{t('result.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-2 px-5 pb-5">
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
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      style={{ width: h.getSize() }}
                      className={cx(
                        'flex shrink-0 items-center px-2 py-2.5 font-semibold text-muted',
                        isNumericType(col.type) ? 'justify-end text-right' : 'text-left',
                      )}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
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
