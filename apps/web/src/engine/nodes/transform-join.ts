import { JoinConfigSchema, type JoinConfig } from '@hrflow/flow-schema';
import type { NodePlugin, SqlNodeContext } from '../core/plugin';
import type { ColumnDef } from '../core/types';
import {
  DUCK_TYPE,
  isBlank,
  mergeCtes,
  normKey,
  ORD,
  q,
  qName,
  withClause,
  type SqlRel,
} from '../duckdb/sql';
import { configError, findColumn, OUT_PORT, passColumn } from './shared';

const NUMERIC = new Set(['integer', 'decimal']);

interface JoinPlan {
  keys: { left: ColumnDef; right: ColumnDef }[];
  /** Output columns; `source` says where each comes from. */
  columns: { def: ColumnDef; side: 'left' | 'right'; from: string; isKey: boolean }[];
}

function planJoin(config: JoinConfig, left: readonly ColumnDef[], right: readonly ColumnDef[]) {
  const keys = config.on.map((p, i) => {
    const l = findColumn(left, p.left, 'join.error.unknownColumn', `on.${i}.left`);
    const r = findColumn(right, p.right, 'join.error.unknownColumn', `on.${i}.right`);
    if (l.type !== r.type && !(NUMERIC.has(l.type) && NUMERIC.has(r.type))) {
      throw configError('join.error.keyTypeMismatch', `on.${i}`, {
        left: p.left,
        right: p.right,
      });
    }
    return { left: l, right: r };
  });
  const keepsRightRows = config.how === 'right' || config.how === 'full';
  const columns: JoinPlan['columns'] = left.map((c) => {
    const key = keys.find((k) => k.left.key === c.key);
    const def = passColumn(c);
    // Key values of right-only rows come from the right side; integer + decimal → decimal.
    if (key && keepsRightRows && key.right.type !== c.type) def.type = 'decimal';
    return { def, side: 'left' as const, from: c.key, isKey: key !== undefined };
  });
  if (config.how === 'anti') return { keys, columns };

  const rightKeys = new Set(config.on.map((p) => p.right));
  const picked = config.rightColumns
    ? config.rightColumns.map((k, i) =>
        findColumn(right, k, 'join.error.unknownColumn', `rightColumns.${i}`),
      )
    : right.filter((c) => !rightKeys.has(c.key));
  const taken = new Set(columns.map((c) => c.def.key));
  for (const c of picked) {
    let key = c.key;
    if (taken.has(key)) key = `${key}${config.rightSuffix}`;
    if (taken.has(key)) {
      throw configError('join.error.columnConflict', 'rightColumns', { column: c.key });
    }
    taken.add(key);
    columns.push({ def: { ...passColumn(c), key }, side: 'right', from: c.key, isKey: false });
  }
  return { keys, columns };
}

/** Key expression of one side: normalized for string keys when `normalizeKeys`. */
/**
 * Key expression of one side. Blank string keys become NULL so they never match, and the join
 * condition stays a plain equality (DuckDB then uses a hash join; an extra non-equi predicate
 * in the ON clause of an outer join would force a nested-loop join).
 */
function keyExpr(alias: string, col: ColumnDef, normalize: boolean): string {
  const x = `${alias}.${q(col.key)}`;
  if (col.type !== 'string') return x;
  if (normalize) return `NULLIF(${normKey(x)}, '')`;
  return `CASE WHEN ${isBlank(x, 'string')} THEN NULL ELSE ${x} END`;
}

/** Join condition: blank keys never match (spec §12.1.4). */
function condition(plan: JoinPlan, normalize: boolean): string {
  return plan.keys
    .map((k) => `${keyExpr('l', k.left, normalize)} = ${keyExpr('r', k.right, normalize)}`)
    .join(' AND ');
}

const JOIN_SQL = { inner: 'JOIN', left: 'LEFT JOIN', right: 'RIGHT JOIN', full: 'FULL OUTER JOIN' };

