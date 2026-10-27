/**
 * QA perf, SKIPPED by default: payroll-like table (7 columns, like the acceptance flow) through
 * filter -> join -> groupBy(avg) -> sort(string, TS) -> code.sql, at HRFLOW_PERF_SIZES rows.
 * HRFLOW_PERF=1 HRFLOW_PERF_SIZES=100000,1000000 NODE_OPTIONS=--max-old-space-size=3700 \
 *   pnpm --filter @hrflow/web test -- qa-duckdb-flow-perf
 * (3700 MB ~ the V8 heap limit of the Chromium used by the E2E tests.)
 */
import { describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import type { ColumnDef, Row, Table } from '../core/types';
import { nodeDuckDb } from './duckdb-node';
import { runWith } from './sql-helpers';

const ENABLED = process.env.HRFLOW_PERF === '1';
const SIZES = (process.env.HRFLOW_PERF_SIZES ?? '100000').split(',').map(Number);

function payroll(n: number): Table {
  const columns: ColumnDef[] = [
    { key: 'ma_nv', type: 'string' },
    { key: 'ho_ten', type: 'string' },
    { key: 'chi_nhanh', type: 'string' },
    { key: 'cong', type: 'decimal' },
    { key: 'ot', type: 'decimal' },
    { key: 'phep', type: 'decimal' },
    { key: 'khong_luong', type: 'decimal' },
  ];
  const rows = new Array<Row>(n);
  for (let i = 0; i < n; i++) {
    rows[i] = {
      ma_nv: `NV${String(i).padStart(7, '0')}`,
      ho_ten: `Nhân viên Giả ${i}`,
      chi_nhanh: `CN${String(i % 20).padStart(2, '0')}`,
      cong: new Big(20 + (i % 7) / 2),
      ot: new Big((i % 13) / 4),
      phep: new Big(i % 3),
      khong_luong: new Big(i % 5 === 0 ? 1 : 0),
    };
  }
  return { columns, rows };
}

describe.skipIf(!ENABLED)('QA DuckDB flow perf (7 columns)', () => {
  for (const n of SIZES) {
    it(`${n} rows`, { timeout: 1_800_000 }, async () => {
      await nodeDuckDb();
      const left = payroll(n);
      const right = payroll(n);
      const t0 = performance.now();
      const result = await runWith(
        { left, right },
        [
          {
            id: 'f',
            type: 'transform.filter',
            config: { conditions: [{ column: 'cong', op: 'gte', value: 1 }] },
          },
          {
            id: 'j',
            type: 'transform.join',
            config: {
              how: 'left',
              on: [{ left: 'ma_nv', right: 'ma_nv' }],
              rightColumns: ['cong'],
            },
          },
          {
            id: 'g',
            type: 'transform.groupBy',
            config: {
              by: ['chi_nhanh'],
              aggregations: [
                { key: 'tong', fn: 'sum', column: 'cong' },
                { key: 'tb', fn: 'avg', column: 'cong_r' },
                { key: 'n', fn: 'countRows' },
              ],
            },
          },
          {
            id: 's',
            type: 'transform.sort',
            config: { by: [{ column: 'chi_nhanh', direction: 'desc' }] },
          },
        ],
        [
          { from: 'left', to: 'f' },
          { from: 'f', to: 'j', toPort: 'left' },
          { from: 'right', to: 'j', toPort: 'right' },
          { from: 'j', to: 'g' },
          { from: 'g', to: 's' },
        ],
        { collect: ['s'] },
      );
      const ms = Math.round(performance.now() - t0);
      process.stderr.write(
        `[flow-perf] ${n} rows x 7 cols: ${ms} ms ${JSON.stringify(result.nodes.map((x) => [x.nodeId, Math.round(x.durationMs)]))}\n`,
      );
      expect(result.outputs.s!.out!.rows).toHaveLength(20);
    });
  }
});
