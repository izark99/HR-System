/* global process, console */
// Bundle budget (spec §18, MEMORY 2026-10-27 07:36): the gzipped entry chunk must not grow more
// than 10% over the end-of-step-2 baseline (commit d079f6b), stored in bundle-budget.json.
// Design v2 (spec §28 AC-UI-41): the total gzipped CSS (every dist/assets/*.css) must not grow
// more than 10% over the baseline measured on a6e36e1.
//
//   node scripts/check-bundle-size.mjs [distDir]            check (run after `vite build`)
//   node scripts/check-bundle-size.mjs [distDir] --measure  print the size only (to set a baseline)
import { readdirSync, readFileSync } from 'node:fs';
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
const gzip = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
const gzipBytes = gzip(entry);
const cssFiles = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => `assets/${f}`);
const cssGzipBytes = cssFiles.reduce((sum, f) => sum + gzip(f), 0);

if (measureOnly) {
  console.log(JSON.stringify({ entry, gzipBytes, cssFiles, cssGzipBytes }));
  process.exit(0);
}

const budget = JSON.parse(readFileSync(join(here, '..', 'bundle-budget.json'), 'utf8'));
const limit = Math.floor(budget.entryGzipBytes * (1 + budget.maxGrowth));
const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
const line = `entry chunk ${entry}: ${kb(gzipBytes)} gzip (baseline ${kb(budget.entryGzipBytes)} at ${budget.baselineCommit}, limit ${kb(limit)})`;
const cssLimit = Math.floor(budget.cssGzipBytes * (1 + budget.maxGrowth));
const cssLine = `css (${cssFiles.length} files): ${kb(cssGzipBytes)} gzip (baseline ${kb(budget.cssGzipBytes)} at ${budget.cssBaselineCommit}, limit ${kb(cssLimit)})`;
let failed = false;
for (const [over, text] of [
  [gzipBytes > limit, line],
  [cssGzipBytes > cssLimit, cssLine],
]) {
  if (over) failed = true;
  (over ? console.error : console.log)(`bundle-budget: ${over ? 'FAIL' : 'OK'} ${text}`);
}
if (failed) process.exit(1);
