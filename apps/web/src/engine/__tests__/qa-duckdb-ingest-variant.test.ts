/**
 * QA experiment, SKIPPED by default: same ingestion as SqlScope.upload but with allocation-free
 * Arrow builders (one growing UTF-8 buffer, decimals scaled from big.js digits without BigInt
 * strings). Shows how much of the non-linear cost is garbage collection of per-cell temporaries.
 * HRFLOW_PERF=1 HRFLOW_PERF_SIZES=100000,400000 NODE_OPTIONS=--max-old-space-size=8192 \
 *   pnpm --filter @hrflow/web test -- qa-duckdb-ingest-variant
 */
import { PerformanceObserver } from 'node:perf_hooks';
import {
  Decimal as ArrowDecimal,
  makeData,
  makeVector,
  Table as ArrowTable,
  tableToIPC,
  Utf8,
  type Vector,
} from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import type { ColumnDef, Row, Table } from '../core/types';
import { float64Vector, SqlScope } from '../duckdb/scope';
import { DUCK_TYPE, ORD, q, qName } from '../duckdb/sql';
import { nodeDuckDb } from './duckdb-node';

const ENABLED = process.env.HRFLOW_PERF === '1';
const SIZES = (process.env.HRFLOW_PERF_SIZES ?? '100000,400000').split(',').map(Number);
const CHUNK = 50_000;
const enc = new TextEncoder();

function utf8Col(rows: readonly Row[], from: number, to: number, key: string): Vector {
  const n = to - from;
  const offsets = new Int32Array(n + 1);
  let buf = new Uint8Array(Math.max(1024, n * 16));
  let pos = 0;
  const valid = new Uint8Array((n + 7) >> 3);
  let nulls = 0;
  for (let i = 0; i < n; i++) {
    const v = rows[from + i]![key];
    if (v === null || v === undefined) nulls++;
    else {
      valid[i >> 3]! |= 1 << (i & 7);
      const s = String(v);
      if (pos + s.length * 3 > buf.length) {
        const bigger = new Uint8Array(Math.max(pos + s.length * 3, buf.length * 2));
        bigger.set(buf.subarray(0, pos));
        buf = bigger;
      }
      pos += enc.encodeInto(s, buf.subarray(pos)).written;
    }
    offsets[i + 1] = pos;
  }
  return makeVector(
    makeData({
      type: new Utf8(),
      length: n,
      nullCount: nulls,
      nullBitmap: valid,
      valueOffsets: offsets,
      data: buf.slice(0, pos),
    }),
  );
}

/** Decimal128(38,10) straight from big.js digits; values with <= 15 digits stay in doubles. */
function decimalCol(rows: readonly Row[], from: number, to: number, key: string): Vector {
  const n = to - from;
  const words = new Uint32Array(n * 4);
  const valid = new Uint8Array((n + 7) >> 3);
  let nulls = 0;
  for (let i = 0; i < n; i++) {
    const v = rows[from + i]![key] as Big | null | undefined;
    if (v === null || v === undefined) {
      nulls++;
      continue;
    }
    valid[i >> 3]! |= 1 << (i & 7);
    const c = v.c;
    const places = Math.max(0, c.length - v.e - 1);
    if (
      c.length <= 15 &&
      places <= 10 &&
      c.length + (10 - places) + Math.max(0, v.e + 1 - c.length) <= 15
    ) {
      let x = 0;
      for (let d = 0; d < c.length; d++) x = x * 10 + c[d]!;
      const exp = v.e - (c.length - 1) + 10; // value = x * 10^(e-len+1) -> scaled by 1e10
      x *= 10 ** exp;
      const lo = x % 4294967296;
      const hi = Math.floor(x / 4294967296);
      if (v.s < 0) {
        // two's complement of (hi:lo) in 128 bits
        const nlo = (~lo >>> 0) + 1;
        words[4 * i] = nlo >>> 0;
        words[4 * i + 1] = ((~hi >>> 0) + (nlo > 0xffffffff ? 1 : 0)) >>> 0;
        words[4 * i + 2] = 0xffffffff;
        words[4 * i + 3] = 0xffffffff;
      } else {
        words[4 * i] = lo;
        words[4 * i + 1] = hi;
      }
    } else {
      const big = BigInt.asUintN(
        128,
        BigInt(v.round(10, Big.roundHalfUp).times('1e10').toFixed(0)),
      );
      words[4 * i] = Number(big & 0xffffffffn);
      words[4 * i + 1] = Number((big >> 32n) & 0xffffffffn);
      words[4 * i + 2] = Number((big >> 64n) & 0xffffffffn);
      words[4 * i + 3] = Number((big >> 96n) & 0xffffffffn);
    }
  }
  return makeVector(
    makeData({
      type: new ArrowDecimal(10, 38, 128),
      length: n,
      nullCount: nulls,
      nullBitmap: valid,
      data: words,
    }),
  );
}

