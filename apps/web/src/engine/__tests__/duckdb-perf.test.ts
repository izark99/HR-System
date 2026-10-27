/**
 * Performance of the DuckDB transforms (AC-B3-24), SKIPPED by default so CI stays fast.
 * Run: HRFLOW_PERF=1 pnpm --filter @hrflow/web test -- duckdb-perf
 * Rows: HRFLOW_PERF_ROWS (default 100000) × 30 columns, fake data in memory (no Excel parsing;
 * the reader has its own perf test, qa-perf). 1M rows needs NODE_OPTIONS=--max-old-space-size=8192.
 */
import { describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import type { ColumnDef, Row, Table } from '../core/types';
import { nodeDuckDb } from './duckdb-node';
import { runWith } from './sql-helpers';

const ENABLED = process.env.HRFLOW_PERF === '1';
const N = Number(process.env.HRFLOW_PERF_ROWS ?? 100_000);

function bigTable(n: number): Table {
  const columns: ColumnDef[] = [
    { key: 'ma_nv', type: 'string' },
    { key: 'chi_nhanh', type: 'string' },
    { key: 'ngay_vao', type: 'date' },
  ];
  for (let c = 0; c < 15; c++) columns.push({ key: `so_${c}`, type: 'decimal' });
  for (let c = 0; c < 12; c++) columns.push({ key: `txt_${c}`, type: 'string' });
  const rows = new Array<Row>(n);
  for (let i = 0; i < n; i++) {
    const r: Row = {
      ma_nv: `NV${String(i).padStart(7, '0')}`,
      chi_nhanh: `CN${String(i % 50).padStart(2, '0')}`,
      ngay_vao: `20${String(10 + (i % 15))}-0${1 + (i % 9)}-1${i % 10}`,
    };
    for (let c = 0; c < 15; c++) r[`so_${c}`] = new Big(((i * (c + 3)) % 100_000) / 100);
    for (let c = 0; c < 12; c++) r[`txt_${c}`] = `Giá trị ${c}-${i % 997}`;
    rows[i] = r;
  }
  return { columns, rows };
}

describe.skipIf(!ENABLED)(`DuckDB perf: ${N} rows × 30 columns`, () => {
  it('filter → join → groupBy → output stays within budget', { timeout: 900_000 }, async () => {
    await nodeDuckDb(); // not part of the budget (first load)
    const left = bigTable(N);
    const right: Table = {
      columns: [
        { key: 'ma_nv', type: 'string' },
        { key: 'he_so', type: 'decimal' },
      ],
      rows: left.rows.map((r, i) => ({ ma_nv: r.ma_nv ?? null, he_so: new Big(1 + (i % 5) / 10) })),
    };
    const t0 = performance.now();
    const result = await runWith(
      { left, right },
      [
        {
          id: 'f',
          type: 'transform.filter',
          config: { conditions: [{ column: 'so_0', op: 'gte', value: 1 }] },
        },
        {
          id: 'j',
          type: 'transform.join',
          config: { how: 'left', on: [{ left: 'ma_nv', right: 'ma_nv' }] },
        },
        {
          id: 'g',
          type: 'transform.groupBy',
          config: {
            by: ['chi_nhanh'],
            aggregations: [
              { key: 'tong', fn: 'sum', column: 'so_1' },
              { key: 'tb', fn: 'avg', column: 'he_so' },
              { key: 'n', fn: 'countRows' },
            ],
          },
        },
      ],
      [
        { from: 'left', to: 'f' },
        { from: 'f', to: 'j', toPort: 'left' },
        { from: 'right', to: 'j', toPort: 'right' },
        { from: 'j', to: 'g' },
      ],
      { collect: ['g'] },
    );
    const ms = Math.round(performance.now() - t0);
    process.stderr.write(
      `[perf] ${N} rows: ${ms} ms ${JSON.stringify(result.nodes.map((n) => [n.nodeId, Math.round(n.durationMs)]))}\n`,
    );
    expect(result.outputs.g!.out!.rows).toHaveLength(50);
    if (N <= 100_000) expect(ms).toBeLessThan(10_000);
  });
});
