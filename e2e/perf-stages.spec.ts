/**
 * Perf round (spec §31), opt-in (HRFLOW_PERF=1): stage timings of a run in Chromium, read from the
 * engine worker's User Timing measures (`hrflow:<stage>`, engine/core/perf.ts — names and
 * durations only, never data). Fake data only (perf-flow.ts, fixed seed), generated into the OS
 * temp dir and reused.
 *
 * - `stages` (AC-PF-01/02, AC-B3-24): input.excel → filter → join → groupBy → output.excel.
 *   read = read + validate of the data file; upload = SqlScope.upload; sql = DuckDB SQL
 *   (node SQL, materialize, read back); write = .xlsx writer; total = read + run (click → result,
 *   inside the worker).
 * - `formula` (AC-PF-03, AC-B4-31): input.excel → transform.formula (5 columns, 10 at ≥ 1M rows)
 *   → 2 × groupBy → output.excel; "formula SQL" = the one materialize of the formula result.
 *
 * One warm-up pass per test first (loads DuckDB: not counted), then HRFLOW_PERF_RUNS passes
 * (default 3) in the same page and worker; each number is the median.
 *
 * HRFLOW_PERF=1 [HRFLOW_PERF_ROWS=100000,1000000] [HRFLOW_PERF_RUNS=3]
 *   [HRFLOW_PERF_SUITE=stages,formula] pnpm test:e2e e2e/perf-stages.spec.ts
 * (or `pnpm perf:local`, scripts/perf-local.mjs, on a real machine with Chrome).
 */
import { expect, test, type Page } from './fixtures';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  perfBranchAoa,
  perfFlow,
  perfFormulaFlow,
  writePerfWorkbook,
} from '../apps/web/src/engine/__tests__/perf-flow';
import { ExcelJS, XLSX } from './helpers';
import type { SupabaseMock } from './supabase-mock';

const ENABLED = process.env.HRFLOW_PERF === '1';
const SIZES = (process.env.HRFLOW_PERF_ROWS ?? '100000').split(',').map(Number);
const RUNS = Number(process.env.HRFLOW_PERF_RUNS ?? 3);
const SUITES = (process.env.HRFLOW_PERF_SUITE ?? 'stages').split(',');
const DIR = join(tmpdir(), 'hrflow-perf-stages');
const BRANCHES = join(DIR, 'chi_nhanh.xlsx');
const dataFile = (rows: number) => join(DIR, `du_lieu_${rows}.xlsx`);

test.skip(!ENABLED, 'perf E2E: set HRFLOW_PERF=1');
test.describe.configure({ timeout: 4 * 60 * 60_000 });

const STAGES = ['read', 'upload', 'sql', 'write', 'run'] as const;
type Stage = (typeof STAGES)[number];
interface Pass {
  stages: Record<Stage, number>;
  sqlMax: number;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

/** Sum of the measures per stage (and the longest single `sql` one) of the engine worker. */
async function readMeasures(page: Page): Promise<Pass | null> {
  for (const w of page.workers()) {
    const entries = await w
      .evaluate(() =>
        performance
          .getEntriesByType('measure')
          .filter((e) => e.name.startsWith('hrflow:'))
          .map((e) => [e.name.slice(7), e.duration] as [string, number]),
      )
      .catch(() => [] as [string, number][]);
    if (entries.length === 0) continue;
    const stages = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
    let sqlMax = 0;
    for (const [name, ms] of entries) {
      if (name in stages) stages[name as Stage] += ms;
      if (name === 'sql') sqlMax = Math.max(sqlMax, ms);
    }
    return { stages, sqlMax };
  }
  return null;
}

async function clearMeasures(page: Page): Promise<void> {
  for (const w of page.workers())
    await w.evaluate(() => performance.clearMeasures()).catch(() => 0);
}

const runButton = (page: Page) => page.getByRole('button', { name: /^(Bắt đầu|Đang)/ }).last();

/** One pass: (re)select the data file (read + validate), run, wait for the Result screen. */
async function pass(page: Page, data: string): Promise<Pass> {
  const remove = page.getByRole('button', { name: `Bỏ file ${basename(data)}` });
  if (await remove.count()) await remove.click();
  await clearMeasures(page);
  await page.getByLabel(/^Chọn file cho Dữ liệu nhân sự/).setInputFiles(data);
  await expect(runButton(page)).toHaveText('Bắt đầu', { timeout: 60 * 60_000 });
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 60 * 60_000 });
  const m = await readMeasures(page);
  if (!m) throw new Error('no hrflow:* measures in any worker');
  await page.getByRole('button', { name: 'Bắt đầu lại' }).click();
  await expect(page).not.toHaveURL(/\/result$/);
  return m;
}

