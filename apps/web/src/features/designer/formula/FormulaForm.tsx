import { lazy, Suspense, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FUNCTIONS, FUNCTION_GROUPS } from '../../../engine/formula/functions';
import { toDisplay, toStored } from '../../../engine/formula/refs';
import type { FormulaParamDef } from '../../../engine/formula/compile';
import type { ColumnInfo } from '../../../engine/protocol';
import type { NodeFormProps } from '../forms/NodeForms';
import {
  FieldErrors,
  issuesAt,
  labelClass,
  ListEditor,
  SelectField,
  TextField,
} from '../forms/fields';
import type { FormulaMarker } from './FormulaEditor';
import {
  checkShown,
  generatedSql,
  inferredAt,
  refsAt,
  typedRefsAt,
  type RawColumn,
} from './formula-check';

/** Monaco loads only when a formula form opens (Designer chunk, spec §12.2). */
const FormulaEditor = lazy(() => import('./FormulaEditor'));

type Obj = Record<string, unknown>;
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const objs = (v: unknown): Obj[] =>
  Array.isArray(v)
    ? v.filter((x): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x))
    : [];

const TYPES = ['string', 'integer', 'decimal', 'boolean', 'date'] as const;

const toggleClass =
  'min-h-target self-start rounded-control border border-line-input bg-card px-3.5 text-small font-semibold text-ink hover:bg-page';

/** `transform.formula` form (spec §12.2 "Designer", AC-B4-40…45). */
export function FormulaForm(p: NodeFormProps) {
  const { t } = useTranslation('designer');
  const { t: te } = useTranslation('engine');
  const c = p.node.config;
  const items = objs(c.columns);
  const input = p.info?.inputs.in ?? null;
  const ro = p.readOnly;
  const [showFns, setShowFns] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const fnId = useId();
  const sqlId = useId();
  const params: FormulaParamDef[] = useMemo(
    () =>
      p.doc.params
        .filter((x) => typeof x.key === 'string' && typeof x.type === 'string')
        .map((x) => ({ key: str(x.key), type: str(x.type) as FormulaParamDef['type'] })),
    [p.doc.params],
  );
  const functions = useMemo(
    () =>
      FUNCTIONS.map((f) => ({
        name: f.name,
        syntax: t(`formula.fn.${f.name}.syntax`),
        desc: t(`formula.fn.${f.name}.desc`),
      })),
    [t],
  );
  const label = p.node.label ?? p.node.id;
  const at = (path: string) => issuesAt(p.issues, path);
  const setColumns = (next: Obj[], field: string) =>
    p.onConfig(
      { ...c, columns: next },
      next.length !== items.length ? undefined : `${p.node.id}:${field}`,
    );
  const setItem = (i: number, patch: Obj, field: string) => {
    const next: Obj = { ...items[i], ...patch };
    for (const k of ['title']) if (next[k] === '') delete next[k];
    setColumns(
      items.map((x, k) => (k === i ? next : x)),
      `columns.${i}.${field}`,
    );
  };

  return (
    <div className="flex flex-col gap-3.5">
      <ListEditor
        label={t('node.formula.columns')}
        items={items}
        onChange={(v) => setColumns(v, 'columns')}
        issues={at('columns')}
        create={() => {
          const taken = items.map((x) => str(x.key));
          let n = items.length + 1;
          while (taken.includes(`cot_${n}`)) n++;
          return { key: `cot_${n}`, formula: '=', type: 'auto', onError: 'blank' };
        }}
        addLabel={t('node.formula.add')}
        itemLabel={(i) =>
          str(items[i]?.title) || str(items[i]?.key) || t('node.formula.columnN', { n: i + 1 })
        }
        disabled={ro}
        render={(col, i) => (
          <FormulaColumn
            col={col}
            index={i}
            items={items}
            input={input}
            params={params}
            functions={functions}
            nodeLabel={label}
            readOnly={ro}
            issuesAt={at}
            onPatch={(patch, field) => setItem(i, patch, field)}
            t={t}
            te={te}
          />
        )}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={toggleClass}
          aria-expanded={showFns}
          aria-controls={fnId}
          onClick={() => setShowFns((v) => !v)}
        >
          {t('node.formula.functionsShow')}
        </button>
        <button
          type="button"
          className={toggleClass}
          aria-expanded={showSql}
          aria-controls={sqlId}
          onClick={() => setShowSql((v) => !v)}
        >
          {t('node.formula.sqlShow')}
        </button>
      </div>
      {showSql && (
        <section
          id={sqlId}
          aria-label={t('node.formula.sqlTitle')}
          className="flex flex-col gap-1.5"
        >
          <h3 className={labelClass + ' m-0'}>{t('node.formula.sqlTitle')}</h3>
          <GeneratedSql input={input} items={items} params={params} t={t} />
        </section>
      )}
      {showFns && <FunctionTable id={fnId} t={t} />}
    </div>
  );
}

