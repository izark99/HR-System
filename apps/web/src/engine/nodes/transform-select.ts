import { SelectConfigSchema, type SelectConfig } from '@hrflow/flow-schema';
import type { NodePlugin } from '../core/plugin';
import type { ColumnDef } from '../core/types';
import { ORD, q, qName } from '../duckdb/sql';
import { configError, findColumn, IN_PORT, OUT_PORT } from './shared';

function outputColumns(config: SelectConfig, input: readonly ColumnDef[]): ColumnDef[] {
  const out: ColumnDef[] = [];
  config.columns.forEach((c, i) => {
    const src = findColumn(input, c.from, 'select.error.unknownColumn', `columns.${i}.from`);
    const key = c.key ?? c.from;
    // `_…` keys belong to system columns (e.g. `_source_file`); they may only be kept as is.
    if (key.startsWith('_') && key !== c.from) {
      throw configError('select.error.reservedKey', `columns.${i}.key`, { key });
    }
    if (out.some((o) => o.key === key)) {
      throw configError('select.error.duplicateKey', `columns.${i}.key`, { key });
    }
    out.push({
      key,
      type: src.type,
      title: c.title ?? src.title ?? src.key,
      ...(src.numFmt !== undefined ? { numFmt: src.numFmt } : {}),
    });
  });
  return out;
}

/** `transform.select` (spec §12.1.1): pick, rename and reorder columns. DuckDB. */
export const transformSelectPlugin: NodePlugin<SelectConfig> = {
  type: 'transform.select',
  configSchema: SelectConfigSchema,
  inputs: [{ name: IN_PORT, required: true }],
  outputs: [{ name: OUT_PORT, required: false }],
  inferSchema(config, inputs) {
    return { [OUT_PORT]: outputColumns(config, inputs[IN_PORT] ?? []) };
  },
  runSql(config, inputs, ctx) {
    const input = inputs[IN_PORT]!;
    const columns = outputColumns(config, input.columns);
    const list = config.columns.map((c, i) => `${q(c.from)} AS ${q(columns[i]!.key)}`);
    const sql = `SELECT ${[...list, ORD].join(', ')} FROM ${qName(input.name)}`;
    return { [OUT_PORT]: ctx.sql.derive([input], columns, sql, []) };
  },
};