/** `transform.join` (spec §12.1.4). DuckDB. */
export const transformJoinPlugin: NodePlugin<JoinConfig> = {
  type: 'transform.join',
  configSchema: JoinConfigSchema,
  inputs: [
    { name: 'left', required: true },
    { name: 'right', required: true },
  ],
  outputs: [{ name: OUT_PORT, required: false }],
  inferSchema(config, inputs) {
    const plan = planJoin(config, inputs.left ?? [], inputs.right ?? []);
    return { [OUT_PORT]: plan.columns.map((c) => c.def) };
  },
  runSql(config, inputs, ctx) {
    let left = inputs.left!;
    let right = inputs.right!;
    if (config.how !== 'anti') {
      // The rowsMultiplied check reads both inputs once more: evaluate lazy chains only once.
      left = ctx.sql.materialize(left);
      right = ctx.sql.materialize(right);
    }
    const plan = planJoin(config, left.columns, right.columns);
    const columns = plan.columns.map((c) => c.def);
    const on = condition(plan, config.normalizeKeys);
    const L = qName(left.name);
    const R = qName(right.name);

    if (config.how === 'anti') {
      const sql = `SELECT l.* FROM ${L} l WHERE NOT EXISTS (SELECT 1 FROM ${R} r WHERE ${on})`;
      return { [OUT_PORT]: ctx.sql.derive([left, right], columns, sql, []) };
    }

    warnMultiplied(config, plan, left, right, ctx);
    const keepsRightRows = config.how === 'right' || config.how === 'full';
    const list = plan.columns.map((c) => {
      if (c.side === 'right') return `r.${q(c.from)} AS ${q(c.def.key)}`;
      const key = plan.keys.find((k) => k.left.key === c.from);
      if (key && keepsRightRows) {
        return `coalesce(CAST(l.${q(c.from)} AS ${DUCK_TYPE[c.def.type]}), CAST(r.${q(key.right.key)} AS ${DUCK_TYPE[c.def.type]})) AS ${q(c.def.key)}`;
      }
      return `l.${q(c.from)} AS ${q(c.def.key)}`;
    });
    // Row order: left order, then right order; right-only rows last (spec §12.1.4).
    list.push(`row_number() OVER (ORDER BY l.${ORD} NULLS LAST, r.${ORD} NULLS LAST) AS ${ORD}`);
    const sql = `SELECT ${list.join(', ')} FROM ${L} l ${JOIN_SQL[config.how]} ${R} r ON ${on}`;
    return { [OUT_PORT]: ctx.sql.derive([left, right], columns, sql, []) };
  },
};

/**
 * Many-to-many: count the keys present on the left that match several right rows
 * (`join.warning.rowsMultiplied`, count only — never key values).
 */
function warnMultiplied(
  config: JoinConfig,
  plan: JoinPlan,
  left: SqlRel,
  right: SqlRel,
  ctx: SqlNodeContext,
): void {
  const n = config.normalizeKeys;
  const rk = plan.keys.map((k, i) => `${keyExpr('r', k.right, n)} AS k${i}`).join(', ');
  const ks = plan.keys.map((_, i) => `k${i}`);
  const rNotBlank = ks.map((k) => `${k} IS NOT NULL`).join(' AND ');
  const match = plan.keys.map((k, i) => `${keyExpr('l', k.left, n)} = d.k${i}`).join(' AND ');
  const w = withClause(mergeCtes([left, right]));
  const sql =
    `${w.sql}SELECT count(*) FROM (SELECT ${ks.join(', ')} FROM (SELECT ${rk} FROM ${qName(right.name)} r) ` +
    `WHERE ${rNotBlank} GROUP BY ${ks.join(', ')} HAVING count(*) > 1) d ` +
    `WHERE EXISTS (SELECT 1 FROM ${qName(left.name)} l WHERE ${match})`;
  const result = ctx.sql.run(sql, w.params);
  const count = Number(result.getChildAt(0)?.get(0) ?? 0);
  if (count > 0) ctx.run.warn({ messageKey: 'join.warning.rowsMultiplied', params: { count } });
}
