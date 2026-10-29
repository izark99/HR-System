import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Callout } from '../../../components/ui';
import type { DesignIssue, DesignNodeInfo } from '../../../engine/design';
import type { ColumnInfo } from '../../../engine/protocol';
import type { DesignerDoc, DNode, JsonObject } from '../model';
import {
  CheckField,
  ColumnField,
  ColumnListField,
  issuesAt,
  LinesField,
  ListEditor,
  NumberField,
  SelectField,
  TextField,
} from './fields';

/**
 * Config form per node type (spec §12.1, §15.3 "Form cấu hình"): columns are picked from the
 * schema inferred upstream (no typing of column names); every field shows the engine's message
 * for its path.
 */

export interface NodeFormProps {
  node: DNode;
  info: DesignNodeInfo | undefined;
  issues: readonly DesignIssue[];
  doc: DesignerDoc;
  readOnly: boolean;
  onConfig: (config: JsonObject, mergeKey?: string, renames?: Record<string, string>) => void;
}

type Obj = Record<string, unknown>;
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const objs = (v: unknown): Obj[] =>
  Array.isArray(v)
    ? v.filter((x): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x))
    : [];
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const literalText = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function useForm(p: NodeFormProps) {
  const { t } = useTranslation('designer');
  const c = p.node.config;
  const set = (patch: Obj, field: string, renames?: Record<string, string>) =>
    p.onConfig({ ...c, ...patch }, `${p.node.id}:${field}`, renames);
  const unset = (key: string) => {
    const next = { ...c };
    delete next[key];
    p.onConfig(next, `${p.node.id}:${key}`);
  };
  const at = (path: string) => issuesAt(p.issues, path);
  const cols = (port: string): ColumnInfo[] | null => p.info?.inputs[port] ?? null;
  return { t, c, set, unset, at, cols, ro: p.readOnly };
}