function report(title: string, passes: Pass[]): string {
  const row = (label: string, xs: number[]) =>
    `${label.padEnd(12)} median ${String(Math.round(median(xs))).padStart(7)} ms   runs ${xs.map(Math.round).join(', ')}`;
  const lines = [title];
  for (const s of ['read', 'upload', 'sql', 'write'] as const) {
    lines.push(
      row(
        s,
        passes.map((p) => p.stages[s]),
      ),
    );
  }
  lines.push(
    row(
      'sql (max 1)',
      passes.map((p) => p.sqlMax),
    ),
  );
  lines.push(
    row(
      'run',
      passes.map((p) => p.stages.run),
    ),
  );
  lines.push(
    row(
      'total',
      passes.map((p) => p.stages.read + p.stages.run),
    ),
  );
  return lines.join('\n');
}

async function measure(
  page: Page,
  supabase: SupabaseMock,
  flow: ReturnType<typeof perfFlow>,
  rows: number,
  withBranches: boolean,
): Promise<Pass[]> {
  supabase.setVersions([{ no: 1, from: '2026-01-01', definition: flow }]);
  const crashed: string[] = [];
  page.on('crash', () => crashed.push('page crashed'));
  page.on('pageerror', (e) => crashed.push(e.message));
  await page.goto('/run/payroll-timesheet');
  await expect(page.getByLabel(/^Chọn file cho Dữ liệu nhân sự/)).toBeAttached();
  if (withBranches)
    await page.getByLabel(/^Chọn file cho Danh mục chi nhánh/).setInputFiles(BRANCHES);
  await pass(page, dataFile(rows)); // warm-up: first DuckDB load, not counted
  const passes: Pass[] = [];
  for (let r = 0; r < RUNS; r++) passes.push(await pass(page, dataFile(rows)));
  expect(crashed).toEqual([]);
  return passes;
}

test.beforeAll(async () => {
  test.setTimeout(4 * 60 * 60_000);
  mkdirSync(DIR, { recursive: true });
  if (!existsSync(BRANCHES)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perfBranchAoa()), 'ChiNhanh');
    writeFileSync(BRANCHES, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  }
  for (const n of SIZES)
    if (!existsSync(dataFile(n))) await writePerfWorkbook(ExcelJS, dataFile(n), n);
});

for (const rows of SIZES) {
  if (SUITES.includes('stages')) {
    test(`stages: ${rows} rows x 30 columns, filter -> join -> groupBy -> output.excel`, async ({
      page,
      supabase,
    }) => {
      const passes = await measure(page, supabase, perfFlow(), rows, true);
      console.log(report(`[perf stages] rows=${rows} runs=${RUNS}`, passes));
    });
  }
  if (SUITES.includes('formula')) {
    const count = rows >= 1_000_000 ? 10 : 5;
    test(`formula: ${rows} rows x 30 columns, ${count} formula columns`, async ({
      page,
      supabase,
    }) => {
      const passes = await measure(page, supabase, perfFormulaFlow(count), rows, false);
      console.log(
        report(`[perf formula] rows=${rows} formulas=${count} runs=${RUNS}`, passes) +
          `\nformula SQL (AC-B4-31) = "sql (max 1)" row`,
      );
    });
  }
}
