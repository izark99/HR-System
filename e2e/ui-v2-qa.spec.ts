/**
 * Verifier checks for design v2 (spec §28 AC-UI-09): the Result-screen conclusion title, the KPI
 * cards and the dark conclusion card must tell the same story. Fake data only.
 */
import { expect, SUPABASE_ORIGIN, test } from './fixtures';
import {
  employees,
  persistedState,
  recordRequests,
  openFlow,
  payroll,
  payrollInput,
  runButton,
  runToResult,
  timesheet,
  timesheetInput,
} from './helpers';

test.describe('result conclusion (AC-UI-09)', () => {
  test('every employee matches: "khớp toàn bộ" title, no-action dark card', async ({ page }) => {
    test.setTimeout(120_000);
    const requests = recordRequests(page);
    await openFlow(page);
    await payrollInput(page).setInputFiles([payroll('luong.xlsx', employees(4))]);
    await timesheetInput(page).setInputFiles([timesheet('cham_cong.xlsx', employees(4))]);
    await expect(runButton(page)).toBeEnabled();
    await runToResult(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Kỳ 09/2026 khớp toàn bộ 4 nhân viên',
    );
    await expect(page.getByTestId('conclusion')).toContainText('Không có gì cần xử lý');

    // Privacy (data-privacy.md): fonts self-hosted, nothing leaves app + Supabase (mock), no
    // employee data persisted.
    const app = new URL(page.url()).origin;
    const foreign = requests
      .map((r) => new URL(r.url))
      .filter((u) => !['blob:', 'data:'].includes(u.protocol))
      .filter((u) => u.origin !== app && u.origin !== SUPABASE_ORIGIN);
    expect(foreign.map((u) => u.href)).toEqual([]);
    const fonts = requests.filter((r) => r.resourceType === 'font');
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) expect(new URL(f.url).origin).toBe(app);
    const supabaseBodies = requests
      .filter((r) => r.url.startsWith(SUPABASE_ORIGIN))
      .map((r) => r.body)
      .join('\n');
    expect(supabaseBodies).not.toContain('NV00001');
    expect(supabaseBodies).not.toContain('Nhân viên Giả');
    const persisted = await persistedState(page);
    expect(persisted).not.toContain('NV00001');
    expect(persisted).not.toContain('Giả 1');
  });

  test('no mismatch but one employee only in payroll: title counts everyone to handle (AC-UI-51)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openFlow(page);
    await payrollInput(page).setInputFiles([payroll('luong.xlsx', employees(5))]);
    await timesheetInput(page).setInputFiles([timesheet('cham_cong.xlsx', employees(4))]);
    await expect(runButton(page)).toBeEnabled();
    await runToResult(page);
    await expect(page.getByTestId('kpi').nth(2).locator('dd')).toHaveText('1');
    await expect(page.getByTestId('conclusion')).toContainText('Cần xử lý 1 nhân viên');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Kỳ 09/2026 có 1 nhân viên cần xử lý',
    );
  });
});
