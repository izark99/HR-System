/**
 * Perf round (spec §31, AC-PF-01/02) in Node, SKIPPED by default: time `SqlScope.upload` alone on
 * the table the reader builds from the 30-column perf workbook (perf-flow.ts, fake data, fixed
 * seed). Median of HRFLOW_PERF_RUNS (default 5) uploads, each in a fresh scope.
 * HRFLOW_PERF=1 [HRFLOW_PERF_SIZES=100000,1000000] [HRFLOW_PERF_RUNS=5] \
 *   NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @hrflow/web test -- upload-perf
 */
import { FlowDefinitionSchema } from '@hrflow/flow-schema';
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqlScope } from '../duckdb/scope';
import { readSlotAsync } from '../io/excel-reader';
import { nodeDuckDb } from './duckdb-node';
import { perfFlow, writePerfWorkbook } from './perf-flow';

const ENABLED = process.env.HRFLOW_PERF === '1';
const SIZES = (process.env.HRFLOW_PERF_SIZES ?? '100000').split(',').map(Number);
const RUNS = Number(process.env.HRFLOW_PERF_RUNS ?? 5);
const DIR = join(tmpdir(), 'hrflow-perf-columnar');

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

describe.skipIf(!ENABLED)('perf: SqlScope.upload', () => {
  for (const n of SIZES) {
    it(`${n} rows × 30 columns`, { timeout: 3_600_000 }, async () => {
      mkdirSync(DIR, { recursive: true });
      const path = join(DIR, `du_lieu_${n}.xlsx`);
      if (!existsSync(path)) await writePerfWorkbook(ExcelJS, path, n);
      const flow = FlowDefinitionSchema.parse(perfFlow());
      const data = await readSlotAsync(flow.inputSlots[0]!, [
        { name: 'du_lieu.xlsx', data: new Uint8Array(readFileSync(path)) },
      ]);
      expect(data.table.rowCount).toBe(n);
      const db = await nodeDuckDb();
      const times: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        const scope = new SqlScope(db);
        const t0 = performance.now();
        const rel = scope.upload(data.table);
        times.push(performance.now() - t0);
        expect(rel.rowCount).toBe(n);
        scope.dispose();
      }
      process.stderr.write(
        `[upload-perf] ${n} rows: median ${Math.round(median(times))} ms, runs ${JSON.stringify(times.map(Math.round))}\n`,
      );
    });
  }
});
