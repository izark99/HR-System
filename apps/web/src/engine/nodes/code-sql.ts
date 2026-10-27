import { CodeSqlConfigSchema, type CodeSqlConfig, type DataType } from '@hrflow/flow-schema';
import type { NodeIssue, NodePlugin, OutputSchemas, PortDef } from '../core/plugin';
import { EngineError, type ColumnDef, type EngineContext } from '../core/types';
import type { SqlParam } from '../duckdb/base';
import type { DuckDb } from '../duckdb/db';
import { DUCK_TYPE, ORD, q, qName, SqlRel, withClause } from '../duckdb/sql';
import { guardSql, sqlError, type GuardedSql } from '../duckdb/sql-guard';
import { OUT_PORT, paramToSql } from './shared';

/**
 * `code.sql` (spec §9.2, §12.1.8): an Admin SELECT over one view per input port (view = port
 * name, columns = column keys, no `__ord`). Params `$key` are bound as VARCHAR values. Output
 * columns come from `DESCRIBE` and are converted to the canonical types of §9.4.
 */

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

interface ResultColumn {
  def: ColumnDef;
  /** Expression converting the DuckDB column to its canonical type. */
  cast: string;
  /** DOUBLE/FLOAT: received as decimal with 15 significant digits (§9.4). */
  double: boolean;
}

function ports(config: CodeSqlConfig): PortDef[] {
  return config.inputs.map((i) => ({ name: i.port, required: true }));
}

/** DuckDB type (as printed by DESCRIBE) → engine type and conversion. `null` = unsupported. */
function mapType(
  duckType: string,
  x: string,
): { type: DataType; cast: string; double: boolean } | null {
  const t = duckType.toUpperCase();
  if (t === 'VARCHAR') return { type: 'string', cast: x, double: false };
  if (t === 'BOOLEAN') return { type: 'boolean', cast: x, double: false };
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|UTINYINT|USMALLINT|UINTEGER)$/.test(t)) {
    return { type: 'integer', cast: `CAST(${x} AS BIGINT)`, double: false };
  }
  if (/^(UBIGINT|HUGEINT|UHUGEINT)$/.test(t) || /^DECIMAL\(\d+,\d+\)$/.test(t)) {
    return { type: 'decimal', cast: `CAST(${x} AS ${DUCK_TYPE.decimal})`, double: false };
  }
  if (/^(DOUBLE|FLOAT|REAL)$/.test(t)) {
    // Same rule as numbers read from Excel (decimalFromNumber): 15 significant digits.
    return {
      type: 'decimal',
      cast: `CAST(printf('%.15g', ${x}) AS ${DUCK_TYPE.decimal})`,
      double: true,
    };
  }
  if (t === 'DATE') return { type: 'date', cast: x, double: false };
  if (/^TIMESTAMP(_S|_MS|_NS)?$/.test(t)) {
    return { type: 'datetime', cast: `CAST(${x} AS TIMESTAMP)`, double: false };
  }
  return null;
}

function resultColumns(
  described: { name: string; type: string }[],
  inputs: Record<string, readonly ColumnDef[]>,
): ResultColumn[] {
  const inputCols = Object.values(inputs).flat();
  const seen = new Set<string>();
  return described.map(({ name, type }) => {
    // `_…` names are reserved for system columns of the inputs (e.g. `_source_file`).
    const system = name.startsWith('_') && inputCols.some((c) => c.key === name);
    if (!IDENTIFIER.test(name) || (name.startsWith('_') && !system)) {
      throw new EngineError('sql.error.invalidColumnName', { column: name });
    }
    if (seen.has(name)) throw new EngineError('sql.error.duplicateColumn', { column: name });
    seen.add(name);
    const mapped = mapType(type, `"${name}"`);
    if (!mapped) throw new EngineError('sql.error.unsupportedType', { column: name, type });
    const source = inputCols.find((c) => c.key === name);
    return {
      def: { key: name, type: mapped.type, title: source?.title ?? name },
      cast: mapped.cast,
      double: mapped.double,
    };
  });
}

function describe(
  db: DuckDb,
  guarded: GuardedSql,
  values: SqlParam[],
): { name: string; type: string }[] {
  let table;
  try {
    table = db.query(`DESCRIBE ${guarded.sql}\n`, values);
  } catch (err) {
    throw sqlError(err);
  }
  const names = table.getChild('column_name');
  const types = table.getChild('column_type');
  const out: { name: string; type: string }[] = [];
  for (let i = 0; i < table.numRows; i++) {
    out.push({ name: String(names?.get(i)), type: String(types?.get(i)) });
  }
  return out;
}