function Section({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3.5">{children}</div>;
}

// ---- input.excel ------------------------------------------------------------------------------

function InputExcelForm(p: NodeFormProps) {
  const { t, c, set, at, ro } = useForm(p);
  const slots = p.doc.inputSlots.map((s) => ({
    value: str(s.key),
    label: str(s.label) ? `${str(s.label)} (${str(s.key)})` : str(s.key),
  }));
  return (
    <Section>
      <SelectField
        label={t('node.inputExcel.slot')}
        value={str(c.slot)}
        onChange={(v) => set({ slot: v }, 'slot')}
        options={slots}
        issues={at('slot')}
        disabled={ro}
        hint={slots.length === 0 ? t('node.inputExcel.noSlots') : t('node.inputExcel.hint')}
      />
    </Section>
  );
}

// ---- control.compare --------------------------------------------------------------------------

function CompareForm(p: NodeFormProps) {
  const { t, c, set, unset, at, cols, ro } = useForm(p);
  const left = cols('left');
  const right = cols('right');
  const both =
    left && right ? left.filter((l) => right.some((r) => r.key === l.key)) : (left ?? right);
  const union = [
    ...(left ?? []),
    ...(right ?? []).filter((r) => !left?.some((l) => l.key === r.key)),
  ];
  const metrics = objs(c.metrics);
  const sides: { left?: unknown; right?: unknown } | null =
    typeof c.sideLabels === 'object' && c.sideLabels !== null ? c.sideLabels : null;
  return (
    <Section>
      <ColumnListField
        label={t('node.compare.keys')}
        value={strs(c.keys)}
        onChange={(v) => set({ keys: v }, 'keys')}
        columns={both}
        issues={at('keys')}
        issuesFor={(i) => at(`keys.${i}`)}
        hint={t('node.compare.keysHint')}
        disabled={ro}
      />
      <ListEditor
        label={t('node.compare.metrics')}
        items={metrics}
        onChange={(v) => set({ metrics: v }, 'metrics')}
        issues={at('metrics')}
        create={() => ({ left: '', right: '', label: '', tolerance: '0' })}
        addLabel={t('node.compare.addMetric')}
        itemLabel={(i) => str(metrics[i]?.label) || t('node.compare.metricN', { n: i + 1 })}
        disabled={ro}
        render={(m, i, setItem) => (
          <>
            <TextField
              label={t('node.compare.metricLabel')}
              value={str(m.label)}
              onChange={(v) => setItem({ ...m, label: v })}
              issues={at(`metrics.${i}.label`)}
              disabled={ro}
            />
            <div className="grid grid-cols-2 gap-2">
              <ColumnField
                label={t('node.compare.left')}
                value={str(m.left)}
                onChange={(v) => setItem({ ...m, left: v, right: str(m.right) || v })}
                columns={left}
                issues={at(`metrics.${i}.left`)}
                disabled={ro}
              />
              <ColumnField
                label={t('node.compare.right')}
                value={str(m.right)}
                onChange={(v) => setItem({ ...m, right: v })}
                columns={right}
                issues={at(`metrics.${i}.right`)}
                disabled={ro}
              />
            </div>
            <TextField
              label={t('node.compare.tolerance')}
              value={typeof m.tolerance === 'number' ? String(m.tolerance) : str(m.tolerance, '0')}
              onChange={(v) => setItem({ ...m, tolerance: v.trim().replace(',', '.') })}
              issues={at(`metrics.${i}.tolerance`)}
              hint={t('node.compare.toleranceHint')}
              disabled={ro}
            />
          </>
        )}
      />
      <ColumnListField
        label={t('node.compare.carry')}
        value={strs(c.carryColumns)}
        onChange={(v) => set({ carryColumns: v }, 'carryColumns')}
        columns={union}
        issues={at('carryColumns')}
        issuesFor={(i) => at(`carryColumns.${i}`)}
        hint={t('node.compare.carryHint')}
        disabled={ro}
      />
      <CheckField
        label={t('node.compare.nullAsZero')}
        checked={bool(c.nullAsZero, true)}
        onChange={(v) => set({ nullAsZero: v }, 'nullAsZero')}
        hint={t('node.compare.nullAsZeroHint')}
        disabled={ro}
      />
      <CheckField
        label={t('node.compare.sideLabels')}
        checked={sides !== null}
        onChange={(v) =>
          v
            ? set(
                { sideLabels: { left: t('node.compare.sideA'), right: t('node.compare.sideB') } },
                'sideLabels',
              )
            : unset('sideLabels')
        }
        disabled={ro}
      />
      {sides && (
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label={t('node.compare.sideLeft')}
            value={str(sides.left)}
            onChange={(v) => set({ sideLabels: { ...sides, left: v } }, 'sideLabels.left')}
            issues={at('sideLabels.left')}
            disabled={ro}
          />
          <TextField
            label={t('node.compare.sideRight')}
            value={str(sides.right)}
            onChange={(v) => set({ sideLabels: { ...sides, right: v } }, 'sideLabels.right')}
            issues={at('sideLabels.right')}
            disabled={ro}
          />
        </div>
      )}
    </Section>
  );
}

// ---- output.excel -----------------------------------------------------------------------------

function nextPort(taken: readonly string[]): string {
  for (let i = 1; ; i++) if (!taken.includes(`sheet_${i}`)) return `sheet_${i}`;
}

function OutputExcelForm(p: NodeFormProps) {
  const { t, c, set, at, ro } = useForm(p);
  const sheets = objs(c.sheets);
  const params = p.doc.params.map((x) => str(x.key)).filter(Boolean);
  return (
    <Section>
      <TextField
        label={t('node.outputExcel.fileName')}
        value={str(c.fileName)}
        onChange={(v) => set({ fileName: v }, 'fileName')}
        issues={at('fileName')}
        hint={
          params.length > 0
            ? t('node.outputExcel.fileNameHint', { example: `{${params[0]}}` })
            : t('node.outputExcel.fileNameHintNoParam')
        }
        disabled={ro}
      />
      <ListEditor
        label={t('node.outputExcel.sheets')}
        items={sheets}
        onChange={(v) => set({ sheets: v }, 'sheets')}
        issues={at('sheets')}
        create={() => ({
          name: t('node.outputExcel.sheetN', { n: sheets.length + 1 }),
          port: nextPort(sheets.map((s) => str(s.port))),
        })}
        addLabel={t('node.outputExcel.addSheet')}
        itemLabel={(i) => str(sheets[i]?.name) || t('node.outputExcel.sheetN', { n: i + 1 })}
        disabled={ro}
        render={(s, i) => (
          <>
            <TextField
              label={t('node.outputExcel.sheetName')}
              value={str(s.name)}
              onChange={(v) =>
                set(
                  { sheets: sheets.map((x, k) => (k === i ? { ...x, name: v } : x)) },
                  `sheets.${i}.name`,
                )
              }
              issues={at(`sheets.${i}.name`)}
              disabled={ro}
            />
            <TextField
              label={t('node.outputExcel.port')}
              value={str(s.port)}
              mono
              onChange={(v) =>
                set(
                  { sheets: sheets.map((x, k) => (k === i ? { ...x, port: v } : x)) },
                  `sheets.${i}.port`,
                  { [str(s.port)]: v },
                )
              }
              issues={at(`sheets.${i}.port`)}
              hint={t('node.outputExcel.portHint')}
              disabled={ro}
            />
          </>
        )}
      />
    </Section>
  );
}

// ---- output.preview ---------------------------------------------------------------------------

function OutputPreviewForm(p: NodeFormProps) {
  const { t, c, set, unset, at, cols, ro } = useForm(p);
  const all = c.columns === undefined;
  return (
    <Section>
      <TextField
        label={t('node.preview.title')}
        value={str(c.title)}
        onChange={(v) => set({ title: v }, 'title')}
        issues={at('title')}
        hint={t('node.preview.titleHint')}
        disabled={ro}
      />
      <CheckField
        label={t('node.preview.allColumns')}
        checked={all}
        onChange={(v) =>
          v ? unset('columns') : set({ columns: (cols('in') ?? []).map((x) => x.key) }, 'columns')
        }
        disabled={ro}
      />
      {!all && (
        <ColumnListField
          label={t('node.preview.columns')}
          value={strs(c.columns)}
          onChange={(v) => set({ columns: v }, 'columns')}
          columns={cols('in')}
          issues={at('columns')}
          issuesFor={(i) => at(`columns.${i}`)}
          disabled={ro}
        />
      )}
      <NumberField
        label={t('node.preview.maxRows')}
        value={num(c.maxRows)}
        onChange={(v) => (v === undefined ? unset('maxRows') : set({ maxRows: v }, 'maxRows'))}
        issues={at('maxRows')}
        min={1}
        max={1_000_000}
        hint={t('node.preview.maxRowsHint')}
        disabled={ro}
      />
    </Section>
  );
}

// ---- transform.select -------------------------------------------------------------------------

function SelectForm(p: NodeFormProps) {
  const { t, c, set, at, cols, ro } = useForm(p);
  const items = objs(c.columns);
  const input = cols('in');
  return (
    <Section>
      {!ro && input && (
        <button
          type="button"
          className="min-h-target self-start rounded-control border border-line-input bg-card px-3.5 text-small font-semibold text-ink hover:bg-page"
          onClick={() => set({ columns: input.map((x) => ({ from: x.key })) }, 'columns')}
        >
          {t('node.select.all')}
        </button>
      )}
      <ListEditor
        label={t('node.select.columns')}
        items={items}
        onChange={(v) => set({ columns: v }, 'columns')}
        issues={at('columns')}
        create={() => ({ from: '' })}
        addLabel={t('node.select.add')}
        itemLabel={(i) =>
          str(items[i]?.key) || str(items[i]?.from) || t('node.select.columnN', { n: i + 1 })
        }
        disabled={ro}
        render={(col, i, setItem) => {
          const rest = (patch: Obj) => {
            const next: Obj = { ...col, ...patch };
            for (const k of ['key', 'title']) if (next[k] === '') delete next[k];
            setItem(next);
          };
          return (
            <>
              <ColumnField
                label={t('node.select.from')}
                value={str(col.from)}
                onChange={(v) => rest({ from: v })}
                columns={input}
                issues={at(`columns.${i}.from`)}
                disabled={ro}
              />
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label={t('node.select.key')}
                  value={str(col.key)}
                  mono
                  onChange={(v) => rest({ key: v })}
                  issues={at(`columns.${i}.key`)}
                  placeholder={str(col.from)}
                  disabled={ro}
                />
                <TextField
                  label={t('node.select.titleField')}
                  value={str(col.title)}
                  onChange={(v) => rest({ title: v })}
                  issues={at(`columns.${i}.title`)}
                  disabled={ro}
                />
              </div>
            </>
          );
        }}
      />
    </Section>
  );
}

// ---- transform.filter -------------------------------------------------------------------------

const FILTER_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'isBlank',
  'notBlank',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
] as const;
const LIST_OPS = new Set(['in', 'notIn']);
const NO_VALUE_OPS = new Set(['isBlank', 'notBlank']);

