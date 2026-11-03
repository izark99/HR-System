// Subpath import: keeps zod (the schemas) out of the main-thread bundle.
import { migrateFlowDefinition } from '@hrflow/flow-schema/migrate';
import type { TFunction } from 'i18next';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from '@tanstack/react-router';
import { DatePicker } from '../../components/DatePicker';
import { Tooltip } from '../../components/Tooltip';
import { LayersIcon } from '../../components/icons';
import {
  RowActions,
  rowActionsCellClass,
  rowActionsHeadClass,
  RowIcon,
  rowIconClass,
} from '../../components/RowActions';
import {
  Button,
  Callout,
  Card,
  Chip,
  cx,
  inputClass,
  labelClass,
  PageHeader,
  CellText,
  tdLineClass,
  textareaClass,
  thLineClass,
  type Tone,
} from '../../components/ui';
import type { Json, VersionStatus } from '../../lib/database.types';
import { todayIso } from '../runner/as-of';
import { EngineClient } from '../runner/engine-client';
import {
  errorKeyOf,
  type AdminApi,
  type AdminErrorKey,
  type AdminFlow,
  type AdminFlowVersion,
} from './admin-api';
import { Dialog } from './Dialog';
import { useAdminApi, useAdminQuery } from './use-admin';
import { LoadingRegion, TableCardSkeleton } from '../../components/Skeleton';

const MAX_JSON_BYTES = 1024 * 1024;
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const STATUS_TONE: Record<VersionStatus, Tone> = {
  published: 'teal',
  draft: 'blue',
  retired: 'neutral',
};

function loadFlows(api: AdminApi): Promise<AdminFlow[]> {
  return api.listFlows();
}

function formatDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "flow_luong (1).json" → "flow-luong-1". */
export function codeFromFileName(name: string): string {
  return name
    .replace(/\.json$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

interface Candidate {
  fileName: string;
  definition: Json;
  notices: string[];
}

type ReadResult =
  | { ok: true; candidate: Candidate }
  | { ok: false; key: 'tooLarge' | 'notJson' | 'invalid' | 'engine'; problems?: string[] };

/**
 * Parse + validate a flow JSON file with the engine worker (the same check the run page uses).
 * Outdated parts (e.g. `.csv` in `accept`) are cleaned here and the CLEANED definition is what
 * gets published (spec §8.1); the worker's own migration stays as a safety net for old data.
 */
async function readFlowFile(file: File, t: TFunction): Promise<ReadResult> {
  if (file.size > MAX_JSON_BYTES) return { ok: false, key: 'tooLarge' };
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text()) as unknown;
  } catch {
    return { ok: false, key: 'notJson' };
  }
  const migrated = migrateFlowDefinition(raw);
  const definition = migrated.definition as Json;
  // One message per kind of change (AC-B3-91), by the slot's display label.
  const notices = migrated.notes.map((n) =>
    t(`admin.import.migration.${n.code}`, { slot: n.label }),
  );
  const engine = new EngineClient();
  try {
    const result = await engine.api.loadFlow(definition);
    if (!result.ok) return { ok: false, key: 'invalid', problems: result.problems };
    return { ok: true, candidate: { fileName: file.name, definition, notices } };
  } catch {
    return { ok: false, key: 'engine' };
  } finally {
    engine.dispose();
  }
}

/**
 * Versions of a flow on ONE line (AC-UI-57): the two newest versions with their status chips,
 * then "+N" for the others. The full list with effective ranges is in the tooltip and is read by
 * screen readers (sr-only list); the cell is focusable when something is hidden.
 */
function VersionList({ versions }: { versions: AdminFlowVersion[] }) {
  const { t } = useTranslation();
  if (versions.length === 0) return <span className="text-muted">-</span>;
  const describe = (v: AdminFlowVersion) => {
    const range = v.effectiveFrom
      ? v.effectiveTo
        ? t('admin.flows.rangeTo', {
            from: formatDate(v.effectiveFrom),
            to: formatDate(v.effectiveTo),
          })
        : t('admin.flows.rangeOpen', { from: formatDate(v.effectiveFrom) })
      : '';
    return `v${v.versionNo} ${t(`admin.flows.status.${v.status}`)}${range ? ` ${range}` : ''}`;
  };
  const full = versions.map(describe).join('; ');
  const shown = versions.slice(0, 2);
  const rest = versions.length - shown.length;
  const hidden = rest > 0 || versions.some((v) => v.effectiveFrom);
  return (
    <Tooltip text={hidden ? full : null} className="block">
      <span
        tabIndex={hidden ? 0 : undefined}
        data-version-summary
        className="flex items-center gap-2 whitespace-nowrap"
      >
        <ul className="sr-only">
          {versions.map((v) => (
            <li key={v.id}>{describe(v)}</li>
          ))}
        </ul>
        {shown.map((v, i) => (
          <span key={v.id} aria-hidden className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted">·</span>}
            <span className="font-semibold">v{v.versionNo}</span>
            <Chip tone={STATUS_TONE[v.status]}>{t(`admin.flows.status.${v.status}`)}</Chip>
          </span>
        ))}
        {rest > 0 && (
          <span aria-hidden className="text-caption font-semibold text-muted">
            +{rest}
          </span>
        )}
      </span>
    </Tooltip>
  );
}

