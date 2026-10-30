import type { FlowParam } from '@hrflow/flow-schema';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Callout, Chip, cx } from '../../components/ui';
import { formatIssue } from '../../engine/io/validation';
import type { PreviewOutcome } from '../../engine/preview';
import type { RunWarningInfo } from '../../engine/protocol';
import type { ParamValues, SlotValidation } from '../../engine/protocol';
import { formatCell, formatInteger, isNumericType } from '../../lib/format';
import { ParamsCard } from '../runner/components/ParamsCard';
import { EngineClient } from '../runner/engine-client';
import type { DesignerDoc, DNode, JsonObject } from './model';

/**
 * Bottom data panel of the Designer (spec §13.3, §15.3): sample file per slot (kept in the RAM
 * of this panel's worker only: no upload, no storage, no run log), its validation report, preview
 * params, and the preview of the selected node (200 rows per output, total count). The worker is
 * terminated when the Designer closes (or by the idle sign-out), which releases everything.
 */

const MAX_ISSUES = 50;

interface SampleState {
  files: string[];
  validation: SlotValidation | null;
  busy: boolean;
}

function usePreviewEngine() {
  const ref = useRef<EngineClient | null>(null);
  useEffect(
    () => () => {
      ref.current?.dispose();
      ref.current = null;
    },
    [],
  );
  return () => (ref.current ??= new EngineClient());
}