function FilterForm(p: NodeFormProps) {
  const { t, c, set, at, cols, ro } = useForm(p);
  const conditions = objs(c.conditions);
  const input = cols('in');
  const params = p.doc.params.map((x) => ({
    value: str(x.key),
    label: str(x.label) ? `${str(x.label)} (${str(x.key)})` : str(x.key),
  }));
  return (
    <Section>
      <SelectField
        label={t('node.filter.match')}
        value={str(c.match, 'all')}
        onChange={(v) => set({ match: v }, 'match')}
        options={[
          { value: 'all', label: t('node.filter.matchAll') },
          { value: 'any', label: t('node.filter.matchAny') },
        ]}
        disabled={ro}
      />
      <ListEditor
        label={t('node.filter.conditions')}
        items={conditions}
        onChange={(v) => set({ conditions: v }, 'conditions')}
        issues={at('conditions')}
        create={() => ({ column: '', op: 'eq', value: '' })}
        addLabel={t('node.filter.add')}
        itemLabel={(i) => t('node.filter.conditionN', { n: i + 1 })}
        disabled={ro}
        render={(cond, i, setItem) => {
          const op = str(cond.op, 'eq');
          const col = input?.find((x) => x.key === cond.column);
          const value = cond.value;
          const isParam = typeof value === 'object' && value !== null && 'param' in value;
          const setOp = (next: string) => {
            const out: Obj = { column: cond.column, op: next };
            if (LIST_OPS.has(next)) out.values = Array.isArray(cond.values) ? cond.values : [];
            else if (!NO_VALUE_OPS.has(next)) out.value = cond.value ?? '';
            setItem(out);
          };
          return (
            <>
              <ColumnField
                label={t('node.filter.column')}
                value={str(cond.column)}
                onChange={(v) => setItem({ ...cond, column: v })}
                columns={input}
                issues={at(`conditions.${i}.column`)}
                disabled={ro}
              />
              <SelectField
                label={t('node.filter.op')}
                value={op}
                onChange={setOp}
                options={FILTER_OPS.map((o) => ({ value: o, label: t(`node.filter.ops.${o}`) }))}
                issues={at(`conditions.${i}.op`)}
                disabled={ro}
              />
              {LIST_OPS.has(op) && (
                <LinesField
                  label={t('node.filter.values')}
                  value={(Array.isArray(cond.values) ? cond.values : []).map(String)}
                  onChange={(v) => setItem({ ...cond, values: v })}
                  issues={at(`conditions.${i}.values`)}
                  hint={t('node.filter.valuesHint')}
                  disabled={ro}
                />
              )}
              {!LIST_OPS.has(op) && !NO_VALUE_OPS.has(op) && (
                <>
                  <SelectField
                    label={t('node.filter.valueSource')}
                    value={isParam ? 'param' : 'literal'}
                    onChange={(v) =>
                      setItem({
                        ...cond,
                        value: v === 'param' ? { param: params[0]?.value ?? '' } : '',
                      })
                    }
                    options={[
                      { value: 'literal', label: t('node.filter.literal') },
                      { value: 'param', label: t('node.filter.param') },
                    ]}
                    disabled={ro}
                  />
                  {isParam ? (
                    <SelectField
                      label={t('node.filter.paramField')}
                      value={str((value as { param?: unknown }).param)}
                      onChange={(v) => setItem({ ...cond, value: { param: v } })}
                      options={params}
                      issues={at(`conditions.${i}.value`)}
                      hint={t('node.filter.paramHint')}
                      disabled={ro}
                    />
                  ) : col?.type === 'boolean' ? (
                    <SelectField
                      label={t('node.filter.value')}
                      value={value === true ? 'true' : value === false ? 'false' : ''}
                      onChange={(v) => setItem({ ...cond, value: v === 'true' })}
                      options={[
                        { value: 'true', label: t('form.yes') },
                        { value: 'false', label: t('form.no') },
                      ]}
                      issues={at(`conditions.${i}.value`)}
                      disabled={ro}
                    />
                  ) : (
                    <TextField
                      label={t('node.filter.value')}
                      value={literalText(value)}
                      onChange={(v) => setItem({ ...cond, value: v })}
                      issues={at(`conditions.${i}.value`)}
                      hint={col ? t(`node.filter.valueHint.${col.type}`) : undefined}
                      disabled={ro}
                    />
                  )}
                </>
              )}
            </>
          );
        }}
      />
      <CheckField
        label={t('node.filter.normalizeText')}
        checked={bool(c.normalizeText, true)}
        onChange={(v) => set({ normalizeText: v }, 'normalizeText')}
        hint={t('node.filter.normalizeTextHint')}
        disabled={ro}
      />
    </Section>
  );
}

