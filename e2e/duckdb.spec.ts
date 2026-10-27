/**
 * DuckDB-WASM in the browser (spec §13.1; AC-B3-02, AC-B3-03, AC-B3-04, AC-B3-05): the .wasm
 * parts come from the app origin only, are verified, cached in Cache Storage (binary only) and
 * DuckDB runs a transform node; a corrupt part fails cleanly with duckdb.error.loadFailed.
 */
import { expect, SUPABASE_ORIGIN, test, type Page } from './fixtures';
import { runButton, uploadFixtures } from './helpers';
import { baseFlowDefinition } from './supabase-mock';

/** Acceptance flow + `in_luong → transform.filter (CN01) → output.preview`. */
function flowWithDuckDb(): Record<string, unknown> {
  const def = baseFlowDefinition();
  (def.nodes as unknown[]).push(
    {
      id: 'loc_cn01',
      type: 'transform.filter',
      label: 'Chi nhánh CN01',
      config: { conditions: [{ column: 'chi_nhanh', op: 'eq', value: 'cn01' }] },
    },
    { id: 'xem_cn01', type: 'output.preview', config: { title: 'Lương CN01' } },
  );
  (def.edges as unknown[]).push(
    { from: 'in_luong', to: 'loc_cn01' },
    { from: 'loc_cn01', to: 'xem_cn01' },
  );
  return def;
}

function track(page: Page) {
  const parts: string[] = [];
  const external: string[] = [];
  page.context().on('request', (req) => {
    const url = new URL(req.url());
    if (/\/duckdb\/.+\.wasm\.part\d+$/.test(url.pathname)) parts.push(url.pathname);
    if (
      url.hostname !== 'localhost' &&
      url.origin !== SUPABASE_ORIGIN &&
      url.protocol !== 'blob:' &&
      url.protocol !== 'data:'
    ) {
      external.push(url.origin);
    }
  });
  return { parts, external };
}

const cacheKeys = (page: Page) => page.evaluate(async () => caches.keys());

test.describe('DuckDB runtime', () => {
  test.beforeEach(({ supabase }) => {
    supabase.setVersions([{ no: 1, from: '2026-01-01', definition: flowWithDuckDb() }]);
  });

  test('loads the parts once, verifies, caches, runs the DuckDB node', async ({ page }) => {
    const { parts, external } = track(page);
    await uploadFixtures(page);
    await runButton(page).click();
    await expect(page).toHaveURL(/\/result$/, { timeout: 120_000 });
    await expect(page.getByRole('tab', { name: /^Lương CN01/ })).toBeVisible();
    await page.getByRole('tab', { name: /^Lương CN01/ }).click();
    const region = page.getByRole('region', { name: 'Lương CN01' });
    await expect(region.getByRole('row')).not.toHaveCount(0);

    expect(parts).toHaveLength(2);
    expect(new Set(parts).size).toBe(2);
    expect(external).toEqual([]);
    const keys = await cacheKeys(page);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^hrflow-duckdb-1\.32\.0-[0-9a-f]{16}$/);
    // Cache Storage holds the .wasm parts only.
    const cached = await page.evaluate(async (name) => {
      const cache = await caches.open(name);
      return (await cache.keys()).map((r) => new URL(r.url).pathname);
    }, keys[0]!);
    expect(cached.sort()).toEqual([...parts].sort());

    // AC-B3-03: after a reload the parts come from Cache Storage.
    parts.length = 0;
    await uploadFixtures(page);
    await runButton(page).click();
    await expect(page).toHaveURL(/\/result$/, { timeout: 120_000 });
    await expect(page.getByRole('tab', { name: /^Lương CN01/ })).toBeVisible();
    expect(parts).toEqual([]);
  });

  test('AC-B3-04: a corrupt part fails with loadFailed and leaves no cache', async ({ page }) => {
    await page.context().route(/\/duckdb\/.+\.wasm\.part1$/, (route) =>
      route.fulfill({
        status: 200,
        body: Buffer.alloc(1024),
        contentType: 'application/octet-stream',
      }),
    );
    await uploadFixtures(page);
    await runButton(page).click();
    await expect(page.getByText(/Không tải được bộ xử lý dữ liệu/)).toBeVisible({
      timeout: 60_000,
    });
    expect(await cacheKeys(page)).toEqual([]);
  });
});

test('AC-B3-22: a code.sql runtime error shows the DuckDB message on the UI, never in the console', async ({
  page,
  supabase,
}) => {
  const def = baseFlowDefinition();
  (def.nodes as unknown[]).push(
    {
      id: 'sql_loi',
      type: 'code.sql',
      label: 'SQL lỗi',
      config: {
        inputs: [{ port: 'luong' }],
        sql: 'SELECT CAST(ho_ten AS INTEGER) AS so FROM luong',
      },
    },
    { id: 'xem', type: 'output.preview', config: { title: 'Xem SQL' } },
  );
  (def.edges as unknown[]).push(
    { from: 'in_luong', to: 'sql_loi', toPort: 'luong' },
    { from: 'sql_loi', to: 'xem' },
  );
  supabase.setVersions([{ no: 1, from: '2026-01-01', definition: def }]);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('worker', (w) => w.on('console', (m) => logs.push(m.text())));

  await uploadFixtures(page);
  await runButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Node "SQL lỗi": câu SQL lỗi khi chạy.');
  await expect(page.getByRole('alert')).toContainText('Conversion Error');
  expect(logs.filter((l) => /Conversion|INT32|Error/i.test(l))).toEqual([]);
  const log = supabase.runLogs.at(-1)!;
  expect(log.error_code).toBe('sql.error.runtime');
  expect(log.error_node_id).toBe('sql_loi');
  expect(JSON.stringify(log)).not.toContain('Conversion');
});

test('AC-B3-05: the acceptance flow never downloads DuckDB', async ({ page }) => {
  const { parts } = track(page);
  await uploadFixtures(page);
  await runButton(page).click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 120_000 });
  await expect(page.getByTestId('kpi').first()).toBeVisible();
  expect(parts).toEqual([]);
  expect(await cacheKeys(page)).toEqual([]);
});
