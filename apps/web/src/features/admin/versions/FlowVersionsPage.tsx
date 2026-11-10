import { Link, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { flowRefTables } from '@hrflow/flow-schema/ref-tables';
import type { RefTableDef } from '../../../engine/core/types';
import { getSupabase } from '../../../lib/supabase';
import { loadRefCatalog, refDefinitions } from '../../runner/ref-source';
import { DatePicker } from '../../../components/DatePicker';
import type { MenuItem } from '../../../components/Menu';
import { DataTable, type DataTableColumn } from '../../../components/DataTable';
import { Dialog, DialogFooter } from '../../../components/Dialog';
import { Checkbox, FormField, Textarea } from '../../../components/FormField';
import { PageHeader, Toolbar } from '../../../components/layout';
import { RowActions, RowIcon, rowIconClass } from '../../../components/RowActions';
import { Select } from '../../../components/Select';
import { useToast } from '../../../components/Toast';
import {
  Button,
  Callout,
  Card,
  cardClass,
  CellText,
  Chip,
  cx,
  type Tone,
} from '../../../components/ui';
import type { Json, VersionStatus } from '../../../lib/database.types';
import { saveFile } from '../../../lib/download';
import { todayIso } from '../../runner/as-of';
import { EngineClient } from '../../runner/engine-client';
import {
  AdminApiError,
  errorKeyOf,
  type AdminErrorKey,
  type AdminVersionDetail,
  type FlowVersions,
} from '../admin-api';
import { AdminConfirm, type ConfirmRequest } from '../AdminConfirm';
import { useAdminApi } from '../use-admin';
import { DiffView } from './DiffView';
import {
  findGaps,
  findOverlap,
  isEffectiveOn,
  newGaps,
  openPreviousVersion,
  previousDay,
  publishedRanges,
  simulatePublish,
  type Gap,
} from './version-ranges';
import { HeaderSkeleton, LoadingRegion, TableCardSkeleton } from '../../../components/Skeleton';
import { ArrowLeftIcon, EyeIcon, PencilIcon } from '../../../components/icons';

/** Status chips (spec §14.4): Draft = blue, Published = teal, Retired = neutral grey. */
export const VERSION_STATUS_TONE: Record<VersionStatus, Tone> = {
  draft: 'blue',
  published: 'teal',
  retired: 'neutral',
};

/** YYYY-MM-DD → dd/MM/yyyy. */
export function formatDay(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type T = ReturnType<typeof useTranslation>['t'];

function rangeText(t: T, from: string | null, to: string | null): string {
  if (!from) return t('admin.versions.noRange');
  return to
    ? t('admin.flows.rangeTo', { from: formatDay(from), to: formatDay(to) })
    : t('admin.versions.rangeOpen', { from: formatDay(from) });
}

function gapText(t: T, g: Gap): string {
  return g.to
    ? t('admin.versions.gap', { from: formatDay(g.from), to: formatDay(previousDay(g.to)) })
    : t('admin.versions.gapOpen', { from: formatDay(g.from) });
}

type DialogState =
  | { kind: 'publish'; version: AdminVersionDetail }
  | { kind: 'end'; version: AdminVersionDetail }
  | null;

/**
 * Engine check before publishing (spec §14.4): the structural load used by the run page plus the
 * full design check (`planFlow` + `checkConfig` + `inferSchema`), errors listed per node.
 */
async function checkDefinition(definition: Json): Promise<string[] | null> {
  const engine = new EngineClient();
  try {
    // Reference tables used by the flow (spec §34): their definitions take part in the check.
    let refs: Record<string, RefTableDef> | undefined;
    if (flowRefTables(definition).length > 0) {
      refs = await loadRefCatalog(getSupabase()).then(refDefinitions, () => undefined);
    }
    const design = await engine.api.checkDesign(definition, refs);
    const errors = design.issues.filter((i) => i.severity === 'error').map((i) => i.text);
    if (errors.length > 0) return errors;
    const result = await engine.api.loadFlow(definition);
    return result.ok ? [] : result.problems;
  } catch {
    return null;
  } finally {
    engine.dispose();
  }
}

export function FlowVersionsPage() {
  const { t } = useTranslation();
  const api = useAdminApi();
  const { flowCode } = useParams({ from: '/admin/flows/$flowCode/versions' });
  const [data, setData] = useState<FlowVersions | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<AdminErrorKey | null>(null);
  const [tick, setTick] = useState(0);
  const toast = useToast();
  // One result message at a time (as the former callout): a new one replaces the last toast.
  const lastToast = useRef<number | null>(null);
  const setMessage = useCallback(
    (m: { tone: 'teal' | 'coral'; label: string; text: string } | null) => {
      if (lastToast.current !== null) toast.dismiss(lastToast.current);
      lastToast.current = m ? toast.show({ tone: m.tone, message: `${m.label} ${m.text}` }) : null;
    },
    [toast],
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [compare, setCompare] = useState<{ from: string; to: string } | null>(null);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    api.getFlowVersions(flowCode).then(
      (d) => {
        if (!alive) return;
        setData(d);
        setLoadError(null);
      },
      (e: unknown) => alive && setLoadError(errorKeyOf(e)),
    );
    return () => {
      alive = false;
    };
  }, [api, flowCode, tick]);

  const versions = useMemo(() => data?.versions ?? [], [data]);
  const today = todayIso();
  const current = versions.find((v) => isEffectiveOn(v, today));
  const draft = versions.find((v) => v.status === 'draft');

  // Default comparison: newest vs the one before it.
  const effectiveCompare = useMemo(() => {
    if (
      compare &&
      versions.some((v) => v.id === compare.from) &&
      versions.some((v) => v.id === compare.to)
    ) {
      return compare;
    }
    return versions.length >= 2 ? { from: versions[1]!.id, to: versions[0]!.id } : null;
  }, [compare, versions]);

  function done(text: string) {
    setDialog(null);
    setMessage({ tone: 'teal', label: t('admin.versions.doneLabel'), text });
    reload();
  }

  function fail(text: string) {
    setMessage({ tone: 'coral', label: t('admin.errorLabel'), text });
  }

  async function cloneFrom(v: AdminVersionDetail) {
    setMessage(null);
    if (draft) {
      fail(t('admin.versions.hasDraft', { version: draft.versionNo }));
      return;
    }
    try {
      const r = await api.createDraftFromVersion(v.id);
      done(t('admin.versions.cloned', { version: r.versionNo, from: v.versionNo }));
    } catch (e) {
      if (e instanceof AdminApiError && e.key === 'duplicate') {
        // Another Admin created a draft meanwhile: show it, never overwrite it.
        reload();
        fail(t('admin.versions.hasDraftUnknown'));
      } else {
        fail(t(`admin.errors.${errorKeyOf(e)}`));
      }
    }
  }

  function exportJson(v: AdminVersionDetail) {
    const text = JSON.stringify(v.definition, null, 2);
    saveFile({
      fileName: `${flowCode}_v${v.versionNo}.json`,
      mimeType: 'application/json',
      data: new TextEncoder().encode(text).buffer,
    });
  }

  function compareWithPrevious(v: AdminVersionDetail) {
    const older = versions.filter((x) => x.versionNo < v.versionNo)[0];
    const newer = versions.filter((x) => x.versionNo > v.versionNo).at(-1);
    if (older) setCompare({ from: older.id, to: v.id });
    else if (newer) setCompare({ from: v.id, to: newer.id });
    document.getElementById('diff-title')?.scrollIntoView({ block: 'start' });
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
          {t(`admin.errors.${loadError}`)}
        </Callout>
        <Button size="sm" onClick={reload}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (data === undefined) {
    return (
      <LoadingRegion className="flex flex-col gap-6">
        <HeaderSkeleton />
        <TableCardSkeleton rows={3} columns={5} />
      </LoadingRegion>
    );
  }
  if (data === null) {
    return (
      <>
        <BackLink />
        <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
          {t('admin.versions.notFound')}
        </Callout>
      </>
    );
  }

  const gaps = findGaps(versions);
  const action = (label: string, v: AdminVersionDetail) =>
    t('admin.versions.actionFor', { action: label, version: v.versionNo });

  function askRetire(v: AdminVersionDetail) {
    setConfirm({
      title: t('admin.versions.retireDialog.title', { version: v.versionNo }),
      body: t('admin.versions.retireDialog.body', {
        range: rangeText(t, v.effectiveFrom, v.effectiveTo),
      }),
      action: t('admin.versions.retire'),
      tone: 'danger',
      run: async () => {
        await api.retireVersion(v.id);
        done(t('admin.versions.retired', { version: v.versionNo }));
      },
    });
  }

  function askDiscard(v: AdminVersionDetail) {
    setConfirm({
      title: t('admin.versions.discardDialog.title', { version: v.versionNo }),
      body: t('admin.versions.discardDialog.body'),
      action: t('admin.versions.discardDialog.action'),
      tone: 'danger',
      run: async () => {
        await api.discardDraft(v.id);
        done(t('admin.versions.discarded', { version: v.versionNo }));
      },
    });
  }

  const columns: DataTableColumn<AdminVersionDetail>[] = [
    {
      id: 'version',
      header: t('admin.versions.col.version'),
      rowHeader: true,
      cell: (v) => `v${v.versionNo}`,
    },
    {
      id: 'status',
      header: t('admin.versions.col.status'),
      cell: (v) => (
        <span className="flex gap-2">
          <Chip tone={VERSION_STATUS_TONE[v.status]}>{t(`admin.flows.status.${v.status}`)}</Chip>
          {current?.id === v.id && <Chip tone="teal">{t('admin.versions.current')}</Chip>}
        </span>
      ),
    },
    {
      id: 'range',
      header: t('admin.versions.col.range'),
      cell: (v) => <CellText text={rangeText(t, v.effectiveFrom, v.effectiveTo)} />,
    },
    {
      id: 'note',
      header: t('admin.versions.col.note'),
      cell: (v) => <CellText text={v.changeNote || '-'} />,
    },
    {
      id: 'published',
      header: t('admin.versions.col.published'),
      cell: (v) => (
        <CellText
          className="text-caption"
          text={
            v.publishedAt
              ? v.publishedBy
                ? t('admin.versions.publishedBy', {
                    user: v.publishedBy,
                    time: formatDateTime(v.publishedAt),
                  })
                : formatDateTime(v.publishedAt)
              : '-'
          }
        />
      ),
    },
  ];

  /** Row menu (AC-UI-54): everything but the visible buttons; destructive items last. */
  const versionMenu = (v: AdminVersionDetail): MenuItem[] => {
    const item = (key: string, label: string, onSelect: () => void, danger = false): MenuItem => ({
      key,
      label,
      ariaLabel: action(label, v),
      onSelect,
      danger,
    });
    const items: MenuItem[] = [];
    if (v.status === 'draft') {
      items.push(
        item('publish', t('admin.versions.publish'), () => {
          setMessage(null);
          setDialog({ kind: 'publish', version: v });
        }),
      );
    }
    if (v.status !== 'draft') {
      items.push(item('clone', t('admin.versions.clone'), () => void cloneFrom(v)));
    }
    if (v.status === 'published') {
      items.push(
        item('editEnd', t('admin.versions.editEnd'), () => setDialog({ kind: 'end', version: v })),
      );
    }
    if (versions.length > 1) {
      items.push(item('compare', t('admin.versions.compare'), () => compareWithPrevious(v)));
    }
    if (v.status !== 'draft') {
      items.push(item('export', t('admin.versions.export'), () => exportJson(v)));
    }
    if (v.status === 'published') {
      items.push(item('retire', t('admin.versions.retire'), () => askRetire(v), true));
    }
    if (v.status === 'draft') {
      items.push(item('discard', t('admin.versions.discard'), () => askDiscard(v), true));
    }
    return items;
  };

  return (
    <>
      <PageHeader
        back={<BackLink />}
        title={
          current
            ? t('admin.versions.titleActive', { name: data.flow.name, version: current.versionNo })
            : t('admin.versions.titleNone', { name: data.flow.name })
        }
        oneLineTitle
        subtitle={t('admin.versions.subtitle')}
      />

      <Timeline versions={versions} gaps={gaps} today={today} />

      <section
        aria-labelledby="versions-title"
        data-card
        className={cx(cardClass, 'flex min-w-0 flex-col overflow-hidden')}
      >
        <Toolbar>
          <h2 id="versions-title" className="m-0 text-title-sm font-semibold text-ink">
            {t('admin.versions.listTitle', { count: versions.length })}
          </h2>
        </Toolbar>
        <DataTable
          caption={t('admin.versions.caption')}
          columns={columns}
          rows={versions}
          rowKey={(v) => v.id}
          rowTone={(v) => (current?.id === v.id ? 'teal' : undefined)}
          empty={{ title: t('admin.versions.emptyTitle'), text: t('admin.versions.emptyText') }}
          actions={{
            header: t('admin.versions.col.actions'),
            cell: (v) => (
              <RowActions
                rowName={`v${v.versionNo}`}
                visible={
                  v.status === 'draft' ? (
                    <RowIcon label={t('admin.versions.openDesigner')}>
                      <Link
                        to="/admin/flows/$flowCode/designer"
                        params={{ flowCode }}
                        search={{}}
                        aria-label={action(t('admin.versions.openDesigner'), v)}
                        className={cx(rowIconClass, 'hover:text-ink')}
                      >
                        <PencilIcon />
                      </Link>
                    </RowIcon>
                  ) : (
                    <RowIcon label={t('admin.versions.viewInDesigner')}>
                      <Link
                        to="/admin/flows/$flowCode/designer"
                        params={{ flowCode }}
                        search={{ version: v.id }}
                        aria-label={action(t('admin.versions.viewInDesigner'), v)}
                        className={cx(rowIconClass, 'hover:text-ink')}
                      >
                        <EyeIcon />
                      </Link>
                    </RowIcon>
                  )
                }
                items={versionMenu(v)}
              />
            ),
          }}
        />
      </section>

      <Card aria-labelledby="diff-title" className="flex flex-col gap-4">
        <h2 id="diff-title" className="m-0 text-title-md text-ink">
          {t('admin.versions.diff.title')}
        </h2>
        {effectiveCompare ? (
          <>
            <ComparePickers
              versions={versions}
              value={effectiveCompare}
              onChange={(v) => setCompare(v)}
            />
            {effectiveCompare.from === effectiveCompare.to ? (
              <p className="m-0 text-muted">{t('admin.versions.diff.sameVersion')}</p>
            ) : (
              <DiffView
                before={versions.find((v) => v.id === effectiveCompare.from)!}
                after={versions.find((v) => v.id === effectiveCompare.to)!}
              />
            )}
          </>
        ) : (
          <p className="m-0 text-muted">{t('admin.versions.diff.needTwo')}</p>
        )}
      </Card>

      <Dialog
        open={dialog?.kind === 'publish'}
        onClose={() => setDialog(null)}
        title={
          dialog
            ? t('admin.versions.publishDialog.title', { version: dialog.version.versionNo })
            : ''
        }
      >
        {dialog?.kind === 'publish' && (
          <PublishForm
            draft={dialog.version}
            versions={versions}
            onDone={(no) => done(t('admin.versions.published', { version: no }))}
            onConflict={() => {
              setDialog(null);
              reload();
              fail(t('admin.errors.draft_conflict'));
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={dialog?.kind === 'end'}
        onClose={() => setDialog(null)}
        title={
          dialog ? t('admin.versions.endDialog.title', { version: dialog.version.versionNo }) : ''
        }
      >
        {dialog?.kind === 'end' && (
          <EndDateForm
            version={dialog.version}
            versions={versions}
            onDone={() =>
              done(t('admin.versions.endChanged', { version: dialog.version.versionNo }))
            }
          />
        )}
      </Dialog>

      <AdminConfirm confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/admin/flows"
      className="inline-flex min-h-target items-center gap-2 self-start text-label text-teal-strong"
    >
      <ArrowLeftIcon />
      {t('admin.versions.back')}
    </Link>
  );
}

/** Published ranges on one line (oldest first) and the gap warnings (spec §14.4). */
function Timeline({
  versions,
  gaps,
  today,
}: {
  versions: AdminVersionDetail[];
  gaps: Gap[];
  today: string;
}) {
  const { t } = useTranslation();
  const ranges = publishedRanges(versions);
  return (
    <Card aria-labelledby="timeline-title" className="flex flex-col gap-4">
      <h2 id="timeline-title" className="m-0 text-title-md text-ink">
        {t('admin.versions.timeline.title')}
      </h2>
      {ranges.length === 0 ? (
        <p className="m-0 text-muted">{t('admin.versions.timeline.empty')}</p>
      ) : (
        <ol
          className="m-0 flex list-none flex-wrap gap-2 p-0"
          aria-label={t('admin.versions.timeline.title')}
        >
          {ranges.map((v) => (
            <li
              key={v.id}
              className={cx(
                'flex min-w-45 flex-1 flex-col gap-1 rounded-card border border-t-4 border-line bg-card px-4 py-3',
                isEffectiveOn(v, today) ? 'border-t-teal' : 'border-t-line-input',
              )}
            >
              <span className="font-semibold text-ink">v{v.versionNo}</span>
              <span className="text-caption text-ink-soft">
                {rangeText(t, v.effectiveFrom, v.effectiveTo)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {gaps.map((g) => (
        <Callout key={`${g.from}-${g.to ?? ''}`} tone="amber" label={t('admin.versions.gapLabel')}>
          {gapText(t, g)}
        </Callout>
      ))}
    </Card>
  );
}

function ComparePickers({
  versions,
  value,
  onChange,
}: {
  versions: AdminVersionDetail[];
  value: { from: string; to: string };
  onChange: (v: { from: string; to: string }) => void;
}) {
  const { t } = useTranslation();
  const fromId = useId();
  const toId = useId();
  const options = versions.map((v) => ({
    value: v.id,
    label: `v${v.versionNo} - ${t(`admin.flows.status.${v.status}`)}`,
  }));
  return (
    <div className="flex flex-wrap gap-4">
      <FormField id={fromId} label={t('admin.versions.diff.from')}>
        {(f) => (
          <Select
            id={f.id}
            options={options}
            value={value.from}
            onChange={(from) => onChange({ ...value, from })}
          />
        )}
      </FormField>
      <FormField id={toId} label={t('admin.versions.diff.to')}>
        {(f) => (
          <Select
            id={f.id}
            options={options}
            value={value.to}
            onChange={(to) => onChange({ ...value, to })}
          />
        )}
      </FormField>
    </div>
  );
}

type PublishFieldError = 'fromRequired' | 'noteRequired' | 'range';

function PublishForm({
  draft,
  versions,
  onDone,
  onConflict,
}: {
  draft: AdminVersionDetail;
  versions: AdminVersionDetail[];
  onDone: (versionNo: number) => void;
  onConflict: () => void;
}) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [problems, setProblems] = useState<string[] | null | undefined>(undefined);
  const [from, setFrom] = useState(() => todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [closePrevious, setClosePrevious] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<PublishFieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();

  useEffect(() => {
    let alive = true;
    void checkDefinition(draft.definition).then((p) => alive && setProblems(p));
    return () => {
      alive = false;
    };
  }, [draft.definition]);

  const previous = from ? openPreviousVersion(versions, from) : undefined;
  const close = Boolean(previous) && closePrevious;
  const created =
    from && (!to || to > from)
      ? newGaps(versions, simulatePublish(versions, draft.id, from, to || null, close))
      : [];

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
      const r = await api.publishDraft({
        versionId: draft.id,
        effectiveFrom: from,
        effectiveTo: to || null,
        changeNote: note.trim(),
        closePrevious: close,
        expectedUpdatedAt: draft.updatedAt,
      });
      onDone(r.versionNo);
    } catch (err) {
      const key = errorKeyOf(err);
      if (key === 'draft_conflict') {
        onConflict();
        return;
      }
      if (key === 'overlap') {
        const after = simulatePublish(versions, draft.id, from, to || null, close);
        const hit = findOverlap(after, from, to || null, draft.id);
        setError(
          hit
            ? t('admin.versions.publishDialog.overlap', {
                version: hit.versionNo,
                range: rangeText(t, hit.effectiveFrom, hit.effectiveTo),
              })
            : t('admin.errors.overlap'),
        );
      } else {
        setError(t(`admin.errors.${key}`));
      }
    } finally {
      setBusy(false);
    }
  }

  if (problems === undefined) {
    return (
      <p role="status" className="m-0 text-muted">
        {t('admin.versions.publishDialog.checking')}
      </p>
    );
  }
  if (problems === null || problems.length > 0) {
    return (
      <Callout tone="coral" label={t('admin.versions.publishDialog.problemsLabel')} role="alert">
        {problems === null
          ? t('admin.import.read.engine')
          : t('admin.versions.publishDialog.problems')}
        {problems && (
          <ul className="mt-2 mb-0 pl-6">
            {problems.slice(0, 30).map((p, i) => (
              <li key={i} className="font-mono text-caption">
                {p}
              </li>
            ))}
          </ul>
        )}
      </Callout>
    );
  }

  const has = (k: PublishFieldError) => fieldErrors.includes(k);
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <div data-field-block className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-4">
          <FormField
            id="publish-from"
            required
            label={
              <>
                {t('admin.versions.publishDialog.from')}
                <span aria-hidden> *</span>
              </>
            }
            error={
              has('fromRequired')
                ? t('admin.versions.publishDialog.errors.fromRequired')
                : undefined
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
            id="publish-to"
            label={t('admin.versions.publishDialog.to')}
            hint={t('admin.versions.publishDialog.toHint')}
            error={has('range') ? t('admin.versions.publishDialog.errors.range') : undefined}
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
      </div>
      {previous && (
        <Checkbox
          checked={closePrevious}
          onChange={(e) => setClosePrevious(e.target.checked)}
          label={t('admin.versions.publishDialog.closePrevious', {
            version: previous.versionNo,
            date: formatDay(from),
          })}
        />
      )}
      <FormField
        id={noteId}
        required
        label={
          <>
            {t('admin.versions.publishDialog.note')}
            <span aria-hidden> *</span>
          </>
        }
        error={
          has('noteRequired') ? t('admin.versions.publishDialog.errors.noteRequired') : undefined
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
      {created.map((g) => (
        <Callout key={`${g.from}-${g.to ?? ''}`} tone="amber" label={t('admin.versions.gapLabel')}>
          {gapText(t, g)}
        </Callout>
      ))}
      {error && (
        <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
          {error}
        </Callout>
      )}
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy
            ? t('admin.versions.publishDialog.submitting')
            : t('admin.versions.publishDialog.submit')}
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
  version: AdminVersionDetail;
  versions: AdminVersionDetail[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [to, setTo] = useState(version.effectiveTo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = version.effectiveFrom ?? '';
  const next = versions.map((v) => (v.id === version.id ? { ...v, effectiveTo: to || null } : v));
  const created = to && to <= from ? [] : newGaps(versions, next);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (to && to <= from) {
      setError(t('admin.versions.publishDialog.errors.range'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setEffectiveTo(version.id, to || null);
      onDone();
    } catch (err) {
      const key = errorKeyOf(err);
      const hit = key === 'overlap' ? findOverlap(next, from, to || null, version.id) : undefined;
      setError(
        hit
          ? t('admin.versions.publishDialog.overlap', {
              version: hit.versionNo,
              range: rangeText(t, hit.effectiveFrom, hit.effectiveTo),
            })
          : t(`admin.errors.${key}`),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-body text-ink-soft">
        {rangeText(t, version.effectiveFrom, version.effectiveTo)}
      </p>
      <FormField id="end-to" label={t('admin.versions.publishDialog.to')}>
        {(f) => <DatePicker id={f.id} labelId={f.labelId} value={to} onChange={setTo} />}
      </FormField>
      {created.map((g) => (
        <Callout key={`${g.from}-${g.to ?? ''}`} tone="amber" label={t('admin.versions.gapLabel')}>
          {gapText(t, g)}
        </Callout>
      ))}
      {error && (
        <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
          {error}
        </Callout>
      )}
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('admin.versions.endDialog.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