function ImportForm({
  candidate,
  flows,
  onDone,
}: {
  candidate: Candidate;
  flows: AdminFlow[];
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [code, setCode] = useState(() => codeFromFileName(candidate.fileName));
  const existing = flows.find((f) => f.code === code.trim());
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso().slice(0, 8) + '01');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [closePrevious, setClosePrevious] = useState(true);
  const [error, setError] = useState<
    AdminErrorKey | 'codeInvalid' | 'nameRequired' | 'range' | 'noteRequired' | null
  >(null);
  const [busy, setBusy] = useState(false);
  const openVersion = existing?.versions.find((v) => v.status === 'published' && !v.effectiveTo);

  // Pre-fill metadata once when the code matches an existing flow.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (existing && prefilledFor !== existing.id) {
    setPrefilledFor(existing.id);
    setName(existing.name);
    setCategory(existing.category);
    setDescription(existing.description);
    setInstructions(existing.instructions);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!CODE_PATTERN.test(c)) return setError('codeInvalid');
    if (!name.trim()) return setError('nameRequired');
    if (!effectiveFrom || (effectiveTo && effectiveTo <= effectiveFrom)) return setError('range');
    // The database refuses a blank note too (spec §14.1); check first for a clear message.
    if (!changeNote.trim()) return setError('noteRequired');
    setBusy(true);
    setError(null);
    try {
      const r = await api.publishFlow({
        code: c,
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        instructions: instructions.trim(),
        definition: candidate.definition,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        changeNote: changeNote.trim(),
        closePrevious: Boolean(openVersion) && closePrevious,
      });
      onDone(t('admin.import.done', { name: name.trim(), version: `v${r.versionNo}` }));
    } catch (err) {
      setError(errorKeyOf(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    required = false,
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
        {required && (
          <>
            <span aria-hidden> *</span>
            <span className="sr-only"> ({t('common.required')})</span>
          </>
        )}
      </label>
      <input id={id} value={value} onChange={(e) => set(e.target.value)} className={inputClass} />
    </div>
  );

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3.5">
      <p className="m-0 text-caption text-muted">
        {t('admin.import.file', { name: candidate.fileName })}
      </p>
      {candidate.notices.length > 0 && (
        <Callout tone="amber" label={t('admin.import.noticesLabel')}>
          {candidate.notices.join(' ')}
        </Callout>
      )}
      {field('import-code', t('admin.import.code'), code, setCode, true)}
      <p className="-mt-2 m-0 text-caption text-muted">{t('admin.import.codeHint')}</p>
      {existing ? (
        <Callout tone="blue" label={t('admin.import.existingLabel')}>
          {t('admin.import.existing', { name: existing.name })}
        </Callout>
      ) : null}
      {field('import-name', t('admin.import.name'), name, setName, true)}
      {field('import-category', t('admin.import.category'), category, setCategory)}
      {field('import-description', t('admin.import.description'), description, setDescription)}
      {field('import-instructions', t('admin.import.instructions'), instructions, setInstructions)}
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <label id="import-from-label" htmlFor="import-from" className={labelClass}>
            {t('admin.import.effectiveFrom')} <span aria-hidden>*</span>
            <span className="sr-only">({t('common.required')})</span>
          </label>
          <DatePicker
            id="import-from"
            labelId="import-from-label"
            value={effectiveFrom}
            required
            onChange={setEffectiveFrom}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label id="import-to-label" htmlFor="import-to" className={labelClass}>
            {t('admin.import.effectiveTo')}
          </label>
          <DatePicker
            id="import-to"
            labelId="import-to-label"
            value={effectiveTo}
            onChange={setEffectiveTo}
          />
        </div>
      </div>
      <p className="-mt-2 m-0 text-caption text-muted">{t('admin.import.rangeHint')}</p>
      {openVersion && (
        <label className="flex min-h-target items-center gap-2.5 text-body text-ink-soft">
          <input
            type="checkbox"
            className="size-4.5 accent-teal-strong"
            checked={closePrevious}
            onChange={(e) => setClosePrevious(e.target.checked)}
          />
          {t('admin.import.closePrevious', {
            version: `v${openVersion.versionNo}`,
            date: formatDate(effectiveFrom),
          })}
        </label>
      )}
      {field('import-note', t('admin.import.changeNote'), changeNote, setChangeNote, true)}
      {error && (
        <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
          {t(
            error === 'codeInvalid' ||
              error === 'nameRequired' ||
              error === 'range' ||
              error === 'noteRequired'
              ? `admin.import.errors.${error}`
              : `admin.errors.${error}`,
          )}
        </Callout>
      )}
      <Button type="submit" variant="primary" disabled={busy} className="self-end">
        {busy ? t('admin.import.publishing') : t('admin.import.publish')}
      </Button>
    </form>
  );
}

