/**
 * AC-B3-24 in Node, SKIPPED by default: the 30-column flow of perf-flow.ts (input.excel → filter →
 * join → groupBy → output.excel) from a real .xlsx, timing the read + validation and the run.
 * HRFLOW_PERF=1 [HRFLOW_PERF_SIZES=100000,1000000] NODE_OPTIONS=--max-old-space-size=3800 \
 *   pnpm --filter @hrflow/web test -- perf-columnar
 * Workbooks are generated once (fixed seed, fake data) into the OS temp dir.
 */
import { FlowDefinitionSchema } from '@hrflow/flow-schema';
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { runFlow } from '../core/executor';
import { createEngineTranslator } from '../core/i18n';
import { readSlotAsync } from '../io/excel-reader';
import { nodeDuckDb } from './duckdb-node';
import { perfBranchAoa, perfFlow, writePerfWorkbook } from './perf-flow';

const ENABLED = process.env.HRFLOW_PERF === '1';
const SIZES = (process.env.HRFLOW_PERF_SIZES ?? '100000').split(',').map(Number);
const DIR = join(tmpdir(), 'hrflow-perf-columnar');
const mb = (n: number) => Math.round(n / 1048576);

describe.skipIf(!ENABLED)('perf: 30-column flow from .xlsx', () => {
  for (const n of SIZES) {
    it(`${n} rows`, { timeout: 3_600_000 }, async () => {
      mkdirSync(DIR, { recursive: true });
      const path = join(DIR, `du_lieu_${n}.xlsx`);
      if (!existsSync(path)) await writePerfWorkbook(ExcelJS, path, n);
      const flow = FlowDefinitionSchema.parse(perfFlow());
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perfBranchAoa()), 'CN');
      const branches = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      await nodeDuckDb();

      const t0 = performance.now();
      const data = await readSlotAsync(flow.inputSlots[0]!, [
        { name: 'du_lieu.xlsx', data: new Uint8Array(readFileSync(path)) },
      ]);
      const lookup = await readSlotAsync(flow.inputSlots[1]!, [
        { name: 'chi_nhanh.xlsx', data: branches },
      ]);
      const readMs = performance.now() - t0;
      const readHeap = getHeapStatistics().used_heap_size;
      expect(data.report.errorCount).toBe(0);
      expect(data.table.rowCount).toBe(n);

      const result = await runFlow(flow, {
        t: createEngineTranslator('vi'),
        duck: nodeDuckDb,
        releaseIntermediate: true,
        readSlot: (k) => (k === 'du_lieu' ? data : lookup),
      });
      process.stderr.write(
        `[perf-columnar] ${n} rows x 30: read+validate ${Math.round(readMs)} ms (heap ${mb(readHeap)} MB), run ${Math.round(result.durationMs)} ms ${JSON.stringify(result.nodes.map((x) => [x.nodeId, Math.round(x.durationMs)]))}, heap after ${mb(getHeapStatistics().used_heap_size)} MB\n`,
      );
      expect(result.artifacts).toHaveLength(1);
      expect(result.outputs.gop?.out?.rowCount).toBe(150);
      // Spec §18 / AC-B3-24: 100k rows x 30 columns in < 10 s.
      if (n <= 100_000) {
        expect(result.durationMs).toBeLessThan(10_000);
        expect(readMs + result.durationMs).toBeLessThan(10_000);
      }
    });
  }
});
