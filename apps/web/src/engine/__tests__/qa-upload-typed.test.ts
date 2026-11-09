/**
 * QA (verifier, perf round spec §31 AC-PF-04): independent checks of the typed upload
 * (`SqlScope.upload`, `insertArrow(create=false)` appends by column position) against the former
 * upload (VARCHAR / DOUBLE raw table + CAST). Cases the developer test does not cover: keyword /
 * odd keys, one column, many interleaved types, a typed batch followed by a fallback batch in
 * another row group, integers beyond 2^53 (BIGINT fallback), and the User Timing entries.
 * Fake values only.
 */
import { Table as ArrowTable, tableToIPC, type Vector } from 'apache-arrow';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import { perfClear, perfMeasure, perfNow, PERF_PREFIX } from '../core/perf';
import {
  BooleanVector,
  DecimalVector,
  IntegerVector,
  StringVector,
  type Vector as EngineVector,
} from '../core/table';
import { Table, type ColumnDef, type Row } from '../core/types';
import { toArrow } from '../duckdb/arrow-io';
import type { DuckDb } from '../duckdb/db';
import {
  boolVector,
  float64Vector,
  SqlScope,
  UPLOAD_CHUNK_ROWS,
  utf8Vector,
} from '../duckdb/scope';
import { DUCK_TYPE, ORD, ORD_NAME, q, qName, SqlRel } from '../duckdb/sql';
import { nodeDuckDb } from './duckdb-node';

let db: DuckDb;
beforeAll(async () => {
  db = await nodeDuckDb();
});

let n = 0;
function formerUpload(table: Table): string {
  const name = `hr$qaref${++n}`;
  const raw = `${name}_raw`;
  const cols = table.columns;
  if (table.rowCount === 0) {
    const defs = [...cols.map((c) => `${q(c.key)} ${DUCK_TYPE[c.type]}`), `${ORD} BIGINT`];
    db.exec(`CREATE TABLE ${qName(name)} (${defs.join(', ')})`);
    return name;
  }
  const old = (vec: EngineVector, from: number, len: number, key: string): Vector => {
    const pick = <T>(get: (i: number) => T) => Array.from({ length: len }, (_, i) => get(from + i));
    if (vec instanceof StringVector) return utf8Vector(pick((i) => vec.get(i)));
    if (vec instanceof IntegerVector) return float64Vector(pick((i) => vec.get(i)));
    if (vec instanceof BooleanVector) return boolVector(pick((i) => vec.get(i)));
    if (vec instanceof DecimalVector) return toArrow(vec, from, len, key);
    throw new Error('unknown vector');
  };
  for (let from = 0; from < table.rowCount; from += 50_000) {
    const len = Math.min(50_000, table.rowCount - from);
    const vectors: Record<string, Vector> = {};
    cols.forEach((c, i) => (vectors[c.key] = old(table.vectors[i]!, from, len, c.key)));
    vectors[ORD_NAME] = float64Vector(Array.from({ length: len }, (_, i) => from + i + 1));
    db.insertArrow(tableToIPC(new ArrowTable(vectors), 'stream'), raw, from === 0);
  }
  const casts = cols.map((c) => `CAST(${q(c.key)} AS ${DUCK_TYPE[c.type]}) AS ${q(c.key)}`);
  try {
    db.exec(
      `CREATE TABLE ${qName(name)} AS SELECT ${[...casts, `CAST(${ORD} AS BIGINT) AS ${ORD}`].join(', ')} FROM ${qName(raw)}`,
    );
  } finally {
    db.exec(`DROP TABLE IF EXISTS ${qName(raw)}`);
  }
  return name;
}

/** Column-by-column text of a table, by key (not by position), ordered by __ord. */
function textByKey(name: string, cols: ColumnDef[]): string[] {
  return db
    .query(
      `SELECT concat_ws('|', ${[ORD, ...cols.map((c) => q(c.key))].map((k) => `coalesce(CAST(${k} AS VARCHAR), '∅')`).join(', ')}) AS t FROM ${qName(name)} ORDER BY ${ORD}`,
    )
    .toArray()
    .map((r: { t: string }) => r.t);
}

