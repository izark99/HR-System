// Subpath import: keeps zod (the schemas) out of the main-thread bundle.
import { migrateFlowDefinition } from '@hrflow/flow-schema/migrate';
import type { TFunction } from 'i18next';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DatePicker } from '../../components/DatePicker';
import { Button, Callout, Card, Chip, cx, PageHeader, type Tone } from '../../components/ui';
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

const MAX_JSON_BYTES = 1024 * 1024;
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const STATUS_TONE: Record<VersionStatus, Tone> = {
  published: 'teal',
  draft: 'amber',
  retired: 'neutral',
};

const inputClass = 'h-10.5 rounded-control border border-line-input bg-card px-3 text-label';
const labelClass = 'text-small font-semibold text-body';

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

function VersionList({ versions }: { versions: AdminFlowVersion[] }) {
  const { t } = useTranslation();
  if (versions.length === 0) return <span className="text-muted">-</span>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {versions.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">v{v.versionNo}</span>
          <Chip tone={STATUS_TONE[v.status]}>{t(`admin.flows.status.${v.status}`)}</Chip>
          {v.effectiveFrom && (
            <span className="text-small text-muted">
              {v.effectiveTo
                ? t('admin.flows.rangeTo', {
                    from: formatDate(v.effectiveFrom),
                    to: formatDate(v.effectiveTo),
                  })
                : t('admin.flows.rangeOpen', { from: formatDate(v.effectiveFrom) })}
            </span>
          )}
        </li>
      ))}
    </ul>
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
      <p className="m-0 text-small text-muted">
        {t('admin.import.file', { name: candidate.fileName })}
      </p>
      {candidate.notices.length > 0 && (
        <Callout tone="amber" label={t('admin.import.noticesLabel')}>
          {candidate.notices.join(' ')}
        </Callout>
      )}
      {field('import-code', t('admin.import.code'), code, setCode, true)}
      <p className="-mt-2 m-0 text-small text-muted">{t('admin.import.codeHint')}</p>
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
      <p className="-mt-2 m-0 text-small text-muted">{t('admin.import.rangeHint')}</p>
      {openVersion && (
        <label className="flex min-h-target items-center gap-2.5 text-label text-body">
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

export function AdminFlowsPage() {
  const { t } = useTranslation();
  const { data, error, reload } = useAdminQuery(loadFlows);
  const fileRef = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [readError, setReadError] = useState<Exclude<ReadResult, { ok: true }> | null>(null);
  const [message, setMessage] = useState('');

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
                <li key={i} className="font-mono text-small">
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
      {!data && !error && <p className="m-0 text-muted">{t('common.loading')}</p>}

      {data && (
        <Card aria-labelledby="flows-title" className="flex flex-col gap-3.5">
          <h2 id="flows-title" className="m-0 text-section">
            {t('admin.flows.listTitle', { count: data.length })}
          </h2>
          {data.length === 0 ? (
            <p className="m-0 rounded-callout bg-neutral px-4 py-6 text-center text-label text-muted">
              {t('admin.flows.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 border-collapse text-label text-body">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th scope="col" className="px-2 py-2.5 font-semibold">
                      {t('admin.flows.name')}
                    </th>
                    <th scope="col" className="px-2 py-2.5 font-semibold">
                      {t('admin.flows.code')}
                    </th>
                    <th scope="col" className="px-2 py-2.5 font-semibold">
                      {t('admin.flows.category')}
                    </th>
                    <th scope="col" className="px-2 py-2.5 font-semibold">
                      {t('admin.flows.versions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((f) => (
                    <tr key={f.id} className={cx('border-b border-line align-top last:border-b-0')}>
                      <th scope="row" className="px-2 py-3 text-left font-semibold">
                        {f.name}
                        {f.isArchived && (
                          <span className="ml-2">
                            <Chip tone="neutral">{t('admin.flows.archived')}</Chip>
                          </span>
                        )}
                      </th>
                      <td className="px-2 py-3 font-mono text-small">{f.code}</td>
                      <td className="px-2 py-3">{f.category || '-'}</td>
                      <td className="px-2 py-3">
                        <VersionList versions={f.versions} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="m-0 text-small text-muted">{t('admin.flows.note')}</p>
        </Card>
      )}

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
