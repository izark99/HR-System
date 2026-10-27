import type { DataType } from '@hrflow/flow-schema';
import {
  Bool,
  Decimal as ArrowDecimal,
  Float64,
  makeData,
  makeVector,
  Table as ArrowTable,
  tableToIPC,
  Utf8,
  type Vector,
} from 'apache-arrow';
import { Big, decimalFrom, isDecimal, type Decimal } from '../core/decimal';
import { EngineError, type ColumnDef, type Row, type Table, type Value } from '../core/types';
import { DuckDbError, type SqlParam } from './base';
import type { DuckDb } from './db';
import {
  decimalOverflow,
  decimalToSql,
  DUCK_TYPE,
  mergeCtes,
  ORD,
  ORD_NAME,
  q,
  qName,
  SqlRel,
  withClause,
  type Cte,
} from './sql';

/** Rows per Arrow batch when moving data between TS and DuckDB (bounds the peak copy). */
const CHUNK_ROWS = 50_000;

function toSqlText(v: Value, type: DataType, column: string): string | null {
  if (v === null || v === undefined) return null;
  if (type === 'decimal') {
    const d = isDecimal(v) ? v : decimalFrom(typeof v === 'boolean' ? String(v) : v);
    return decimalToSql(d, column);
  }
  return isDecimal(v) ? v.toFixed() : String(v);
}

/*
 * Arrow vectors are assembled from typed arrays with `makeData`: apache-arrow's Builders (used by
 * `vectorFromArray`) compile code with `new Function`, which the CSP (no 'unsafe-eval') blocks.
 */

function validity(n: number, valid: (i: number) => boolean): { bitmap: Uint8Array; nulls: number } {
  const bitmap = new Uint8Array((n + 7) >> 3);
  let nulls = 0;
  for (let i = 0; i < n; i++) {
    if (valid(i)) bitmap[i >> 3]! |= 1 << (i & 7);
    else nulls++;
  }
  return { bitmap, nulls };
}

export function float64Vector(values: readonly (number | null)[]): Vector {
  const n = values.length;
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) data[i] = values[i] ?? 0;
  const { bitmap, nulls } = validity(n, (i) => values[i] !== null);
  return makeVector(
    makeData({ type: new Float64(), length: n, nullCount: nulls, nullBitmap: bitmap, data }),
  );
}

export function boolVector(values: readonly (boolean | null)[]): Vector {
  const n = values.length;
  const { bitmap: data } = validity(n, (i) => values[i] === true);
  const { bitmap, nulls } = validity(n, (i) => values[i] !== null);
  return makeVector(
    makeData({ type: new Bool(), length: n, nullCount: nulls, nullBitmap: bitmap, data }),
  );
}

const encoder = new TextEncoder();

export function utf8Vector(values: readonly (string | null)[]): Vector {
  const n = values.length;
  const offsets = new Int32Array(n + 1);
  const encoded = new Array<Uint8Array | null>(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const bytes = v === null || v === undefined ? null : encoder.encode(v);
    encoded[i] = bytes;
    total += bytes?.length ?? 0;
    offsets[i + 1] = total;
  }
  const data = new Uint8Array(total);
  for (let i = 0; i < n; i++) {
    const bytes = encoded[i];
    if (bytes) data.set(bytes, offsets[i]);
  }
  const { bitmap, nulls } = validity(n, (i) => encoded[i] !== null);
  return makeVector(
    makeData({
      type: new Utf8(),
      length: n,
      nullCount: nulls,
      nullBitmap: bitmap,
      valueOffsets: offsets,
      data,
    }),
  );
}

/**
 * Decimals cross as Arrow Decimal128(38, 10): the scaled integer value × 10^10 (two's complement,
 * little endian). Lossless and much faster for DuckDB than parsing decimal strings.
 */
