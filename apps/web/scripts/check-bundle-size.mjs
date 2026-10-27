/* global process, console */
// Bundle budget (spec §18, MEMORY 2026-10-27 07:36): the gzipped entry chunk must not grow more
// than 10% over the end-of-step-2 baseline (commit d079f6b), stored in bundle-budget.json.
//
//   node scripts/check-bundle-size.mjs [distDir]            check (run after `vite build`)
//   node scripts/check-bundle-size.mjs [distDir] --measure  print the size only (to set a baseline)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const measureOnly = args.includes('--measure');
const dist = resolve(args.find((a) => !a.startsWith('--')) ?? join(here, '..', 'dist'));

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const match = /<script[^>]*type="module"[^>]*src="\/([^"]+\.js)"/.exec(html);
if (!match) {
  console.error('bundle-budget: no entry <script type="module"> found in dist/index.html');
  process.exit(1);
}
const entry = match[1];
const gzipBytes = gzipSync(readFileSync(join(dist, entry)), { level: 9 }).length;

if (measureOnly) {
  console.log(JSON.stringify({ entry, gzipBytes }));
  process.exit(0);
}

const budget = JSON.parse(readFileSync(join(here, '..', 'bundle-budget.json'), 'utf8'));
const limit = Math.floor(budget.entryGzipBytes * (1 + budget.maxGrowth));
const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
const line = `entry chunk ${entry}: ${kb(gzipBytes)} gzip (baseline ${kb(budget.entryGzipBytes)} at ${budget.baselineCommit}, limit ${kb(limit)})`;
if (gzipBytes > limit) {
  console.error(`bundle-budget: FAIL ${line}`);
  process.exit(1);
}
console.log(`bundle-budget: OK ${line}`);
