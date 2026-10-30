/**
 * QA profiling of TS -> DuckDB ingestion (SqlScope.upload), SKIPPED by default.
 * Run: HRFLOW_PERF=1 HRFLOW_PERF_SIZES=100000,250000 NODE_OPTIONS=--max-old-space-size=8192 \
 *      pnpm --filter @hrflow/web test -- qa-duckdb-ingest-perf
 * Prints per-phase timings (stderr). Fake data only.
 */
import { tableToIPC, Table as ArrowTable, type Vector } from 'apache-arrow';
import { PerformanceObserver } from 'node:perf_hooks';
import { describe, it } from 'vitest';
import { Big } from '../core/decimal';
import type { ColumnDef, Row, Table } from '../core/types';
import { SqlScope, float64Vector } from '../duckdb/scope';
import { nodeDuckDb } from './duckdb-node';
import { asTable } from './helpers';

const ENABLED = process.env.HRFLOW_PERF === '1';
const SIZES = (process.env.HRFLOW_PERF_SIZES ?? '100000,250000').split(',').map(Number);
const SHAPE = process.env.HRFLOW_PERF_SHAPE ?? 'wide'; // wide = 30 cols, narrow = 3 cols

function bigTable(n: number): Table {
  const columns: ColumnDef[] = [
    { key: 'ma_nv', type: 'string' },
    { key: 'chi_nhanh', type: 'string' },
    { key: 'ngay_vao', type: 'date' },
  ];
  if (SHAPE === 'wide') {
    for (let c = 0; c < 15; c++) columns.push({ key: `so_${c}`, type: 'decimal' });
    for (let c = 0; c < 12; c++) columns.push({ key: `txt_${c}`, type: 'string' });
  }
  const rows = new Array<Row>(n);
  for (let i = 0; i < n; i++) {
    const r: Row = {
      ma_nv: `NV${String(i).padStart(7, '0')}`,
      chi_nhanh: `CN${String(i % 50).padStart(2, '0')}`,
      ngay_vao: `20${String(10 + (i % 15))}-0${1 + (i % 9)}-1${i % 10}`,
    };
    if (SHAPE === 'wide') {
      for (let c = 0; c < 15; c++) r[`so_${c}`] = new Big(((i * (c + 3)) % 100_000) / 100);
      for (let c = 0; c < 12; c++) r[`txt_${c}`] = `Giá trị ${c}-${i % 997}`;
    }
    rows[i] = r;
  }
  return asTable({ columns, rows });
}

describe.skipIf(!ENABLED)('QA ingestion profile', () => {
  for (const n of SIZES) {
    it(`upload ${n} rows`, { timeout: 1_800_000 }, async () => {
      const db = await nodeDuckDb();
      const tbl = bigTable(n);
      const scope = new SqlScope(db);
      // Wrap the two DuckDB entry points to split DuckDB time from TS-side (vector/IPC) time.
      const inserts: number[] = [];
      const queries: [string, number][] = [];
      const origInsert = db.insertArrow.bind(db);
      const origQuery = db.query.bind(db);
      db.insertArrow = (ipc, name, create) => {
        const s0 = performance.now();
        origInsert(ipc, name, create);
        inserts.push(Math.round(performance.now() - s0));
      };
      db.query = (sql, params) => {
        const s0 = performance.now();
        const r = origQuery(sql, params);
        queries.push([sql.slice(0, 24), Math.round(performance.now() - s0)]);
        return r;
      };
      let gcMs = 0;
      let gcCount = 0;
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          gcMs += e.duration;
          gcCount++;
        }
      });
      obs.observe({ entryTypes: ['gc'] });
      const t0 = performance.now();
      const rel = scope.upload(tbl);
      await new Promise((r) => setTimeout(r, 50));
      obs.disconnect();
      process.stderr.write(`[ingest-gc] rows=${n} gcMs=${Math.round(gcMs)} gcCount=${gcCount}\n`);
      const total = performance.now() - t0;
      db.insertArrow = origInsert;
      db.query = origQuery;
      const insSum = inserts.reduce((a, b) => a + b, 0);
      process.stderr.write(
        `[ingest-split] rows=${n} insertArrow=${insSum}ms per-chunk=${JSON.stringify(inserts)} queries=${JSON.stringify(queries)} tsSide=${Math.round(total - insSum - queries.reduce((a, b) => a + b[1], 0))}ms\n`,
      );
      // Same phases, measured separately on a fresh table: one big insert vs 50k chunks.
      const heap = Math.round(process.memoryUsage().heapUsed / 1e6);
      process.stderr.write(
        `[ingest] shape=${SHAPE} rows=${n} total=${Math.round(total)}ms heapMB=${heap} count=${rel.rowCount}\n`,
      );
      // And back: DuckDB -> TS (SqlScope.fetch), the cost of a TS node (compare/output) after SQL.
      const f0 = performance.now();
      const back = scope.fetch(rel);
      process.stderr.write(
        `[fetch] shape=${SHAPE} rows=${n} fetch=${Math.round(performance.now() - f0)}ms back=${back.rows.length}\n`,
      );
      scope.dispose();
    });
  }
});

export { tableToIPC, ArrowTable, float64Vector };
export type { Vector };
