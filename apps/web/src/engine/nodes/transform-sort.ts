import { SortConfigSchema, type SortConfig } from '@hrflow/flow-schema';
import { decimalFrom, isDecimal, type Decimal } from '../core/decimal';
import type { NodePlugin } from '../core/plugin';
import type { ColumnDef, Row, Table, Value } from '../core/types';
import { isSqlRel, ORD, q, qName } from '../duckdb/sql';
import { findColumn, IN_PORT, OUT_PORT } from './shared';

/**
 * Vietnamese alphabetical order, case-insensitive ("Đ" after "D", before "E"; "an" = "An"), as
 * decided 2026-10-27. DuckDB-WASM has no Vietnamese collation without the ICU extension, so a
 * sort on a string column runs here in TS.
 */
export const VI_COLLATOR = new Intl.Collator('vi', { sensitivity: 'accent' });

function sortColumns(config: SortConfig, input: readonly ColumnDef[]): ColumnDef[] {
  return config.by.map((b, i) =>
    findColumn(input, b.column, 'sort.error.unknownColumn', `by.${i}.column`),
  );
}

function blankValue(v: Value | undefined, type: ColumnDef['type']): boolean {
  return v === null || v === undefined || (type === 'string' && String(v).trim() === '');
}

/**
 * Stable sort of `table` (equal rows keep their order). String columns are ranked once with the
 * collator (distinct values only), so the row sort compares numbers.
 */
export function sortTable(config: SortConfig, table: Table): Table {
  const cols = sortColumns(config, table.columns);
  const rows = table.rows;
  const keys = cols.map((col): ((r: Row) => number | string | null) => {
    if (col.type === 'string') {
      const distinct = new Set<string>();
      for (const r of rows) {
        const v = r[col.key];
        if (!blankValue(v, 'string')) distinct.add(String(v));
      }
      const sorted = [...distinct].sort(VI_COLLATOR.compare);
      const rank = new Map<string, number>();
      let current = 0;
      sorted.forEach((s, i) => {
        if (i > 0 && VI_COLLATOR.compare(sorted[i - 1]!, s) !== 0) current++;
        rank.set(s, current);
      });
      return (r) => {
        const v = r[col.key];
        return blankValue(v, 'string') ? null : rank.get(String(v))!;
      };
    }
    return (r) => {
      const v = r[col.key];
      if (blankValue(v, col.type)) return null;
      if (isDecimal(v)) return v.toNumber();
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v as number | string;
    };
  });
  const decimals = cols.map((c) => c.type === 'decimal');
  const index = rows.map((_, i) => i);
  const cache = keys.map((k) => rows.map(k));
  index.sort((a, b) => {
    for (let k = 0; k < cols.length; k++) {
      const spec = config.by[k]!;
      const va = cache[k]![a]!;
      const vb = cache[k]![b]!;
      if (va === null || vb === null) {
        if (va === vb) continue;
        const blankFirst = spec.blanks === 'first';
        return (va === null) === blankFirst ? -1 : 1;
      }
      let cmp: number;
      if (decimals[k]) {
        // Exact decimal comparison (the cached number only marks blanks).
        const da = rows[a]![cols[k]!.key] as Decimal | number | string;
        const db = rows[b]![cols[k]!.key] as Decimal | number | string;
        cmp = decimalFrom(da).cmp(decimalFrom(db));
      } else cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return spec.direction === 'desc' ? -cmp : cmp;
    }
    return a - b;
  });
  const out = new Array<Row>(index.length);
  for (let i = 0; i < index.length; i++) out[i] = rows[index[i]!]!;
  return { columns: table.columns, rows: out };
}

/** `transform.sort` (spec §12.1.3). */
export const transformSortPlugin: NodePlugin<SortConfig> = {
  type: 'transform.sort',
  configSchema: SortConfigSchema,
  inputs: [{ name: IN_PORT, required: true }],
  outputs: [{ name: OUT_PORT, required: false }],
  inferSchema(config, inputs) {
    const input = inputs[IN_PORT] ?? [];
    sortColumns(config, input);
    return { [OUT_PORT]: [...input] };
  },
  // DuckDB only for data already in DuckDB and no string column; otherwise TS (same order).
  usesDuckDb(config, inputs) {
    const input = inputs[IN_PORT];
    if (!input || !isSqlRel(input)) return false;
    return sortColumns(config, input.columns).every((c) => c.type !== 'string');
  },
  execute(config, inputs) {
    return { [OUT_PORT]: sortTable(config, inputs[IN_PORT]!) };
  },
  runSql(config, inputs, ctx) {
    const input = inputs[IN_PORT]!;
    const cols = sortColumns(config, input.columns);
    const order = config.by.map(
      (b, i) =>
        `${q(cols[i]!.key)} ${b.direction === 'desc' ? 'DESC' : 'ASC'} NULLS ${b.blanks === 'first' ? 'FIRST' : 'LAST'}`,
    );
    const list = input.columns.map((c) => q(c.key));
    const sql = `SELECT ${[...list, `row_number() OVER (ORDER BY ${[...order, ORD].join(', ')}) AS ${ORD}`].join(', ')} FROM ${qName(input.name)}`;
    return { [OUT_PORT]: ctx.sql.derive([input], input.columns, sql, []) };
  },
};