export function DataPanel({
  doc,
  definition,
  node,
  onRunWarnings,
}: {
  doc: DesignerDoc;
  definition: JsonObject;
  node: DNode | null;
  /** Run warnings of the last preview (e.g. formula row errors), shown on the canvas nodes too. */
  onRunWarnings?: (warnings: RunWarningInfo[]) => void;
}) {
  const { t } = useTranslation('designer');
  const { t: tc } = useTranslation();
  const { t: te } = useTranslation('engine');
  const engine = usePreviewEngine();
  const [samples, setSamples] = useState<Record<string, SampleState>>({});
  const [params, setParams] = useState<ParamValues>({});
  const [outcome, setOutcome] = useState<PreviewOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState(0);

  const slots = doc.inputSlots.filter((s) => typeof s.key === 'string' && s.key);
  const slotJson = JSON.stringify(slots);
  // The slot config may change after a sample was chosen: re-check the samples (debounced).
  useEffect(() => {
    const keys = Object.keys(samples).filter((k) => samples[k]!.files.length > 0);
    if (keys.length === 0) return;
    const timer = setTimeout(() => {
      for (const key of keys) {
        const slot = slots.find((s) => s.key === key);
        void engine()
          .api.previewValidate(key, slot ?? null)
          .then(
            (v) => setSamples((s) => (s[key] ? { ...s, [key]: { ...s[key], validation: v } } : s)),
            () => undefined,
          );
      }
    }, 300);
    return () => clearTimeout(timer);
    // `samples` changes on every validation; only the slot config should re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotJson]);

  const pick = async (slot: JsonObject, list: FileList | null) => {
    const key = String(slot.key);
    const files = list ? Array.from(list) : [];
    setSamples((s) => ({
      ...s,
      [key]: { files: files.map((f) => f.name), validation: null, busy: true },
    }));
    setOutcome(null);
    try {
      const v = await engine().api.previewSetSamples(
        key,
        files.map((f) => ({ name: f.name, blob: f })),
        slot,
      );
      setSamples((s) => ({
        ...s,
        [key]: { files: files.map((f) => f.name), validation: v, busy: false },
      }));
    } catch {
      setSamples((s) => ({ ...s, [key]: { files: [], validation: null, busy: false } }));
    }
  };

  const run = async () => {
    if (!node) return;
    setRunning(true);
    setTab(0);
    try {
      const result = await engine().api.previewRun(definition, node.id, params);
      setOutcome(result);
      onRunWarnings?.(result.ok ? result.warnings : []);
    } catch {
      onRunWarnings?.([]);
      setOutcome({
        ok: false,
        error: { messageKey: 'executor.error.engineCrashed', params: {} },
        ran: [],
      });
    } finally {
      setRunning(false);
    }
  };

  const validParams = doc.params.filter(
    (p): p is JsonObject & FlowParam =>
      typeof p.key === 'string' && typeof p.label === 'string' && typeof p.type === 'string',
  );
  const tables = outcome?.ok ? outcome.tables : [];
  // Compare outputs get their business names (spec §13.3: Tổng hợp / Lệch / Chỉ có trong A / B).
  const portName = (name: string) =>
    ['summary', 'mismatched', 'only_left', 'only_right', 'out', 'removed'].includes(name)
      ? t(`data.ports.${name}`)
      : name;
  const current = tables[Math.min(tab, tables.length - 1)];

  return (
    <div className="flex max-h-[42vh] flex-col gap-3.5 overflow-y-auto px-3.5 pb-3.5">
      <Callout tone="teal" label={t('data.safeLabel')}>
        {t('data.safe')}
      </Callout>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        {slots.length === 0 && <p className="m-0 text-small text-muted">{t('data.noSlots')}</p>}
        {slots.map((slot) => (
          <SampleCard
            key={String(slot.key)}
            slot={slot}
            state={samples[String(slot.key)]}
            onPick={(files) => void pick(slot, files)}
          />
        ))}
      </div>
      {validParams.length > 0 && (
        <ParamsCard
          params={validParams}
          values={params}
          disabled={running}
          onChange={(key, value) => setParams((p) => ({ ...p, [key]: value }))}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!node || running} onClick={() => void run()}>
          {running
            ? t('data.running')
            : node
              ? t('data.run', { node: node.label || node.id })
              : t('data.pickNode')}
        </Button>
        {outcome?.ok && (
          <span className="text-small text-muted">
            {t('data.ran', { count: outcome.ran.length })}
          </span>
        )}
      </div>
      {outcome && !outcome.ok && (
        <Callout tone="coral" label={t('toast.errorLabel')} role="alert">
          {te(outcome.error.messageKey, outcome.error.params)}
        </Callout>
      )}
      {outcome?.ok &&
        outcome.warnings.map((w, i) => (
          <Callout key={i} tone="amber" label={t('form.noteLabel')}>
            {te(w.messageKey, {
              ...w.params,
              node: nodeLabel(definition, w.nodeId),
            })}
          </Callout>
        ))}
      {outcome?.ok && tables.length === 0 && (
        <p className="m-0 text-small text-muted">{t('data.noTables')}</p>
      )}
      {current && (
        <section aria-label={t('data.resultLabel')} className="flex flex-col gap-2">
          {tables.length > 1 && (
            <div
              role="tablist"
              aria-label={t('data.resultLabel')}
              className="flex flex-wrap gap-1.5"
            >
              {tables.map((x, i) => (
                <button
                  key={x.name}
                  type="button"
                  role="tab"
                  aria-selected={x === current}
                  onClick={() => setTab(i)}
                  className={cx(
                    'min-h-target rounded-full px-4 text-label',
                    x === current
                      ? 'bg-teal-tint font-bold text-teal-strong'
                      : 'font-semibold text-muted hover:bg-page',
                  )}
                >
                  {t('data.tab', { name: portName(x.name), count: x.total })}
                </button>
              ))}
            </div>
          )}
          <p className="m-0 text-small text-muted" aria-live="polite">
            {t('data.shown', {
              shown: formatInteger(current.rows.length),
              total: formatInteger(current.total),
            })}
          </p>
          <div
            role="region"
            aria-label={current.name}
            tabIndex={0}
            className="max-h-72 overflow-auto rounded-control border border-line"
          >
            <table className="w-max min-w-full border-collapse text-small text-body">
              <thead className="sticky top-0 bg-page">
                <tr>
                  {current.columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={cx(
                        'border-b border-line px-2 py-2 font-semibold text-muted',
                        isNumericType(c.type) ? 'text-right' : 'text-left',
                      )}
                    >
                      {c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {current.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line">
                    {current.columns.map((c, ci) => (
                      <td
                        key={c.key}
                        className={cx(
                          'px-2 py-1.5 whitespace-nowrap',
                          isNumericType(c.type) && 'text-right tabular-nums',
                        )}
                      >
                        {formatCell(r[ci] ?? null, c.type, tc)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SampleCard({
  slot,
  state,
  onPick,
}: {
  slot: JsonObject;
  state: SampleState | undefined;
  onPick: (files: FileList | null) => void;
}) {
  const { t } = useTranslation('designer');
  const { t: te } = useTranslation('engine');
  const id = useId();
  const label = typeof slot.label === 'string' && slot.label ? slot.label : String(slot.key);
  const multiple =
    typeof slot.multiple === 'object' &&
    slot.multiple !== null &&
    (slot.multiple as { enabled?: unknown }).enabled === true;
  const v = state?.validation;
  const issues = v
    ? [...v.report.issues].sort(
        (a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'),
      )
    : [];
  return (
    <div className="flex flex-col gap-2 rounded-tile border border-line bg-page p-3">
      <label htmlFor={id} className="text-label font-semibold text-ink">
        {t('data.sampleFor', { slot: label })}
      </label>
      <input
        id={id}
        type="file"
        accept=".xlsx,.xls"
        multiple={multiple}
        onChange={(e) => onPick(e.target.files)}
        className="text-small"
      />
      {state?.busy && <p className="m-0 text-small text-muted">{t('data.checking')}</p>}
      {v && (
        <div className="flex flex-wrap items-center gap-1.5" role="status">
          <Chip tone="neutral">{t('data.rows', { count: v.rowCount })}</Chip>
          <Chip tone={v.report.errorCount > 0 ? 'coral' : 'teal'}>
            {t('data.errors', { count: v.report.errorCount })}
          </Chip>
          <Chip tone={v.report.warningCount > 0 ? 'amber' : 'neutral'}>
            {t('data.warnings', { count: v.report.warningCount })}
          </Chip>
        </div>
      )}
      {issues.length > 0 && (
        <ul className="m-0 flex max-h-32 list-none flex-col gap-1 overflow-y-auto p-0 text-small">
          {issues.slice(0, MAX_ISSUES).map((i, k) => (
            <li key={k} className={i.severity === 'error' ? 'text-coral-text' : 'text-amber-text'}>
              {formatIssue(i, te)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Label of a node of the canvas definition (falls back to its id). */
function nodeLabel(definition: JsonObject, id: string): string {
  const nodes: unknown[] = Array.isArray(definition.nodes) ? definition.nodes : [];
  for (const n of nodes) {
    if (typeof n !== 'object' || n === null || Array.isArray(n)) continue;
    const o = n as Record<string, unknown>;
    if (o.id === id) return typeof o.label === 'string' && o.label ? o.label : id;
  }
  return id;
}
