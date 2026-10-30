import { Link, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DatePicker } from '../../../components/DatePicker';
import { Select } from '../../../components/Select';
import {
  ArrowLeftIcon,
  Button,
  buttonClass,
  Callout,
  Card,
  Chip,
  cx,
  PageHeader,
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
import { Dialog } from '../Dialog';
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

/** Status chips (spec §14.4): Draft = blue, Published = teal, Retired = neutral grey. */
export const VERSION_STATUS_TONE: Record<VersionStatus, Tone> = {
  draft: 'blue',
  published: 'teal',
  retired: 'neutral',
};

const labelClass = 'text-small font-semibold text-body';
const smallButton = 'min-h-target px-3.5 text-small';

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
  | { kind: 'retire'; version: AdminVersionDetail }
  | { kind: 'discard'; version: AdminVersionDetail }
  | { kind: 'end'; version: AdminVersionDetail }
  | null;

/**
 * Engine check before publishing (spec §14.4): the structural load used by the run page plus the
 * full design check (`planFlow` + `checkConfig` + `inferSchema`), errors listed per node.
 */
async function checkDefinition(definition: Json): Promise<string[] | null> {
  const engine = new EngineClient();
  try {
    const design = await engine.api.checkDesign(definition);
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
  const [message, setMessage] = useState<{ tone: Tone; label: string; text: string } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
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
      <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
        {t(`admin.errors.${loadError}`)}
      </Callout>
    );
  }
  if (data === undefined) return <p className="m-0 text-muted">{t('common.loading')}</p>;
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

  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow={t('admin.versions.eyebrow')}
        eyebrowTone="blue"
        title={
          current
            ? t('admin.versions.titleActive', { name: data.flow.name, version: current.versionNo })
            : t('admin.versions.titleNone', { name: data.flow.name })
        }
        subtitle={t('admin.versions.subtitle')}
      />

      {message && (
        <Callout
          tone={message.tone}
          label={message.label}
          role={message.tone === 'coral' ? 'alert' : 'status'}
        >
          {message.text}
        </Callout>
      )}

      <Timeline versions={versions} gaps={gaps} today={today} />

      <Card aria-labelledby="versions-title" className="flex flex-col gap-3.5">
        <h2 id="versions-title" className="m-0 text-section">
          {t('admin.versions.listTitle', { count: versions.length })}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 border-collapse text-label text-body">
            <caption className="sr-only">{t('admin.versions.caption')}</caption>
            <thead>
              <tr className="border-b border-line text-left text-muted">
                {(['version', 'status', 'range', 'note', 'published', 'actions'] as const).map(
                  (c) => (
                    <th key={c} scope="col" className="px-2 py-2.5 font-semibold">
                      {t(`admin.versions.col.${c}`)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const isCurrent = current?.id === v.id;
                return (
                  <tr
                    key={v.id}
                    className={cx(
                      'border-b border-line align-top last:border-b-0',
                      isCurrent && 'bg-teal-tint-soft',
                    )}
                  >
                    <th scope="row" className="px-2 py-3 text-left font-bold whitespace-nowrap">
                      v{v.versionNo}
                    </th>
                    <td className="px-2 py-3">
                      <span className="flex flex-wrap gap-1.5">
                        <Chip tone={VERSION_STATUS_TONE[v.status]}>
                          {t(`admin.flows.status.${v.status}`)}
                        </Chip>
                        {isCurrent && <Chip tone="teal">{t('admin.versions.current')}</Chip>}
                      </span>
                    </td>
                    <td className="px-2 py-3">{rangeText(t, v.effectiveFrom, v.effectiveTo)}</td>
                    <td className="max-w-70 px-2 py-3 break-words whitespace-pre-line">
                      {v.changeNote || '-'}
                    </td>
                    <td className="px-2 py-3 text-small">
                      {v.publishedAt
                        ? v.publishedBy
                          ? t('admin.versions.publishedBy', {
                              user: v.publishedBy,
                              time: formatDateTime(v.publishedAt),
                            })
                          : formatDateTime(v.publishedAt)
                        : '-'}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-2">
                        {v.status === 'draft' && (
                          <>
                            <Link
                              to="/admin/flows/$flowCode/designer"
                              params={{ flowCode }}
                              search={{}}
                              aria-label={action(t('admin.versions.openDesigner'), v)}
                              className={cx(buttonClass.secondary, smallButton, 'no-underline')}
                            >
                              {t('admin.versions.openDesigner')}
                            </Link>
                            <Button
                              variant="primary"
                              className={smallButton}
                              aria-label={action(t('admin.versions.publish'), v)}
                              onClick={() => {
                                setMessage(null);
                                setDialog({ kind: 'publish', version: v });
                              }}
                            >
                              {t('admin.versions.publish')}
                            </Button>
                            <Button
                              className={smallButton}
                              aria-label={action(t('admin.versions.discard'), v)}
                              onClick={() => setDialog({ kind: 'discard', version: v })}
                            >
                              {t('admin.versions.discard')}
                            </Button>
                          </>
                        )}
                        {v.status !== 'draft' && (
                          <Link
                            to="/admin/flows/$flowCode/designer"
                            params={{ flowCode }}
                            search={{ version: v.id }}
                            aria-label={action(t('admin.versions.viewInDesigner'), v)}
                            className={cx(buttonClass.secondary, smallButton, 'no-underline')}
                          >
                            {t('admin.versions.viewInDesigner')}
                          </Link>
                        )}
                        {v.status !== 'draft' && (
                          <Button
                            className={smallButton}
                            aria-label={action(t('admin.versions.clone'), v)}
                            onClick={() => void cloneFrom(v)}
                          >
                            {t('admin.versions.clone')}
                          </Button>
                        )}
                        {v.status === 'published' && (
                          <>
                            <Button
                              className={smallButton}
                              aria-label={action(t('admin.versions.editEnd'), v)}
                              onClick={() => setDialog({ kind: 'end', version: v })}
                            >
                              {t('admin.versions.editEnd')}
                            </Button>
                            <Button
                              className={smallButton}
                              aria-label={action(t('admin.versions.retire'), v)}
                              onClick={() => setDialog({ kind: 'retire', version: v })}
                            >
                              {t('admin.versions.retire')}
                            </Button>
                          </>
                        )}
                        {versions.length > 1 && (
                          <Button
                            className={smallButton}
                            aria-label={action(t('admin.versions.compare'), v)}
                            onClick={() => compareWithPrevious(v)}
                          >
                            {t('admin.versions.compare')}
                          </Button>
                        )}
                        {v.status !== 'draft' && (
                          <Button
                            className={smallButton}
                            aria-label={action(t('admin.versions.export'), v)}
                            onClick={() => exportJson(v)}
                          >
                            {t('admin.versions.export')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card aria-labelledby="diff-title" className="flex flex-col gap-4">
        <h2 id="diff-title" className="m-0 text-section">
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

      <ConfirmDialog
        open={dialog?.kind === 'retire'}
        title={
          dialog
            ? t('admin.versions.retireDialog.title', { version: dialog.version.versionNo })
            : ''
        }
        body={
          dialog
            ? t('admin.versions.retireDialog.body', {
                range: rangeText(t, dialog.version.effectiveFrom, dialog.version.effectiveTo),
              })
            : ''
        }
        action={t('admin.versions.retire')}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const v = dialog!.version;
          await api.retireVersion(v.id);
          done(t('admin.versions.retired', { version: v.versionNo }));
        }}
      />

      <ConfirmDialog
        open={dialog?.kind === 'discard'}
        title={
          dialog
            ? t('admin.versions.discardDialog.title', { version: dialog.version.versionNo })
            : ''
        }
        body={t('admin.versions.discardDialog.body')}
        action={t('admin.versions.discardDialog.action')}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const v = dialog!.version;
          await api.discardDraft(v.id);
          done(t('admin.versions.discarded', { version: v.versionNo }));
        }}
      />
    </>
  );
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/admin/flows"
      className="inline-flex min-h-target items-center gap-1.5 self-start text-label font-semibold text-teal-strong"
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
    <Card aria-labelledby="timeline-title" className="flex flex-col gap-3.5">
      <h2 id="timeline-title" className="m-0 text-section">
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
                'flex min-w-45 flex-1 flex-col gap-1 rounded-tile border-t-8 bg-neutral px-3.5 py-2.5',
                isEffectiveOn(v, today) ? 'border-teal' : 'border-line-input',
              )}
            >
              <span className="font-bold text-ink">v{v.versionNo}</span>
              <span className="text-small text-body">
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fromId} className={labelClass}>
          {t('admin.versions.diff.from')}
        </label>
        <Select
          id={fromId}
          options={options}
          value={value.from}
          onChange={(from) => onChange({ ...value, from })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={toId} className={labelClass}>
          {t('admin.versions.diff.to')}
        </label>
        <Select
          id={toId}
          options={options}
          value={value.to}
          onChange={(to) => onChange({ ...value, to })}
        />
      </div>
    </div>
  );
}