function expectSame(table: Table): void {
  const scope = new SqlScope(db);
  try {
    const rel = scope.upload(table);
    const ref = formerUpload(table);
    try {
      const types = (t: string) =>
        db
          .query(`DESCRIBE ${qName(t)}`)
          .toArray()
          .map(
            (r: { column_name: string; column_type: string }) =>
              `${r.column_name} ${r.column_type}`,
          );
      expect(types(rel.name)).toEqual(types(ref));
      expect(textByKey(rel.name, table.columns)).toEqual(textByKey(ref, table.columns));
      const back = scope.fetch(rel);
      const backRef = scope.fetch(new SqlRel(table.columns, ref, [], table.rowCount));
      expect(back.rows).toEqual(backRef.rows);
    } finally {
      db.exec(`DROP TABLE IF EXISTS ${qName(ref)}`);
    }
  } finally {
    scope.dispose();
  }
}

const tbl = (columns: ColumnDef[], rows: Row[]) => Table.fromRows(columns, rows);

describe('QA typed upload: column order and names', () => {
  it('SQL keyword keys and many interleaved types land in the right columns', () => {
    const columns: ColumnDef[] = [
      { key: 'select', type: 'integer' },
      { key: 'order', type: 'string' },
      { key: 'from', type: 'decimal' },
      { key: 'group', type: 'date' },
      { key: 'x', type: 'integer' },
      { key: 'where', type: 'boolean' },
      { key: 'y', type: 'string' },
      { key: 'z', type: 'decimal' },
      { key: 'table', type: 'datetime' },
      { key: '_a', type: 'integer' },
    ];
    const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({
      select: i,
      order: `NV${i}`,
      from: new Big(i).div(7).round(10),
      group: `20${10 + (i % 15)}-0${1 + (i % 9)}-1${i % 9}`,
      x: -i * 1000,
      where: i % 3 === 0 ? null : i % 2 === 0,
      y: i % 4 === 0 ? '' : i % 5 === 0 ? null : `y${i}`,
      z: new Big(-i).times('123456.0000000001'),
      table: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T0${i % 10}:15:30`,
      _a: i % 2 ? null : i,
    }));
    expectSame(tbl(columns, rows));
  });

  it('one column only (string, integer, date)', () => {
    expectSame(tbl([{ key: 'a', type: 'string' }], [{ a: 'x' }, { a: null }, { a: '' }]));
    expectSame(tbl([{ key: 'a', type: 'integer' }], [{ a: 1 }, { a: null }]));
    expectSame(tbl([{ key: 'a', type: 'date' }], [{ a: '1899-12-31' }, { a: null }]));
  });
});

describe('QA typed upload: batches and fallbacks', () => {
  it('typed date batch then a fallback (non-ISO) batch in the next row group', () => {
    const rows: Row[] = Array.from({ length: UPLOAD_CHUNK_ROWS + 3 }, (_, i) => ({
      ngay: i < UPLOAD_CHUNK_ROWS ? '2026-10-26' : '2026-1-5',
      ts: i < UPLOAD_CHUNK_ROWS ? '2026-10-26T08:20:00' : '2026-10-26 08:20:00.250',
      k: i,
    }));
    expectSame(
      tbl(
        [
          { key: 'ngay', type: 'date' },
          { key: 'ts', type: 'datetime' },
          { key: 'k', type: 'integer' },
        ],
        rows,
      ),
    );
  });

  it('integers beyond 2^53 take the DOUBLE fallback and equal the former CAST', () => {
    const big = [2 ** 53, 2 ** 60, -(2 ** 62), 1, null];
    expectSame(
      tbl(
        [{ key: 'i', type: 'integer' }],
        big.map((i) => ({ i })),
      ),
    );
  });

  it('decimals: many fractional digits, tiny and huge magnitudes', () => {
    const vals = [
      '-0.0000000009',
      '0.9999999999',
      '-123456789012345678901234567.8',
      '1e27',
      '-1e-10',
      '42',
    ];
    expectSame(
      tbl(
        [{ key: 'd', type: 'decimal' }],
        vals.map((d) => ({ d: new Big(d) })),
      ),
    );
  });
});

describe('QA perf timings (AC-PF-01): names only, bounded per run', () => {
  afterEach(() => perfClear());

  it('measures carry only the stage name and duration (no detail)', () => {
    const t0 = perfNow();
    perfMeasure('upload', t0);
    const entries = performance
      .getEntriesByType('measure')
      .filter((e) => e.name.startsWith(PERF_PREFIX));
    expect(entries.map((e) => e.name)).toEqual(['hrflow:upload']);
    expect((entries[0] as PerformanceMeasure).detail ?? null).toBeNull();
  });

  it('perfClear() empties every stage', () => {
    for (const s of ['read', 'upload', 'sql', 'write', 'run'] as const) perfMeasure(s, perfNow());
    perfClear();
    expect(
      performance.getEntriesByType('measure').filter((e) => e.name.startsWith(PERF_PREFIX)),
    ).toEqual([]);
  });
});
