/**
 * Version & validity screen (spec §14.4, AC-B3-60..73): list, publish (validation, close the open
 * version, overlap, gap), retire, clone/rollback, discard, end date, diff, export. Supabase is
 * mocked (e2e/supabase-mock.ts); fake flow configurations only.
 */
import { ADMIN, expect, test, USER, type Page } from './fixtures';
import { chooseOption, pickDate } from './helpers';
import { baseFlowDefinition, flowWithCongTolerance, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN });

const URL = '/admin/flows/payroll-timesheet/versions';
const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';

/** v1 published (open-ended unless `to`), v2 draft with the "Công" tolerance changed. */
function setup(supabase: SupabaseMock, opts: { to?: string; draft?: unknown } = {}) {
  const [v1] = supabase.setVersions([{ no: 1, from: '2026-01-01', to: opts.to ?? null }]);
  v1!.change_note = 'Bản đầu tiên';
  v1!.published_by = ADMIN.id;
  supabase.versions.push({
    id: DRAFT_ID,
    flow_id: FLOW_ID,
    version_no: 2,
    status: 'draft',
    effective_from: '',
    effective_to: null,
    definition: opts.draft ?? flowWithCongTolerance('2'),
    published_at: null,
    updated_at: '2026-10-27T01:00:00.000001+00:00',
  });
}

const row = (page: Page, no: number) =>
  page
    .getByRole('table', { name: 'Danh sách phiên bản' })
    .getByRole('row', { name: new RegExp(`^v${no}\\b`) });
const publishDialog = (page: Page, no = 2) => page.getByRole('dialog', { name: `Publish v${no}` });
const rpcBodies = (supabase: SupabaseMock) =>
  supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_draft');

async function openPublish(page: Page) {
  await page.getByRole('button', { name: 'Publish v2' }).click();
  await expect(publishDialog(page).getByLabel(/^Ghi chú thay đổi/)).toBeVisible();
}

