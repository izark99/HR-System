/**
 * Run log (spec §7.1, §16; MEMORY "Dữ liệu & tuân thủ"): exactly one metadata-only entry per run
 * (success, failure, cancel). The body may hold hashes, sizes and counts, never file names, cell
 * values or error text. Supabase is mocked (e2e/supabase-mock.ts); fake data only.
 */
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';
import {
  employees,
  fixtures,
  openFlow,
  payroll,
  payrollInput,
  RESULT_URL,
  runButton,
  runToResult,
  textCellValues,
  timesheet,
  timesheetInput,
  uploadFixtures,
} from './helpers';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const KEYS = [
  'client_info',
  'duration_ms',
  'error_code',
  'error_node_id',
  'flow_version_id',
  'inputs_meta',
  'params',
  'rows_out',
  'status',
];
const FIXTURE_FILES = [...fixtures('bang_luong_'), ...fixtures('cham_cong_')];
const SECRETS = textCellValues(FIXTURE_FILES);

/** Shape + content rules every log entry must follow, whatever the outcome. */
function expectMetadataOnly(entry: Record<string, unknown>, forbidden: string[]) {
  expect(Object.keys(entry).sort()).toEqual(KEYS);
  const text = JSON.stringify(entry);
  for (const bad of forbidden) expect(text, `log leaks "${bad}"`).not.toContain(bad);
  expect(text).not.toMatch(/\.xlsx|\.xls|\.csv/i);
  const slots = entry.inputs_meta as {
    slot: string;
    rows: number;
    files: Record<string, unknown>[];
  }[];
  for (const slot of slots) {
    expect(Object.keys(slot).sort()).toEqual(['files', 'rows', 'slot']);
    expect(Number.isInteger(slot.rows)).toBe(true);
    for (const f of slot.files) {
      expect(Object.keys(f).sort()).toEqual(['sha256', 'size']);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(f.size)).toBe(true);
    }
  }
  expect(Number.isInteger(entry.duration_ms)).toBe(true);
  expect(entry.client_info).toBeNull();
  // Error text must never be stored; only a stable code made of letters, digits, dots, underscores.
  if (entry.error_code !== null) expect(entry.error_code as string).toMatch(/^[A-Za-z][\w.]*$/);
}

const logsPosted = (supabase: SupabaseMock) =>
  supabase.calls.filter((c) => c.method === 'POST' && c.path === '/rest/v1/run_logs');

test('success: one log, hashes of the file names, sizes and row counts only', async ({
  page,
  supabase,
}) => {
  await uploadFixtures(page);
  await runToResult(page);
  await expect.poll(() => supabase.runLogs.length).toBe(1);
  await page.waitForTimeout(1500); // a second, late post would show up here
  expect(logsPosted(supabase)).toHaveLength(1);

  const entry = supabase.runLogs[0]!;
  expectMetadataOnly(entry, [
    ...SECRETS,
    'bang_luong_CN01',
    'cham_cong_CN01',
    'Mã NV',
    'DoiChieu_2026',
    'NV00001',
  ]);
  expect(entry).toMatchObject({ status: 'succeeded', error_code: null, error_node_id: null });
  expect(entry.params).toEqual({ ky_luong: '2026-09' });
  expect(entry.rows_out).toBeGreaterThan(0);

  const slots = entry.inputs_meta as { slot: string; rows: number; files: { sha256: string }[] }[];
  expect(slots.map((s) => [s.slot, s.rows])).toEqual([
    ['bang_luong', 75],
    ['cham_cong', 75],
  ]);
  expect(slots[0]!.files.map((f) => f.sha256)).toEqual(
    fixtures('bang_luong_').map((p) => sha256(basename(p))),
  );
  expect(slots[1]!.files.map((f) => f.sha256)).toEqual(
    fixtures('cham_cong_').map((p) => sha256(basename(p))),
  );

  // Leaving and coming back to the result must not post again; a new run posts a second entry.
  await page.goBack();
  await page.getByRole('link', { name: 'Xem kết quả' }).click();
  await page.reload();
  await page.waitForTimeout(500);
  expect(logsPosted(supabase)).toHaveLength(1);
});

test('two runs on the same page produce two entries (one each)', async ({ page, supabase }) => {
  await uploadFixtures(page);
  await runToResult(page);
  await expect.poll(() => supabase.runLogs.length).toBe(1);
  await page.goBack();
  await expect(runButton(page)).toBeEnabled();
  await runToResult(page);
  await expect.poll(() => supabase.runLogs.length).toBe(2);
  await page.waitForTimeout(1000);
  expect(logsPosted(supabase)).toHaveLength(2);
});

