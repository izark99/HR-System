/**
 * Perf round (spec §31, AC-PF-04): the typed upload (`SqlScope.upload`: Arrow data already in the
 * DuckDB column types, whole row-group batches, no raw table) gives exactly the table the former
 * upload gave (VARCHAR / DOUBLE raw table + `CAST`, 50k-row batches, DOUBLE `__ord`): same column
 * types, same values (compared with EXCEPT ALL both ways and as text), same `__ord`, same table
 * read back. Fake values only, chosen at the edges of each type.
 */
import { Table as ArrowTable, tableToIPC, type Vector } from 'apache-arrow';
import { beforeAll, describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import {
  BooleanVector,
  DecimalVector,
  IntegerVector,
  StringVector,
  type Vector as EngineVector,
} from '../core/table';
import { EngineError, type ColumnDef, type Row, type Table } from '../core/types';
import {
  isoDateDays,
  isoDateTimeSeconds,
  ordVector,
  toArrow,
  writeScaled,
} from '../duckdb/arrow-io';
import type { DuckDb } from '../duckdb/db';
import {
  boolVector,
  float64Vector,
  SqlScope,
  toEngineError,
  UPLOAD_CHUNK_ROWS,
  utf8Vector,
} from '../duckdb/scope';
import { DUCK_TYPE, ORD, ORD_NAME, q, qName, SqlRel } from '../duckdb/sql';
import { nodeDuckDb } from './duckdb-node';
import { asTable } from './helpers';

let db: DuckDb;
beforeAll(async () => {
  db = await nodeDuckDb();
});

let refCounter = 0;

/** The upload as it was before the perf round (reference). Returns the table name. */
function referenceUpload(table: Table): string {
  const name = `hr$ref${++refCounter}`;
  const raw = `${name}_raw`;
  const cols = table.columns;
  if (table.rowCount === 0) {
    const defs = [...cols.map((c) => `${q(c.key)} ${DUCK_TYPE[c.type]}`), `${ORD} BIGINT`];
    db.exec(`CREATE TABLE ${qName(name)} (${defs.join(', ')})`);
    return name;
  }
  const old = (vec: EngineVector, from: number, n: number, key: string): Vector => {
    const pick = <T>(get: (i: number) => T) => Array.from({ length: n }, (_, i) => get(from + i));
    if (vec instanceof StringVector) return utf8Vector(pick((i) => vec.get(i)));
    if (vec instanceof IntegerVector) return float64Vector(pick((i) => vec.get(i)));
    if (vec instanceof BooleanVector) return boolVector(pick((i) => vec.get(i)));
    if (vec instanceof DecimalVector) return toArrow(vec, from, n, key); // unchanged path
    throw new Error('unknown vector');
  };
  for (let from = 0; from < table.rowCount; from += 50_000) {
    const n = Math.min(50_000, table.rowCount - from);
    const vectors: Record<string, Vector> = {};
    cols.forEach((c, i) => (vectors[c.key] = old(table.vectors[i]!, from, n, c.key)));
    vectors[ORD_NAME] = float64Vector(Array.from({ length: n }, (_, i) => from + i + 1));
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

const scalarNum = (sql: string) => Number(db.scalar(sql));

function describeTable(name: string): string[] {
  return db
    .query(`DESCRIBE ${qName(name)}`)
    .toArray()
    .map((r: { column_name: string; column_type: string }) => `${r.column_name} ${r.column_type}`);
}

/** Upload both ways and assert the two DuckDB tables (and their read-back) are identical. */
function expectSameUpload(table: Table): void {
  const scope = new SqlScope(db);
  try {
    const rel = scope.upload(table);
    const ref = referenceUpload(table);
    try {
      expect(describeTable(rel.name)).toEqual(describeTable(ref));
      const a = qName(rel.name);
      const b = qName(ref);
      expect(scalarNum(`SELECT count(*) FROM ${a}`)).toBe(table.rowCount);
      expect(
        scalarNum(`SELECT count(*) FROM (SELECT * FROM ${a} EXCEPT ALL SELECT * FROM ${b})`),
      ).toBe(0);
      expect(
        scalarNum(`SELECT count(*) FROM (SELECT * FROM ${b} EXCEPT ALL SELECT * FROM ${a})`),
      ).toBe(0);
      // Text form per row and `__ord` (EXCEPT compares typed values; this pins the exact text).
      const text = (t: string) =>
        db
          .query(
            `SELECT ${ORD} AS o, concat_ws('|', ${[...table.columns.map((c) => `coalesce(CAST(${q(c.key)} AS VARCHAR), '∅')`), "''"].join(', ')}) AS t FROM ${t} ORDER BY ${ORD}`,
          )
          .toArray()
          .map((r: { o: bigint; t: string }) => `${r.o}:${r.t}`);
      const ta = text(a);
      expect(ta).toEqual(text(b));
      expect(ta.map((s) => Number(s.slice(0, s.indexOf(':'))))).toEqual(
        Array.from({ length: table.rowCount }, (_, i) => i + 1),
      );
      // Read back through the engine: same TS table.
      const back = scope.fetch(rel);
      const backRef = scope.fetch(new SqlRel(table.columns, ref, [], table.rowCount));
      expect(back.columns).toEqual(backRef.columns);
      expect(back.rows).toEqual(backRef.rows);
    } finally {
      db.exec(`DROP TABLE IF EXISTS ${qName(ref)}`);
    }
  } finally {
    scope.dispose();
  }
}

const COLUMNS: ColumnDef[] = [
  { key: 'ma_nv', type: 'string' },
  { key: 'so_nguyen', type: 'integer' },
  { key: 'so_tien', type: 'decimal' },
  { key: 'ngay', type: 'date' },
  { key: 'thoi_diem', type: 'datetime' },
  { key: 'co', type: 'boolean' },
];

const STRINGS = [
  'NV001',
  'Nguyễn Văn Ánh',
  'Đặng Thị Ỷ',
  '',
  '  khoảng trắng  ',
  '😀 ký tự',
  "O'Neil",
  null,
];
const INTEGERS = [
  0,
  1,
  -1,
  Number.MAX_SAFE_INTEGER,
  -Number.MAX_SAFE_INTEGER,
  2 ** 32,
  -(2 ** 32),
  2 ** 31 - 1,
  -(2 ** 31),
  2 ** 32 - 1,
  null,
];
const DECIMALS = [
  '0',
  '1.5',
  '-1.5',
  '0.0000000001',
  '-0.0000000001',
  '1234567.89',
  '9999999999999999999999999999.9999999999',
  '-9999999999999999999999999999.9999999999',
  '123456789012345678.123456789',
  '0.1',
  null,
];
const DATES = [
  '2026-10-26',
  '2024-02-29',
  '2026-02-28',
  '1970-01-01',
  '1969-12-31',
  '1900-03-01',
  '1900-02-28',
  '2000-02-29',
  '0001-01-01',
  '9999-12-31',
  null,
];
const DATETIMES = [
  '2026-10-26T08:20:00',
  '1970-01-01T00:00:00',
  '1969-12-31T23:59:59',
  '0001-01-01T00:00:00',
  '9999-12-31T23:59:59',
  '2024-02-29T12:34:56',
  null,
];
const BOOLS = [true, false, null];

function edgeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const d = DECIMALS[i % DECIMALS.length]!;
    return {
      ma_nv: STRINGS[i % STRINGS.length]!,
      so_nguyen: INTEGERS[(i * 7) % INTEGERS.length]!,
      so_tien: d === null ? null : new Big(d),
      ngay: DATES[(i * 3) % DATES.length]!,
      thoi_diem: DATETIMES[(i * 5) % DATETIMES.length]!,
      co: BOOLS[i % 3]!,
    };
  });
}

