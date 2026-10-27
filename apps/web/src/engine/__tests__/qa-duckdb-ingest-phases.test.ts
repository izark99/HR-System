/**
 * QA: where does the TS side of ingestion spend its time with a large live heap? SKIPPED by
 * default. HRFLOW_PERF=1 HRFLOW_PERF_SIZES=100000,400000 NODE_OPTIONS=--max-old-space-size=8192 \
 *   pnpm --filter @hrflow/web test -- qa-duckdb-ingest-phases
 * Compares the app's utf8Vector (one TextEncoder.encode per cell => one small ArrayBuffer each)
 * with a single-buffer variant that writes with encodeInto.
 */
import { PerformanceObserver } from 'node:perf_hooks';
import { makeData, makeVector, Utf8, type Vector } from 'apache-arrow';
import { describe, it } from 'vitest';
import { Big } from '../core/decimal';
import { decimalToSql } from '../duckdb/sql';
import { decimal128Vector, utf8Vector } from '../duckdb/scope';

const ENABLED = process.env.HRFLOW_PERF === '1';
const SIZES = (process.env.HRFLOW_PERF_SIZES ?? '100000,400000').split(',').map(Number);
const CHUNK = 50_000;

const enc = new TextEncoder();
/** Candidate fix: one pass, one growing buffer, no per-cell allocation. */
function utf8VectorFast(values: readonly (string | null)[]): Vector {
  const n = values.length;
  const offsets = new Int32Array(n + 1);
  const valid = new Uint8Array((n + 7) >> 3);
  let nulls = 0;
  let buf = new Uint8Array(Math.max(1024, n * 16));
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null || v === undefined) nulls++;
    else {
      valid[i >> 3]! |= 1 << (i & 7);
      const need = pos + v.length * 3;
      if (need > buf.length) {
        const bigger = new Uint8Array(Math.max(need, buf.length * 2));
        bigger.set(buf.subarray(0, pos));
        buf = bigger;
      }
      pos += enc.encodeInto(v, buf.subarray(pos)).written;
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

describe.skipIf(!ENABLED)('QA ingestion phases', () => {
  for (const n of SIZES) {
    it(`phases at ${n} rows`, { timeout: 1_800_000 }, async () => {
      // Live heap similar to the real engine: row objects with Big decimals and strings.
      const rows = new Array<Record<string, unknown>>(n);
      for (let i = 0; i < n; i++) {
        const r: Record<string, unknown> = {};
        for (let c = 0; c < 15; c++) r[`so_${c}`] = new Big(((i * (c + 3)) % 100_000) / 100);
        for (let c = 0; c < 12; c++) r[`txt_${c}`] = `Giá trị ${c}-${i % 997}`;
        rows[i] = r;
      }
      let gc = 0;
      const obs = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) gc += e.duration;
      });
      obs.observe({ entryTypes: ['gc'] });
      const out: Record<string, number> = {
        utf8App: 0,
        utf8Fast: 0,
        decimal: 0,
        decimalToSqlOnly: 0,
      };
      const gcBy: Record<string, number> = {
        utf8App: 0,
        utf8Fast: 0,
        decimal: 0,
        decimalToSqlOnly: 0,
      };
      const time = async (label: string, fn: () => void) => {
        const g0 = gc;
        const t0 = performance.now();
        fn();
        out[label]! += performance.now() - t0;
        await new Promise((r) => setTimeout(r, 0)); // let the observer flush
        gcBy[label]! += gc - g0;
      };
      for (let from = 0; from < n; from += CHUNK) {
        const to = Math.min(n, from + CHUNK);
        const strs: (string | null)[][] = [];
        for (let c = 0; c < 12; c++) {
          const col = new Array<string | null>(to - from);
          for (let i = from; i < to; i++) col[i - from] = rows[i]![`txt_${c}`] as string;
          strs.push(col);
        }
        await time('utf8App', () => strs.forEach((s) => utf8Vector(s)));
        await time('utf8Fast', () => strs.forEach((s) => utf8VectorFast(s)));
        const decs: (string | null)[][] = [];
        await time('decimalToSqlOnly', () => {
          for (let c = 0; c < 15; c++) {
            const col = new Array<string | null>(to - from);
            for (let i = from; i < to; i++)
              col[i - from] = decimalToSql(rows[i]![`so_${c}`] as Big);
            decs.push(col);
          }
        });
        await time('decimal', () => decs.forEach((s) => decimal128Vector(s)));
      }
      obs.disconnect();
      const fmt = (k: string) => `${k}=${Math.round(out[k]!)}ms(gc ${Math.round(gcBy[k]!)}ms)`;
      process.stderr.write(`[phases] rows=${n} ${Object.keys(out).map(fmt).join(' ')}\n`);
    });
  }
});
