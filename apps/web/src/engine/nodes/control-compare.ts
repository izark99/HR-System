import { CompareConfigSchema, type CompareConfig } from '@hrflow/flow-schema';
import { Big, decimalFrom, isDecimal, ZERO, type Decimal } from '../core/decimal';
import type { NodePlugin } from '../core/plugin';
import {
  EngineError,
  type ColumnDef,
  type EngineContext,
  type Row,
  type Table,
  type Value,
} from '../core/types';

/**
 * `control.compare` (spec §24.2): reconcile two tables by key.
 * diff = right − left; a metric mismatches when |diff| > tolerance (diff == tolerance matches).
 * All arithmetic is decimal (big.js).
 */

export const MISMATCHED_METRICS_COLUMN = '_mismatched_metrics';

interface MetricPlan {
  label: string;
  left: string;
  right: string;
  tolerance: Decimal;
  keyLeft: string;
  keyRight: string;
  keyDiff: string;
}

/**
 * Output column keys are `<column>__left/right/diff`. Two metrics may compare the same column pair
 * (e.g. different tolerances), so a key already taken — by an earlier metric or by a key/carry
 * column — gets the 1-based metric index as suffix (`cong_2__left`). Keys of the first metric on a
 * pair stay stable.
 */
function metricPlans(config: CompareConfig): MetricPlan[] {
  const taken = new Set<string>([
    ...config.keys,
    ...config.carryColumns,
    MISMATCHED_METRICS_COLUMN,
  ]);
  return config.metrics.map((m, i) => {
    const base = m.left === m.right ? m.left : `${m.left}_${m.right}`;
    const keysFor = (id: string) => [`${id}__left`, `${id}__right`, `${id}__diff`] as const;
    let keys = keysFor(base);
    for (let n = i + 1; keys.some((k) => taken.has(k)); n++) keys = keysFor(`${base}_${n}`);
    for (const k of keys) taken.add(k);
    const [keyLeft, keyRight, keyDiff] = keys;
    return {
      label: m.label,
      left: m.left,
      right: m.right,
      tolerance: decimalFrom(m.tolerance),
      keyLeft,
      keyRight,
      keyDiff,
    };
  });
}

function sideLabels(config: CompareConfig, ctx: EngineContext) {
  return {
    left: config.sideLabels?.left ?? ctx.t('compare.side.left'),
    right: config.sideLabels?.right ?? ctx.t('compare.side.right'),
  };
}

const NUMERIC = new Set(['decimal', 'integer']);

function checkColumns(
  config: CompareConfig,
  left: ColumnDef[],
  right: ColumnDef[],
  ctx: EngineContext,
) {
  const sides = sideLabels(config, ctx);
  const need = (cols: ColumnDef[], side: string, name: string, numeric: boolean) => {
    const col = cols.find((c) => c.key === name);
    if (!col) throw new EngineError('compare.error.missingColumn', { side, column: name });
    if (numeric && !NUMERIC.has(col.type)) {
      throw new EngineError('compare.error.notNumeric', { side, column: name });
    }
    return col;
  };
  for (const k of config.keys) {
    need(left, sides.left, k, false);
    need(right, sides.right, k, false);
  }
  for (const m of config.metrics) {
    need(left, sides.left, m.left, true);
    need(right, sides.right, m.right, true);
  }
  for (const c of config.carryColumns) {
    if (!left.some((x) => x.key === c) && !right.some((x) => x.key === c)) {
      throw new EngineError('compare.error.missingColumn', { side: sides.left, column: c });
    }
  }
}

function outputSchemas(
  config: CompareConfig,
  left: ColumnDef[],
  right: ColumnDef[],
  ctx: EngineContext,
): Record<'summary' | 'mismatched' | 'only_left' | 'only_right', ColumnDef[]> {
  const sides = sideLabels(config, ctx);
  const t = ctx.t;
  const find = (key: string) => left.find((c) => c.key === key) ?? right.find((c) => c.key === key);
  const passthrough = (key: string): ColumnDef => {
    const c = find(key)!;
    return { key: c.key, type: c.type, ...(c.title ? { title: c.title } : {}) };
  };

  const summary: ColumnDef[] = [
    { key: 'metric', type: 'string', title: t('compare.summary.metric') },
    { key: 'tolerance', type: 'decimal', title: t('compare.summary.tolerance') },
    { key: 'matched', type: 'integer', title: t('compare.summary.matched') },
    { key: 'mismatched', type: 'integer', title: t('compare.summary.mismatched') },
    {
      key: 'only_left',
      type: 'integer',
      title: t('compare.summary.onlyLeft', { side: sides.left }),
    },
    {
      key: 'only_right',
      type: 'integer',
      title: t('compare.summary.onlyRight', { side: sides.right }),
    },
    { key: 'total_diff', type: 'decimal', title: t('compare.summary.totalDiff') },
  ];

  const mismatched: ColumnDef[] = [
    ...config.keys.map(passthrough),
    ...config.carryColumns.filter((c) => !config.keys.includes(c)).map(passthrough),
  ];
  for (const m of metricPlans(config)) {
    mismatched.push(
      {
        key: m.keyLeft,
        type: 'decimal',
        title: t('compare.column.left', { metric: m.label, side: sides.left }),
      },
      {
        key: m.keyRight,
        type: 'decimal',
        title: t('compare.column.right', { metric: m.label, side: sides.right }),
      },
      { key: m.keyDiff, type: 'decimal', title: t('compare.column.diff', { metric: m.label }) },
    );
  }
  mismatched.push({
    key: MISMATCHED_METRICS_COLUMN,
    type: 'string',
    title: t('compare.column.mismatchedMetrics'),
  });

  return { summary, mismatched, only_left: [...left], only_right: [...right] };
}

