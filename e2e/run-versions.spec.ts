/**
 * Run page and version resolution (spec §14.2, §15.1): two published versions with different
 * tolerances, the period decides which one the callout shows and which one the run uses.
 * Supabase is mocked (e2e/supabase-mock.ts); fake data only.
 *
 *   v1: 2026-01-01 .. before 2026-07-01   Công tolerance 0.5 → 9 mismatched rows on the fixtures
 *   v2: 2026-09-01 .. open                Công tolerance 100 → 6 mismatched rows
 *   gap: July and August 2026 have no version.
 */
import { expect, test, type Page } from './fixtures';
import { flowWithCongTolerance, type SupabaseMock } from './supabase-mock';
import {
  fixtures,
  openFlow,
  periodButton,
  pickMonth,
  payrollInput,
  RESULT_URL,
  runButton,
  runToResult,
  timesheetInput,
} from './helpers';

const V1 = '00000000-0000-4000-8000-000000000201';
const V2 = '00000000-0000-4000-8000-000000000202';

function twoVersions(supabase: SupabaseMock) {
  supabase.setVersions([
    { no: 1, from: '2026-01-01', to: '2026-07-01' },
    { no: 2, from: '2026-09-01', definition: flowWithCongTolerance('100') },
  ]);
}

const callout = (page: Page) => page.getByRole('status').filter({ hasText: 'Phiên bản áp dụng:' });
const noVersion = (page: Page) => page.getByRole('alert').filter({ hasText: 'Chưa có phiên bản:' });

async function upload(page: Page) {
  await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
  await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
}

async function mismatchedTab(page: Page) {
  return page.getByRole('tab', { selected: true }).textContent();
}

