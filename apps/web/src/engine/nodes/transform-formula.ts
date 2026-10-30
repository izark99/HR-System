import { FormulaConfigSchema, type FlowDefinition, type FormulaConfig } from '@hrflow/flow-schema';
import { decimalFromNumber } from '../core/decimal';
import type { NodeIssue, NodePlugin } from '../core/plugin';
import { EngineError, type ColumnDef, type ParamValue } from '../core/types';
import { decimalToSql, ORD, q, qName } from '../duckdb/sql';
import {
  compileFormula,
  FormulaColumnError,
  runnableSql,
  type Binding,
  type CompiledFormula,
  type InputColumn,
} from '../formula/compile';
import { toDisplay, type RefColumn } from '../formula/refs';
import { configError, IN_PORT, isBlankParam, OUT_PORT, passColumn } from './shared';

/**
 * `transform.formula` (spec §12.2): computed columns from Excel formulas, transpiled to DuckDB
 * SQL (formula/compile.ts). Constants and params are bound values. Rows that fail (#DIV/0!, …)
 * are left blank with a warning (counts + row numbers, never cell values) or stop the run,
 * per column (`onError`).
 */

/** Rows listed per error type in the warning (spec §12.2). */
const MAX_ROWS_LISTED = 5;

function paramDefs(flow: FlowDefinition | undefined) {
  return (flow?.params ?? []).map((p) => ({ key: p.key, type: p.type }));
}

/** Columns visible to column `index` (input + earlier formula columns), for display texts. */
function refsAt(config: FormulaConfig, input: readonly ColumnDef[], index: number): RefColumn[] {
  const refs: RefColumn[] = input.map((c) => ({ key: c.key, title: c.title ?? c.key }));
  config.columns.slice(0, index).forEach((c) => {
    const prev = refs.findIndex((r) => r.key === c.key);
    const title = c.title ?? (prev >= 0 ? refs[prev]!.title : c.key);
    if (prev >= 0) refs[prev] = { key: c.key, title };
    else refs.push({ key: c.key, title });
  });
  return refs;
}

/** Compile, turning formula errors into config errors on the right field (spec §12.1). */
export function compileFormulaNode(
  config: FormulaConfig,
  input: readonly ColumnDef[],
  flow: FlowDefinition | undefined,
): CompiledFormula {
  const opts = { params: paramDefs(flow) };
  const cols: InputColumn[] = input.map((c) => ({
    key: c.key,
    type: c.type,
    title: c.title ?? c.key,
  }));
  try {
    return compileFormula(config.columns, cols, opts);
  } catch (err) {
    if (!(err instanceof FormulaColumnError)) throw err;
    const i = err.index;
    const cause = err.error;
    let pos = cause.pos;
    // Positions are reported on the text the Admin sees (references shown by title).
    if (err.field === 'formula' && pos !== undefined) {
      const shown = toDisplay(config.columns[i]!.formula, refsAt(config, input, i));
      const columns = config.columns.map((c, k) => (k === i ? { ...c, formula: shown } : c));
      try {
        compileFormula(columns, cols, opts);
      } catch (again) {
        if (
          again instanceof FormulaColumnError &&
          again.index === i &&
          again.error.pos !== undefined
        ) {
          pos = again.error.pos;
        }
      }
    }
    throw configError(cause.messageKey, `columns.${i}.${err.field}`, {
      ...cause.params,
      formulaColumn: config.columns[i]!.title ?? config.columns[i]!.key,
      ...(pos !== undefined ? { pos: pos + 1 } : {}),
    });
  }
}

function outputColumns(plan: CompiledFormula, input: readonly ColumnDef[]): ColumnDef[] {
  return plan.output.map((c) => {
    const f = plan.columns.find((x) => x.key === c.key);
    if (!f) return passColumn(input.find((x) => x.key === c.key)!);
    return { key: c.key, type: c.type, title: f.title };
  });
}