function RequiredMark() {
  const { t } = useTranslation();
  return (
    <>
      <span aria-hidden> *</span>
      <span className="sr-only"> ({t('common.required')})</span>
    </>
  );
}

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="m-0 text-small font-semibold text-coral-text">
      {children}
    </p>
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
          <ul className="mt-2 mb-0 pl-5">
            {problems.slice(0, 30).map((p, i) => (
              <li key={i} className="font-mono text-small">
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
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3.5">
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <label id="publish-from-label" htmlFor="publish-from" className={labelClass}>
            {t('admin.versions.publishDialog.from')}
            <RequiredMark />
          </label>
          <div className={cx('rounded-control', has('fromRequired') && 'ring-2 ring-coral')}>
            <DatePicker
              id="publish-from"
              labelId="publish-from-label"
              value={from}
              required
              onChange={setFrom}
            />
          </div>
          {has('fromRequired') && (
            <FieldError id="publish-from-error">
              {t('admin.versions.publishDialog.errors.fromRequired')}
            </FieldError>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label id="publish-to-label" htmlFor="publish-to" className={labelClass}>
            {t('admin.versions.publishDialog.to')}
          </label>
          <div className={cx('rounded-control', has('range') && 'ring-2 ring-coral')}>
            <DatePicker id="publish-to" labelId="publish-to-label" value={to} onChange={setTo} />
          </div>
          {has('range') && (
            <FieldError id="publish-to-error">
              {t('admin.versions.publishDialog.errors.range')}
            </FieldError>
          )}
        </div>
      </div>
      <p className="-mt-2 m-0 text-small text-muted">{t('admin.versions.publishDialog.toHint')}</p>
      {previous && (
        <label className="flex min-h-target items-center gap-2.5 text-label text-body">
          <input
            type="checkbox"
            className="size-4.5 accent-teal-strong"
            checked={closePrevious}
            onChange={(e) => setClosePrevious(e.target.checked)}
          />
          {t('admin.versions.publishDialog.closePrevious', {
            version: previous.versionNo,
            date: formatDay(from),
          })}
        </label>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className={labelClass}>
          {t('admin.versions.publishDialog.note')}
          <RequiredMark />
        </label>
        <textarea
          id={noteId}
          rows={3}
          maxLength={1000}
          value={note}
          aria-invalid={has('noteRequired') || undefined}
          aria-describedby={has('noteRequired') ? 'publish-note-error' : undefined}
          onChange={(e) => setNote(e.target.value)}
          className={cx(
            'rounded-control border bg-card px-3 py-2.5 text-label',
            has('noteRequired') ? 'border-2 border-coral' : 'border-line-input',
          )}
        />
        {has('noteRequired') && (
          <FieldError id="publish-note-error">
            {t('admin.versions.publishDialog.errors.noteRequired')}
          </FieldError>
        )}
      </div>
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
      <Button type="submit" variant="primary" disabled={busy} className="self-end">
        {busy
          ? t('admin.versions.publishDialog.submitting')
          : t('admin.versions.publishDialog.submit')}
      </Button>
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
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3.5">
      <p className="m-0 text-label text-body">
        {rangeText(t, version.effectiveFrom, version.effectiveTo)}
      </p>
      <div className="flex flex-col gap-1.5">
        <label id="end-to-label" htmlFor="end-to" className={labelClass}>
          {t('admin.versions.publishDialog.to')}
        </label>
        <DatePicker id="end-to" labelId="end-to-label" value={to} onChange={setTo} />
      </div>
      <p className="-mt-2 m-0 text-small text-muted">{t('admin.versions.publishDialog.toHint')}</p>
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
      <Button type="submit" variant="primary" disabled={busy} className="self-end">
        {t('admin.versions.endDialog.save')}
      </Button>
    </form>
  );
}

function ConfirmDialog({
  open,
  title,
  body,
  action,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  action: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  return (
    <Dialog
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title={title}
    >
      <p className="m-0 text-copy text-body">{body}</p>
      {error && (
        <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
          {t(`admin.errors.${error}`)}
        </Callout>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose}>{t('admin.cancel')}</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            onConfirm()
              .catch((e: unknown) => setError(errorKeyOf(e)))
              .finally(() => setBusy(false));
          }}
        >
          {action}
        </Button>
      </div>
    </Dialog>
  );
}