test.describe('period decides the version', () => {
  test.beforeEach(({ supabase }) => twoVersions(supabase));

  test('switching v2 → v1 while files are still validating: callout, run and log use v1', async ({
    page,
    supabase,
  }) => {
    await openFlow(page, '2026-09');
    await expect(callout(page)).toContainText('v2, hiệu lực từ 01/09/2026, theo kỳ đã chọn');
    await upload(page); // validation of 6 files starts, do not wait for it
    await pickMonth(page, '2026-03');
    await expect(callout(page)).toContainText(
      'v1, hiệu lực từ 01/01/2026 đến 30/06/2026, theo kỳ đã chọn',
    );
    await expect(runButton(page)).toHaveText('Chạy');
    await expect(page.getByText('0 lỗi')).toBeVisible();
    await runToResult(page);
    expect(await mismatchedTab(page)).toBe('Lệch (9)'); // v1 tolerance (0.5)
    await expect.poll(() => supabase.runLogs.length).toBe(1);
    expect(supabase.runLogs[0]).toMatchObject({
      flow_version_id: V1,
      status: 'succeeded',
      params: { ky_luong: '2026-03' },
    });
  });

  test('switching v1 → v2 while files are still validating: callout, run and log use v2', async ({
    page,
    supabase,
  }) => {
    await openFlow(page, '2026-03');
    await expect(callout(page)).toContainText('v1, hiệu lực từ 01/01/2026 đến 30/06/2026');
    await upload(page);
    await pickMonth(page, '2026-10');
    await expect(callout(page)).toContainText('v2, hiệu lực từ 01/09/2026, theo kỳ đã chọn');
    await expect(runButton(page)).toHaveText('Chạy');
    await runToResult(page);
    expect(await mismatchedTab(page)).toBe('Lệch (6)'); // v2 tolerance (100)
    await expect.poll(() => supabase.runLogs.length).toBe(1);
    expect(supabase.runLogs[0]).toMatchObject({
      flow_version_id: V2,
      params: { ky_luong: '2026-10' },
    });
  });

  test('a slow answer for the old period never overwrites the newer period', async ({
    page,
    supabase,
  }) => {
    supabase.resolveDelayMs = (asOf) => (asOf === '2026-03-01' ? 1500 : 0);
    await openFlow(page, '2026-09');
    await upload(page);
    await expect(runButton(page)).toHaveText('Chạy');
    await pickMonth(page, '2026-03'); // v1 answer is slow ...
    await pickMonth(page, '2026-10'); // ... and a newer pick (v2) is made meanwhile
    await page.waitForTimeout(2500); // the stale v1 answer has arrived by now
    await expect(callout(page)).toContainText('v2, hiệu lực từ 01/09/2026');
    await expect(periodButton(page)).toContainText('Tháng 10/2026');
    await expect(runButton(page)).toHaveText('Chạy');
    await runToResult(page);
    expect(await mismatchedTab(page)).toBe('Lệch (6)');
    await expect.poll(() => supabase.runLogs.length).toBe(1);
    expect(supabase.runLogs[0]).toMatchObject({ flow_version_id: V2 });
  });

  test('effective-date boundaries: last month of v1, the gap, first month of v2', async ({
    page,
    supabase,
  }) => {
    await openFlow(page, '2026-06'); // as-of 2026-06-01 → v1
    await expect(callout(page)).toContainText('v1');
    await pickMonth(page, '2026-07'); // as-of 2026-07-01 = v1.effective_to (exclusive) → none
    await expect(noVersion(page)).toContainText('flow chưa có phiên bản hiệu lực cho kỳ 07/2026');
    await pickMonth(page, '2026-08');
    await expect(noVersion(page)).toContainText('cho kỳ 08/2026');
    await pickMonth(page, '2026-09'); // as-of 2026-09-01 = v2.effective_from (inclusive) → v2
    await expect(noVersion(page)).toHaveCount(0);
    await expect(callout(page)).toContainText('v2, hiệu lực từ 01/09/2026');
    const asOf = supabase.bodiesOf('/rest/v1/rpc/resolve_flow_version').map((b) => b.p_as_of);
    expect(asOf).toEqual(
      expect.arrayContaining(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']),
    );
  });

  test('period without a version: coral error, Run disabled even with valid files, nothing logged', async ({
    page,
    supabase,
  }) => {
    await openFlow(page, '2026-09');
    await upload(page);
    await expect(runButton(page)).toHaveText('Chạy');
    await pickMonth(page, '2025-12'); // before v1
    const alert = noVersion(page);
    await expect(alert).toContainText('flow chưa có phiên bản hiệu lực cho kỳ 12/2025');
    await expect(alert).toHaveClass(/coral/);
    await expect(runButton(page)).toHaveText('Chạy (chưa có phiên bản cho kỳ này)');
    await expect(runButton(page)).toBeDisabled();
    await runButton(page).click({ force: true });
    await runButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(new RegExp(RESULT_URL));
    await page.waitForTimeout(500);
    expect(supabase.runLogs).toEqual([]);

    // Back to a covered period: the same files are re-validated and Run is available again.
    await pickMonth(page, '2026-10');
    await expect(noVersion(page)).toHaveCount(0);
    await expect(runButton(page)).toHaveText('Chạy');
    await expect(runButton(page)).toBeEnabled();
  });

  test('lookup failure: Run is blocked with a retry; retry restores it', async ({
    page,
    supabase,
  }) => {
    await openFlow(page, '2026-09');
    await upload(page);
    await expect(runButton(page)).toHaveText('Chạy');
    supabase.resolveFailure = { status: 500, code: 'XX000', sticky: true };
    await pickMonth(page, '2026-03');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Chưa xác định được phiên bản:' }),
    ).toBeVisible();
    await expect(runButton(page)).toHaveText('Chạy (chưa xác định được phiên bản)');
    await expect(runButton(page)).toBeDisabled();
    supabase.resolveFailure = null;
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(callout(page)).toContainText('v1');
    await expect(runButton(page)).toHaveText('Chạy');
  });

  test('without a chosen period the callout says it follows today and asks to pick a period', async ({
    page,
  }) => {
    await openFlow(page, '');
    await expect(callout(page)).toContainText('theo ngày hôm nay (chọn kỳ để kiểm tra lại)');
  });
});

test.describe('fixed bugs (were KNOWN BUGS)', () => {
  test.beforeEach(({ supabase }) => twoVersions(supabase));

  // Was run-store.ts:291-297: the "no version" answer (v2, applies=false) replaced the displayed
  // version while the worker still held v1, so a v2 period skipped the reload. The store now
  // tracks the version loaded in the worker separately.
  test('v1 → gap → v2: the run uses the v2 definition it reports', async ({ page, supabase }) => {
    await openFlow(page, '2026-03'); // worker holds v1
    await upload(page);
    await expect(runButton(page)).toHaveText('Chạy');
    await pickMonth(page, '2026-08'); // gap: server answers with v2, applies = false
    await expect(noVersion(page)).toBeVisible();
    await pickMonth(page, '2026-10'); // v2 applies
    await expect(callout(page)).toContainText('v2, hiệu lực từ 01/09/2026');
    await expect(runButton(page)).toHaveText('Chạy');
    await runToResult(page);
    await expect.poll(() => supabase.runLogs.length).toBe(1);
    expect(supabase.runLogs[0]).toMatchObject({ flow_version_id: V2 });
    expect(await mismatchedTab(page)).toBe('Lệch (6)');
  });
});
