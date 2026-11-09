import { useBlocker } from '@tanstack/react-router';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogFooter } from '../../../components/Dialog';
import { FormField, TextInput } from '../../../components/FormField';
import { RedoIcon, UndoIcon } from '../../../components/icons';
import { PageHeader, Toolbar } from '../../../components/layout';
import { HeaderSkeleton, LoadingRegion, TableCardSkeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import { Button, Callout, cardClass, Chip, cx } from '../../../components/ui';
import { useUnsavedChanges } from '../../auth/idle/activity';
import { DataGrid, type GridHandlers } from './DataGrid';
import {
  addRows,
  editCells,
  gridProblems,
  gridRows,
  gridSummary,
  initGrid,
  paste,
  redo,
  toggleRemoved,
  undo,
  type GridState,
} from './grid-model';
import { ImportDialog } from './ImportDialog';
import { compactRow, fold, MAX_BYTES, MAX_ROWS, rowsBytes } from './model';
import {
  refErrorOf,
  refErrorText,
  type RefApiErrorKey,
  type RefTable,
  type RefVersionMeta,
} from './ref-tables-api';
import { BackLink, formatStamp, REF_STATUS_TONE, useRefApi } from './shared';

/** Rows drawn at once (like the UI text table, AC-TX-13); search runs over every row. */
const PAGE = 100;

interface Loaded {
  table: RefTable;
  version: RefVersionMeta;
  grid: GridState;
}

/** Data of one version (spec §34 AC-RT-04): editable grid for the draft, read-only otherwise. */
export function RefTableDataPage({ code, versionNo }: { code: string; versionNo: number }) {
  const { t } = useTranslation('refTables');
  const api = useRefApi();
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);
  const [error, setError] = useState<RefApiErrorKey | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const table = await api.getTable(code);
      const version = table?.versions.find((v) => v.versionNo === versionNo);
      if (!table || !version) return null;
      const rows = await api.getRows(version.id);
      return { table, version, grid: initGrid(table.columns, rows) };
    })().then(
      (r) => {
        if (!alive) return;
        setLoaded(r);
        setError(null);
      },
      (e: unknown) => alive && setError(refErrorOf(e)),
    );
    return () => {
      alive = false;
    };
  }, [api, code, versionNo, tick]);

  if (error) {
    return (
      <>
        <BackLink code={code} />
        <div className="flex flex-col items-start gap-3">
          <Callout tone="coral" label={t('errorLabel')} role="alert">
            {t(refErrorText(error))}
          </Callout>
          <Button size="sm" onClick={reload}>
            {t('retry')}
          </Button>
        </div>
      </>
    );
  }
  if (loaded === undefined) {
    return (
      <LoadingRegion className="flex flex-col gap-6">
        <HeaderSkeleton />
        <TableCardSkeleton rows={6} columns={4} />
      </LoadingRegion>
    );
  }
  if (loaded === null) {
    return (
      <>
        <BackLink code={code} />
        <Callout tone="coral" label={t('errorLabel')} role="alert">
          {t('data.notFound', { code, version: versionNo })}
        </Callout>
      </>
    );
  }
  return (
    <DataEditor
      key={`${loaded.version.id}:${loaded.version.updatedAt}`}
      {...loaded}
      onReload={reload}
    />
  );
}

