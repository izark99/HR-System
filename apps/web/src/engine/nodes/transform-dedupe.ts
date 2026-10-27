import { DedupeConfigSchema, type DedupeConfig } from '@hrflow/flow-schema';
import type { NodePlugin } from '../core/plugin';
import type { ColumnDef } from '../core/types';
import { isBlank, normKey, ORD, q, qName } from '../duckdb/sql';
import { findColumn, IN_PORT, OUT_PORT } from './shared';

export const REMOVED_PORT = 'removed';

function keyColumns(config: DedupeConfig, input: readonly ColumnDef[]): ColumnDef[] {
  return config.keys.map((k, i) => findColumn(input, k, 'dedupe.error.unknownColumn', `keys.${i}`));
}

/** Partition value of a key: normalized string, blank string as NULL, other types as is. */
function partition(col: ColumnDef, normalize: boolean): string {
  const x = q(col.key);
  if (col.type !== 'string') return x;
  if (normalize) return normKey(x);
  return `CASE WHEN ${isBlank(x, 'string')} THEN NULL ELSE ${x} END`;
}

/**
 * `transform.dedupe` (spec §12.1.7): keep the first (or last) row per key; `removed` gets the
 * others. Rows whose key columns are all blank are never duplicates. Row order is kept. DuckDB.
 */
export const transformDedupePlugin: NodePlugin<DedupeConfig> = {
  type: 'transform.dedupe',
  configSchema: DedupeConfigSchema,
  inputs: [{ name: IN_PORT, required: true }],
  outputs: [
    { name: OUT_PORT, required: false },
    { name: REMOVED_PORT, required: false },
  ],
  inferSchema(config, inputs) {
    const input = inputs[IN_PORT] ?? [];
    keyColumns(config, input);
    return { [OUT_PORT]: [...input], [REMOVED_PORT]: [...input] };
  },
  runSql(config, inputs, ctx) {
    const input = inputs[IN_PORT]!;
    const keys = keyColumns(config, input.columns);
    const allBlank = keys.map((c) => isBlank(q(c.key), c.type)).join(' AND ');
    const parts = keys.map((c) => partition(c, config.normalizeKeys)).join(', ');
    const dir = config.keep === 'last' ? 'DESC' : 'ASC';
    const ranked = ctx.sql.derive(
      [input],
      input.columns,
      `SELECT *, (${allBlank}) AS "__all_blank", row_number() OVER (PARTITION BY ${parts} ORDER BY ${ORD} ${dir}) AS "__rn" FROM ${qName(input.name)}`,
      [],
    );
    const list = [...input.columns.map((c) => q(c.key)), ORD].join(', ');
    const from = qName(ranked.name);
    return {
      [OUT_PORT]: ctx.sql.derive(
        [ranked],
        input.columns,
        `SELECT ${list} FROM ${from} WHERE "__all_blank" OR "__rn" = 1`,
        [],
      ),
      [REMOVED_PORT]: ctx.sql.derive(
        [ranked],
        input.columns,
        `SELECT ${list} FROM ${from} WHERE NOT "__all_blank" AND "__rn" > 1`,
        [],
      ),
    };
  },
};