export function decimal128Vector(values: readonly (string | null)[]): Vector {
  const n = values.length;
  const data = new BigUint64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const text = values[i];
    if (text === null || text === undefined) continue;
    const dot = text.indexOf('.');
    const int = dot < 0 ? text : text.slice(0, dot);
    const frac = dot < 0 ? '' : text.slice(dot + 1);
    const scaled = BigInt.asUintN(128, BigInt(`${int}${frac.padEnd(10, '0')}`));
    data[2 * i] = BigInt.asUintN(64, scaled);
    data[2 * i + 1] = scaled >> 64n;
  }
  const { bitmap, nulls } = validity(n, (i) => values[i] !== null);
  return makeVector(
    makeData({
      type: new ArrowDecimal(10, 38, 128),
      length: n,
      nullCount: nulls,
      nullBitmap: bitmap,
      data: new Uint32Array(data.buffer),
    }),
  );
}

function buildVector(rows: readonly Row[], from: number, to: number, col: ColumnDef): Vector {
  const n = to - from;
  if (col.type === 'integer') {
    const values = new Array<number | null>(n);
    for (let i = 0; i < n; i++) {
      const v = rows[from + i]![col.key];
      values[i] =
        v === null || v === undefined
          ? null
          : typeof v === 'number'
            ? v
            : Number(isDecimal(v) ? v.toFixed() : v);
    }
    return float64Vector(values);
  }
  if (col.type === 'boolean') {
    const values = new Array<boolean | null>(n);
    for (let i = 0; i < n; i++) {
      const v = rows[from + i]![col.key];
      values[i] = v === null || v === undefined ? null : v === true || v === 'true';
    }
    return boolVector(values);
  }
  const values = new Array<string | null>(n);
  for (let i = 0; i < n; i++) {
    values[i] = toSqlText(rows[from + i]![col.key] ?? null, col.type, col.key);
  }
  return col.type === 'decimal' ? decimal128Vector(values) : utf8Vector(values);
}

/** DuckDB → engine type of a *canonical* relation column, read back as text where lossless. */
function readExpr(col: ColumnDef): string {
  const c = q(col.key);
  switch (col.type) {
    case 'string':
    case 'boolean':
      return c;
    case 'datetime':
      return `strftime(${c}, '%Y-%m-%dT%H:%M:%S')`;
    default:
      return `CAST(${c} AS VARCHAR)`;
  }
}

function parseInteger(s: string): number | Decimal {
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : new Big(s);
}

/**
 * DuckDB state of one run (or one design-time check): uploads TS tables, materializes lazy
 * relations, fetches results back, and drops every object it created on `dispose()`. Object
 * names are `hr$<n>`, which no port or column key can be.
 */
export class SqlScope {
  private static counter = 0;
  private readonly objects: { name: string; kind: 'TABLE' | 'VIEW' }[] = [];

  constructor(readonly db: DuckDb) {}

  /** Unique per worker (not per run), so a leftover of a failed run can never collide. */
  nextName(): string {
    return `hr$${++SqlScope.counter}`;
  }

  /** Track a view created by a node (e.g. code.sql port views) so it is dropped with the scope. */
  track(name: string, kind: 'TABLE' | 'VIEW'): void {
    this.objects.push({ name, kind });
  }

  /** Drop a table of this scope early (no relation reads it any more). */
  drop(name: string): void {
    const i = this.objects.findIndex((o) => o.name === name && o.kind === 'TABLE');
    if (i < 0) return;
    this.objects.splice(i, 1);
    try {
      this.db.exec(`DROP TABLE IF EXISTS ${qName(name)}`);
    } catch {
      // Best effort; dispose() would not do better.
    }
  }

  /** Run a statement, turning DuckDB errors into engine errors (no raw text, may hold data). */
  run(sql: string, params: readonly SqlParam[] = []): ArrowTable {
    try {
      return this.db.query(sql, params);
    } catch (err) {
      throw toEngineError(err);
    }
  }