/** Runtime param → bound text (cast in SQL): month → first day, number → decimal text. */
function paramValue(
  b: Extract<Binding, { kind: 'param' }>,
  v: ParamValue | undefined,
): string | null {
  if (isBlankParam(v)) return null;
  switch (b.type) {
    case 'month':
      return /^\d{4}-\d{2}$/.test(String(v)) ? `${String(v)}-01` : null;
    case 'number':
      try {
        return typeof v === 'number' ? decimalToSql(decimalFromNumber(v)) : String(v).trim();
      } catch {
        return null;
      }
    case 'boolean':
      return typeof v === 'boolean' ? String(v) : String(v).trim().toLowerCase();
    default:
      return String(v);
  }
}

export const transformFormulaPlugin: NodePlugin<FormulaConfig> = {
  type: 'transform.formula',
  configSchema: FormulaConfigSchema,
  inputs: [{ name: IN_PORT, required: true }],
  outputs: [{ name: OUT_PORT, required: false }],
  inferSchema(config, inputs, ctx) {
    const input = inputs[IN_PORT] ?? [];
    return { [OUT_PORT]: outputColumns(compileFormulaNode(config, input, ctx.flow), input) };
  },
  warnings(config, inputs, ctx) {
    const plan = compileFormulaNode(config, inputs[IN_PORT] ?? [], ctx.flow);
    return plan.columns
      .filter((c) => c.mixedTypes)
      .map((c): NodeIssue => ({
        messageKey: 'formula.warning.mixedTypes',
        params: { column: c.title, path: `columns.${c.index}.formula` },
      }));
  },
  runSql(config, inputs, ctx) {
    const input = inputs[IN_PORT]!;
    const plan = compileFormulaNode(config, input.columns, ctx.flow);
    const values = plan.bindings.map((b) =>
      b.kind === 'const' ? b.value : paramValue(b, ctx.run.params[b.key]),
    );
    const out = outputColumns(plan, input.columns);
    const failing = plan.columns.filter((c) => c.err !== null);
    const sql = runnableSql(plan.sql(qName(input.name), ORD, failing.length > 0));
    if (failing.length === 0) {
      return { [OUT_PORT]: ctx.sql.derive([input], out, sql, values) };
    }

    // Some rows may fail: evaluate once, then count errors per column (no cell values read).
    const errKey = (index: number) => `hr$err${index}`;
    const errCols: ColumnDef[] = failing.map((c) => ({ key: errKey(c.index), type: 'string' }));
    const table = ctx.sql.materialize(ctx.sql.derive([input], [...out, ...errCols], sql, values));
    for (const c of failing) {
      const e = q(errKey(c.index));
      const res = ctx.sql.run(
        `SELECT ${e} AS code, count(*) AS n, min(${ORD}) AS first FROM ${qName(table.name)} WHERE ${e} IS NOT NULL GROUP BY 1 ORDER BY 3`,
      );
      const groups: { code: string; count: number; first: number }[] = [];
      for (let r = 0; r < res.numRows; r++) {
        groups.push({
          code: String(res.getChild('code')!.get(r)),
          count: Number(res.getChild('n')!.get(r)),
          first: Number(res.getChild('first')!.get(r)),
        });
      }
      if (groups.length === 0) continue;
      if (c.onError === 'fail') {
        const g = groups[0]!;
        throw new EngineError('formula.error.rowError', {
          column: c.title,
          error: g.code,
          row: g.first,
          count: groups.reduce((s, x) => s + x.count, 0),
        });
      }
      for (const g of groups) {
        const rows = ctx.sql.run(
          `SELECT ${ORD} AS r FROM ${qName(table.name)} WHERE ${e} = ? ORDER BY ${ORD} LIMIT ${MAX_ROWS_LISTED}`,
          [g.code],
        );
        const list: number[] = [];
        for (let r = 0; r < rows.numRows; r++) list.push(Number(rows.getChild('r')!.get(r)));
        ctx.run.warn({
          messageKey: 'formula.warning.rowErrors',
          params: { column: c.title, error: g.code, count: g.count, rows: list.join(', ') },
        });
      }
    }
    const select = [...out.map((c) => q(c.key)), ORD].join(', ');
    return {
      [OUT_PORT]: ctx.sql.derive([table], out, `SELECT ${select} FROM ${qName(table.name)}`, []),
    };
  },
};
