#!/usr/bin/env node
/**
 * `pnpm perf:local` (spec §31, AC-PF-06): stage timings of the AC-B3-24 / AC-B4-31 flows on this
 * machine. Builds the app (E2E mode: mocked Supabase, nothing leaves the machine), generates fake
 * workbooks (fixed seed) into the OS temp dir and runs e2e/perf-stages.spec.ts in the installed
 * Google Chrome (or PW_CHROMIUM_PATH). Prints one table per test.
 *
 *   pnpm perf:local                       # 100,000 rows, stages + formula, 3 runs
 *   pnpm perf:local -- --rows 100000,1000000 --runs 3 --suite stages,formula
 *   pnpm perf:local -- --no-build         # reuse the last build
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const env = {
  ...process.env,
  HRFLOW_PERF: '1',
  HRFLOW_PERF_ROWS: opt('rows', '100000'),
  HRFLOW_PERF_RUNS: opt('runs', '3'),
  HRFLOW_PERF_SUITE: opt('suite', 'stages,formula'),
  // Use the browser installed on this machine; no browser download.
  ...(process.env.PW_CHROMIUM_PATH ? {} : { PW_CHANNEL: process.env.PW_CHANNEL ?? 'chrome' }),
  // Fresh preview server for this build.
  CI: '1',
};

const shell = process.platform === 'win32';
function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', env, shell });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!args.includes('--no-build')) run('pnpm', ['--filter', '@hrflow/web', 'build:e2e']);
run('pnpm', ['exec', 'playwright', 'test', 'e2e/perf-stages.spec.ts', '--reporter=list']);