// ---- transform.sort ---------------------------------------------------------------------------

function SortForm(p: NodeFormProps) {
  const { t, c, set, at, cols, ro } = useForm(p);
  const by = objs(c.by);
  return (
    <Section>
      <ListEditor
        label={t('node.sort.by')}
        items={by}
        onChange={(v) => set({ by: v }, 'by')}
        issues={at('by')}
        create={() => ({ column: '', direction: 'asc', blanks: 'last' })}
        addLabel={t('node.sort.add')}
        itemLabel={(i) => t('node.sort.levelN', { n: i + 1 })}
        disabled={ro}
        render={(s, i, setItem) => (
          <>
            <ColumnField
              label={t('node.sort.column')}
              value={str(s.column)}
              onChange={(v) => setItem({ ...s, column: v })}
              columns={cols('in')}
              issues={at(`by.${i}.column`)}
              disabled={ro}
            />
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label={t('node.sort.direction')}
                value={str(s.direction, 'asc')}
                onChange={(v) => setItem({ ...s, direction: v })}
                options={[
                  { value: 'asc', label: t('node.sort.asc') },
                  { value: 'desc', label: t('node.sort.desc') },
                ]}
                disabled={ro}
              />
              <SelectField
                label={t('node.sort.blanks')}
                value={str(s.blanks, 'last')}
                onChange={(v) => setItem({ ...s, blanks: v })}
                options={[
                  { value: 'last', label: t('node.sort.blanksLast') },
                  { value: 'first', label: t('node.sort.blanksFirst') },
                ]}
                disabled={ro}
              />
            </div>
          </>
        )}
      />
      <p className="m-0 text-small text-muted">{t('node.sort.hint')}</p>
    </Section>
  );
}