function DataEditor({
  table,
  version,
  grid: initial,
  onReload,
}: Loaded & { onReload: () => void }) {
  const { t } = useTranslation('refTables');
  const api = useRefApi();
  const toast = useToast();
  const columns = table.columns;
  const width = columns.length;
  const readOnly = version.status !== 'draft';
  const [grid, setGrid] = useState(initial);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [importing, setImporting] = useState(false);
  const [problemNote, setProblemNote] = useState<number | null>(null);
  /** Cell to focus after the next render (new row, first problem). */
  const pendingFocus = useRef<{ row: number; col: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const problems = useMemo(() => gridProblems(grid, columns), [grid, columns]);
  const summary = useMemo(() => gridSummary(grid), [grid]);
  const dirty = !readOnly && summary.dirty;
  useUnsavedChanges(dirty);
  const leaving = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const deferred = useDeferredValue(query);
  const matches = useMemo(() => {
    const q = fold(deferred);
    const out: number[] = [];
    grid.rows.forEach((r, i) => {
      if (!q || r.cells.some((c) => fold(c).includes(q))) out.push(i);
    });
    return out;
  }, [grid.rows, deferred]);
  const [filterKey, setFilterKey] = useState(deferred);
  if (filterKey !== deferred) {
    setFilterKey(deferred);
    setLimit(PAGE);
  }
  const visible = useMemo(() => matches.slice(0, limit), [matches, limit]);
  const more = Math.min(PAGE, matches.length - visible.length);

  useEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    const pos = visible.indexOf(f.row);
    if (pos < 0) return;
    pendingFocus.current = null;
    const el = gridRef.current?.querySelector<HTMLInputElement>(
      `[data-pos="${pos}"][data-col="${f.col}"]`,
    );
    el?.focus();
  });

  const latest = useRef({ matches, limit });
  useEffect(() => {
    latest.current = { matches, limit };
  });
  const handlers = useMemo<GridHandlers>(
    () => ({
      commit: (row, col, value) => setGrid((g) => editCells(g, [{ row, col, value }], width)),
      paste: (pos, col, text) => {
        const targets = latest.current.matches.slice(pos);
        setGrid((g) => {
          const r = paste(g, targets, col, text, width);
          const end = pos + r.rows;
          if (end > latest.current.limit) setLimit(end);
          return r.state;
        });
      },
      toggle: (row) => setGrid((g) => toggleRemoved(g, row, width)),
      undo: () => setGrid((g) => undo(g, width)),
      redo: () => setGrid((g) => redo(g, width)),
    }),
    [width],
  );

  function addRow() {
    setQuery('');
    setFilterKey('');
    const row = grid.rows.length;
    setGrid((g) => addRows(g, 1, width));
    setLimit(Math.max(PAGE, row + 1));
    pendingFocus.current = { row, col: 0 };
  }

  /** Bring a cell into the drawn rows and focus it. */
  function reveal(key: string) {
    const [row, col] = key.split(':').map(Number) as [number, number];
    setQuery('');
    setFilterKey('');
    setLimit(Math.max(PAGE, row + 1));
    pendingFocus.current = { row, col };
  }

  async function save() {
    if (busy || readOnly) return;
    if (problems.size > 0) {
      setProblemNote(problems.size);
      reveal(problems.keys().next().value!);
      return;
    }
    setProblemNote(null);
    const rows = gridRows(grid, columns);
    if (!rows) return;
    const stored = rows.map((r) => compactRow(r, columns));
    if (stored.length > MAX_ROWS) {
      toast.show({
        tone: 'coral',
        message: t('data.tooManyRows', { count: stored.length, max: MAX_ROWS }),
      });
      return;
    }
    const bytes = rowsBytes(stored);
    if (bytes > MAX_BYTES) {
      toast.show({
        tone: 'coral',
        message: t('data.tooLarge', {
          mb: (bytes / 1024 / 1024).toFixed(1),
          max: MAX_BYTES / 1024 / 1024,
        }),
      });
      return;
    }
    setBusy(true);
    try {
      await api.replaceDraft(table.id, stored, version.updatedAt);
      leaving.current = true;
      toast.show({ tone: 'teal', message: t('data.saved', { version: version.versionNo }) });
      onReload();
    } catch (e) {
      const key = refErrorOf(e);
      if (key === 'draft_conflict') setConflict(true);
      else toast.show({ tone: 'coral', message: `${t('errorLabel')} ${t(refErrorText(key))}` });
      setBusy(false);
    }
  }

  // Ctrl+Z / Ctrl+Y anywhere in the card outside a cell (the cells handle their own keys).
  function onCardKey(e: KeyboardEvent<HTMLElement>) {
    if (readOnly || (e.target as HTMLElement).closest('input, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (!mod || (key !== 'z' && key !== 'y')) return;
    e.preventDefault();
    if (key === 'y' || e.shiftKey) handlers.redo();
    else handlers.undo();
  }

  const base = readOnly
    ? t('data.countReadOnly', { count: grid.rows.length })
    : summary.dirty
      ? t('data.dirty', { edited: summary.edited, added: summary.added, removed: summary.removed })
      : t('data.clean', { count: grid.rows.length, time: formatStamp(version.updatedAt) });
  const status =
    !readOnly && problems.size > 0
      ? `${base} · ${t('data.problemCount', { count: problems.size })}`
      : base;

  return (
    <>
      <PageHeader
        back={<BackLink code={table.code} />}
        title={t('data.title', { version: version.versionNo, name: table.name })}
        oneLineTitle
        meta={<Chip tone={REF_STATUS_TONE[version.status]}>{t(`status.${version.status}`)}</Chip>}
        subtitle={readOnly ? t('data.subtitleReadOnly') : t('data.subtitle')}
        actions={
          readOnly ? undefined : (
            <>
              <Button onClick={() => setImporting(true)}>{t('data.import')}</Button>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>
                {busy ? t('saving') : t('data.save')}
              </Button>
            </>
          )
        }
      />
      {problemNote !== null && problems.size > 0 && (
        <Callout tone="coral" label={t('data.problemsLabel')} role="alert">
          {t('data.problems', { count: problems.size })}
        </Callout>
      )}
      {columns.length === 0 && (
        <Callout tone="amber" label={t('data.noColumnsLabel')}>
          {t('data.noColumns')}
        </Callout>
      )}

      <section
        aria-label={t('data.cardLabel')}
        data-card
        onKeyDown={onCardKey}
        className={cx(cardClass, 'flex min-w-0 flex-col overflow-hidden')}
      >
        <Toolbar
          className="items-end"
          end={
            <span
              aria-live="polite"
              data-grid-status
              className="flex h-control items-center text-caption whitespace-nowrap text-muted tabular-nums"
            >
              {deferred
                ? t('data.matches', { shown: matches.length, total: grid.rows.length })
                : status}
            </span>
          }
        >
          <FormField id="ref-data-search" label={t('data.search')} className="w-64 max-w-full">
            {(f) => (
              <TextInput
                {...f.input}
                type="search"
                autoComplete="off"
                value={query}
                placeholder={t('data.searchPlaceholder')}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
          </FormField>
          {!readOnly && (
            <div className="flex items-center gap-3 self-end">
              <Button onClick={addRow}>{t('data.addRow')}</Button>
              <Tooltip text={t('data.undo')} className="inline-flex">
                <Button
                  aria-label={t('data.undo')}
                  aria-keyshortcuts="Control+Z"
                  className="w-control px-0!"
                  disabled={grid.past.length === 0}
                  onClick={handlers.undo}
                >
                  <UndoIcon />
                </Button>
              </Tooltip>
              <Tooltip text={t('data.redo')} className="inline-flex">
                <Button
                  aria-label={t('data.redo')}
                  aria-keyshortcuts="Control+Y"
                  className="w-control px-0!"
                  disabled={grid.future.length === 0}
                  onClick={handlers.redo}
                >
                  <RedoIcon />
                </Button>
              </Tooltip>
            </div>
          )}
        </Toolbar>
        {grid.rows.length === 0 ? (
          <p className="m-0 p-6 text-body text-muted">
            {readOnly ? t('data.emptyReadOnly') : t('data.empty')}
          </p>
        ) : matches.length === 0 ? (
          <p className="m-0 p-6 text-body text-muted">{t('data.noMatch')}</p>
        ) : (
          <div ref={gridRef}>
            <DataGrid
              columns={columns}
              rows={grid.rows}
              visible={visible}
              problems={problems}
              readOnly={readOnly}
              handlers={handlers}
              label={t('data.gridLabel', { version: version.versionNo })}
            />
          </div>
        )}
        {more > 0 && (
          <div className="flex items-center justify-center border-t border-line p-4">
            <Button onClick={() => setLimit((n) => n + PAGE)}>
              {t('data.showMore', { count: more, left: matches.length - visible.length })}
            </Button>
          </div>
        )}
      </section>

      {!readOnly && (
        <ImportDialog
          open={importing}
          table={table}
          draft={version}
          gridDirty={dirty}
          onClose={() => setImporting(false)}
          onDone={(no) => {
            setImporting(false);
            leaving.current = true;
            toast.show({ tone: 'teal', message: t('import.done', { version: no }) });
            onReload();
          }}
        />
      )}
      <Dialog open={conflict} onClose={() => setConflict(false)} title={t('conflict.title')}>
        <p className="m-0 text-body text-ink-soft">{t('conflict.draftText')}</p>
        <DialogFooter>
          <Button variant="text" onClick={() => setConflict(false)}>
            {t('conflict.stay')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setConflict(false);
              leaving.current = true;
              onReload();
            }}
          >
            {t('conflict.reload')}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={blocker.status === 'blocked'}
        onClose={() => blocker.reset?.()}
        title={t('leave.title')}
      >
        <p className="m-0 text-body text-ink-soft">{t('leave.text')}</p>
        <DialogFooter>
          <Button onClick={() => blocker.reset?.()}>{t('leave.stay')}</Button>
          <Button variant="primary" onClick={() => blocker.proceed?.()}>
            {t('leave.leave')}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