type T = (key: string, params?: Record<string, unknown>) => string;

function FormulaColumn({
  col,
  index,
  items,
  input,
  params,
  functions,
  nodeLabel,
  readOnly,
  issuesAt: at,
  onPatch,
  t,
  te,
}: {
  col: Obj;
  index: number;
  items: Obj[];
  input: ColumnInfo[] | null;
  params: FormulaParamDef[];
  functions: { name: string; syntax: string; desc: string }[];
  nodeLabel: string;
  readOnly: boolean;
  issuesAt: (path: string) => ReturnType<typeof issuesAt>;
  onPatch: (patch: Obj, field: string) => void;
  t: T;
  te: T;
}) {
  const editorId = useId();
  const cols = input ?? [];
  const raw = items as RawColumn[];
  const refs = refsAt(cols, raw, index);
  const refKey = JSON.stringify(refs);
  const completion = useMemo(
    () => ({ columns: typedRefsAt(cols, raw, index, params), functions }),
    // Rebuilt when the visible columns change, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refKey, functions, params, index],
  );
  const inferred = inferredAt(cols, raw, index, params);
  const formulaIssues = at(`columns.${index}.formula`);
  const formulaTitle = str(col.title) || str(col.key);
  const validate = (shown: string): FormulaMarker | null => {
    const prob = checkShown(cols, raw, index, shown, params);
    if (!prob) return null;
    return {
      start: prob.start,
      end: prob.end,
      message: te(prob.messageKey, {
        ...prob.params,
        node: nodeLabel,
        formulaColumn: formulaTitle,
      }),
    };
  };
  const typeOptions = [
    {
      value: 'auto',
      label: inferred
        ? t('node.formula.typeAuto', { type: t(`types.${inferred}`) })
        : t('node.formula.typeAutoUnknown'),
    },
    ...TYPES.map((x) => ({ value: x, label: t(`types.${x}`) })),
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label={t('node.formula.key')}
          value={str(col.key)}
          mono
          onChange={(v) => onPatch({ key: v }, 'key')}
          issues={at(`columns.${index}.key`)}
          hint={t('node.formula.keyHint')}
          disabled={readOnly}
        />
        <TextField
          label={t('node.formula.title')}
          value={str(col.title)}
          onChange={(v) => onPatch({ title: v }, 'title')}
          issues={at(`columns.${index}.title`)}
          hint={t('node.formula.titleHint')}
          disabled={readOnly}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>{t('node.formula.formula')}</span>
        <Suspense
          fallback={
            <textarea
              aria-label={`${t('node.formula.formula')} ${formulaTitle}`}
              rows={3}
              spellCheck={false}
              value={toDisplay(str(col.formula), refs)}
              disabled={readOnly}
              onChange={(e) => onPatch({ formula: toStored(e.target.value, refs) }, 'formula')}
              className="w-full rounded-control border border-line-input bg-card p-2 font-mono text-label"
            />
          }
        >
          <FormulaEditor
            value={str(col.formula)}
            onChange={(v) => onPatch({ formula: v }, 'formula')}
            toDisplay={(s) => toDisplay(s, refsAt(cols, raw, index))}
            toStored={(s) => toStored(s, refsAt(cols, raw, index))}
            validate={validate}
            readOnly={readOnly}
            label={`${t('node.formula.formula')} ${formulaTitle}`}
            describedBy={`${editorId}-hint`}
            invalid={formulaIssues.length > 0}
            completion={completion}
            refsKey={refKey}
            testId={`formula-editor-${index}`}
          />
        </Suspense>
        <p id={`${editorId}-hint`} className="m-0 text-small text-muted">
          {t('node.formula.editorHint')}
        </p>
        <FieldErrors id={`${editorId}-errors`} issues={formulaIssues} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label={t('node.formula.type')}
          value={str(col.type, 'auto')}
          onChange={(v) => onPatch({ type: v }, 'type')}
          options={typeOptions}
          issues={at(`columns.${index}.type`)}
          disabled={readOnly}
        />
        <SelectField
          label={t('node.formula.onError')}
          value={str(col.onError, 'blank')}
          onChange={(v) => onPatch({ onError: v }, 'onError')}
          options={[
            { value: 'blank', label: t('node.formula.onErrorBlank') },
            { value: 'fail', label: t('node.formula.onErrorFail') },
          ]}
          issues={at(`columns.${index}.onError`)}
          hint={t('node.formula.onErrorHint')}
          disabled={readOnly}
        />
      </div>
    </>
  );
}

