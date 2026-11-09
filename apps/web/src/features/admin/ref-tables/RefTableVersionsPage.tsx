import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataTableColumn } from '../../../components/DataTable';
import { DatePicker } from '../../../components/DatePicker';
import { Dialog, DialogFooter } from '../../../components/Dialog';
import { Checkbox, FormField, Textarea } from '../../../components/FormField';
import { EyeIcon, PencilIcon } from '../../../components/icons';
import { PageHeader } from '../../../components/layout';
import type { MenuItem } from '../../../components/Menu';
import { RowActions, RowIcon, rowIconClass } from '../../../components/RowActions';
import { Select } from '../../../components/Select';
import { HeaderSkeleton, LoadingRegion, TableCardSkeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import {
  Button,
  buttonClass,
  Callout,
  Card,
  cardClass,
  CellText,
  Chip,
  cx,
} from '../../../components/ui';
import { todayIso } from '../../runner/as-of';
import { AdminConfirm, type ConfirmRequest } from '../AdminConfirm';
import {
  findGaps,
  findOverlap,
  isEffectiveOn,
  newGaps,
  openPreviousVersion,
  previousDay,
  simulatePublish,
  type Gap,
} from '../versions/version-ranges';
import { ImportDialog } from './ImportDialog';
import { diffRows, type RefRow, type RowDiff } from './model';
import {
  refErrorOf,
  refErrorText,
  type RefApiErrorKey,
  type RefTable,
  type RefVersionMeta,
} from './ref-tables-api';
import { RowDiffView } from './RowDiffView';
import { BackLink, formatDay, formatStamp, REF_STATUS_TONE, refPath, useRefApi } from './shared';

type T = ReturnType<typeof useTranslation>['t'];

function gapText(t: T, g: Gap): string {
  return g.to
    ? t('admin.versions.gap', { from: formatDay(g.from), to: formatDay(previousDay(g.to)) })
    : t('admin.versions.gapOpen', { from: formatDay(g.from) });
}

function rangeText(t: T, v: { effectiveFrom: string | null; effectiveTo: string | null }) {
  if (!v.effectiveFrom) return t('admin.versions.noRange');
  return v.effectiveTo
    ? t('admin.flows.rangeTo', { from: formatDay(v.effectiveFrom), to: formatDay(v.effectiveTo) })
    : t('admin.versions.rangeOpen', { from: formatDay(v.effectiveFrom) });
}

/** Rows of versions, fetched once per page (published rows never change). */
function useRowCache() {
  const api = useRefApi();
  const cache = useRef(new Map<string, Promise<RefRow[]>>());
  return useCallback(
    (id: string, fresh = false) => {
      let p = fresh ? undefined : cache.current.get(id);
      if (!p) {
        p = api.getRows(id);
        cache.current.set(id, p);
        p.catch(() => cache.current.delete(id));
      }
      return p;
    },
    [api],
  );
}

/** Versions of one table (spec §34 AC-RT-06): list, publish, retire, discard, rollback, diff. */
export function RefTableVersionsPage({ code }: { code: string }) {
  const { t } = useTranslation('refTables');
  const { t: tc } = useTranslation();
  const api = useRefApi();
  const toast = useToast();
  const navigate = useNavigate();
  const rowsOf = useRowCache();
  const [table, setTable] = useState<RefTable | null | undefined>(undefined);
  const [error, setError] = useState<RefApiErrorKey | null>(null);
  const [tick, setTick] = useState(0);
  const [publishing, setPublishing] = useState<RefVersionMeta | null>(null);
  const [ending, setEnding] = useState<RefVersionMeta | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [compare, setCompare] = useState<{ from: string; to: string } | null>(null);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    api.getTable(code).then(
      (r) => {
        if (!alive) return;
        setTable(r);
        setError(null);
      },
      (e: unknown) => alive && setError(refErrorOf(e)),
    );
    return () => {
      alive = false;
    };
  }, [api, code, tick]);

  const versions = useMemo(() => table?.versions ?? [], [table]);
  const today = todayIso();
  const current = versions.find((v) => isEffectiveOn(v, today));
  const draft = versions.find((v) => v.status === 'draft');
  const pair = useMemo(() => {
    if (
      compare &&
      versions.some((v) => v.id === compare.from) &&
      versions.some((v) => v.id === compare.to)
    )
      return compare;
    return versions.length >= 2 ? { from: versions[1]!.id, to: versions[0]!.id } : null;
  }, [compare, versions]);

  const ok = (message: string) => {
    toast.show({ tone: 'teal', message });
    reload();
  };
  const fail = (key: RefApiErrorKey) =>
    toast.show({ tone: 'coral', message: `${t('errorLabel')} ${t(refErrorText(key))}` });

  if (error) {
    return (
      <>
        <BackLink />
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
  if (table === undefined) {
    return (
      <LoadingRegion className="flex flex-col gap-6">
        <HeaderSkeleton />
        <TableCardSkeleton rows={3} columns={6} />
      </LoadingRegion>
    );
  }
  if (table === null) {
    return (
      <>
        <BackLink />
        <Callout tone="coral" label={t('errorLabel')} role="alert">
          {t('notFound', { code })}
        </Callout>
      </>
    );
  }
  const tbl = table;
  const gaps = findGaps(versions);
  const label = (action: string, v: RefVersionMeta) =>
    t('versions.actionFor', { action, version: v.versionNo });

  async function cloneFrom(v: RefVersionMeta) {
    if (draft) {
      toast.show({
        tone: 'coral',
        message: `${t('errorLabel')} ${t('versions.hasDraft', { version: draft.versionNo })}`,
      });
      return;
    }
    try {
      const r = await api.createDraftFrom(v.id);
      ok(t('versions.cloned', { version: r.versionNo, from: v.versionNo }));
    } catch (e) {
      const key = refErrorOf(e);
      if (key === 'duplicate') reload();
      fail(key === 'duplicate' ? 'draft_conflict' : key);
    }
  }

  const menu = (v: RefVersionMeta): MenuItem[] => {
    const item = (key: string, text: string, onSelect: () => void, danger = false): MenuItem => ({
      key,
      label: text,
      ariaLabel: label(text, v),
      onSelect,
      danger,
    });
    const items: MenuItem[] = [];
    if (v.status === 'draft')
      items.push(item('publish', t('versions.publish'), () => setPublishing(v)));
    if (versions.length > 1)
      items.push(
        item('compare', t('versions.compare'), () => {
          const older = versions.find((x) => x.versionNo < v.versionNo);
          const newer = [...versions].reverse().find((x) => x.versionNo > v.versionNo);
          if (older) setCompare({ from: older.id, to: v.id });
          else if (newer) setCompare({ from: v.id, to: newer.id });
          document.getElementById('ref-diff-title')?.scrollIntoView({ block: 'start' });
        }),
      );
    if (v.status !== 'draft')
      items.push(item('clone', t('versions.clone'), () => void cloneFrom(v)));
    if (v.status === 'published')
      items.push(item('editEnd', t('versions.editEnd'), () => setEnding(v)));
    if (v.status === 'published')
      items.push(
        item(
          'retire',
          t('versions.retire'),
          () =>
            setConfirm({
              title: t('versions.retireDialog.title', { version: v.versionNo }),
              body: t('versions.retireDialog.body', { range: rangeText(tc, v) }),
              action: t('versions.retire'),
              tone: 'danger',
              run: async () => {
                await api.retire(v.id);
                ok(t('versions.retired', { version: v.versionNo }));
              },
            }),
          true,
        ),
      );
    if (v.status === 'draft')
      items.push(
        item(
          'discard',
          t('versions.discard'),
          () =>
            setConfirm({
              title: t('versions.discardDialog.title', { version: v.versionNo }),
              body: t('versions.discardDialog.body'),
              action: t('versions.discardDialog.action'),
              tone: 'danger',
              run: async () => {
                await api.discard(v.id);
                ok(t('versions.discarded', { version: v.versionNo }));
              },
            }),
          true,
        ),
      );
    return items;
  };

  const columns: DataTableColumn<RefVersionMeta>[] = [
    {
      id: 'version',
      header: t('versions.col.version'),
      rowHeader: true,
      cell: (v) => `v${v.versionNo}`,
    },
    {
      id: 'status',
      header: t('versions.col.status'),
      cell: (v) => (
        <span className="flex gap-2">
          <Chip tone={REF_STATUS_TONE[v.status]}>{t(`status.${v.status}`)}</Chip>
          {current?.id === v.id && <Chip tone="teal">{t('versions.current')}</Chip>}
        </span>
      ),
    },
    { id: 'from', header: t('versions.col.from'), cell: (v) => formatDay(v.effectiveFrom) || '–' },
    { id: 'to', header: t('versions.col.to'), cell: (v) => formatDay(v.effectiveTo) || '–' },
    {
      id: 'rows',
      header: t('versions.col.rows'),
      align: 'right',
      cell: (v) => <span className="tabular-nums">{v.rowCount.toLocaleString('vi-VN')}</span>,
    },
    {
      id: 'note',
      header: t('versions.col.note'),
      cell: (v) => <CellText text={v.changeNote || '–'} />,
    },
    {
      id: 'updated',
      header: t('versions.col.updated'),
      cell: (v) => (
        <span className="text-caption text-muted">
          {t('versions.updatedBy', {
            user:
              (v.status === 'draft' ? v.updatedBy : (v.publishedBy ?? v.updatedBy)) ??
              t('unknownUser'),
            time: formatStamp(v.status === 'draft' ? v.updatedAt : (v.publishedAt ?? v.updatedAt)),
          })}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        back={<BackLink />}
        title={t('versions.title', { name: tbl.name })}
        oneLineTitle
        meta={<Chip tone="neutral">{tbl.code}</Chip>}
        subtitle={t('versions.subtitle')}
        actions={
          <>
            <Link
              to="/admin/ref-tables/$"
              params={refPath(tbl.code)}
              className={buttonClass('outline')}
            >
              {t('versions.columns')}
            </Link>
            <Button variant="primary" onClick={() => setImporting(true)}>
              {t('versions.import')}
            </Button>
          </>
        }
      />
      {gaps.map((g) => (
        <Callout key={`${g.from}-${g.to ?? ''}`} tone="amber" label={tc('admin.versions.gapLabel')}>
          {gapText(tc, g)}
        </Callout>
      ))}

      <section
        aria-label={t('versions.cardLabel')}
        data-card
        className={cx(cardClass, 'flex min-w-0 flex-col overflow-hidden')}
      >
        <DataTable
          caption={t('versions.caption')}
          columns={columns}
          rows={versions}
          rowKey={(v) => v.id}
          rowTone={(v) => (current?.id === v.id ? 'teal' : undefined)}
          empty={{ title: t('versions.emptyTitle'), text: t('versions.emptyText') }}
          actions={{
            header: t('versions.col.actions'),
            cell: (v) => (
              <RowActions
                rowName={`v${v.versionNo}`}
                visible={
                  <RowIcon
                    label={v.status === 'draft' ? t('versions.editData') : t('versions.viewData')}
                  >
                    <Link
                      to="/admin/ref-tables/$"
                      params={refPath(tbl.code, `versions/${v.versionNo}`)}
                      aria-label={label(
                        v.status === 'draft' ? t('versions.editData') : t('versions.viewData'),
                        v,
                      )}
                      className={cx(rowIconClass, 'hover:text-ink')}
                    >
                      {v.status === 'draft' ? <PencilIcon /> : <EyeIcon />}
                    </Link>
                  </RowIcon>
                }
                items={menu(v)}
              />
            ),
          }}
        />
      </section>

      <Card aria-labelledby="ref-diff-title" className="flex min-w-0 flex-col gap-4">
        <h2 id="ref-diff-title" className="m-0 text-title-md text-ink">
          {t('diff.title')}
        </h2>
        {pair ? (
          <DiffSection
            table={tbl}
            versions={versions}
            pair={pair}
            onChange={setCompare}
            rowsOf={rowsOf}
          />
        ) : (
          <p className="m-0 text-muted">{t('diff.needTwo')}</p>
        )}
      </Card>

      <Dialog
        open={publishing !== null}
        onClose={() => setPublishing(null)}
        title={
          publishing ? t('publish.title', { version: publishing.versionNo, code: tbl.code }) : ''
        }
      >
        {publishing && (
          <PublishForm
            table={tbl}
            draft={publishing}
            versions={versions}
            rowsOf={rowsOf}
            onDone={(no, from) => {
              setPublishing(null);
              ok(t('publish.done', { version: no, code: tbl.code, from: formatDay(from) }));
            }}
            onConflict={() => {
              setPublishing(null);
              reload();
              fail('draft_conflict');
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={ending ? tc('admin.versions.endDialog.title', { version: ending.versionNo }) : ''}
      >
        {ending && (
          <EndDateForm
            version={ending}
            versions={versions}
            onDone={() => {
              const no = ending.versionNo;
              setEnding(null);
              ok(t('versions.endChanged', { version: no }));
            }}
          />
        )}
      </Dialog>
      <ImportDialog
        open={importing}
        table={tbl}
        draft={draft ?? null}
        onClose={() => setImporting(false)}
        onDone={(no) => {
          setImporting(false);
          toast.show({ tone: 'teal', message: t('import.done', { version: no }) });
          void navigate({ to: '/admin/ref-tables/$', params: refPath(tbl.code, `versions/${no}`) });
        }}
      />
      <AdminConfirm confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function DiffSection({
  table,
  versions,
  pair,
  onChange,
  rowsOf,
}: {
  table: RefTable;
  versions: RefVersionMeta[];
  pair: { from: string; to: string };
  onChange: (p: { from: string; to: string }) => void;
  rowsOf: (id: string, fresh?: boolean) => Promise<RefRow[]>;
}) {
  const { t } = useTranslation('refTables');
  const fromId = useId();
  const toId = useId();
  const [diff, setDiff] = useState<
    { key: string; diff: RowDiff } | { key: string; error: true } | null
  >(null);
  const key = `${pair.from}/${pair.to}`;
  useEffect(() => {
    if (pair.from === pair.to) return;
    let alive = true;
    // A draft may have been saved since: never compare a cached draft.
    const fresh = (id: string) => versions.find((v) => v.id === id)?.status === 'draft';
    Promise.all([rowsOf(pair.from, fresh(pair.from)), rowsOf(pair.to, fresh(pair.to))]).then(
      ([a, b]) => alive && setDiff({ key, diff: diffRows(table.columns, a, b) }),
      () => alive && setDiff({ key, error: true }),
    );
    return () => {
      alive = false;
    };
  }, [key, pair.from, pair.to, rowsOf, table.columns, versions]);

  const options = versions.map((v) => ({
    value: v.id,
    label: `v${v.versionNo} - ${t(`status.${v.status}`)}`,
  }));
  const shown = diff && diff.key === key ? diff : null;
  return (
    <>
      <div className="flex flex-wrap gap-4">
        <FormField id={fromId} label={t('diff.from')}>
          {(f) => (
            <Select
              id={f.id}
              options={options}
              value={pair.from}
              onChange={(from) => onChange({ ...pair, from })}
            />
          )}
        </FormField>
        <FormField id={toId} label={t('diff.to')}>
          {(f) => (
            <Select
              id={f.id}
              options={options}
              value={pair.to}
              onChange={(to) => onChange({ ...pair, to })}
            />
          )}
        </FormField>
      </div>
      {pair.from === pair.to ? (
        <p className="m-0 text-muted">{t('diff.same')}</p>
      ) : !shown ? (
        <p role="status" className="m-0 text-muted">
          {t('diff.loading')}
        </p>
      ) : 'error' in shown ? (
        <Callout tone="coral" label={t('errorLabel')} role="alert">
          {t('diff.failed')}
        </Callout>
      ) : (
        <RowDiffView columns={table.columns} diff={shown.diff} />
      )}
    </>
  );
}

type PublishFieldError = 'fromRequired' | 'noteRequired' | 'range';

function PublishForm({
  table,
  draft,
  versions,
  rowsOf,
  onDone,
  onConflict,
}: {
  table: RefTable;
  draft: RefVersionMeta;
  versions: RefVersionMeta[];
  rowsOf: (id: string, fresh?: boolean) => Promise<RefRow[]>;
  onDone: (versionNo: number, from: string) => void;
  onConflict: () => void;
}) {
  const { t } = useTranslation('refTables');
  const { t: tc } = useTranslation();
  const api = useRefApi();
  const [from, setFrom] = useState(() => todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [closePrevious, setClosePrevious] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<PublishFieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ version: number; diff: RowDiff } | null>(null);
  const noteId = useId();

  const previous = from ? openPreviousVersion(versions, from) : undefined;
  const close = Boolean(previous) && closePrevious;
  const created =
    from && (!to || to > from)
      ? newGaps(versions, simulatePublish(versions, draft.id, from, to || null, close))
      : [];
  // What changes for the runs: against the version open before the start date, else the latest.
  const base = previous ?? versions.find((v) => v.status === 'published' && v.id !== draft.id);
  useEffect(() => {
    if (!base) return;
    let alive = true;
    Promise.all([rowsOf(base.id), rowsOf(draft.id, true)]).then(
      ([a, b]) =>
        alive && setSummary({ version: base.versionNo, diff: diffRows(table.columns, a, b) }),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [base, draft.id, rowsOf, table.columns]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: PublishFieldError[] = [];
    if (!from) errs.push('fromRequired');
    if (from && to && to <= from) errs.push('range');
    if (!note.trim()) errs.push('noteRequired');
    setFieldErrors(errs);
    setError(null);
    if (errs.length > 0 || busy) return;
    setBusy(true);
    try {
      const r = await api.publish({
        versionId: draft.id,
        effectiveFrom: from,
        effectiveTo: to || null,
        changeNote: note.trim(),
        closePrevious: close,
        expectedUpdatedAt: draft.updatedAt,
      });
      onDone(r.versionNo, from);
    } catch (err) {
      const key = refErrorOf(err);
      if (key === 'draft_conflict') {
        onConflict();
        return;
      }
      if (key === 'overlap') {
        const after = simulatePublish(versions, draft.id, from, to || null, close);
        const hit = findOverlap(after, from, to || null, draft.id);
        setError(
          hit
            ? tc('admin.versions.publishDialog.overlap', {
                version: hit.versionNo,
                range: rangeText(tc, hit),
              })
            : tc('admin.errors.overlap'),
        );
      } else if (key === 'invalid_rows' || key === 'key_blank' || key === 'duplicate_key') {
        setError(t('publish.rowsMismatch'));
      } else {
        setError(t(refErrorText(key)));
      }
    } finally {
      setBusy(false);
    }
  }

  const has = (k: PublishFieldError) => fieldErrors.includes(k);
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <FormField
          id="ref-publish-from"
          required
          label={
            <>
              {tc('admin.versions.publishDialog.from')}
              <span aria-hidden> *</span>
            </>
          }
          error={
            has('fromRequired') ? tc('admin.versions.publishDialog.errors.fromRequired') : undefined
          }
        >
          {(f) => (
            <DatePicker
              id={f.id}
              labelId={f.labelId}
              describedBy={f.describedBy}
              invalid={f.invalid}
              value={from}
              required
              onChange={setFrom}
            />
          )}
        </FormField>
        <FormField
          id="ref-publish-to"
          label={tc('admin.versions.publishDialog.to')}
          hint={tc('admin.versions.publishDialog.toHint')}
          error={has('range') ? tc('admin.versions.publishDialog.errors.range') : undefined}
        >
          {(f) => (
            <DatePicker
              id={f.id}
              labelId={f.labelId}
              describedBy={f.describedBy}
              invalid={f.invalid}
              value={to}
              onChange={setTo}
            />
          )}
        </FormField>
      </div>
      <FormField
        id={noteId}
        required
        label={
          <>
            {tc('admin.versions.publishDialog.note')}
            <span aria-hidden> *</span>
          </>
        }
        error={
          has('noteRequired') ? tc('admin.versions.publishDialog.errors.noteRequired') : undefined
        }
      >
        {(f) => (
          <Textarea
            {...f.input}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </FormField>
      {previous && (
        <Checkbox
          checked={closePrevious}
          onChange={(e) => setClosePrevious(e.target.checked)}
          label={tc('admin.versions.publishDialog.closePrevious', {
            version: previous.versionNo,
            date: formatDay(from),
          })}
        />
      )}
      {summary && (
        <Callout tone="blue" label={t('publish.summaryLabel')} role="status">
          {t('publish.summary', {
            version: summary.version,
            added: summary.diff.added.length,
            changed: summary.diff.changed.length,
            removed: summary.diff.removed.length,
          })}
        </Callout>
      )}
      {created.map((g) => (
        <Callout key={`${g.from}-${g.to ?? ''}`} tone="amber" label={tc('admin.versions.gapLabel')}>
          {gapText(tc, g)}
        </Callout>
      ))}
      {error && (
        <Callout tone="coral" label={t('errorLabel')} role="alert">
          {error}
        </Callout>
      )}
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy
            ? tc('admin.versions.publishDialog.submitting')
            : tc('admin.versions.publishDialog.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EndDateForm({
  version,
  versions,
  onDone,
}: {
  version: RefVersionMeta;
  versions: RefVersionMeta[];
  onDone: () => void;
}) {
  const { t } = useTranslation('refTables');
  const { t: tc } = useTranslation();
  const api = useRefApi();
  const [to, setTo] = useState(version.effectiveTo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = version.effectiveFrom ?? '';
  const next = versions.map((v) => (v.id === version.id ? { ...v, effectiveTo: to || null } : v));
  const created = to && to <= from ? [] : newGaps(versions, next);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (to && to <= from) {
      setError(tc('admin.versions.publishDialog.errors.range'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setEffectiveTo(version.id, to || null);
      onDone();
    } catch (err) {
      const key = refErrorOf(err);
      const hit = key === 'overlap' ? findOverlap(next, from, to || null, version.id) : undefined;
      setError(
        hit
          ? tc('admin.versions.publishDialog.overlap', {
              version: hit.versionNo,
              range: rangeText(tc, hit),
            })
          : t(refErrorText(key)),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-body text-ink-soft">{rangeText(tc, version)}</p>
      <FormField id="ref-end-to" label={tc('admin.versions.publishDialog.to')}>
        {(f) => <DatePicker id={f.id} labelId={f.labelId} value={to} onChange={setTo} />}
      </FormField>
      {created.map((g) => (
        <Callout key={`${g.from}-${g.to ?? ''}`} tone="amber" label={tc('admin.versions.gapLabel')}>
          {gapText(tc, g)}
        </Callout>
      ))}
      {error && (
        <Callout tone="coral" label={t('errorLabel')} role="alert">
          {error}
        </Callout>
      )}
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={busy}>
          {tc('admin.versions.endDialog.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
