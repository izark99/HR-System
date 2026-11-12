/* global process, console */
// Bundle budget (spec §18, MEMORY 2026-11-12 21:14), settings in bundle-budget.json:
//
// 1. The JS loaded at start-up must stay under an absolute gzip limit. Vite 8 (Rolldown) moves
//    shared modules out of the entry into chunks the entry imports statically (listed as
//    <link rel="modulepreload">); they load with the entry, so they count (spec §30 AC-TL-02).
// 2. The heavy libraries (Monaco, React Flow, DuckDB, SheetJS, ExcelJS) must not be in that
//    start-up JS. Each one is recognised by a marker string of its code. A marker found in no
//    chunk at all is stale (the library changed or was removed): that fails too, so the check
//    cannot go blind without anyone noticing.
// 3. Design v2 (spec §28 AC-UI-41): the total gzipped CSS (every dist/assets/*.css) must not grow
//    more than 10% over the baseline measured on a6e36e1.
//
//   node scripts/check-bundle-size.mjs [distDir]            check (run after `vite build`)
//   node scripts/check-bundle-size.mjs [distDir] --measure  print the sizes only
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
const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/([^"]+\.js)"/g)].map(
  (m) => m[1],
);
const initialJs = [entry, ...preloads];
const gzip = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
const gzipBytes = initialJs.reduce((sum, f) => sum + gzip(f), 0);
const assets = readdirSync(join(dist, 'assets')).map((f) => `assets/${f}`);
const cssFiles = assets.filter((f) => f.endsWith('.css'));
const cssGzipBytes = cssFiles.reduce((sum, f) => sum + gzip(f), 0);

if (measureOnly) {
  console.log(JSON.stringify({ entry, preloads, gzipBytes, cssFiles, cssGzipBytes }));
  process.exit(0);
}

const budget = JSON.parse(readFileSync(join(here, '..', 'bundle-budget.json'), 'utf8'));
const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
const checks = [];

const limit = budget.entryLimitGzipBytes;
checks.push([
  gzipBytes > limit,
  `start-up JS ${entry} + ${preloads.length} preloaded: ${kb(gzipBytes)} gzip (limit ${kb(limit)}, ${kb(limit - gzipBytes)} left)`,
]);

const jsFiles = assets.filter((f) => f.endsWith('.js'));
const jsText = new Map(jsFiles.map((f) => [f, readFileSync(join(dist, f), 'utf8')]));
for (const { library, marker } of budget.notInInitialJs) {
  const holders = jsFiles.filter((f) => jsText.get(f).includes(marker));
  const leaked = holders.filter((f) => initialJs.includes(f));
  if (holders.length === 0) {
    checks.push([
      true,
      `${library}: marker "${marker}" is in no chunk; update notInInitialJs in bundle-budget.json`,
    ]);
  } else {
    checks.push([
      leaked.length > 0,
      leaked.length > 0
        ? `${library} is in the start-up JS (${leaked.join(', ')}); it must load lazily`
        : `${library} stays out of the start-up JS (${holders.length} lazy chunk${holders.length > 1 ? 's' : ''})`,
    ]);
  }
}

const cssLimit = Math.floor(budget.cssGzipBytes * (1 + budget.cssMaxGrowth));
checks.push([
  cssGzipBytes > cssLimit,
  `css (${cssFiles.length} files): ${kb(cssGzipBytes)} gzip (baseline ${kb(budget.cssGzipBytes)} at ${budget.cssBaselineCommit}, limit ${kb(cssLimit)})`,
]);

let failed = false;
for (const [bad, text] of checks) {
  if (bad) failed = true;
  (bad ? console.error : console.log)(`bundle-budget: ${bad ? 'FAIL' : 'OK'} ${text}`);
}
if (failed) process.exit(1);
