import { SortConfigSchema, type SortConfig } from '@hrflow/flow-schema';
import type { NodePlugin } from '../core/plugin';
import { DecimalVector } from '../core/table';
import type { ColumnDef, Table } from '../core/types';
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

/**
 * Per-row sort keys of one column: a rank (strings, in collator order), a number, or the text
 * (date/datetime ISO text sorts as text); `null` = blank.
 */
function sortKeys(table: Table, col: ColumnDef): (number | string | null)[] {
  const vec = table.vector(col.key)!;
  const n = table.rowCount;
  const out = new Array<number | string | null>(n);
  if (col.type === 'string') {
    const texts = new Array<string | null>(n);
    const distinct = new Set<string>();
    for (let i = 0; i < n; i++) {
      const v = vec.get(i) as string | null;
      const blank = v === null || v.trim() === '';
      texts[i] = blank ? null : v;
      if (!blank) distinct.add(v);
    }
    const sorted = [...distinct].sort(VI_COLLATOR.compare);
    const rank = new Map<string, number>();
    let current = 0;
    sorted.forEach((s, i) => {
      if (i > 0 && VI_COLLATOR.compare(sorted[i - 1]!, s) !== 0) current++;
      rank.set(s, current);
    });
    for (let i = 0; i < n; i++) out[i] = texts[i] === null ? null : rank.get(texts[i]!)!;
    return out;
  }
  for (let i = 0; i < n; i++) {
    if (vec.isNull(i)) out[i] = null;
    else if (vec instanceof DecimalVector)
      out[i] = 0; // compared exactly through the vector
    else {
      const v = vec.get(i);
      out[i] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    }
  }
  return out;
}

/**
 * Stable sort of `table` (equal rows keep their order). String columns are ranked once with the
 * collator (distinct values only), so the row sort compares numbers.
 */
export function sortTable(config: SortConfig, table: Table): Table {
  const cols = sortColumns(config, table.columns);
  const cache = cols.map((c) => sortKeys(table, c));
  const decimals = cols.map((c) => {
    const v = table.vector(c.key);
    return v instanceof DecimalVector ? v : null;
  });
  const index = Array.from({ length: table.rowCount }, (_, i) => i);
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
      const dec = decimals[k];
      // Exact decimal comparison (the cached key only marks blanks).
      const cmp = dec ? dec.compare(a, b) : va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return spec.direction === 'desc' ? -cmp : cmp;
    }
    return a - b;
  });
  return table.take(index);
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
