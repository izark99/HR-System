// Subpath import: keeps zod (the schemas) out of the main-thread bundle.
import { migrateFlowDefinition } from '@hrflow/flow-schema/migrate';
import type { TFunction } from 'i18next';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from '@tanstack/react-router';
import { DataTable, type DataTableColumn } from '../../components/DataTable';
import { DatePicker } from '../../components/DatePicker';
import { Dialog, DialogFooter } from '../../components/Dialog';
import { Checkbox, FormField, Textarea, TextInput } from '../../components/FormField';
import { PageHeader, Toolbar } from '../../components/layout';
import { RowActions, RowIcon, rowIconClass } from '../../components/RowActions';
import { useToast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { Button, Callout, cardClass, CellText, Chip, cx, type Tone } from '../../components/ui';
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
import { useAdminApi, useAdminQuery } from './use-admin';
import { LoadingRegion, TableCardSkeleton } from '../../components/Skeleton';
import { LayersIcon } from '../../components/icons';

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
 * Versions of a flow on ONE line (AC-UI-57): the two newest versions with their status chips and
 * effective start, then "+N" for the others (full list in the tooltip). Screen readers get the
 * full list (sr-only); the cell is focusable only when versions are hidden.
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
  const hidden = rest > 0;
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
          <span key={v.id} aria-hidden className="flex items-center gap-2">
            {i > 0 && <span className="text-muted">·</span>}
            <span className="font-semibold">v{v.versionNo}</span>
            <Chip tone={STATUS_TONE[v.status]}>{t(`admin.flows.status.${v.status}`)}</Chip>
            {v.effectiveFrom && (
              <span className="text-caption">
                {t('admin.flows.rangeOpen', { from: formatDate(v.effectiveFrom) })}
              </span>
            )}
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
    opts: { required?: boolean; hint?: string } = {},
  ) => (
    <FormField
      id={id}
      required={opts.required}
      hint={opts.hint}
      label={
        <>
          {label}
          {opts.required && <span aria-hidden> *</span>}
        </>
      }
    >
      {(f) => <TextInput {...f.input} value={value} onChange={(e) => set(e.target.value)} />}
    </FormField>
  );

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-caption text-muted">
        {t('admin.import.file', { name: candidate.fileName })}
      </p>
      {candidate.notices.length > 0 && (
        <Callout tone="amber" label={t('admin.import.noticesLabel')}>
          {candidate.notices.join(' ')}
        </Callout>
      )}
      {field('import-code', t('admin.import.code'), code, setCode, {
        required: true,
        hint: t('admin.import.codeHint'),
      })}
      {existing ? (
        <Callout tone="blue" label={t('admin.import.existingLabel')}>
          {t('admin.import.existing', { name: existing.name })}
        </Callout>
      ) : null}
      {field('import-name', t('admin.import.name'), name, setName, { required: true })}
      {field('import-category', t('admin.import.category'), category, setCategory)}
      {field('import-description', t('admin.import.description'), description, setDescription)}
      {field('import-instructions', t('admin.import.instructions'), instructions, setInstructions)}
      <div className="flex flex-wrap gap-4">
        <FormField
          id="import-from"
          required
          label={
            <>
              {t('admin.import.effectiveFrom')} <span aria-hidden>*</span>
            </>
          }
        >
          {(f) => (
            <DatePicker
              id={f.id}
              labelId={f.labelId}
              value={effectiveFrom}
              required
              onChange={setEffectiveFrom}
            />
          )}
        </FormField>
        <FormField
          id="import-to"
          label={t('admin.import.effectiveTo')}
          hint={t('admin.import.rangeHint')}
        >
          {(f) => (
            <DatePicker
              id={f.id}
              labelId={f.labelId}
              value={effectiveTo}
              onChange={setEffectiveTo}
            />
          )}
        </FormField>
      </div>
      {openVersion && (
        <Checkbox
          checked={closePrevious}
          onChange={(e) => setClosePrevious(e.target.checked)}
          label={t('admin.import.closePrevious', {
            version: `v${openVersion.versionNo}`,
            date: formatDate(effectiveFrom),
          })}
        />
      )}
      {field('import-note', t('admin.import.changeNote'), changeNote, setChangeNote, {
        required: true,
      })}
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
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('admin.import.publishing') : t('admin.import.publish')}
        </Button>
      </DialogFooter>
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
    <FormField id={id} label={label} hint={opts.hint} error={opts.invalid || undefined}>
      {(f) =>
        opts.area ? (
          <Textarea {...f.input} value={value} onChange={(e) => set(e.target.value)} />
        ) : (
          <TextInput
            {...f.input}
            value={value}
            onChange={(e) => set(e.target.value)}
            className={cx(opts.mono && 'font-mono')}
          />
        )
      }
    </FormField>
  );

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
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
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('admin.flows.create.creating') : t('admin.flows.create.submit')}
        </Button>
      </DialogFooter>
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
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setChecking(true);
    setReadError(null);
    const result = await readFlowFile(file, t);
    setChecking(false);
    if (fileRef.current) fileRef.current.value = '';
    if (result.ok) setCandidate(result.candidate);
    else setReadError(result);
  }

  const columns: DataTableColumn<AdminFlow>[] = [
    {
      id: 'name',
      header: t('admin.flows.name'),
      rowHeader: true,
      cell: (f) => (
        <span className="flex min-w-0 items-center gap-2">
          <CellText text={f.name} />
          {f.isArchived && (
            <span className="shrink-0">
              <Chip tone="neutral">{t('admin.flows.archived')}</Chip>
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'code',
      header: t('admin.flows.code'),
      cell: (f) => <CellText text={f.code} className="font-mono" />,
    },
    {
      id: 'category',
      header: t('admin.flows.category'),
      cell: (f) => <CellText text={f.category || '-'} />,
    },
    {
      id: 'versions',
      header: t('admin.flows.versions'),
      cell: (f) => <VersionList versions={f.versions} />,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('admin.flows.eyebrow')}
        eyebrowTone="blue"
        title={t('admin.flows.title')}
        subtitle={t('admin.flows.subtitleShort')}
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

      {readError && (
        <Callout tone="coral" label={t('admin.import.invalidLabel')} role="alert">
          {t(`admin.import.read.${readError.key}`)}
          {readError.problems && readError.problems.length > 0 && (
            <ul className="mt-2 mb-0 pl-6">
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
        <div className="flex flex-col items-start gap-3">
          <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
            {t(`admin.errors.${error}`)}
          </Callout>
          <Button size="sm" onClick={reload}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {!data && !error && (
        <LoadingRegion>
          <TableCardSkeleton rows={2} columns={4} />
        </LoadingRegion>
      )}

      {data && (
        <section
          aria-labelledby="flows-title"
          data-card
          className={cx(cardClass, 'flex min-w-0 flex-col overflow-hidden')}
        >
          <Toolbar>
            <h2 id="flows-title" className="m-0 text-title-sm font-semibold text-ink">
              {t('admin.flows.listTitle', { count: data.length })}
            </h2>
          </Toolbar>
          <DataTable
            caption={t('admin.flows.tableLabel')}
            columns={columns}
            rows={data}
            rowKey={(f) => f.id}
            empty={{ title: t('admin.flows.emptyTitle'), text: t('admin.flows.empty') }}
            actions={{
              header: t('admin.flows.actions'),
              cell: (f) => (
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
              ),
            }}
          />
          <p className="m-0 border-t border-line px-4 py-3 text-caption text-muted">
            {t('admin.flows.note')}
          </p>
        </section>
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
              toast.show({ tone: 'teal', message: `${t('admin.import.doneLabel')} ${msg}` });
              reload();
            }}
          />
        )}
      </Dialog>
    </>
  );
}