describe('typed upload = former upload (AC-PF-04)', () => {
  it('edge values of every type, one batch', () => {
    expectSameUpload(asTable({ columns: COLUMNS, rows: edgeRows(240) }));
  });

  it('several row-group batches (last one partial) keep __ord dense and in order', () => {
    expect(UPLOAD_CHUNK_ROWS).toBe(122_880);
    expectSameUpload(asTable({ columns: COLUMNS, rows: edgeRows(2 * UPLOAD_CHUNK_ROWS + 17) }));
  });

  it('decimals as exact doubles and as exact text (engine reader paths)', () => {
    const rows: Row[] = [
      0.1,
      0.25,
      -7.5,
      1e15,
      123456789.123,
      2 ** 53 - 1,
      -(2 ** 53 - 1),
      1e-10,
      5e-11,
    ].map((x) => ({ so_tien: new Big(x) }));
    rows.push({ so_tien: new Big('12345678901234567890.0123456789') }, { so_tien: null });
    expectSameUpload(asTable({ columns: [{ key: 'so_tien', type: 'decimal' }], rows }));
  });

  it('all-null and blank-only columns', () => {
    const rows = Array.from({ length: 10 }, () => ({
      ma_nv: null,
      so_nguyen: null,
      so_tien: null,
      ngay: null,
      thoi_diem: null,
      co: null,
    }));
    expectSameUpload(asTable({ columns: COLUMNS, rows }));
    expectSameUpload(
      asTable({ columns: [{ key: 'ma_nv', type: 'string' }], rows: [{ ma_nv: '' }] }),
    );
  });

  it('empty table', () => {
    expectSameUpload(asTable({ columns: COLUMNS, rows: [] }));
  });

  it('date text that is not strict ISO falls back to the DuckDB cast (same result)', () => {
    const rows: Row[] = [
      { ngay: '2026-1-5', thoi_diem: '2026-10-26 08:20:00' },
      { ngay: '2026-10-26', thoi_diem: '2026-10-26T08:20:00.5' },
      { ngay: null, thoi_diem: null },
    ];
    expectSameUpload(
      asTable({
        columns: [
          { key: 'ngay', type: 'date' },
          { key: 'thoi_diem', type: 'datetime' },
        ],
        rows,
      }),
    );
  });

  it('an invalid date fails with the same engine error as before', () => {
    const table = asTable({
      columns: [{ key: 'ngay', type: 'date' }],
      rows: [{ ngay: '2026-02-30' }],
    });
    const scope = new SqlScope(db);
    let mine: unknown;
    let before: unknown;
    try {
      scope.upload(table);
    } catch (err) {
      mine = err;
    }
    try {
      referenceUpload(table);
    } catch (err) {
      before = toEngineError(err);
    }
    scope.dispose();
    expect(mine).toBeInstanceOf(EngineError);
    expect((mine as EngineError).messageKey).toBe((before as EngineError).messageKey);
    // Nothing left behind.
    expect(scalarNum(`SELECT count(*) FROM duckdb_tables() WHERE table_name LIKE 'hr$%'`)).toBe(0);
  });
});