  /** TS table → DuckDB table with canonical types and a dense 1-based `__ord`. */
  upload(table: Table): SqlRel {
    const name = this.nextName();
    const raw = `${name}_raw`;
    // Registered first: a failure half-way (bad value, out of memory) leaves nothing behind.
    this.track(name, 'TABLE');
    this.track(raw, 'TABLE');
    const cols = table.columns;
    const casts = cols.map((c) => `CAST(${q(c.key)} AS ${DUCK_TYPE[c.type]}) AS ${q(c.key)}`);
    if (table.rows.length === 0) {
      const defs = [...cols.map((c) => `${q(c.key)} ${DUCK_TYPE[c.type]}`), `${ORD} BIGINT`];
      this.run(`CREATE TABLE ${qName(name)} (${defs.join(', ')})`);
    } else {
      for (let from = 0; from < table.rows.length; from += CHUNK_ROWS) {
        const to = Math.min(table.rows.length, from + CHUNK_ROWS);
        const vectors: Record<string, Vector> = {};
        for (const c of cols) vectors[c.key] = buildVector(table.rows, from, to, c);
        const ord = new Array<number>(to - from);
        for (let i = 0; i < ord.length; i++) ord[i] = from + i + 1;
        vectors[ORD_NAME] = float64Vector(ord);
        const ipc = tableToIPC(new ArrowTable(vectors), 'stream');
        try {
          this.db.insertArrow(ipc, raw, from === 0);
        } catch (err) {
          throw toEngineError(err);
        }
      }
      this.run(
        `CREATE TABLE ${qName(name)} AS SELECT ${[...casts, `CAST(${ORD} AS BIGINT) AS ${ORD}`].join(', ')} FROM ${qName(raw)}`,
      );
    }
    this.drop(raw);
    return new SqlRel(table.columns, name, [], table.rows.length);
  }

  /** A new lazy relation: `sql` reads the input relations by name; its CTE chain is merged. */
  derive(
    inputs: readonly SqlRel[],
    columns: readonly ColumnDef[],
    sql: string,
    params: readonly SqlParam[],
  ): SqlRel {
    const name = this.nextName();
    const cte: Cte = { name, sql, params };
    const bases = [...new Set(inputs.flatMap((r) => r.bases))];
    return new SqlRel(columns, name, [...mergeCtes(inputs), cte], null, bases);
  }

  /** `WITH … SELECT * FROM rel` (or just the table) with its params. */
  selectAll(rel: SqlRel): { sql: string; params: SqlParam[] } {
    const w = withClause(rel.ctes);
    return { sql: `${w.sql}SELECT * FROM ${qName(rel.name)}`, params: w.params };
  }

  /** Evaluate a lazy relation into a table with dense `__ord` and a known row count. */
  materialize(rel: SqlRel): SqlRel {
    if (rel.materialized && rel.rowCount !== null) return rel;
    const name = this.nextName();
    const w = withClause(rel.ctes);
    const cols = rel.columns.map((c) => q(c.key));
    this.track(name, 'TABLE');
    try {
      this.run(
        `CREATE TABLE ${qName(name)} AS ${w.sql}SELECT ${[...cols, `row_number() OVER (ORDER BY ${ORD}) AS ${ORD}`].join(', ')} FROM ${qName(rel.name)}`,
        w.params,
      );
    } catch (err) {
      this.drop(name);
      throw this.blame(rel.ctes, err);
    }
    const count = Number(this.db.scalar(`SELECT count(*) FROM ${qName(name)}`) ?? 0);
    return new SqlRel(rel.columns, name, [], count);
  }

