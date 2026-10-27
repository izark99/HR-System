import { UnionConfigSchema, type UnionConfig } from '@hrflow/flow-schema';
import type { NodePlugin, PortDef } from '../core/plugin';
import type { ColumnDef } from '../core/types';
import { DUCK_TYPE, ORD, q, qName, SqlBuilder } from '../duckdb/sql';
import { configError, OUT_PORT, passColumn } from './shared';

const NUMERIC = new Set(['integer', 'decimal']);

export function unionPorts(config: UnionConfig): PortDef[] {
  return Array.from({ length: config.inputCount }, (_, i) => ({
    name: `in_${i + 1}`,
    required: true,
  }));
}

function unionColumns(config: UnionConfig, inputs: Record<string, readonly ColumnDef[]>) {
  const ports = unionPorts(config).map((p) => p.name);
  const columns: ColumnDef[] = [];
  for (const port of ports) {
    for (const c of inputs[port] ?? []) {
      const existing = columns.find((x) => x.key === c.key);
      if (!existing) {
        columns.push(passColumn(c));
        continue;
      }
      if (existing.type === c.type) continue;
      if (NUMERIC.has(existing.type) && NUMERIC.has(c.type)) existing.type = 'decimal';
      else throw configError('union.error.typeMismatch', '', { column: c.key, port });
    }
  }
  if (config.missingColumns === 'error') {
    for (const port of ports) {
      const have = new Set((inputs[port] ?? []).map((c) => c.key));
      const missing = columns.find((c) => !have.has(c.key));
      if (missing) {
        throw configError('union.error.missingColumn', 'missingColumns', {
          column: missing.key,
          port,
        });
      }
    }
  }
  if (config.sourceColumn) {
    const key = config.sourceColumn.key;
    if (columns.some((c) => c.key === key)) {
      throw configError('union.error.duplicateKey', 'sourceColumn.key', { key });
    }
    columns.push({ key, type: 'string', title: key });
  }
  return { ports, columns };
}

/** `transform.union` (spec §12.1.5): stack N inputs, columns matched by key. DuckDB. */
export const transformUnionPlugin: NodePlugin<UnionConfig> = {
  type: 'transform.union',
  configSchema: UnionConfigSchema,
  inputs: [],
  outputs: [{ name: OUT_PORT, required: false }],
  inputPorts: unionPorts,
  inferSchema(config, inputs) {
    return { [OUT_PORT]: unionColumns(config, inputs).columns };
  },
  runSql(config, inputs, ctx) {
    const schemas = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.columns]));
    const { ports, columns } = unionColumns(config, schemas);
    const b = new SqlBuilder();
    const source = config.sourceColumn;
    const data = source ? columns.slice(0, -1) : columns;
    const selects = ports.map((port, i) => {
      const rel = inputs[port]!;
      const list = data.map((c) => {
        const present = rel.column(c.key) !== undefined;
        return `CAST(${present ? q(c.key) : 'NULL'} AS ${DUCK_TYPE[c.type]}) AS ${q(c.key)}`;
      });
      if (source)
        list.push(`CAST(${b.param(source.labels[i] ?? '')} AS VARCHAR) AS ${q(source.key)}`);
      list.push(`${i} AS "__input"`, ORD);
      return `SELECT ${list.join(', ')} FROM ${qName(rel.name)}`;
    });
    const keys = columns.map((c) => q(c.key));
    // All rows of in_1, then in_2, … each in its own order.
    const sql = `SELECT ${[...keys, `row_number() OVER (ORDER BY "__input", ${ORD}) AS ${ORD}`].join(', ')} FROM (${selects.join(' UNION ALL ')})`;
    const rels = ports.map((p) => inputs[p]!);
    return { [OUT_PORT]: ctx.sql.derive(rels, columns, sql, b.params) };
  },
};