/** An empty draft: the Designer starts from a blank canvas (spec §15.3, AC-B3-31). */
const EMPTY_DEFINITION: Json = {
  schemaVersion: 1,
  params: [],
  nodes: [],
  edges: [],
  inputSlots: [],
};

function CreateFlowForm({ onCreated }: { onCreated: (code: string) => void }) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [instructions, setInstructions] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeOk = CODE_PATTERN.test(code);
  const nameOk = name.trim() !== '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!codeOk || !nameOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createFlow({
        code,
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        instructions: instructions.trim(),
        definition: EMPTY_DEFINITION,
      });
      onCreated(code);
    } catch (err) {
      const key = errorKeyOf(err);
      setError(key === 'duplicate' ? t('admin.flows.create.duplicate') : t(`admin.errors.${key}`));
    } finally {
      setBusy(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { invalid?: string | false; hint?: string; area?: boolean; mono?: boolean } = {},
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {opts.area ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          onChange={(e) => set(e.target.value)}
          className={textareaClass}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          aria-invalid={opts.invalid ? true : undefined}
          aria-describedby={opts.hint || opts.invalid ? `${id}-desc` : undefined}
          onChange={(e) => set(e.target.value)}
          className={cx(inputClass, opts.mono && 'font-mono')}
        />
      )}
      {(opts.hint || opts.invalid) && (
        <p
          id={`${id}-desc`}
          className={cx('m-0 text-caption', opts.invalid ? 'text-coral-text' : 'text-muted')}
        >
          {opts.invalid || opts.hint}
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3.5">
      <p className="m-0 text-caption text-muted">{t('admin.flows.create.intro')}</p>
      {field('new-flow-code', t('admin.flows.create.code'), code, (v) => setCode(v.trim()), {
        mono: true,
        hint: t('admin.flows.create.codeHint'),
        invalid: touched && !codeOk && t('admin.flows.create.codeInvalid'),
      })}
      {field('new-flow-name', t('admin.flows.create.name'), name, setName, {
        invalid: touched && !nameOk && t('admin.flows.create.nameRequired'),
      })}
      {field('new-flow-category', t('admin.flows.create.category'), category, setCategory)}
      {field(
        'new-flow-description',
        t('admin.flows.create.description'),
        description,
        setDescription,
        {
          area: true,
        },
      )}
      {field(
        'new-flow-instructions',
        t('admin.flows.create.instructions'),
        instructions,
        setInstructions,
        { area: true },
      )}
      {error && (
        <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
          {error}
        </Callout>
      )}
      <Button type="submit" variant="primary" disabled={busy} className="self-end">
        {busy ? t('admin.flows.create.creating') : t('admin.flows.create.submit')}
      </Button>
    </form>
  );
}

export function AdminFlowsPage() {
  const { t } = useTranslation();
  const { data, error, reload } = useAdminQuery(loadFlows);
  const fileRef = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [readError, setReadError] = useState<Exclude<ReadResult, { ok: true }> | null>(null);
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setChecking(true);
    setReadError(null);
    setMessage('');
    const result = await readFlowFile(file, t);
    setChecking(false);
    if (fileRef.current) fileRef.current.value = '';
    if (result.ok) setCandidate(result.candidate);
    else setReadError(result);
  }

  return (
    <>
      <PageHeader
        eyebrow={t('admin.flows.eyebrow')}
        eyebrowTone="blue"
        title={t('admin.flows.title')}
        subtitle={t('admin.flows.subtitle')}
        actions={
          <>
            <input
              ref={fileRef}
              id="import-flow-file"
              type="file"
              accept=".json,application/json"
              className="sr-only"
              tabIndex={-1}
              aria-label={t('admin.import.choose')}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button onClick={() => setCreating(true)}>{t('admin.flows.create.button')}</Button>
            <Button variant="primary" disabled={checking} onClick={() => fileRef.current?.click()}>
              {checking ? t('admin.import.checking') : t('admin.import.button')}
            </Button>
          </>
        }
      />

      {message && (
        <Callout tone="teal" label={t('admin.import.doneLabel')} role="status">
          {message}
        </Callout>
      )}
      {readError && (
        <Callout tone="coral" label={t('admin.import.invalidLabel')} role="alert">
          {t(`admin.import.read.${readError.key}`)}
          {readError.problems && readError.problems.length > 0 && (
            <ul className="mt-2 mb-0 pl-5">
              {readError.problems.slice(0, 20).map((p, i) => (
                <li key={i} className="font-mono text-caption">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </Callout>
      )}
      {error && (
        <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
          {t(`admin.errors.${error}`)}
        </Callout>
      )}
      {!data && !error && (
        <LoadingRegion>
          <TableCardSkeleton rows={2} columns={4} />
        </LoadingRegion>
      )}

      {data && (
        <Card aria-labelledby="flows-title" className="flex flex-col gap-4">
          <h2 id="flows-title" className="m-0 text-title-md text-ink">
            {t('admin.flows.listTitle', { count: data.length })}
          </h2>
          {data.length === 0 ? (
            <p className="m-0 rounded-card bg-neutral px-4 py-6 text-center text-body text-muted">
              {t('admin.flows.empty')}
            </p>
          ) : (
            <div
              className="overflow-x-auto"
              role="region"
              tabIndex={0}
              aria-label={t('admin.flows.tableLabel')}
            >
              <table className="w-full min-w-215 table-fixed border-collapse text-body text-ink-soft">
                <colgroup>
                  <col />
                  <col className="w-48" />
                  <col className="w-36" />
                  <col className="w-64" />
                  <col className="w-30" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className={thLineClass}>
                      {t('admin.flows.name')}
                    </th>
                    <th scope="col" className={thLineClass}>
                      {t('admin.flows.code')}
                    </th>
                    <th scope="col" className={thLineClass}>
                      {t('admin.flows.category')}
                    </th>
                    <th scope="col" className={thLineClass}>
                      {t('admin.flows.versions')}
                    </th>
                    <th scope="col" className={rowActionsHeadClass}>
                      {t('admin.flows.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((f) => (
                    <tr key={f.id} className="bg-card">
                      <th
                        scope="row"
                        className={cx(tdLineClass, 'text-left font-semibold text-ink')}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <CellText text={f.name} />
                          {f.isArchived && (
                            <span className="shrink-0">
                              <Chip tone="neutral">{t('admin.flows.archived')}</Chip>
                            </span>
                          )}
                        </span>
                      </th>
                      <td className={tdLineClass}>
                        <CellText text={f.code} className="font-mono" />
                      </td>
                      <td className={tdLineClass}>
                        <CellText text={f.category || '-'} />
                      </td>
                      <td className={tdLineClass}>
                        <VersionList versions={f.versions} />
                      </td>
                      <td className={rowActionsCellClass}>
                        <RowActions
                          rowName={f.name}
                          visible={
                            <RowIcon label={t('admin.flows.openVersions')}>
                              <Link
                                to="/admin/flows/$flowCode/versions"
                                params={{ flowCode: f.code }}
                                aria-label={t('admin.flows.openVersionsFor', { name: f.name })}
                                className={cx(rowIconClass, 'hover:text-ink')}
                              >
                                <LayersIcon />
                              </Link>
                            </RowIcon>
                          }
                          items={[
                            {
                              key: 'designer',
                              label: t('admin.versions.openDesigner'),
                              ariaLabel: t('admin.flows.openDesignerFor', { name: f.name }),
                              onSelect: () =>
                                void navigate({
                                  to: '/admin/flows/$flowCode/designer',
                                  params: { flowCode: f.code },
                                  search: {},
                                }),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="m-0 text-caption text-muted">{t('admin.flows.note')}</p>
        </Card>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={t('admin.flows.create.title')}
      >
        {creating && (
          <CreateFlowForm
            onCreated={(code) => {
              setCreating(false);
              void navigate({
                to: '/admin/flows/$flowCode/designer',
                params: { flowCode: code },
                search: {},
              });
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={candidate !== null}
        onClose={() => setCandidate(null)}
        title={t('admin.import.title')}
      >
        {candidate && data && (
          <ImportForm
            candidate={candidate}
            flows={data}
            onDone={(msg) => {
              setCandidate(null);
              setMessage(msg);
              reload();
            }}
          />
        )}
      </Dialog>
    </>
  );
}
