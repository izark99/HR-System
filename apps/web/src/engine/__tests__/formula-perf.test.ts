/**
 * AC-B4-31 in Node, SKIPPED by default: `transform.formula` over the 30-column perf workbook
 * (perf-flow.ts, fake data). 100k rows × 5 formula columns (target ≤ 2 s for the node) and
 * 1M rows × 10 formula columns (must finish without crashing). Only the formula SQL is timed; the
 * upload of the input table to DuckDB is reported apart (MEMORY 2026-10-30 17:32).
 * HRFLOW_PERF=1 [HRFLOW_PERF_SIZES=100000,1000000] NODE_OPTIONS=--max-old-space-size=3800 \
 *   pnpm --filter @hrflow/web test -- formula-perf
 */
import { FlowDefinitionSchema } from '@hrflow/flow-schema';
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSlotAsync } from '../io/excel-reader';
import { perfFlow, writePerfWorkbook } from './perf-flow';
import { FormulaConfigSchema } from '@hrflow/flow-schema';
import { createEngineTranslator } from '../core/i18n';
import { SqlScope } from '../duckdb/scope';
import type { SqlRel } from '../duckdb/sql';
import { transformFormulaPlugin } from '../nodes/transform-formula';
import { nodeDuckDb } from './duckdb-node';

const ENABLED = process.env.HRFLOW_PERF === '1';
const SIZES = (process.env.HRFLOW_PERF_SIZES ?? '100000').split(',').map(Number);
const DIR = join(tmpdir(), 'hrflow-perf-columnar');

const FORMULAS = [
  '=ROUND([so_2]*1.1,2)',
  '=IF([so_6]>25000000,"Cao","Thấp")',
  '=IFERROR([so_7]/[so_8],0)',
  '=LEFT([ma_nv],4)&"-"&UPPER([chi_nhanh])',
  '=DATEDIF([ngay_vao],DATE(2026,9,30),"M")',
  '=SUM([so_1],[so_2],[so_3],[so_4])',
  '=EOMONTH([ngay_hd],1)',
  '=MAX([so_11],[so_12])-MIN([so_13],[so_14])',
  '=PROPER([ho_ten])',
  '=[so_15]*[so_1]/26',
];

describe.skipIf(!ENABLED)('perf: transform.formula (AC-B4-31)', () => {
  for (const n of SIZES) {
    const count = n >= 1_000_000 ? 10 : 5;
    it(`${n} rows × 30 columns, ${count} formula columns`, { timeout: 3_600_000 }, async () => {
      mkdirSync(DIR, { recursive: true });
      const path = join(DIR, `du_lieu_${n}.xlsx`);
      if (!existsSync(path)) await writePerfWorkbook(ExcelJS, path, n);
      const flow = FlowDefinitionSchema.parse(perfFlow());
      const data = await readSlotAsync(flow.inputSlots[0]!, [
        { name: 'du_lieu.xlsx', data: new Uint8Array(readFileSync(path)) },
      ]);
      expect(data.table.rowCount).toBe(n);
      const columns = FORMULAS.slice(0, count).map((formula, i) => ({
        key: `ct_${i + 1}`,
        formula,
      }));
      // AC-B4-31 counts the formula SQL only (MEMORY 2026-10-30 17:32): upload the input to DuckDB
      // first (timed apart), then run the node's SQL and materialize its result.
      const db = await nodeDuckDb();
      const scope = new SqlScope(db);
      const t0 = performance.now();
      const input = scope.upload(data.table);
      const uploadMs = performance.now() - t0;
      const warnings: { params: Record<string, unknown> }[] = [];
      const config = FormulaConfigSchema.parse({ columns });
      const t1 = performance.now();
      const out = transformFormulaPlugin.runSql!(
        config,
        { in: input },
        {
          t: createEngineTranslator('vi'),
          sql: scope,
          run: {
            nodeId: 'f',
            params: {},
            readSlot: () => {
              throw new Error('no slot');
            },
            emitArtifact: () => undefined,
            emitView: () => undefined,
            warn: (w) => warnings.push(w),
            signal: undefined,
          },
        },
      ) as Record<string, SqlRel>;
      const result = scope.materialize(out.out!);
      const sqlMs = performance.now() - t1;
      process.stderr.write(
        `[formula-perf] ${n} rows, ${count} formulas: formula SQL ${Math.round(sqlMs)} ms (upload to DuckDB ${Math.round(uploadMs)} ms, not counted), warnings ${JSON.stringify(warnings.map((w) => [w.params.column, w.params.error, w.params.count]))}\n`,
      );
      expect(result.rowCount).toBe(n);
      scope.dispose();
      if (n === 100_000) expect(sqlMs).toBeLessThan(2000);
    });
  }
});