test('failure: one log with the error code only (no column name, no message)', async ({
  page,
  supabase,
}) => {
  const broken = baseFlowDefinition();
  const nodes = broken.nodes as { id: string; config: { carryColumns: string[] } }[];
  nodes.find((n) => n.id === 'cmp')!.config.carryColumns = ['cot_rieng_tu_khong_co'];
  supabase.setVersions([{ no: 1, from: '2026-01-01', definition: broken }]);

  await uploadFixtures(page);
  await runButton(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Chạy không thành công:' })).toBeVisible();
  await expect.poll(() => supabase.runLogs.length).toBe(1);
  await page.waitForTimeout(1500);
  expect(logsPosted(supabase)).toHaveLength(1);

  const entry = supabase.runLogs[0]!;
  expectMetadataOnly(entry, [...SECRETS, 'cot_rieng_tu_khong_co', 'bang_luong_CN01']);
  expect(entry).toMatchObject({
    status: 'failed',
    rows_out: null,
    error_code: 'compare.error.missingColumn',
    error_node_id: 'cmp',
  });
  // The User still sees the human-readable message (it never left the browser).
  await expect(page.getByRole('alert').filter({ hasText: 'Chạy không thành công:' })).toContainText(
    'cot_rieng_tu_khong_co',
  );
});

test.describe('cancel', () => {
  test('one "cancelled" log; the next run logs its own entry', async ({ page, supabase }) => {
    test.setTimeout(120_000);
    const ROWS = 12_000;
    const names = ['bang_luong_nguyen_van_a.xlsx', 'cham_cong_nguyen_van_a.xlsx'];
    await openFlow(page);
    await payrollInput(page).setInputFiles([payroll(names[0]!, employees(ROWS))]);
    await timesheetInput(page).setInputFiles([
      timesheet(names[1]!, employees(ROWS, 1, 'CN01', 24)),
    ]);
    await expect(runButton(page)).toHaveText('Chạy', { timeout: 30_000 });

    await runButton(page).click();
    await page.getByRole('button', { name: 'Hủy', exact: true }).click({ timeout: 5_000 });
    await expect(page.getByText('Đã hủy lần chạy:')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('đang nạp lại file sau khi hủy…')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect.poll(() => supabase.runLogs.length).toBe(1);
    await page.waitForTimeout(1500);
    expect(logsPosted(supabase)).toHaveLength(1);

    const entry = supabase.runLogs[0]!;
    expectMetadataOnly(entry, ['nguyen_van_a', 'Nhân viên Giả', 'NV00001', 'CN01']);
    expect(entry).toMatchObject({ status: 'cancelled', rows_out: null, error_code: null });
    const slots = entry.inputs_meta as { files: { sha256: string }[] }[];
    expect(slots[0]!.files[0]!.sha256).toBe(sha256(names[0]!));
    expect(slots[1]!.files[0]!.sha256).toBe(sha256(names[1]!));

    await expect(runButton(page)).toHaveText('Chạy', { timeout: 30_000 });
    await runButton(page).click();
    await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`), { timeout: 60_000 });
    await expect.poll(() => supabase.runLogs.length).toBe(2);
    expect(supabase.runLogs.map((r) => r.status)).toEqual(['cancelled', 'succeeded']);
  });
});

test('a failing log endpoint never disturbs the run and is not retried in a loop', async ({
  page,
  supabase,
}) => {
  supabase.runLogFailure = { status: 500, code: 'XX000', sticky: true };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await uploadFixtures(page);
  await runToResult(page);
  await page.waitForTimeout(1500);
  expect(logsPosted(supabase)).toHaveLength(1);
  expect(errors).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('no request URL or body carries a file name, only hashes in the log', async ({
  page,
  supabase,
}: {
  page: Page;
  supabase: SupabaseMock;
}) => {
  await uploadFixtures(page);
  await runToResult(page);
  await expect.poll(() => supabase.runLogs.length).toBe(1);
  for (const c of supabase.calls) {
    expect(decodeURIComponent(c.path)).not.toMatch(/bang_luong_CN|cham_cong_CN|\.xlsx/);
    expect(c.body).not.toMatch(/bang_luong_CN|cham_cong_CN|\.xlsx/);
  }
});