describe('typed Arrow helpers', () => {
  const enc = new TextEncoder();
  const days = (s: string) => {
    const b = enc.encode(s);
    return isoDateDays(b, 0, b.length);
  };
  const secs = (s: string) => {
    const b = enc.encode(s);
    return isoDateTimeSeconds(b, 0, b.length);
  };

  it('ISO date → days since epoch (like Date.UTC), strict form only', () => {
    for (const d of [
      '1970-01-01',
      '1969-12-31',
      '2024-02-29',
      '1900-03-01',
      '0001-01-01',
      '9999-12-31',
    ]) {
      const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
      const utc = new Date(0);
      utc.setUTCFullYear(y, m - 1, dd);
      expect(days(d)).toBe(Math.round(utc.getTime() / 86_400_000));
    }
    for (const bad of [
      '2026-02-29',
      '1900-02-29',
      '2026-13-01',
      '2026-00-10',
      '0000-01-01',
      '2026-1-05',
      '2026-01-05 ',
      '2026/01/05',
      '',
    ]) {
      expect(days(bad)).toBeNull();
    }
  });

  it('ISO datetime → seconds since epoch, strict form only', () => {
    expect(secs('1970-01-01T00:00:00')).toBe(0);
    expect(secs('1969-12-31T23:59:59')).toBe(-1);
    expect(secs('2026-10-26T08:20:05')).toBe(Date.UTC(2026, 9, 26, 8, 20, 5) / 1000);
    for (const bad of [
      '2026-10-26 08:20:05',
      '2026-10-26T24:00:00',
      '2026-10-26T08:60:00',
      '2026-10-26T08:20:60',
      '2026-10-26T08:20',
    ]) {
      expect(secs(bad)).toBeNull();
    }
  });

  it('columns cross in their DuckDB type; a non-strict chunk falls back to text', () => {
    const t = asTable({
      columns: COLUMNS,
      rows: [...edgeRows(20), { ngay: '2026-1-5', thoi_diem: '2026-10-26 08:20:00' }],
    });
    const arrowType = (k: number, from: number, n: number) =>
      String(toArrow(t.vectors[k]!, from, n, COLUMNS[k]!.key).type);
    expect([0, 1, 2, 3, 4, 5].map((k) => arrowType(k, 0, 20))).toEqual([
      'Utf8',
      'Int64',
      'Decimal[38e+10]',
      'Date32<DAY>',
      'Timestamp<MICROSECOND>',
      'Bool',
    ]);
    expect(arrowType(3, 0, 21)).toBe('Utf8');
    expect(arrowType(4, 0, 21)).toBe('Utf8');
    expect(String(ordVector(0, 3).type)).toBe('Int64');
  });

  it('__ord is a dense 1-based BIGINT column', () => {
    const v = ordVector(4_294_967_290, 10);
    expect(Array.from({ length: 10 }, (_, i) => v.get(i) as bigint)).toEqual(
      Array.from({ length: 10 }, (_, i) => BigInt(4_294_967_291 + i)),
    );
  });

  it('integers cross as exact BIGINT words', () => {
    const values = [
      0,
      1,
      -1,
      2 ** 32,
      -(2 ** 32),
      2 ** 32 + 5,
      -(2 ** 32) - 5,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
    ];
    const vec = new IntegerVector(values.length, Float64Array.from(values), null);
    const arrow = toArrow(vec, 0, values.length, 'x');
    expect(Array.from({ length: values.length }, (_, i) => arrow.get(i) as bigint)).toEqual(
      values.map(BigInt),
    );
  });

  it('writeScaled matches BigInt arithmetic', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const cases: [number, number][] = [
      [0, 10],
      [Number.MAX_SAFE_INTEGER, 10],
      [Number.MAX_SAFE_INTEGER, 0],
      [1, 0],
      [16777215, 10],
      [16777216, 10],
    ];
    for (let i = 0; i < 2000; i++)
      cases.push([Math.floor(rnd() * Number.MAX_SAFE_INTEGER), i % 11]);
    const words = new Uint32Array(4);
    for (const [y, k] of cases) {
      for (const negative of [false, true]) {
        writeScaled(words, 0, y, k, negative);
        const got = new BigUint64Array(words.buffer);
        const want = BigInt.asUintN(128, (negative ? -1n : 1n) * BigInt(y) * 10n ** BigInt(k));
        expect(got[0]! + (got[1]! << 64n)).toBe(want);
      }
    }
  });
});
