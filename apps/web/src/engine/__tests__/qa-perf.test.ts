/**
 * QA (tester) — performance sanity check, SKIPPED by default so CI stays fast.
 * Run: HRFLOW_PERF=1 pnpm --filter @hrflow/web test -- qa-perf
 * Rows: HRFLOW_PERF_ROWS (default 100000) per side. Fake data only, in memory.
 * Note: generating > ~250k rows with SheetJS needs NODE_OPTIONS=--max-old-space-size=6144.
 */
import { CompareConfigSchema } from '@hrflow/flow-schema';
import { describe, expect, it } from 'vitest';
import { createEngineTranslator } from '../core/i18n';
import { readSlot } from '../io/excel-reader';
import { writeWorkbook } from '../io/excel-writer';
import { executeCompare } from '../nodes/control-compare';
import {
  acceptanceNodeConfig,
  acceptanceSlot,
  nv,
  payrollFile,
  timesheetFile,
  type EmpRow,
} from './qa-helpers';

const ENABLED = process.env.HRFLOW_PERF === '1';
const N = Number(process.env.HRFLOW_PERF_ROWS ?? 100_000);

describe.skipIf(!ENABLED)(`QA perf: ${N} rows reader → compare → writer`, () => {
  it('runs within a sane time budget', { timeout: 600_000 }, async () => {
    const ms = (t0: number) => Math.round(performance.now() - t0);
    const pay: EmpRow[] = [];
    const ts: EmpRow[] = [];
    for (let i = 1; i <= N; i++) {
      const cong = 20 + (i % 7) + (i % 2) * 0.5;
      pay.push([nv(i), `Nhân viên ${i}`, `CN${i % 50}`, cong, i % 9, i % 3, 0]);
      // ~1% mismatched công, ~0.5% only-left/right
      const tsCong = i % 100 === 0 ? cong - 2 : cong;
      ts.push([
        i % 200 === 0 ? `NVX${i}` : nv(i),
        `Nhân viên ${i}`,
        `CN${i % 50}`,
        tsCong,
        i % 9,
        i % 3,
        0,
      ]);
    }
    let t0 = performance.now();
    const payFile = payrollFile('bl.xlsx', pay);
    const tsFile = timesheetFile('cc.xlsx', ts);
    const tGen = ms(t0);

    t0 = performance.now();
    // Ids may exceed 5 digits at this size: keep only the unique rule on ma_nv.
    const noRegex = (key: 'bang_luong' | 'cham_cong') => {
      const s = acceptanceSlot(key);
      s.columns[0]!.rules = [{ unique: true, severity: 'error' }];
      return s;
    };
    const left = readSlot(noRegex('bang_luong'), [payFile]);
    const right = readSlot(noRegex('cham_cong'), [tsFile]);
    const tRead = ms(t0);
    expect(left.table.rows).toHaveLength(N);
    expect(left.report.errorCount + right.report.errorCount).toBe(0);

    t0 = performance.now();
    const ctx = { t: createEngineTranslator('vi') };
    const out = executeCompare(
      CompareConfigSchema.parse(acceptanceNodeConfig('cmp')),
      left.table,
      right.table,
      ctx,
    );
    const tCmp = ms(t0);

    t0 = performance.now();
    const bytes = await writeWorkbook([
      { name: 'Tổng hợp', table: out.summary },
      { name: 'Lệch', table: out.mismatched },
      { name: 'Chỉ có trong lương', table: out.only_left },
      { name: 'Chỉ có trong chấm công', table: out.only_right },
    ]);
    const tWrite = ms(t0);

    const heapMb = Math.round(process.memoryUsage().heapUsed / 1e6);
    // Reported in the test output on purpose (perf sanity, not a data log).
    process.stderr.write(
      `[perf] rows=${N} gen=${tGen}ms read(2 slots)=${tRead}ms compare=${tCmp}ms write=${tWrite}ms ` +
        `out=${Math.round(bytes.byteLength / 1024)}KB heap=${heapMb}MB ` +
        `mismatched=${out.mismatched.rows.length} onlyL=${out.only_left.rows.length} onlyR=${out.only_right.rows.length}\n`,
    );
    expect(tRead + tCmp).toBeLessThan(120_000);
  });
});