/** Views named after the ports, dropped by the returned function. */
function createViews(db: DuckDb, bodies: [port: string, body: string][]): () => void {
  const created: string[] = [];
  const drop = () => {
    for (const port of created) {
      try {
        db.exec(`DROP VIEW IF EXISTS ${q(port)}`);
      } catch {
        // The database only lives as long as the worker.
      }
    }
  };
  try {
    for (const [port, body] of bodies) {
      db.exec(`CREATE OR REPLACE TEMP VIEW ${q(port)} AS ${body}`);
      created.push(port);
    }
  } catch (err) {
    drop();
    throw err instanceof EngineError ? err : sqlError(err);
  }
  return drop;
}

function emptyView(columns: readonly ColumnDef[]): string {
  const list = columns.map((c) => `CAST(NULL AS ${DUCK_TYPE[c.type]}) AS ${q(c.key)}`);
  return `SELECT ${list.length > 0 ? list.join(', ') : 'NULL AS "_"'} LIMIT 0`;
}

/** Design-time schema + warnings: DESCRIBE over empty views with the input schemas. */
export async function describeCodeSql(
  config: CodeSqlConfig,
  inputs: Record<string, readonly ColumnDef[]>,
  ctx: EngineContext,
): Promise<{ columns: ColumnDef[]; warnings: NodeIssue[] }> {
  if (!ctx.duck) throw new EngineError('duckdb.error.unavailable');
  const db = await ctx.duck();
  const keys = new Set((ctx.flow?.params ?? []).map((p) => p.key));
  const guarded = guardSql(db, config.sql, keys);
  const drop = createViews(
    db,
    config.inputs.map((i) => [i.port, emptyView(inputs[i.port] ?? [])]),
  );
  let cols: ResultColumn[];
  try {
    cols = resultColumns(
      describe(
        db,
        guarded,
        guarded.params.map(() => null),
      ),
      inputs,
    );
  } finally {
    drop();
  }
  const warnings: NodeIssue[] = cols
    .filter((c) => c.double)
    .map((c) => ({ messageKey: 'sql.warning.doubleColumn', params: { column: c.def.key } }));
  if (!guarded.hasOrderBy) warnings.push({ messageKey: 'sql.warning.noOrderBy', params: {} });
  return { columns: cols.map((c) => c.def), warnings };
}

export const codeSqlPlugin: NodePlugin<CodeSqlConfig, never, Promise<OutputSchemas>> = {
  type: 'code.sql',
  configSchema: CodeSqlConfigSchema,
  inputs: [],
  outputs: [{ name: OUT_PORT, required: false }],
  inputPorts: ports,
  async inferSchema(config, inputs, ctx) {
    return { [OUT_PORT]: (await describeCodeSql(config, inputs, ctx)).columns };
  },
  async warnings(config, inputs, ctx) {
    return (await describeCodeSql(config, inputs, ctx)).warnings;
  },
  runSql(config, inputs, ctx) {
    const db = ctx.sql.db;
    const keys = new Set((ctx.flow?.params ?? []).map((p) => p.key));
    const guarded = guardSql(db, config.sql, keys);
    const values = guarded.params.map((k) => paramToSql(ctx.run.params[k]));

    // Views cannot hold bound params: an input chain with params is materialized first.
    const bodies: [string, string][] = config.inputs.map((i) => {
      let rel = inputs[i.port]!;
      if (rel.ctes.some((c) => c.params.length > 0)) rel = ctx.sql.materialize(rel);
      const w = withClause(rel.ctes);
      const list = rel.columns.map((c) => q(c.key));
      return [
        i.port,
        `${w.sql}SELECT ${list.length > 0 ? list.join(', ') : 'NULL AS "_"'} FROM ${qName(rel.name)}`,
      ];
    });
    const schemas = Object.fromEntries(config.inputs.map((i) => [i.port, inputs[i.port]!.columns]));
    const drop = createViews(db, bodies);
    try {
      const cols = resultColumns(describe(db, guarded, values), schemas);
      const name = ctx.sql.nextName();
      const select = [
        ...cols.map((c) => `${c.cast} AS ${q(c.def.key)}`),
        `row_number() OVER () AS ${ORD}`,
      ];
      try {
        db.exec(
          `CREATE TABLE ${qName(name)} AS SELECT ${select.join(', ')} FROM (\n${guarded.sql}\n) AS q`,
          values,
        );
      } catch (err) {
        throw sqlError(err);
      }
      ctx.sql.track(name, 'TABLE');
      const count = Number(db.scalar(`SELECT count(*) FROM ${qName(name)}`) ?? 0);
      return {
        [OUT_PORT]: new SqlRel(
          cols.map((c) => c.def),
          name,
          [],
          count,
        ),
      };
    } finally {
      drop();
    }
  },
};