function GeneratedSql({
  input,
  items,
  params,
  t,
}: {
  input: ColumnInfo[] | null;
  items: Obj[];
  params: FormulaParamDef[];
  t: T;
}) {
  if (!input) return <p className="m-0 text-small text-muted">{t('node.formula.sqlNoInput')}</p>;
  const r = generatedSql(input, items, params);
  if ('error' in r) {
    return (
      <p className="m-0 text-small text-coral-text">
        {t('node.formula.sqlError', { n: r.index + 1 })}
      </p>
    );
  }
  return (
    <>
      <pre
        data-testid="formula-sql"
        tabIndex={0}
        className="m-0 max-h-80 overflow-auto rounded-control border border-line bg-page p-3 font-mono text-small whitespace-pre-wrap text-ink"
      >
        {r.sql}
      </pre>
      <p className="m-0 text-small text-muted">{t('node.formula.sqlHint')}</p>
    </>
  );
}

function FunctionTable({ id, t }: { id: string; t: T }) {
  return (
    <section
      id={id}
      aria-label={t('node.formula.functionsTitle', { count: FUNCTIONS.length })}
      className="flex flex-col gap-3"
    >
      <h3 className={labelClass + ' m-0'}>
        {t('node.formula.functionsTitle', { count: FUNCTIONS.length })}
      </h3>
      {FUNCTION_GROUPS.map((g) => (
        <table
          key={g}
          data-testid={`formula-fn-${g}`}
          className="w-full border-collapse text-small"
        >
          <caption className="pb-1 text-left font-semibold text-ink">
            {t(`node.formula.groups.${g}`)}
          </caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 pr-2 font-semibold">
                {t('node.formula.colSyntax')}
              </th>
              <th scope="col" className="py-1 font-semibold">
                {t('node.formula.colDesc')}
              </th>
            </tr>
          </thead>
          <tbody>
            {FUNCTIONS.filter((f) => f.group === g).map((f) => (
              <tr key={f.name} className="border-t border-line align-top">
                <td className="py-1.5 pr-2 font-mono break-words text-ink">
                  {t(`formula.fn.${f.name}.syntax`)}
                </td>
                <td className="py-1.5 text-body">
                  {t(`formula.fn.${f.name}.desc`)}
                  <br />
                  <span className="text-muted">
                    {t('node.formula.colExample')}:{' '}
                    <code className="font-mono">{t(`formula.fn.${f.name}.example`)}</code>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </section>
  );
}