test.describe('Version & validity screen', () => {
  test('reached from the flow list; lists versions with status, range, note, publisher and the current one', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto('/admin/flows');
    await page.getByRole('link', { name: /Quản lý phiên bản và hiệu lực của Đối chiếu/ }).click();
    await expect(page).toHaveURL(URL);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Đối chiếu bảng lương – chấm công: đang áp dụng v1',
    );
    await expect(
      page.getByRole('navigation', { name: 'Menu Admin' }).getByRole('link', { name: 'Flows' }),
    ).toHaveAttribute('aria-current', 'page');

    const v1 = row(page, 1);
    await expect(v1).toContainText('Published');
    await expect(v1).toContainText('Đang áp dụng');
    await expect(v1).toContainText('từ 01/01/2026, không thời hạn');
    await expect(v1).toContainText('Bản đầu tiên');
    await expect(v1).toContainText('admin, ');
    const v2 = row(page, 2);
    await expect(v2).toContainText('Draft');
    await expect(v2).toContainText('Chưa đặt ngày');
    await expect(v2).not.toContainText('Đang áp dụng');
    // Actions by status (spec §14.4).
    await expect(v2.getByRole('button', { name: 'Publish v2' })).toBeVisible();
    await expect(v2.getByRole('button', { name: 'Hủy draft v2' })).toBeVisible();
    await expect(v2.getByRole('button', { name: 'Retire v2' })).toHaveCount(0);
    await expect(v1.getByRole('button', { name: 'Retire v1' })).toBeVisible();
    await expect(v1.getByRole('button', { name: 'Tạo draft từ version này v1' })).toBeVisible();
    await expect(v1.getByRole('button', { name: /Hủy draft|Publish/ })).toHaveCount(0);
    expect(await page.getByRole('button', { name: /Xóa/ }).count()).toBe(0);
  });

  test('publish needs a start date and a non-blank note (fields marked, no request)', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto(URL);
    await openPublish(page);
    const dialog = publishDialog(page);
    const note = dialog.getByLabel(/^Ghi chú thay đổi/);
    await note.fill('   ');
    await dialog.getByRole('button', { name: 'Publish' }).click();
    await expect(dialog).toContainText('Nhập ghi chú thay đổi.');
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    await expect(note).toHaveCSS('border-top-color', 'rgb(249, 115, 98)');
    expect(rpcBodies(supabase)).toEqual([]);
  });

  test('AC-B3-63: publish v2 from 01/10/2026 closing v1, in one call; ranges updated', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto(URL);
    await openPublish(page);
    const dialog = publishDialog(page);
    await pickDate(page, dialog.locator('#publish-from'), '2026-10-01');
    const close = dialog.getByRole('checkbox', {
      name: 'Đặt v1 hiệu lực đến trước ngày 01/10/2026',
    });
    await expect(close).toBeChecked();
    await dialog.getByLabel(/^Ghi chú thay đổi/).fill('  Đổi ngưỡng công  ');
    await dialog.getByRole('button', { name: 'Publish' }).click();
    await expect(dialog).toHaveCount(0);
    expect(rpcBodies(supabase)).toEqual([
      {
        p_version_id: DRAFT_ID,
        p_effective_from: '2026-10-01',
        p_effective_to: null,
        p_change_note: 'Đổi ngưỡng công',
        p_close_previous: true,
        p_expected_updated_at: '2026-10-27T01:00:00.000001+00:00',
      },
    ]);
    await expect(page.getByRole('status').filter({ hasText: 'Đã xong:' })).toContainText(
      'đã publish v2.',
    );
    await expect(row(page, 1)).toContainText('từ 01/01/2026 đến trước 01/10/2026');
    await expect(row(page, 2)).toContainText('từ 01/10/2026, không thời hạn');
    await expect(row(page, 2)).toContainText('Published');
  });

  test('AC-B3-64: without closing v1 the overlap is refused, named, and nothing changes', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto(URL);
    await openPublish(page);
    const dialog = publishDialog(page);
    await pickDate(page, dialog.locator('#publish-from'), '2026-10-01');
    await dialog.getByRole('checkbox', { name: /Đặt v1 hiệu lực/ }).uncheck();
    await dialog.getByLabel(/^Ghi chú thay đổi/).fill('v2');
    await dialog.getByRole('button', { name: 'Publish' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Chưa thành công: Khoảng hiệu lực bị chồng với v1 (từ 01/01/2026, không thời hạn). Hãy chọn ngày khác hoặc đặt ngày kết thúc cho v1.',
    );
    expect(rpcBodies(supabase)[0]).toMatchObject({ p_close_previous: false });
    expect(supabase.versions.find((v) => v.version_no === 1)!.effective_to).toBeNull();
    expect(supabase.versions.find((v) => v.version_no === 2)!.status).toBe('draft');
  });

  test('AC-B3-65: a publish that leaves a gap warns first; the timeline shows the gap afterwards', async ({
    page,
    supabase,
  }) => {
    setup(supabase, { to: '2026-03-01' });
    await page.goto(URL);
    await expect(page.getByText('Từ 01/03/2026 trở đi không có phiên bản hiệu lực')).toBeVisible();
    await openPublish(page);
    const dialog = publishDialog(page);
    await pickDate(page, dialog.locator('#publish-from'), '2026-04-01');
    await expect(dialog.getByRole('checkbox')).toHaveCount(0); // v1 is not open-ended
    await expect(dialog).toContainText(
      'Từ 01/03/2026 đến 31/03/2026 không có phiên bản hiệu lực. User chạy kỳ này sẽ bị báo lỗi.',
    );
    await dialog.getByLabel(/^Ghi chú thay đổi/).fill('Quy định mới từ tháng 4');
    await dialog.getByRole('button', { name: 'Publish' }).click();
    await expect(dialog).toHaveCount(0);
    const timeline = page.getByRole('region', { name: 'Dải thời gian hiệu lực' });
    await expect(timeline).toContainText(
      'Lưu ý: Từ 01/03/2026 đến 31/03/2026 không có phiên bản hiệu lực. User chạy kỳ này sẽ bị báo lỗi.',
    );
    await expect(timeline).not.toContainText('trở đi');
  });

  test('AC-B3-62: a draft with check errors cannot be published; problems are listed', async ({
    page,
    supabase,
  }) => {
    const broken = baseFlowDefinition();
    (broken.edges as unknown[]).length = 0; // compare inputs not connected
    (broken.nodes as { id: string; config: Record<string, unknown> }[])[2]!.config.keys = [
      { left: 'khong_co', right: 'ma_nv' },
    ];
    setup(supabase, { draft: broken });
    await page.goto(URL);
    await page.getByRole('button', { name: 'Publish v2' }).click();
    const dialog = publishDialog(page);
    await expect(dialog.getByRole('alert')).toContainText('Chưa publish được:');
    await expect(dialog.getByRole('listitem').first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Publish' })).toHaveCount(0);
    expect(rpcBodies(supabase)).toEqual([]);
  });

  test('a draft saved elsewhere meanwhile (HF002): the list reloads, nothing is published', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto(URL);
    await openPublish(page);
    supabase.versions.find((v) => v.id === DRAFT_ID)!.updated_at = '2026-10-27T05:00:00.5+00:00';
    const dialog = publishDialog(page);
    await dialog.getByLabel(/^Ghi chú thay đổi/).fill('x');
    await dialog.getByRole('button', { name: 'Publish' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('bản nháp vừa được lưu ở nơi khác');
    await expect(row(page, 2)).toContainText('Draft');
  });

  test('AC-B3-66: retire with confirmation; no way back to Published', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto(URL);
    await row(page, 1).getByRole('button', { name: 'Retire v1' }).click();
    const confirm = page.getByRole('dialog', { name: 'Retire v1?' });
    await expect(confirm).toContainText('từ 01/01/2026, không thời hạn');
    await confirm.getByRole('button', { name: 'Hủy' }).click();
    await expect(confirm).toHaveCount(0);
    expect(supabase.versionWrites).toEqual([]);

    await row(page, 1).getByRole('button', { name: 'Retire v1' }).click();
    await page
      .getByRole('dialog', { name: 'Retire v1?' })
      .getByRole('button', { name: 'Retire' })
      .click();
    await expect(row(page, 1)).toContainText('Retired');
    expect(supabase.versionWrites).toEqual([
      { method: 'PATCH', id: supabase.versions[0]!.id, body: { status: 'retired' } },
    ]);
    await expect(row(page, 1).getByRole('button', { name: /Retire|Publish|Đổi ngày/ })).toHaveCount(
      0,
    );
    await expect(
      row(page, 1).getByRole('button', { name: 'Tạo draft từ version này v1' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'chưa có phiên bản áp dụng hôm nay',
    );
  });

  test('AC-B3-68: with a draft open, "create draft from version" is refused without any request', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto(URL);
    await row(page, 1).getByRole('button', { name: 'Tạo draft từ version này v1' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Chưa thành công: Flow đang có bản nháp v2. Hãy publish hoặc hủy bản nháp đó trước.',
    );
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_create_draft_from_version')).toEqual([]);
  });

  test('AC-B3-69/67: discard the draft (confirmed), then roll back v1 into a new draft', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto(URL);
    await row(page, 2).getByRole('button', { name: 'Hủy draft v2' }).click();
    await page
      .getByRole('dialog', { name: 'Hủy bản nháp v2?' })
      .getByRole('button', { name: 'Hủy bản nháp' })
      .click();
    await expect(row(page, 2)).toHaveCount(0);
    expect(supabase.versionWrites).toEqual([{ method: 'DELETE', id: DRAFT_ID, body: {} }]);

    await row(page, 1).getByRole('button', { name: 'Tạo draft từ version này v1' }).click();
    // Numbering is max + 1 (the discarded v2 number is reused, as in the database trigger).
    await expect(page.getByRole('status')).toContainText('đã tạo bản nháp v2 từ v1.');
    await expect(row(page, 2)).toContainText('Draft');
    const clone = supabase.versions.find((v) => v.status === 'draft')!;
    expect(clone.definition).toEqual(supabase.versions[0]!.definition);
    // Default comparison is now the new draft vs v1: same content.
    await expect(page.getByRole('region', { name: 'So sánh phiên bản' })).toContainText(
      'Hai phiên bản giống nhau về nội dung xử lý.',
    );
  });

  test('AC-B3-70: change the end date of a published version; an overlap is refused', async ({
    page,
    supabase,
  }) => {
    supabase.setVersions([
      { no: 1, from: '2026-01-01', to: '2026-06-01' },
      { no: 2, from: '2026-06-01', to: null },
    ]);
    await page.goto(URL);
    await row(page, 1).getByRole('button', { name: 'Đổi ngày kết thúc v1' }).click();
    const dialog = page.getByRole('dialog', { name: 'Đổi ngày kết thúc của v1' });
    await pickDate(page, dialog.locator('#end-to'), '2026-07-01');
    await dialog.getByRole('button', { name: 'Lưu ngày kết thúc' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Khoảng hiệu lực bị chồng với v2');
    await pickDate(page, dialog.locator('#end-to'), '2026-05-01');
    await expect(dialog).toContainText('Từ 01/05/2026 đến 31/05/2026 không có phiên bản hiệu lực');
    await dialog.getByRole('button', { name: 'Lưu ngày kết thúc' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(page, 1)).toContainText('từ 01/01/2026 đến trước 01/05/2026');
    expect(supabase.versionWrites.map((w) => w.body)).toEqual([
      { effective_to: '2026-07-01' },
      { effective_to: '2026-05-01' },
    ]);
  });

  test('AC-B3-71: diff lists the changed compare node side by side with the tolerance line marked', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto(URL);
    const diff = page.getByRole('region', { name: 'So sánh phiên bản' });
    await expect(diff.getByLabel('Phiên bản cũ')).toHaveAttribute(
      'data-value',
      supabase.versions[0]!.id,
    );
    await expect(diff.getByLabel('Phiên bản mới')).toHaveAttribute('data-value', DRAFT_ID);
    await expect(diff.getByRole('heading', { name: 'Node (1)' })).toBeVisible();
    await expect(diff).toContainText('cmp');
    await expect(diff).toContainText('đổi cấu hình');
    const removed = diff.locator('td.bg-coral-tint');
    const added = diff.locator('td.bg-teal-tint');
    await expect(removed).toHaveCount(1);
    await expect(removed).toContainText('"tolerance": "0.5"');
    await expect(added).toContainText('"tolerance": "2"');
    await expect(diff.getByRole('heading', { name: /Kết nối|Input slot|Tham số/ })).toHaveCount(0);

    // Swap to the same version: nothing to compare.
    await chooseOption(diff.getByLabel('Phiên bản cũ'), 'v2 - Draft');
    await expect(diff).toContainText('Chọn hai phiên bản khác nhau.');
  });

  test('AC-B3-72: versions differing only in ui are reported identical', async ({
    page,
    supabase,
  }) => {
    const withUi = { ...baseFlowDefinition(), ui: { positions: { cmp: { x: 10, y: 20 } } } };
    setup(supabase, { draft: withUi });
    await page.goto(URL);
    await expect(page.getByRole('region', { name: 'So sánh phiên bản' })).toContainText(
      'Không khác biệt: Hai phiên bản giống nhau về nội dung xử lý.',
    );
  });

  test('export JSON downloads the definition of a published version', async ({
    page,
    supabase,
  }) => {
    setup(supabase);
    await page.goto(URL);
    const download = page.waitForEvent('download');
    await row(page, 1).getByRole('button', { name: 'Xuất JSON v1' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('payroll-timesheet_v1.json');
  });

  test('unknown flow code: clear message, back link', async ({ page }) => {
    await page.goto('/admin/flows/khong-co/versions');
    await expect(page.getByRole('alert')).toContainText('không tìm thấy flow này.');
    await page.getByRole('link', { name: 'Về danh sách flow' }).click();
    await expect(page).toHaveURL('/admin/flows');
  });
});

test.describe('Version screen for a User', () => {
  test.use({ signedInAs: USER });

  test('a User is sent home and no admin call is made (AC-B3-30)', async ({ page, supabase }) => {
    await page.goto(URL);
    await expect(page).toHaveURL(/\/$/);
    expect(supabase.adminCalls()).toEqual([]);
  });
});