  /**
   * A lazy chain failed: find the first CTE that fails on its own and attach its node, so the
   * error names the node that caused it rather than the one that read the result (engine.md).
   * Error path only.
   */
  private blame(ctes: readonly Cte[], err: unknown): unknown {
    if (!(err instanceof EngineError) || err.nodeId) return err;
    for (let i = 0; i < ctes.length; i++) {
      const owner = ctes[i]!.owner;
      if (!owner) continue;
      const w = withClause(ctes.slice(0, i + 1));
      // Evaluated into a throw-away table: a count(*) would let DuckDB skip the computed columns.
      const probe = this.nextName();
      try {
        this.db.exec(
          `CREATE TABLE ${qName(probe)} AS ${w.sql}SELECT * FROM ${qName(ctes[i]!.name)}`,
          w.params,
        );
      } catch {
        return new EngineError(err.messageKey, { node: owner.label, ...err.params }, owner.id);
      } finally {
        try {
          this.db.exec(`DROP TABLE IF EXISTS ${qName(probe)}`);
        } catch {
          // ignore
        }
      }
    }
    return err;
  }

  /** Materialize (if needed) and read the relation back into a TS table (spec §9.4). */
  fetch(input: SqlRel): Table {
    const rel = this.materialize(input);
    try {
      return this.read(rel);
    } finally {
      // A table made only for this read is not needed afterwards.
      if (rel !== input) this.drop(rel.name);
    }
  }

  private read(rel: SqlRel): Table {
    const total = rel.rowCount ?? 0;
    const columns = rel.columns.map((c) => ({ ...c }));
    const rows: Row[] = new Array<Row>(total);
    const select = columns.map((c) => `${readExpr(c)} AS ${q(c.key)}`).join(', ');
    let unsafe: Set<string> | null = null;
    for (let from = 0; from < total; from += CHUNK_ROWS) {
      const to = Math.min(total, from + CHUNK_ROWS);
      const result = this.run(
        `SELECT ${select || '1 AS "hr$none"'} FROM ${qName(rel.name)} WHERE ${ORD} > ${from} AND ${ORD} <= ${to} ORDER BY ${ORD}`,
      );
      const n = to - from;
      for (let i = 0; i < n; i++) rows[from + i] = {};
      for (const col of columns) {
        const vec = result.getChild(col.key);
        if (!vec) continue;
        for (let i = 0; i < n; i++) {
          // Read expressions return VARCHAR / BOOLEAN only (see readExpr).
          const raw = vec.get(i) as string | boolean | null | undefined;
          let v: Value = null;
          if (raw !== null && raw !== undefined) {
            if (col.type === 'integer') {
              v = parseInteger(String(raw));
              if (typeof v !== 'number') (unsafe ??= new Set()).add(col.key);
            } else if (col.type === 'decimal') v = new Big(String(raw));
            else if (col.type === 'boolean') v = Boolean(raw);
            else v = String(raw);
          }
          rows[from + i]![col.key] = v;
        }
      }
    }
    // An integer result outside the safe range (e.g. a large SUM) turns the column into decimal.
    if (unsafe) {
      for (const col of columns) {
        if (!unsafe.has(col.key)) continue;
        col.type = 'decimal';
        for (const row of rows) {
          const v = row[col.key];
          if (typeof v === 'number') row[col.key] = new Big(v);
        }
      }
    }
    return { columns, rows };
  }

  /** Drop every object created by this scope. */
  dispose(): void {
    for (const o of this.objects.splice(0).reverse()) {
      try {
        this.db.exec(`DROP ${o.kind} IF EXISTS ${o.kind === 'VIEW' ? o.name : qName(o.name)}`);
      } catch {
        // Best effort: the database lives only as long as the worker.
      }
    }
  }
}

/**
 * DuckDB failure inside a built-in node. The raw message is dropped (it may quote cell values);
 * only overflow is told apart because the Admin can act on it.
 */
export function toEngineError(err: unknown): Error {
  if (err instanceof EngineError) return err;
  if (err instanceof DuckDbError) {
    if (/Out of Range Error|Overflow/i.test(err.message)) return decimalOverflow(undefined);
    return new EngineError('duckdb.error.queryFailed');
  }
  return err instanceof Error ? err : new Error(String(err));
}
