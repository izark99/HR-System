import type { DataType } from '@hrflow/flow-schema';
import {
  compileFormula,
  displaySql,
  FormulaColumnError,
  type FormulaColumnConfig,
  type FormulaParamDef,
  type InputColumn,
} from '../../../engine/formula/compile';
import { FormulaError } from '../../../engine/formula/parser';
import type { RefColumn } from '../../../engine/formula/refs';
import type { ColumnInfo } from '../../../engine/protocol';

/**
 * Designer-side use of the formula transpiler (pure TS, Designer chunk): live check of the text
 * being typed (markers), inferred type, and the generated SQL for "Xem SQL đã sinh". The engine
 * worker runs the same compiler for the design check and the run.
 */

export type RawColumn = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function toConfigs(items: readonly RawColumn[]): FormulaColumnConfig[] {
  return items.map((x) => ({
    key: str(x.key),
    formula: str(x.formula),
    ...(str(x.title) ? { title: str(x.title) } : {}),
    ...(typeof x.type === 'string' ? { type: x.type as FormulaColumnConfig['type'] } : {}),
  }));
}

function inputs(cols: readonly ColumnInfo[]): InputColumn[] {
  return cols.map((c) => ({ key: c.key, title: c.title, type: c.type }));
}

/** Columns a formula at `index` can reference: input + formula columns above (titles). */
export function refsAt(
  input: readonly ColumnInfo[],
  items: readonly RawColumn[],
  index: number,
): RefColumn[] {
  const refs: RefColumn[] = input.map((c) => ({ key: c.key, title: c.title }));
  toConfigs(items)
    .slice(0, index)
    .forEach((c) => {
      const prev = refs.findIndex((r) => r.key === c.key);
      const title = c.title ?? (prev >= 0 ? refs[prev]!.title : c.key);
      if (prev >= 0) refs[prev] = { key: c.key, title };
      else if (c.key) refs.push({ key: c.key, title });
    });
  return refs;
}

/** Same as `refsAt` with the types (column suggestions). */
export function typedRefsAt(
  input: readonly ColumnInfo[],
  items: readonly RawColumn[],
  index: number,
  params: readonly FormulaParamDef[],
): ColumnInfo[] {
  const refs = refsAt(input, items, index);
  let types: Map<string, DataType>;
  try {
    const plan = compileFormula(toConfigs(items).slice(0, index), inputs(input), { params });
    types = new Map(plan.output.map((c) => [c.key, c.type]));
  } catch {
    types = new Map(input.map((c) => [c.key, c.type]));
  }
  return refs.map((r) => ({ ...r, type: types.get(r.key) ?? 'string' }));
}

export interface LocalProblem {
  messageKey: string;
  params: Record<string, unknown>;
  start: number;
  end: number;
}

/** Problem of column `index` when its formula is `shown` (offsets in `shown`). */
export function checkShown(
  input: readonly ColumnInfo[],
  items: readonly RawColumn[],
  index: number,
  shown: string,
  params: readonly FormulaParamDef[],
): LocalProblem | null {
  const configs = toConfigs(items).map((c, k) => (k === index ? { ...c, formula: shown } : c));
  try {
    compileFormula(configs, inputs(input), { params });
    return null;
  } catch (err) {
    if (!(err instanceof FormulaColumnError) || err.index !== index || err.field !== 'formula') {
      return null;
    }
    const e: FormulaError = err.error;
    const start = e.pos ?? 0;
    return {
      messageKey: e.messageKey,
      params: { ...e.params, pos: start + 1 },
      start,
      end: e.end ?? start + 1,
    };
  }
}

/** Inferred result type of column `index` (`null` when it does not compile). */
export function inferredAt(
  input: readonly ColumnInfo[],
  items: readonly RawColumn[],
  index: number,
  params: readonly FormulaParamDef[],
): DataType | null {
  try {
    const configs = toConfigs(items)
      .slice(0, index + 1)
      .map((c, k) => (k === index ? { ...c, type: 'auto' as const } : c));
    return compileFormula(configs, inputs(input), { params }).columns[index]?.type ?? null;
  } catch {
    return null;
  }
}

/** Generated SQL with `$n` placeholders (no value), or the first problem. */
export function generatedSql(
  input: readonly ColumnInfo[],
  items: readonly RawColumn[],
  params: readonly FormulaParamDef[],
): { sql: string } | { error: FormulaError; index: number } {
  try {
    const plan = compileFormula(toConfigs(items), inputs(input), { params });
    const sql = displaySql(plan.sql('"hr$dau_vao"', '"hr$ord"', false));
    return { sql: sql.replaceAll(' FROM (', '\nFROM (') };
  } catch (err) {
    if (err instanceof FormulaColumnError) return { error: err.error, index: err.index };
    return {
      error: new FormulaError('formula.error.syntax', { context: 'empty', pos: 1 }),
      index: 0,
    };
  }
}
