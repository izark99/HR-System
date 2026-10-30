/**
 * Per-node preview in the Designer with sample files (spec §13.3, AC-B3-50..57). Fake data only;
 * Supabase mocked.
 */
import { ADMIN, expect, SUPABASE_ORIGIN, test, type Page } from './fixtures';
import { fixtures, payroll, persistedState, pickMonth } from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';

function withDraft(supabase: SupabaseMock) {
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  supabase.versions.push({
    id: DRAFT_ID,
    flow_id: FLOW_ID,
    version_no: 2,
    status: 'draft',
    effective_from: '',
    effective_to: null,
    definition: baseFlowDefinition(),
    published_at: null,
    updated_at: '2026-10-27T01:00:00.000001+00:00',
  });
}

const node = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const data = (page: Page) => page.getByRole('region', { name: 'Dữ liệu mẫu và xem trước' });

async function openPanel(page: Page) {
  await page.goto(DESIGNER);
  await expect(node(page, 'cmp')).toBeVisible();
  await page.getByRole('button', { name: 'Dữ liệu mẫu và xem trước' }).click();
}

test('AC-B3-50..55: samples stay in the browser; preview runs ancestors only; compare shows 4 tables', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  const bodies: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(SUPABASE_ORIGIN) || !r.url().startsWith('http://localhost')) {
      bodies.push(`${r.method()} ${r.url()} ${r.postData() ?? ''}`);
    }
  });
  await openPanel(page);
  const panel = data(page);
  const run = panel.getByRole('button', { name: /^Xem trước|^Chọn một node/ });
  await expect(run).toBeDisabled();

  // AC-B3-55: no sample yet.
  await node(page, 'cmp').click();
  await panel.getByRole('button', { name: 'Xem trước Đối chiếu' }).click();
  await expect(panel.getByRole('alert')).toContainText('Chưa có file mẫu cho Bảng lương');

  // AC-B3-50: validation report like the Run Wizard.
  await panel
    .getByLabel('File mẫu cho Bảng lương (nhiều chi nhánh)')
    .setInputFiles(fixtures('bang_luong_'));
  await panel
    .getByLabel('File mẫu cho Chấm công (nhiều chi nhánh)')
    .setInputFiles(fixtures('cham_cong_'));
  await expect(panel.getByRole('status').filter({ hasText: '75 dòng' })).toHaveCount(2);
  await expect(panel.getByText('0 lỗi')).toHaveCount(2);

  // Required param first (AC-B3-55), then AC-B3-53.
  await panel.getByRole('button', { name: 'Xem trước Đối chiếu' }).click();
  await expect(panel.getByRole('alert')).toContainText('Kỳ lương');
  await pickMonth(page, '2026-09', panel.getByRole('button', { name: /Kỳ lương/ }));
  await panel.getByRole('button', { name: 'Xem trước Đối chiếu' }).click();
  await expect(panel.getByRole('tab')).toHaveText([
    'Tổng hợp (5)',
    'Lệch (9)',
    'Chỉ có trong A (3)',
    'Chỉ có trong B (3)',
  ]);
  await expect(panel.getByText('Đã chạy 3 node')).toBeVisible();
  await panel.getByRole('tab', { name: 'Lệch (9)' }).click();
  await expect(panel.getByRole('region', { name: 'mismatched' }).getByRole('row')).toHaveCount(
    1 + 9,
  );

  // AC-B3-54: unsaved canvas config is used (tolerance of "Công" raised to 5).
  await panel.getByRole('tab', { name: 'Tổng hợp (5)' }).click();
  const side = page.getByRole('complementary', { name: 'Cấu hình' });
  await side.getByLabel('Ngưỡng chênh lệch').first().fill('5');
  await panel.getByRole('button', { name: 'Xem trước Đối chiếu' }).click();
  await expect(panel.getByRole('tab', { name: /^Lệch/ })).not.toHaveText('Lệch (9)');
  await expect(page.getByText('Có thay đổi chưa lưu')).toBeVisible();

  // Nothing left the browser, nothing stored, no run log.
  expect(bodies.filter((b) => /NV0000|Nhân viên/.test(b))).toEqual([]);
  expect(supabase.bodiesOf('/rest/v1/run_logs')).toEqual([]);
  const stored = await persistedState(page);
  expect(stored).not.toMatch(/NV0000/);
});

test('AC-B3-56/57: header-only sample shows an empty table with columns; samples are gone after leaving', async ({
  page,
  supabase,
}) => {
  withDraft(supabase);
  await openPanel(page);
  const panel = data(page);
  await panel
    .getByLabel('File mẫu cho Bảng lương (nhiều chi nhánh)')
    .setInputFiles(payroll('rong.xlsx', [], { total: false }));
  await expect(panel.getByText('0 dòng')).toBeVisible();
  await expect(panel.getByText('1 cảnh báo')).toBeVisible();
  await pickMonth(page, '2026-09', panel.getByRole('button', { name: /Kỳ lương/ }));
  await node(page, 'in_luong').click();
  await panel.getByRole('button', { name: 'Xem trước Bảng lương' }).click();
  const table = panel.getByRole('region', { name: 'table' });
  await expect(table.getByRole('columnheader')).not.toHaveCount(0);
  await expect(table.getByRole('row')).toHaveCount(1);
  await expect(panel.getByText('Hiển thị 0 / 0 dòng đầu.')).toBeVisible();

  // Leave the Designer and come back: the sample must be chosen again.
  await page.getByRole('link', { name: 'Về màn Phiên bản' }).click();
  await expect(page).toHaveURL(/versions$/);
  await page.goto(DESIGNER);
  await page.getByRole('button', { name: 'Dữ liệu mẫu và xem trước' }).click();
  await expect(data(page).getByText('0 dòng')).toHaveCount(0);
  await pickMonth(page, '2026-09', data(page).getByRole('button', { name: /Kỳ lương/ }));
  await node(page, 'in_luong').click();
  await data(page).getByRole('button', { name: 'Xem trước Bảng lương' }).click();
  await expect(data(page).getByRole('alert')).toContainText('Chưa có file mẫu');
});