function toDecimal(v: Value): Decimal | null {
  if (v === null || v === undefined) return null;
  if (isDecimal(v)) return v;
  if (typeof v === 'number') return new Big(v);
  // Column types were checked up front; anything else is a programming error.
  throw new EngineError('compare.error.notNumeric', { side: '', column: String(v) });
}

/**
 * Key values match case-insensitively with surrounding/repeated whitespace ignored
 * ("nv00001 " = "NV00001"). Output rows keep each side's original values.
 */
export function normalizeKeyPart(v: Value | undefined): string {
  if (v === null || v === undefined) return '';
  const s = isDecimal(v) ? v.toString() : String(v);
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function indexByKey(table: Table, keys: string[], side: string): Map<string, Row> {
  const index = new Map<string, Row>();
  for (const row of table.rows) {
    const parts = keys.map((k) => normalizeKeyPart(row[k]));
    const id = JSON.stringify(parts);
    if (index.has(id)) {
      const shown = keys.map((k) => normalizeKeyPart(row[k]) && String(row[k]).trim());
      throw new EngineError('compare.error.duplicateKey', { side, key: shown.join(' | ') });
    }
    index.set(id, row);
  }
  return index;
}

export function executeCompare(
  config: CompareConfig,
  left: Table,
  right: Table,
  ctx: EngineContext,
): Record<'summary' | 'mismatched' | 'only_left' | 'only_right', Table> {
  checkColumns(config, left.columns, right.columns, ctx);
  const schemas = outputSchemas(config, left.columns, right.columns, ctx);
  const sides = sideLabels(config, ctx);
  const plans = metricPlans(config);
  const leftIndex = indexByKey(left, config.keys, sides.left);
  const rightIndex = indexByKey(right, config.keys, sides.right);

  const perMetric = plans.map(() => ({ matched: 0, mismatched: 0, totalDiff: ZERO }));
  const mismatchedRows: Row[] = [];
  const onlyLeft: Row[] = [];
  let matchedKeys = 0;
  const carry = config.carryColumns.filter((c) => !config.keys.includes(c));

  for (const [id, lrow] of leftIndex) {
    const rrow = rightIndex.get(id);
    if (!rrow) {
      onlyLeft.push({ ...lrow });
      continue;
    }
    const out: Row = {};
    for (const k of config.keys) out[k] = lrow[k] ?? null;
    for (const c of carry) out[c] = lrow[c] ?? rrow[c] ?? null;
    const failed: string[] = [];

    plans.forEach((m, i) => {
      const srcL = toDecimal(lrow[m.left] ?? null);
      const srcR = toDecimal(rrow[m.right] ?? null);
      let l = srcL;
      let r = srcR;
      if (config.nullAsZero) {
        l ??= ZERO;
        r ??= ZERO;
      }
      let diff: Decimal | null = null;
      let isMismatch: boolean;
      if (l === null || r === null) {
        // nullAsZero off: null vs null matches, null vs number mismatches.
        isMismatch = !(l === null && r === null);
      } else {
        diff = r.minus(l);
        isMismatch = diff.abs().gt(m.tolerance);
        perMetric[i]!.totalDiff = perMetric[i]!.totalDiff.plus(diff);
      }
      if (isMismatch) {
        perMetric[i]!.mismatched++;
        failed.push(m.label);
      } else {
        perMetric[i]!.matched++;
      }
      // Blank source values stay blank in the output, even when compared as 0.
      out[m.keyLeft] = srcL;
      out[m.keyRight] = srcR;
      out[m.keyDiff] = diff;
    });

    if (failed.length > 0) {
      out[MISMATCHED_METRICS_COLUMN] = failed.join(', ');
      mismatchedRows.push(out);
    } else {
      matchedKeys++;
    }
  }

  const onlyRight = [...rightIndex]
    .filter(([id]) => !leftIndex.has(id))
    .map(([, row]) => ({ ...row }));

  const summaryRows: Row[] = plans.map((m, i) => ({
    metric: m.label,
    tolerance: m.tolerance,
    matched: perMetric[i]!.matched,
    mismatched: perMetric[i]!.mismatched,
    only_left: onlyLeft.length,
    only_right: onlyRight.length,
    total_diff: perMetric[i]!.totalDiff,
  }));
  summaryRows.push({
    metric: ctx.t('compare.summary.totalRow'),
    tolerance: null,
    matched: matchedKeys,
    mismatched: mismatchedRows.length,
    only_left: onlyLeft.length,
    only_right: onlyRight.length,
    total_diff: null,
  });

  return {
    summary: { columns: schemas.summary, rows: summaryRows },
    mismatched: { columns: schemas.mismatched, rows: mismatchedRows },
    only_left: { columns: schemas.only_left, rows: onlyLeft },
    only_right: { columns: schemas.only_right, rows: onlyRight },
  };
}

export const controlComparePlugin: NodePlugin<CompareConfig> = {
  type: 'control.compare',
  configSchema: CompareConfigSchema,
  inputs: [
    { name: 'left', required: true },
    { name: 'right', required: true },
  ],
  outputs: [
    { name: 'summary', required: false },
    { name: 'mismatched', required: false },
    { name: 'only_left', required: false },
    { name: 'only_right', required: false },
  ],
  inferSchema(config, inputs, ctx) {
    const left = inputs.left ?? [];
    const right = inputs.right ?? [];
    checkColumns(config, left, right, ctx);
    return outputSchemas(config, left, right, ctx);
  },
  execute(config, inputs, ctx) {
    const { left, right } = inputs;
    if (!left || !right) throw new EngineError('compare.error.missingInput');
    return executeCompare(config, left, right, ctx);
  },
};