// ---- transform.join ---------------------------------------------------------------------------

function JoinForm(p: NodeFormProps) {
  const { t, c, set, unset, at, cols, ro } = useForm(p);
  const on = objs(c.on);
  const right = cols('right');
  const allRight = c.rightColumns === undefined;
  return (
    <Section>
      <SelectField
        label={t('node.join.how')}
        value={str(c.how, 'inner')}
        onChange={(v) => set({ how: v }, 'how')}
        options={['inner', 'left', 'right', 'full', 'anti'].map((h) => ({
          value: h,
          label: t(`node.join.hows.${h}`),
        }))}
        issues={at('how')}
        disabled={ro}
      />
      <ListEditor
        label={t('node.join.on')}
        items={on}
        onChange={(v) => set({ on: v }, 'on')}
        issues={at('on')}
        create={() => ({ left: '', right: '' })}
        addLabel={t('node.join.addKey')}
        itemLabel={(i) => t('node.join.keyN', { n: i + 1 })}
        disabled={ro}
        render={(k, i, setItem) => (
          <div className="grid grid-cols-2 gap-2">
            <ColumnField
              label={t('node.join.left')}
              value={str(k.left)}
              onChange={(v) => setItem({ ...k, left: v, right: str(k.right) || v })}
              columns={cols('left')}
              issues={at(`on.${i}.left`)}
              disabled={ro}
            />
            <ColumnField
              label={t('node.join.right')}
              value={str(k.right)}
              onChange={(v) => setItem({ ...k, right: v })}
              columns={right}
              issues={at(`on.${i}.right`)}
              disabled={ro}
            />
          </div>
        )}
      />
      <CheckField
        label={t('node.join.normalizeKeys')}
        checked={bool(c.normalizeKeys, true)}
        onChange={(v) => set({ normalizeKeys: v }, 'normalizeKeys')}
        hint={t('node.join.normalizeKeysHint')}
        disabled={ro}
      />
      <CheckField
        label={t('node.join.allRight')}
        checked={allRight}
        onChange={(v) =>
          v
            ? unset('rightColumns')
            : set(
                {
                  rightColumns: (right ?? [])
                    .map((x) => x.key)
                    .filter((k) => !on.some((o) => o.right === k)),
                },
                'rightColumns',
              )
        }
        disabled={ro}
      />
      {!allRight && (
        <ColumnListField
          label={t('node.join.rightColumns')}
          value={strs(c.rightColumns)}
          onChange={(v) => set({ rightColumns: v }, 'rightColumns')}
          columns={right}
          issues={at('rightColumns')}
          issuesFor={(i) => at(`rightColumns.${i}`)}
          disabled={ro}
        />
      )}
      <TextField
        label={t('node.join.rightSuffix')}
        value={str(c.rightSuffix, '_r')}
        mono
        onChange={(v) => set({ rightSuffix: v }, 'rightSuffix')}
        issues={at('rightSuffix')}
        hint={t('node.join.rightSuffixHint')}
        disabled={ro}
      />
    </Section>
  );
}

