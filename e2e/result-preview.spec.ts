/**
 * Result screen with `output.preview` (spec §12.1.10, AC-B3-27..29b), run warnings (AC-B3-15 on
 * the UI) and the DuckDB loading message (spec §13.1). Supabase mocked; fake data only.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';
import { runButton, uploadFixtures, XLSX } from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

type Def = Record<string, unknown> & { nodes: unknown[]; edges: unknown[] };

/** Acceptance flow (Excel, 4 sheets) + 2 view-only tables after it in node order. */
function withPreviews(): Def {
  const def = baseFlowDefinition() as Def;
  def.nodes.push(
    {
      id: 'theo_cn',
      type: 'transform.groupBy',
      label: 'Đếm theo chi nhánh',
      config: { by: ['chi_nhanh'], aggregations: [{ key: 'so_nv', fn: 'countRows' }] },
    },
    { id: 'xem_cn', type: 'output.preview', config: { title: 'Theo chi nhánh' } },
    {
      id: 'ghep',
      type: 'transform.join',
      label: 'Ghép theo chi nhánh',
      config: { how: 'inner', on: [{ left: 'chi_nhanh', right: 'chi_nhanh' }] },
    },
    {
      id: 'xem_ghep',
      type: 'output.preview',
      config: { title: 'Ghép', columns: ['ho_ten', 'ma_nv'], maxRows: 10 },
    },
  );
  def.edges.push(
    { from: 'in_luong', to: 'theo_cn' },
    { from: 'theo_cn', to: 'xem_cn' },
    { from: 'in_luong', to: 'ghep', toPort: 'left' },
    { from: 'in_cc', to: 'ghep', toPort: 'right' },
    { from: 'ghep', to: 'xem_ghep' },
  );
  return def;
}

function publish(supabase: SupabaseMock, definition: unknown) {
  supabase.setVersions([{ no: 1, from: '2026-01-01', definition }]);
}

async function run(page: Page) {
  await uploadFixtures(page);
  await runButton(page).click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 120_000 });
}

test('AC-B3-27/28/29 + warnings: tabs in node order, "Chỉ xem", columns, sort, search, truncation; file has only the Excel sheets', async ({
  page,
  supabase,
}) => {
  publish(supabase, withPreviews());
  await run(page);
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText([
    /^Tổng hợp/,
    /^Lệch/,
    /^Chỉ có trong lương/,
    /^Chỉ có trong chấm công/,
    /^Theo chi nhánh.*Chỉ xem$/,
    /^Ghép.*Chỉ xem$/,
  ]);
  await expect(tabs.nth(1)).not.toContainText('Chỉ xem');

  // Join on a non-unique key multiplies rows: the warning is shown (counts only).
  await expect(page.getByRole('status').filter({ hasText: 'Cảnh báo:' })).toContainText(
    'Ghép theo chi nhánh',
  );

  await page.getByRole('tab', { name: /^Ghép/ }).click();
  const region = page.getByRole('region', { name: 'Ghép' });
  await expect(region.getByRole('columnheader')).toHaveText(['Họ tên', 'Mã NV']);
  await expect(page.getByText(/Đang hiển thị 10 \/ [\d.]+ dòng đầu\./)).toBeVisible();
  await expect(region.getByRole('row')).toHaveCount(1 + 10);

  // Sort (in the worker) by "Chi nhánh": ascending, then descending; then search.
  await page.getByRole('tab', { name: /^Theo chi nhánh/ }).click();
  const byBranch = page.getByRole('region', { name: 'Theo chi nhánh' });
  const first = () => byBranch.getByRole('row').nth(1).getByRole('cell').first();
  const header = byBranch.getByRole('columnheader', { name: 'Chi nhánh' });
  await byBranch.getByRole('button', { name: 'Chi nhánh' }).click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect(first()).toHaveText('CN01');
  await byBranch.getByRole('button', { name: 'Chi nhánh' }).click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(first()).toHaveText('CN03');
  await page.getByLabel('Tìm trong bảng').fill('cn02');
  await expect(byBranch.getByRole('row')).toHaveCount(1 + 1);
  await expect(first()).toHaveText('CN02');
  await page.getByLabel('Tìm trong bảng').fill('khong-co-dong-nao');
  await expect(page.getByText('Không có dòng nào khớp từ khóa tìm kiếm.')).toBeVisible();

  // The download has the 4 Excel sheets only.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải Excel (4 sheet)' }).click(),
  ]);
  const wb = XLSX.read(readFileSync(await download.path()));
  expect(wb.SheetNames).toEqual([
    'Tổng hợp',
    'Lệch',
    'Chỉ có trong lương',
    'Chỉ có trong chấm công',
  ]);
});

test('AC-B3-29b: a preview-only flow has no download button and creates no file', async ({
  page,
  supabase,
}) => {
  const def = baseFlowDefinition() as Def;
  def.nodes = def.nodes.filter((n) => !['cmp', 'out'].includes((n as { id: string }).id));
  def.edges = [{ from: 'in_luong', to: 'xem' }];
  def.nodes.push({ id: 'xem', type: 'output.preview', config: { title: 'Bảng lương' } });
  publish(supabase, def);
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await run(page);
  await expect(page.getByRole('tab', { name: /^Bảng lương.*Chỉ xem$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Tải/ })).toHaveCount(0);
  const stored = await page.evaluate(() => [localStorage.length, indexedDB.databases()]);
  expect(stored[0]).toBe(0);
  expect(downloads).toEqual([]);
});

test('the DuckDB download shows "Đang tải bộ xử lý dữ liệu" while it runs', async ({
  page,
  supabase,
}) => {
  publish(supabase, withPreviews());
  // Slow the second part down so the message is observable.
  await page.context().route(/\/duckdb\/.+\.wasm\.part1$/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await uploadFixtures(page);
  await runButton(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Đang tải bộ xử lý dữ liệu' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/result$/, { timeout: 120_000 });
});
