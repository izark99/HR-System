import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { denseTdClass, denseThClass } from '../../../components/DataTable';
import { Dialog, DialogFooter } from '../../../components/Dialog';
import { TextInput } from '../../../components/FormField';
import { foldText } from '../../../components/select-logic';
import { LoadingRegion, TableSkeleton } from '../../../components/Skeleton';
import { Button, Callout, cx } from '../../../components/ui';
import type { RefColumnDef } from '../../../engine/core/types';
import { formatIsoDate, lastDay } from '../../../lib/format';

/** Rows shown per batch ("Hiện thêm", like the long Admin tables, AC-RT-15 d). */
export const REF_VIEW_BATCH = 100;

export interface RefTableView {
  name: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  columns: RefColumnDef[];
}

/** Text of a stored cell: dates dd/MM/yyyy, booleans TRUE/FALSE, the rest as stored. */
function cellText(v: unknown, type: RefColumnDef['type']): string {
  if (v === null || v === undefined) return '';
  if (type === 'date' && typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

const numeric = (type: RefColumnDef['type']) => type === 'integer' || type === 'decimal';

/**
 * "Xem bảng" (spec §34 AC-RT-15 d): the rows of the reference table version in use, read only —
 * no edit, no download. Search ignores accents and case; 100 rows per batch. The rows are the ones
 * already loaded for this run-page open (RAM only).
 */
export function RefTableDialog({
  table,
  loadRows,
  onClose,
}: {
  table: RefTableView | null;
  loadRows: () => Promise<unknown[]>;
  onClose: () => void;
}) {
  if (!table) return null;
  // A new table starts from a fresh state (search, batch, rows).
  return (
    <RefTableDialogOpen
      key={`${table.name}:${table.versionNo}`}
      table={table}
      loadRows={loadRows}
      onClose={onClose}
    />
  );
}

function RefTableDialogOpen({
  table,
  loadRows,
  onClose,
}: {
  table: RefTableView;
  loadRows: () => Promise<unknown[]>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<unknown[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(REF_VIEW_BATCH);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    loadRows().then(
      (r) => {
        if (alive) setRows(r);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [loadRows, attempt]);

  const columns = table.columns;
  const texts = useMemo(
    () =>
      (rows ?? []).map((r) => {
        const o = typeof r === 'object' && r !== null ? (r as Record<string, unknown>) : {};
        return columns.map((c) => cellText(o[c.key], c.type));
      }),
    [rows, columns],
  );
  const folded = useMemo(() => texts.map((cells) => foldText(cells.join(' '))), [texts]);
  const needle = foldText(query);
  const matches = useMemo(
    () => (needle ? texts.filter((_, i) => folded[i]!.includes(needle)) : texts),
    [texts, folded, needle],
  );
  const shown = matches.slice(0, limit);
  const rest = matches.length - shown.length;
  const retry = () => {
    setFailed(false);
    setRows(null);
    setAttempt((n) => n + 1);
  };
  const range = table.effectiveTo
    ? t('run.refs.dialog.rangeTo', {
        version: table.versionNo,
        from: formatIsoDate(table.effectiveFrom),
        to: lastDay(table.effectiveTo),
      })
    : t('run.refs.dialog.range', {
        version: table.versionNo,
        from: formatIsoDate(table.effectiveFrom),
      });

  return (
    <Dialog open onClose={onClose} title={table.name} wide>
      <p data-note className="-mt-3 m-0 text-caption text-muted">
        {range}
      </p>
      {failed ? (
        <Callout tone="coral" label={t('run.refs.dialog.errorLabel')} role="alert">
          {t('run.refs.dialog.error')}{' '}
          <Button size="sm" variant="text" onClick={retry}>
            {t('run.refs.retry')}
          </Button>
        </Callout>
      ) : rows === null ? (
        <LoadingRegion>
          <TableSkeleton columns={Math.max(1, columns.length)} />
        </LoadingRegion>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TextInput
              type="search"
              aria-label={t('run.refs.dialog.search')}
              placeholder={t('run.refs.dialog.placeholder')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(REF_VIEW_BATCH);
              }}
              className="max-w-70"
            />
            <span data-note className="text-caption text-muted" aria-live="polite">
              {t('run.refs.dialog.count', { shown: matches.length, total: texts.length })}
            </span>
          </div>
          {matches.length === 0 ? (
            <p data-note className="m-0 text-body text-muted">
              {t('run.refs.dialog.empty')}
            </p>
          ) : (
            <div
              role="region"
              tabIndex={0}
              aria-label={t('run.refs.dialog.tableLabel', { name: table.name })}
              className="max-h-[min(320px,45vh)] overflow-auto rounded-card border border-line"
            >
              <table className="w-full border-collapse text-ink-soft">
                <caption className="sr-only">{table.name}</caption>
                <thead className="sticky top-0 z-10">
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={cx(denseThClass, numeric(c.type) && 'text-right')}
                      >
                        {c.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((cells, i) => (
                    <tr key={i} className="bg-card">
                      {cells.map((text, k) => (
                        <td
                          key={columns[k]!.key}
                          className={cx(
                            denseTdClass,
                            numeric(columns[k]!.type) && 'text-right tabular-nums',
                          )}
                        >
                          {text}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rest > 0 && (
            <Button className="self-center" onClick={() => setLimit((n) => n + REF_VIEW_BATCH)}>
              {t('run.refs.dialog.more', { count: Math.min(REF_VIEW_BATCH, rest), rest })}
            </Button>
          )}
        </>
      )}
      <DialogFooter>
        <Button onClick={onClose}>{t('run.refs.dialog.close')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