// ---- transform.union --------------------------------------------------------------------------

function UnionForm(p: NodeFormProps) {
  const { t, c, set, unset, at, ro } = useForm(p);
  const count = num(c.inputCount) ?? 2;
  const sourceRaw: { key?: unknown; labels?: unknown } | null =
    typeof c.sourceColumn === 'object' && c.sourceColumn !== null ? c.sourceColumn : null;
  const source = sourceRaw ? { key: str(sourceRaw.key), labels: strs(sourceRaw.labels) } : null;
  const labels = (n: number, old: readonly string[] = []) =>
    Array.from({ length: n }, (_, i) => old[i] ?? t('node.union.inputN', { n: i + 1 }));
  return (
    <Section>
      <NumberField
        label={t('node.union.inputCount')}
        value={count}
        min={2}
        max={10}
        onChange={(v) => {
          const n = v ?? 2;
          set(
            {
              inputCount: n,
              ...(source ? { sourceColumn: { ...source, labels: labels(n, source.labels) } } : {}),
            },
            'inputCount',
          );
        }}
        issues={at('inputCount')}
        hint={t('node.union.inputCountHint')}
        disabled={ro}
      />
      <SelectField
        label={t('node.union.missing')}
        value={str(c.missingColumns, 'null')}
        onChange={(v) => set({ missingColumns: v }, 'missingColumns')}
        options={[
          { value: 'null', label: t('node.union.missingNull') },
          { value: 'error', label: t('node.union.missingError') },
        ]}
        disabled={ro}
      />
      <CheckField
        label={t('node.union.source')}
        checked={source !== null}
        onChange={(v) =>
          v
            ? set({ sourceColumn: { key: 'nguon', labels: labels(count) } }, 'sourceColumn')
            : unset('sourceColumn')
        }
        hint={t('node.union.sourceHint')}
        disabled={ro}
      />
      {source && (
        <>
          <TextField
            label={t('node.union.sourceKey')}
            value={str(source.key)}
            mono
            onChange={(v) => set({ sourceColumn: { ...source, key: v } }, 'sourceColumn.key')}
            issues={at('sourceColumn.key')}
            disabled={ro}
          />
          {labels(count, source.labels).map((l, i) => (
            <TextField
              key={i}
              label={t('node.union.labelFor', { port: `in_${i + 1}` })}
              value={l}
              onChange={(v) =>
                set(
                  {
                    sourceColumn: {
                      ...source,
                      labels: labels(count, source.labels).map((x, k) => (k === i ? v : x)),
                    },
                  },
                  `sourceColumn.labels.${i}`,
                )
              }
              issues={at(`sourceColumn.labels.${i}`)}
              disabled={ro}
            />
          ))}
        </>
      )}
    </Section>
  );
}