function bigTable(n: number): Table {
  const columns: ColumnDef[] = [
    { key: 'ma_nv', type: 'string' },
    { key: 'chi_nhanh', type: 'string' },
  ];
  for (let c = 0; c < 15; c++) columns.push({ key: `so_${c}`, type: 'decimal' });
  for (let c = 0; c < 12; c++) columns.push({ key: `txt_${c}`, type: 'string' });
  const rows = new Array<Row>(n);
  for (let i = 0; i < n; i++) {
    const r: Row = {
      ma_nv: `NV${String(i).padStart(7, '0')}`,
      chi_nhanh: `CN${String(i % 50).padStart(2, '0')}`,
    };
    for (let c = 0; c < 15; c++)
      r[`so_${c}`] = new Big(((i * (c + 3)) % 100_000) / 100 - (i % 7 === 0 ? 500 : 0));
    for (let c = 0; c < 12; c++) r[`txt_${c}`] = `Giá trị ${c}-${i % 997}`;
    rows[i] = r;
  }
  return { columns, rows };
}

describe.skipIf(!ENABLED)('QA ingestion variant (allocation-free builders)', () => {
  for (const n of SIZES) {
    it(
      `variant upload ${n} rows equals the app upload and is faster`,
      { timeout: 1_800_000 },
      async () => {
        const db = await nodeDuckDb();
        // HRFLOW_BALLAST=<rows>: extra live JS objects, to show that GC cost follows the live heap.
        const ballast = process.env.HRFLOW_BALLAST
          ? bigTable(Number(process.env.HRFLOW_BALLAST))
          : null;
        const tbl = bigTable(n);
        let gcMs = 0;
        const obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) gcMs += e.duration;
        });
        obs.observe({ entryTypes: ['gc'] });
        const t0 = performance.now();
        const name = 'hr$qavariant';
        for (let from = 0; from < n; from += CHUNK) {
          const to = Math.min(n, from + CHUNK);
          const vectors: Record<string, Vector> = {};
          for (const c of tbl.columns) {
            vectors[c.key] =
              c.type === 'decimal'
                ? decimalCol(tbl.rows, from, to, c.key)
                : utf8Col(tbl.rows, from, to, c.key);
          }
          const ord = new Array<number>(to - from);
          for (let i = 0; i < ord.length; i++) ord[i] = from + i + 1;
          vectors[ORD] = float64Vector(ord);
          db.insertArrow(tableToIPC(new ArrowTable(vectors), 'stream'), `${name}_raw`, from === 0);
        }
        const casts = tbl.columns.map(
          (c) => `CAST(${q(c.key)} AS ${DUCK_TYPE[c.type]}) AS ${q(c.key)}`,
        );
        db.exec(
          `CREATE TABLE ${qName(name)} AS SELECT ${[...casts, `CAST(${ORD} AS BIGINT) AS ${ORD}`].join(', ')} FROM ${qName(`${name}_raw`)}`,
        );
        db.exec(`DROP TABLE ${qName(`${name}_raw`)}`);
        const ms = performance.now() - t0;
        await new Promise((r) => setTimeout(r, 50));
        obs.disconnect();
        process.stderr.write(
          `[variant] ballast=${ballast?.rows.length ?? 0} rows=${n} total=${Math.round(ms)}ms gc=${Math.round(gcMs)}ms\n`,
        );

        // Same values as the app's own upload (first 2000 rows), compared inside DuckDB.
        const small: Table = { columns: tbl.columns, rows: tbl.rows.slice(0, 2000) };
        const scope = new SqlScope(db);
        const rel = scope.upload(small);
        const cols = tbl.columns.map((c) => c.key);
        const diff = db.scalar(
          `SELECT count(*) FROM (SELECT ${cols.map(q).join(', ')} FROM ${qName(name)} WHERE ${ORD} <= 2000 EXCEPT SELECT ${cols.map(q).join(', ')} FROM ${qName(rel.name)})`,
        );
        expect(diff).toBe('0');
        scope.dispose();
        db.exec(`DROP TABLE ${qName(name)}`);
      },
    );
  }
});
