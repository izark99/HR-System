import type { DataType } from '@hrflow/flow-schema';
import { Big, type Decimal } from '../core/decimal';
import { EngineError, type ColumnDef } from '../core/types';
import { BLANK_MACRO, NORM_KEY_MACRO, type SqlParam } from './base';

/** Hidden row-order column of every relation (spec §12.1 "Thứ tự dòng tất định"). */
export const ORD = '__ord';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Quote a column key for SQL. Column keys are `IdentifierSchema` keys; anything else is refused
 * (spec §12.1: names enter SQL only after that check, inside double quotes).
 */
export function q(key: string): string {
  if (!IDENTIFIER.test(key)) throw new Error('not an identifier');
  return `"${key}"`;
}

/** Engine-internal object names contain `$`, so they can never clash with a port or column key. */
export function qName(name: string): string {
  if (!/^hr\$[a-z0-9_]+$/.test(name)) throw new Error('not an internal name');
  return `"${name}"`;
}

/** Canonical DuckDB type of an engine type (spec §9.4). */
export const DUCK_TYPE: Record<DataType, string> = {
  string: 'VARCHAR',
  integer: 'BIGINT',
  decimal: 'DECIMAL(38,10)',
  boolean: 'BOOLEAN',
  date: 'DATE',
  datetime: 'TIMESTAMP',
};

/** Normalized key expression (`normalizeKeyPart` in SQL). VARCHAR only. */
export function normKey(expr: string): string {
  return `${NORM_KEY_MACRO}(${expr})`;
}

/** Blank test for a column of the given type. */
export function isBlank(expr: string, type: DataType): string {
  return type === 'string' ? `${BLANK_MACRO}(${expr})` : `(${expr} IS NULL)`;
}

/** One CTE of a lazy (not yet materialized) relation. */
export interface Cte {
  name: string;
  sql: string;
  params: readonly SqlParam[];
}

/**
 * A relation inside DuckDB: a materialized table (no CTEs) or a chain of CTEs ending at `name`
 * (pushdown, spec §13.1). Its SQL columns are exactly `columns` (by key) plus `__ord`.
 */
export class SqlRel {
  constructor(
    readonly columns: readonly ColumnDef[],
    readonly name: string,
    readonly ctes: readonly Cte[] = [],
    /** Known once materialized. */
    readonly rowCount: number | null = null,
  ) {}

  get materialized(): boolean {
    return this.ctes.length === 0;
  }

  column(key: string): ColumnDef | undefined {
    return this.columns.find((c) => c.key === key);
  }
}

export function isSqlRel(v: unknown): v is SqlRel {
  return v instanceof SqlRel;
}

/** Merge the CTE chains of several inputs, keeping each chain's order and every CTE once. */
export function mergeCtes(rels: readonly SqlRel[]): Cte[] {
  const seen = new Set<string>();
  const out: Cte[] = [];
  for (const rel of rels) {
    for (const cte of rel.ctes) {
      if (seen.has(cte.name)) continue;
      seen.add(cte.name);
      out.push(cte);
    }
  }
  return out;
}

/** `WITH … ` prefix + its params, for a statement reading the given relations. */
export function withClause(ctes: readonly Cte[]): { sql: string; params: SqlParam[] } {
  if (ctes.length === 0) return { sql: '', params: [] };
  const params: SqlParam[] = [];
  const parts = ctes.map((c) => {
    params.push(...c.params);
    return `${qName(c.name)} AS (${c.sql})`;
  });
  return { sql: `WITH ${parts.join(', ')} `, params };
}

/**
 * Builds one SQL fragment left to right. `param()` returns a `?` placeholder and records the
 * value, so placeholders and values always line up. Values never become SQL text.
 */
export class SqlBuilder {
  readonly params: SqlParam[] = [];

  param(value: SqlParam): string {
    this.params.push(value);
    return '?';
  }
}

/** DECIMAL(38,10): at most 28 integer digits (spec §9.4). */
const MAX_INTEGER_DIGITS = 28;
const SCALE = 10;

/** Thrown for a decimal that does not fit DECIMAL(38,10); the executor attaches the node. */
export function decimalOverflow(column: string | undefined): EngineError {
  return new EngineError('duckdb.error.decimalOverflow', column ? { column } : {});
}

/** Decimal → canonical DECIMAL(38,10) text: rounded half-up to 10 places, plain notation. */
export function decimalToSql(v: Decimal, column?: string): string {
  // Fast path (no rounding needed): big.js keeps digits `c` and exponent `e`.
  const places = v.c.length - v.e - 1;
  if (places <= SCALE && v.e < MAX_INTEGER_DIGITS) return v.toFixed();
  const rounded = v.round(SCALE, Big.roundHalfUp);
  const intDigits = rounded.abs().round(0, Big.roundDown).toFixed().replace(/^0$/, '').length;
  if (intDigits > MAX_INTEGER_DIGITS) throw decimalOverflow(column);
  return rounded.toFixed();
}