// ---- transform.groupBy ------------------------------------------------------------------------

const AGG_FNS = ['sum', 'avg', 'min', 'max', 'count', 'countDistinct', 'countRows'];

function GroupByForm(p: NodeFormProps) {
  const { t, c, set, at, cols, ro } = useForm(p);
  const aggs = objs(c.aggregations);
  const input = cols('in');
  return (
    <Section>
      <ColumnListField
        label={t('node.groupBy.by')}
        value={strs(c.by)}
        onChange={(v) => set({ by: v }, 'by')}
        columns={input}
        issues={at('by')}
        issuesFor={(i) => at(`by.${i}`)}
        hint={t('node.groupBy.byHint')}
        disabled={ro}
      />
      <ListEditor
        label={t('node.groupBy.aggregations')}
        items={aggs}
        onChange={(v) => set({ aggregations: v }, 'aggregations')}
        issues={at('aggregations')}
        create={() => ({ key: '', fn: 'sum', column: '' })}
        addLabel={t('node.groupBy.add')}
        itemLabel={(i) => str(aggs[i]?.key) || t('node.groupBy.aggN', { n: i + 1 })}
        disabled={ro}
        render={(a, i, setItem) => {
          const fn = str(a.fn, 'sum');
          const patch = (x: Obj) => {
            const next: Obj = { ...a, ...x };
            if (next.title === '') delete next.title;
            if (next.fn === 'countRows') delete next.column;
            setItem(next);
          };
          return (
            <>
              <SelectField
                label={t('node.groupBy.fn')}
                value={fn}
                onChange={(v) =>
                  patch({ fn: v, ...(v !== 'countRows' ? { column: str(a.column) } : {}) })
                }
                options={AGG_FNS.map((f) => ({ value: f, label: t(`node.groupBy.fns.${f}`) }))}
                issues={at(`aggregations.${i}.fn`)}
                disabled={ro}
              />
              {fn !== 'countRows' && (
                <ColumnField
                  label={t('node.groupBy.column')}
                  value={str(a.column)}
                  onChange={(v) =>
                    patch({ column: v, key: str(a.key) || `${fn}_${v}`.toLowerCase() })
                  }
                  columns={input}
                  issues={at(`aggregations.${i}.column`)}
                  disabled={ro}
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label={t('node.groupBy.key')}
                  value={str(a.key)}
                  mono
                  onChange={(v) => patch({ key: v })}
                  issues={at(`aggregations.${i}.key`)}
                  disabled={ro}
                />
                <TextField
                  label={t('node.groupBy.titleField')}
                  value={str(a.title)}
                  onChange={(v) => patch({ title: v })}
                  issues={at(`aggregations.${i}.title`)}
                  disabled={ro}
                />
              </div>
            </>
          );
        }}
      />
      <p className="m-0 text-small text-muted">{t('node.groupBy.hint')}</p>
    </Section>
  );
}

// ---- transform.dedupe -------------------------------------------------------------------------

function DedupeForm(p: NodeFormProps) {
  const { t, c, set, at, cols, ro } = useForm(p);
  return (
    <Section>
      <ColumnListField
        label={t('node.dedupe.keys')}
        value={strs(c.keys)}
        onChange={(v) => set({ keys: v }, 'keys')}
        columns={cols('in')}
        issues={at('keys')}
        issuesFor={(i) => at(`keys.${i}`)}
        disabled={ro}
      />
      <SelectField
        label={t('node.dedupe.keep')}
        value={str(c.keep, 'first')}
        onChange={(v) => set({ keep: v }, 'keep')}
        options={[
          { value: 'first', label: t('node.dedupe.first') },
          { value: 'last', label: t('node.dedupe.last') },
        ]}
        disabled={ro}
      />
      <CheckField
        label={t('node.dedupe.normalizeKeys')}
        checked={bool(c.normalizeKeys, true)}
        onChange={(v) => set({ normalizeKeys: v }, 'normalizeKeys')}
        hint={t('node.join.normalizeKeysHint')}
        disabled={ro}
      />
      <p className="m-0 text-small text-muted">{t('node.dedupe.hint')}</p>
    </Section>
  );
}

// ---- code.sql ---------------------------------------------------------------------------------

function CodeSqlForm(p: NodeFormProps) {
  const { t, c, set, at, ro } = useForm(p);
  const inputs = objs(c.inputs);
  const sqlId = `${p.node.id}-sql`;
  const sqlIssues = at('sql');
  return (
    <Section>
      <ListEditor
        label={t('node.sql.inputs')}
        items={inputs}
        onChange={(v) => set({ inputs: v }, 'inputs')}
        issues={at('inputs')}
        create={() => {
          const taken = inputs.map((x) => str(x.port));
          let n = inputs.length + 1;
          while (taken.includes(`bang_${n}`)) n++;
          return { port: `bang_${n}` };
        }}
        addLabel={t('node.sql.addInput')}
        itemLabel={(i) => str(inputs[i]?.port) || t('node.sql.inputN', { n: i + 1 })}
        disabled={ro}
        render={(x, i) => (
          <TextField
            label={t('node.sql.port')}
            value={str(x.port)}
            mono
            onChange={(v) =>
              set(
                { inputs: inputs.map((y, k) => (k === i ? { port: v } : y)) },
                `inputs.${i}.port`,
                { [str(x.port)]: v },
              )
            }
            issues={at(`inputs.${i}.port`)}
            hint={t('node.sql.portHint')}
            disabled={ro}
          />
        )}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={sqlId} className="text-small font-semibold text-body">
          {t('node.sql.sql')}
        </label>
        <textarea
          id={sqlId}
          rows={10}
          spellCheck={false}
          value={str(c.sql)}
          disabled={ro}
          aria-invalid={sqlIssues.length > 0 || undefined}
          onChange={(e) => set({ sql: e.target.value }, 'sql')}
          className={
            'w-full rounded-control border bg-card px-3 py-2 font-mono text-small text-ink disabled:bg-neutral ' +
            (sqlIssues.length > 0 ? 'border-2 border-coral' : 'border-line-input')
          }
        />
        <p className="m-0 text-small text-muted">{t('node.sql.editorLater')}</p>
      </div>
    </Section>
  );
}

const FORMS: Record<string, (p: NodeFormProps) => ReactNode> = {
  'input.excel': InputExcelForm,
  'control.compare': CompareForm,
  'output.excel': OutputExcelForm,
  'output.preview': OutputPreviewForm,
  'transform.select': SelectForm,
  'transform.filter': FilterForm,
  'transform.sort': SortForm,
  'transform.join': JoinForm,
  'transform.union': UnionForm,
  'transform.groupBy': GroupByForm,
  'transform.dedupe': DedupeForm,
  'code.sql': CodeSqlForm,
};

export function NodeConfigForm(p: NodeFormProps) {
  const { t } = useTranslation('designer');
  const Form = FORMS[p.node.type];
  if (!Form) {
    return (
      <Callout tone="amber" label={t('form.noteLabel')}>
        {t('form.unknownType', { type: p.node.type })}
      </Callout>
    );
  }
  return <Form {...p} />;
}
