/**
 * Reference tables on the run page (spec §34 AC-RT-08, 10, 15): "Phiên bản áp dụng" box per
 * period, missing version and unconvertible cells block the run, "Xem bảng" read-only dialog,
 * list param taken from a table, run log `ref_versions`, rows kept in memory only.
 * Supabase is mocked; fake data only.
 */
import { expect, test } from './fixtures';
import { fixtures, payrollInput, pickMonth, runButton, timesheetInput } from './helpers';
import { openRefFlow, refBox, REF_FLOW_VERSION, seedRefRun } from './ref-run-helpers';
import { branchRows } from './supabase-mock-ref';

test.describe('reference tables on the run page', () => {
  test('period with every version: box, list param, run, result tab and run log', async ({
    page,
    supabase,
  }) => {
    test.setTimeout(120_000);
    seedRefRun(supabase);
    await openRefFlow(page, '2026-09');
    const box = refBox(page);
    await expect(box).toHaveAttribute('role', 'status');
    await expect(box).toContainText('Phiên bản áp dụng');
    await expect(box).toContainText('Flow v3 · hiệu lực từ 01/01/2025, theo kỳ đã chọn');
    await expect(box).toContainText('Danh mục chi nhánh · v2 · từ 01/07/2026');
    await expect(box).toContainText('Hệ số phụ cấp theo bậc · v1 · từ 01/01/2026');
    await expect(box.getByRole('button', { name: 'Xem bảng Danh mục chi nhánh' })).toBeVisible();

    // List param from the branch list (effective version of the period).
    await page.locator('#param-chi_nhanh').click();
    await expect(page.getByRole('option', { name: 'CN01 – Hồ Chí Minh' })).toBeVisible();
    await page.getByRole('option', { name: 'CN05 – Hậu Giang' }).click();

    await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
    await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
    await expect(runButton(page)).toHaveText('Chạy', { timeout: 30_000 });
    await runButton(page).click();
    await page.waitForURL(/\/result$/, { timeout: 60_000 });
    await expect(page.getByRole('tab', { name: /Chi nhánh/ })).toBeVisible();
    await expect.poll(() => supabase.runLogs.length).toBe(1);
    expect(supabase.runLogs[0]).toMatchObject({
      flow_version_id: REF_FLOW_VERSION,
      status: 'succeeded',
      params: { ky_luong: '2026-09', chi_nhanh: 'CN05' },
      ref_versions: { DM_CHI_NHANH: 'reftbl-1-v2', HE_SO_PHU_CAP: 'reftbl-2-v1' },
    });
    // Metadata only: no reference row in the log.
    expect(JSON.stringify(supabase.runLogs[0])).not.toContain('Hồ Chí Minh');

    // Rows lived in memory only (AC-RT-15 c).
    const stored = await page.evaluate(async () => ({
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
      caches: (await caches.keys()).length,
      dbs: (await indexedDB.databases()).length,
      url: location.href,
    }));
    for (const v of [stored.local, stored.session, stored.url]) {
      expect(v).not.toContain('Hồ Chí Minh');
      expect(v).not.toContain('CN01');
    }
    expect(stored.dbs).toBe(0);
  });

  test('a period without a version of a table: error box, run locked, uploads dimmed', async ({
    page,
    supabase,
  }) => {
    seedRefRun(supabase);
    await openRefFlow(page, '2025-03');
    const box = refBox(page);
    await expect(box).toHaveAttribute('role', 'alert');
    await expect(box).toContainText('Chưa chạy được kỳ 03/2025');
    await expect(box).toContainText(
      'Bảng tham chiếu "Hệ số phụ cấp theo bậc" chưa có phiên bản hiệu lực cho kỳ 03/2025. Liên hệ Admin.',
    );
    // The table that has a version is still listed (with its button).
    await expect(box).toContainText('Danh mục chi nhánh · v1 · từ 01/01/2025');
    await expect(runButton(page)).toBeDisabled();
    await expect(runButton(page)).toHaveText('Chạy (thiếu bảng tham chiếu)');
    await expect(page.locator('[data-refs-locked]')).toHaveCSS('opacity', '0.6');
    await expect(payrollInput(page)).toBeDisabled();
    // Another period clears it; rows of a version are fetched once per page open.
    await pickMonth(page, '2026-09');
    await expect(box).toHaveAttribute('role', 'status');
    await pickMonth(page, '2025-03');
    await expect(box).toHaveAttribute('role', 'alert');
    await pickMonth(page, '2026-09');
    await expect(box).toHaveAttribute('role', 'status');
    const reads = supabase.ref.rowReads;
    expect(reads.filter((id) => id === 'reftbl-1-v2')).toHaveLength(1);
    // Opening the page again loads them again (memory of the open page only).
    await page.reload();
    await pickMonth(page, '2026-09');
    await expect(box).toContainText('Danh mục chi nhánh · v2');
    await expect.poll(() => reads.filter((id) => id === 'reftbl-1-v2').length).toBe(2);
  });

  test('cells that no longer fit the column type block the run (table, version, column)', async ({
    page,
    supabase,
  }) => {
    seedRefRun(supabase, [
      { bac: 1, he_so: '1.2' },
      { bac: 2, he_so: 'một phẩy năm' },
    ]);
    await openRefFlow(page, '2026-09');
    const box = refBox(page);
    await expect(box).toHaveAttribute('role', 'alert');
    await expect(box).toContainText(
      'Bảng tham chiếu "Hệ số phụ cấp theo bậc" phiên bản v1: cột "Hệ số" có ô không đúng kiểu dữ liệu hiện tại và không tự chuyển được.',
    );
    await expect(box).not.toContainText('một phẩy năm');
    await expect(runButton(page)).toBeDisabled();
  });

  test('integers stored as text are converted without blocking', async ({ page, supabase }) => {
    seedRefRun(supabase, [
      { bac: 1, he_so: 2 },
      { bac: 2, he_so: '2.5' },
    ]);
    await openRefFlow(page, '2026-09');
    await expect(refBox(page)).toHaveAttribute('role', 'status');
  });

  test('"Xem bảng": read only, 100 rows per batch, search without accents', async ({
    page,
    supabase,
  }) => {
    seedRefRun(supabase);
    await openRefFlow(page, '2026-09');
    await refBox(page).getByRole('button', { name: 'Xem bảng Danh mục chi nhánh' }).click();
    const dialog = page.getByRole('dialog', { name: 'Danh mục chi nhánh' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Phiên bản v2 · hiệu lực từ 01/07/2026 · chỉ xem');
    await expect(dialog.getByText('126 / 126 dòng')).toBeVisible();
    const rows = dialog.locator('tbody tr');
    await expect(rows).toHaveCount(100);
    await dialog.getByRole('button', { name: 'Hiện thêm 26 dòng (còn 26)' }).click();
    await expect(rows).toHaveCount(126);
    await expect(dialog.getByRole('button', { name: /Hiện thêm/ })).toHaveCount(0);
    // No edit, no download.
    await expect(dialog.locator('tbody input, tbody [contenteditable]')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Tải|Lưu|Sửa|Xóa/ })).toHaveCount(0);
    await dialog.getByRole('searchbox', { name: 'Tìm trong bảng' }).fill('hau giang');
    const expected = branchRows(126).filter((r) => r.ten_cn === 'Hậu Giang').length;
    await expect(dialog.getByText(`${expected} / 126 dòng`)).toBeVisible();
    await expect(rows).toHaveCount(expected);
    await expect(rows.first()).toContainText('Hậu Giang');
    await dialog.locator('[data-dialog-footer]').getByRole('button', { name: 'Đóng' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('list param whose table has no version shows its own error; other params unaffected', async ({
    page,
    supabase,
  }) => {
    seedRefRun(supabase);
    // Branch list v1 moved to June 2025: March 2025 has no branch version.
    supabase.ref.versions.find((v) => v.id === 'reftbl-1-v1')!.effective_from = '2025-06-01';
    await openRefFlow(page, '2025-03');
    await expect(
      page.getByText('Bảng "Danh mục chi nhánh" chưa có phiên bản hiệu lực cho kỳ 03/2025.'),
    ).toBeVisible();
    await expect(page.locator('#param-chi_nhanh')).toHaveAttribute('aria-invalid', 'true');
    // The period param itself keeps working.
    await pickMonth(page, '2026-09');
    await expect(
      page.getByText('Bảng "Danh mục chi nhánh" chưa có phiên bản hiệu lực'),
    ).toHaveCount(0);
  });

  test('a User whose flows do not use the tables reads none of them', async ({
    page,
    supabase,
  }) => {
    seedRefRun(supabase);
    supabase.setVersions([{ no: 1, from: '2025-01-01' }]);
    await page.goto('/run/payroll-timesheet');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Đối chiếu bảng lương/);
    const answer = await page.evaluate(async (origin) => {
      const raw = Object.values(sessionStorage).find((v) => v.includes('access_token'));
      const token = raw ? (JSON.parse(raw) as { access_token: string }).access_token : '';
      const r = await fetch(`${origin}/rest/v1/ref_tables?select=code`, {
        headers: { authorization: `Bearer ${token}`, apikey: 'x' },
      });
      return r.json() as Promise<unknown[]>;
    }, 'https://rzakjtgvbyxqsmbpcomw.supabase.co');
    expect(answer).toEqual([]);
    await expect(refBox(page)).toHaveCount(0);
  });
});
