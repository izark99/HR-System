/**
 * Admin "Flows" screen (spec §6, §14, step 2): import a flow JSON, publish it with an effective
 * date, version list. Supabase is mocked (e2e/supabase-mock.ts); fake definitions only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { baseFlowDefinition } from './supabase-mock';
import { pickDate, pickerPopover, textFile } from './helpers';

test.use({ signedInAs: ADMIN });

const fileInput = (page: Page) => page.getByLabel('Chọn file flow JSON');
const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Nhập flow từ JSON' });
const publishButton = (page: Page) =>
  importDialog(page).getByRole('button', { name: /^(Publish phiên bản|Đang publish)/ });

async function openImport(
  page: Page,
  name: string,
  definition: unknown = baseFlowDefinition(),
  note = 'Cập nhật thử',
) {
  await page.goto('/admin/flows');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flow và phiên bản');
  await fileInput(page).setInputFiles(textFile(name, JSON.stringify(definition)));
  await expect(importDialog(page)).toBeVisible();
  // The change note is mandatory (spec §14.1).
  await importDialog(page).getByLabel('Ghi chú thay đổi').fill(note);
}

test.describe('import flow JSON → publish', () => {
  test('new flow: dialog prefilled from the file name, RPC called with the exact payload', async ({
    page,
    supabase,
  }) => {
    const definition = baseFlowDefinition();
    await openImport(page, 'Flow Mới (1).json', definition);
    const dialog = importDialog(page);
    await expect(dialog).toContainText('File: Flow Mới (1).json (hợp lệ)');
    await expect(dialog.getByLabel(/^Mã flow/)).toHaveValue('flow-moi-1');
    // New code: no "existing flow" callout and no "close previous" checkbox.
    await expect(dialog.getByText('Flow đã có:')).toHaveCount(0);
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);

    await dialog.getByLabel(/^Tên flow/).fill('Flow Mới');
    await dialog.getByLabel('Nhóm flow').fill('Nhóm thử');
    await dialog.getByLabel('Mô tả ngắn').fill('Mô tả thử');
    await dialog.getByLabel('Hướng dẫn cho User').fill('Hướng dẫn thử');
    await dialog.getByLabel('Ghi chú thay đổi').fill('Bản đầu');
    await pickDate(page, dialog.locator('#import-from'), '2026-11-15');
    await expect(dialog.locator('#import-from')).toContainText('15/11/2026');

    await publishButton(page).click();
    await expect(dialog).toHaveCount(0);
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_version')).toEqual([
      {
        p_code: 'flow-moi-1',
        p_name: 'Flow Mới',
        p_description: 'Mô tả thử',
        p_category: 'Nhóm thử',
        p_instructions: 'Hướng dẫn thử',
        p_definition: definition,
        p_effective_from: '2026-11-15',
        p_effective_to: null,
        p_change_note: 'Bản đầu',
        p_close_previous: false,
      },
    ]);
    await expect(page.getByRole('status').filter({ hasText: 'Đã nhập:' })).toContainText(
      'Flow Mới v1.',
    );
    // The list was reloaded: new row with its first version.
    const row = page.getByRole('row', { name: /Flow Mới/ });
    await expect(row).toContainText('flow-moi-1');
    await expect(row).toContainText('v1');
    await expect(row).toContainText('Published');
    await expect(row).toContainText('từ 15/11/2026');
    await expect(page.getByRole('heading', { name: 'Danh sách flow (2)' })).toBeVisible();
  });

  test('existing code: metadata prefilled, previous open version closed on the new date', async ({
    page,
    supabase,
  }) => {
    await openImport(page, 'payroll-timesheet.json');
    const dialog = importDialog(page);
    await expect(dialog.getByText('Flow đã có:')).toBeVisible();
    await expect(dialog.getByLabel(/^Tên flow/)).toHaveValue('Đối chiếu bảng lương – chấm công');
    await expect(dialog.getByLabel('Nhóm flow')).toHaveValue('Lương & công');
    await pickDate(page, dialog.locator('#import-from'), '2026-12-01');
    const close = dialog.getByRole('checkbox', { name: /Kết thúc v3 .* vào ngày 01\/12\/2026/ });
    await expect(close).toBeChecked();

    await publishButton(page).click();
    await expect(dialog).toHaveCount(0);
    const [call] = supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_version');
    expect(call).toMatchObject({
      p_code: 'payroll-timesheet',
      p_effective_from: '2026-12-01',
      p_effective_to: null,
      p_close_previous: true,
    });
    const row = page.getByRole('row', { name: /Đối chiếu bảng lương/ });
    await expect(row).toContainText('v4');
    await expect(row).toContainText('từ 01/12/2026');
    await expect(row).toContainText('từ 01/01/2026 đến trước 01/12/2026'); // v3 was closed
  });

  test('overlap rejected by the database: localized error, dialog stays, retry works', async ({
    page,
    supabase,
  }) => {
    await openImport(page, 'payroll-timesheet.json');
    const dialog = importDialog(page);
    await pickDate(page, dialog.locator('#import-from'), '2026-12-01');
    await dialog.getByRole('checkbox', { name: /Kết thúc v3/ }).uncheck();

    supabase.publishFailure = { status: 409, code: '23P01' };
    await publishButton(page).click();
    await expect(dialog.getByRole('alert')).toContainText('khoảng hiệu lực chồng lấn');
    await expect(dialog.getByRole('alert')).not.toContainText('injected'); // never the raw message
    await expect(dialog).toBeVisible();
    await expect(publishButton(page)).toBeEnabled();
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_version')[0]).toMatchObject({
      p_close_previous: false,
    });

    await dialog.getByRole('checkbox', { name: /Kết thúc v3/ }).check();
    await publishButton(page).click();
    await expect(dialog).toHaveCount(0);
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_version')).toHaveLength(2);
  });

  test('every database error code maps to its own message (no raw text)', async ({
    page,
    supabase,
  }) => {
    await openImport(page, 'flow-loi.json');
    const dialog = importDialog(page);
    await dialog.getByLabel(/^Tên flow/).fill('Flow lỗi');
    const cases: [number, string, string][] = [
      [403, '42501', 'bạn không có quyền'],
      [409, '23505', 'tên/mã này đã tồn tại'],
      [400, 'HF001', 'phiên bản đã publish không được sửa'],
      [400, '22023', 'nội dung flow không hợp lệ'],
      [400, '23514', 'không thỏa ràng buộc'],
      [500, 'XX000', 'có lỗi không xác định'],
    ];
    for (const [status, code, text] of cases) {
      supabase.publishFailure = { status, code };
      await publishButton(page).click();
      await expect(dialog.getByRole('alert')).toContainText(text);
      await expect(publishButton(page)).toBeEnabled();
    }
    await expect(dialog).toBeVisible();
  });

  test('form validation: code, name and date range are checked before any request', async ({
    page,
    supabase,
  }) => {
    await openImport(page, 'flow-kiem-tra.json');
    const dialog = importDialog(page);
    await dialog.getByLabel(/^Mã flow/).fill('Ab');
    await dialog.getByLabel(/^Tên flow/).fill('Tên');
    await publishButton(page).click();
    await expect(dialog.getByRole('alert')).toContainText('mã flow chưa hợp lệ');

    await dialog.getByLabel(/^Mã flow/).fill('flow-kiem-tra');
    await dialog.getByLabel(/^Tên flow/).fill('   ');
    await publishButton(page).click();
    await expect(dialog.getByRole('alert')).toContainText('nhập tên flow');

    await dialog.getByLabel(/^Tên flow/).fill('Tên');
    await pickDate(page, dialog.locator('#import-from'), '2026-12-01');
    await pickDate(page, dialog.locator('#import-to'), '2026-12-01'); // to == from → invalid
    await publishButton(page).click();
    await expect(dialog.getByRole('alert')).toContainText('ngày kết thúc phải sau ngày bắt đầu');

    await pickDate(page, dialog.locator('#import-to'), '2026-12-02');
    await dialog.getByLabel('Ghi chú thay đổi').fill('   '); // blank after trimming
    await publishButton(page).click();
    await expect(dialog.getByRole('alert')).toContainText('nhập ghi chú thay đổi');
    await dialog.getByLabel('Ghi chú thay đổi').fill('Kiểm tra');
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_version')).toEqual([]);

    // Boundary: the day after is accepted and sent as effective_to (exclusive upper bound).
    await pickDate(page, dialog.locator('#import-to'), '2026-12-02');
    await publishButton(page).click();
    await expect(dialog).toHaveCount(0);
    expect(supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_version')).toMatchObject([
      { p_effective_from: '2026-12-01', p_effective_to: '2026-12-02' },
    ]);
  });

  test('SQL-looking text is sent as a bound value, never altering the request shape', async ({
    page,
    supabase,
  }) => {
    const evil = `x'); DROP TABLE flows;--`;
    await openImport(page, 'flow-sql.json');
    const dialog = importDialog(page);
    await dialog.getByLabel(/^Tên flow/).fill(evil);
    await dialog.getByLabel('Ghi chú thay đổi').fill(`" OR 1=1 --`);
    await publishButton(page).click();
    await expect(dialog).toHaveCount(0);
    const [call] = supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_version');
    expect(call).toMatchObject({ p_name: evil, p_change_note: `" OR 1=1 --`, p_code: 'flow-sql' });
    // Only the RPC (and reads) were called: no raw SQL endpoint, nothing else mutated.
    expect(supabase.calls.filter((c) => c.method !== 'GET' && c.method !== 'OPTIONS')).toHaveLength(
      1,
    );
  });
});

test.describe('import flow JSON → file problems (nothing is published)', () => {
  const bad: { title: string; file: ReturnType<typeof textFile>; message: string }[] = [
    {
      title: 'not JSON',
      file: textFile('hong.json', '{ "schemaVersion": 1, '),
      message: 'file không phải JSON',
    },
    { title: 'empty file', file: textFile('rong.json', ''), message: 'file không phải JSON' },
    {
      title: 'a .csv file',
      file: textFile('luong.csv', 'Mã NV,Công\nNV00001,26\n', 'text/csv'),
      message: 'file không phải JSON',
    },
    {
      title: 'valid JSON, wrong schema',
      file: textFile('sai.json', JSON.stringify({ schemaVersion: 1, name: 'x' })),
      message: 'nội dung không đúng định dạng flow',
    },
    {
      title: 'a JSON array',
      file: textFile('mang.json', '[]'),
      message: 'nội dung không đúng định dạng flow',
    },
    {
      title: 'JSON null',
      file: textFile('null.json', 'null'),
      message: 'nội dung không đúng định dạng flow',
    },
    {
      title: 'larger than 1 MB',
      file: textFile('lon.json', JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) })),
      message: 'file lớn hơn 1 MB',
    },
  ];

  for (const { title, file, message } of bad) {
    test(`rejected: ${title}`, async ({ page, supabase }) => {
      await page.goto('/admin/flows');
      await fileInput(page).setInputFiles(file);
      const alert = page.getByRole('alert').filter({ hasText: 'File chưa hợp lệ:' });
      await expect(alert).toContainText(message);
      await expect(importDialog(page)).toHaveCount(0);
      expect(supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_version')).toEqual([]);
    });
  }

  test('schema problems are listed (max 20), a good file afterwards clears the error', async ({
    page,
  }) => {
    await page.goto('/admin/flows');
    await fileInput(page).setInputFiles(textFile('sai.json', JSON.stringify({ schemaVersion: 1 })));
    const alert = page.getByRole('alert').filter({ hasText: 'File chưa hợp lệ:' });
    await expect(alert.getByRole('listitem').first()).toBeVisible();
    expect(await alert.getByRole('listitem').count()).toBeLessThanOrEqual(20);

    // Same input element must fire again for a corrected file (value reset after each read).
    await fileInput(page).setInputFiles(
      textFile('dung.json', JSON.stringify(baseFlowDefinition())),
    );
    await expect(importDialog(page)).toBeVisible();
    await expect(alert).toHaveCount(0);
  });

  test('picking the same bad file twice shows the error twice', async ({ page }) => {
    await page.goto('/admin/flows');
    const bad = textFile('hong.json', '{');
    await fileInput(page).setInputFiles(bad);
    const alert = page.getByRole('alert').filter({ hasText: 'File chưa hợp lệ:' });
    await expect(alert).toBeVisible();
    await fileInput(page).setInputFiles([]);
    await fileInput(page).setInputFiles(bad);
    await expect(alert).toBeVisible();
  });

  test('the file chooser only offers JSON (no .csv)', async ({ page }) => {
    await page.goto('/admin/flows');
    const accept = await fileInput(page).getAttribute('accept');
    expect(accept).toContain('.json');
    expect(accept).not.toMatch(/csv/i);
  });

  test('a file name with HTML is shown as text, never injected', async ({ page }) => {
    await openImport(page, '<img src=x onerror=alert(1)>.json');
    await expect(importDialog(page)).toContainText('<img src=x onerror=alert(1)>.json');
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(importDialog(page).getByLabel(/^Mã flow/)).toHaveValue(
      'img-src-x-onerror-alert-1',
    );
  });
});

test.describe('import flow JSON → migration notices (.csv in accept)', () => {
  type Slot = { accept?: string[]; label?: string };

  function withAccept(accepts: string[][]) {
    const def = baseFlowDefinition();
    const slots = def.inputSlots as Slot[];
    accepts.forEach((a, i) => (slots[i]!.accept = a));
    return def;
  }

  type Published = { p_definition: { inputSlots: { key: string; accept?: string[] }[] } };

  test('.csv among other formats: stripped, notice by slot label, the CLEANED JSON is stored', async ({
    page,
    supabase,
  }) => {
    await openImport(page, 'csv-lan.json', withAccept([['.xlsx', '.csv'], ['.xlsx']]));
    const dialog = importDialog(page);
    await expect(dialog.getByText('Đã tự điều chỉnh:')).toBeVisible();
    // The slot's display label, not its technical key.
    await expect(dialog).toContainText(
      'Đã bỏ định dạng .csv khỏi Bảng lương (nhiều chi nhánh) (không còn được hỗ trợ).',
    );
    await expect(dialog).not.toContainText('bang_luong');
    await expect(dialog).not.toContainText('Chấm công (nhiều chi nhánh)'); // untouched slot
    await dialog.getByLabel(/^Tên flow/).fill('Flow csv');
    await publishButton(page).click();
    await expect(dialog).toHaveCount(0);
    const bodies = supabase.bodiesOf(
      '/rest/v1/rpc/admin_publish_flow_version',
    ) as unknown as Published[];
    expect(bodies).toHaveLength(1);
    const slots = bodies[0]!.p_definition.inputSlots;
    expect(slots[0]!.accept).toEqual(['.xlsx']);
    expect(slots[1]!.accept).toEqual(['.xlsx']);
    expect(JSON.stringify(bodies[0]!.p_definition)).not.toContain('.csv');
  });

  test('slot that accepted only .csv: accept removed (default .xlsx/.xls) before storing', async ({
    page,
    supabase,
  }) => {
    await openImport(page, 'csv-chi.json', withAccept([['.csv'], ['.xlsx']]));
    const dialog = importDialog(page);
    // Its own message (AC-B3-91), not the "removed among other formats" one.
    await expect(dialog).toContainText(
      'Bảng lương (nhiều chi nhánh) chỉ nhận .csv nên đã chuyển sang nhận .xlsx, .xls.',
    );
    await expect(dialog).not.toContainText('Đã bỏ định dạng .csv');
    await dialog.getByLabel(/^Tên flow/).fill('Flow csv chi');
    await publishButton(page).click();
    await expect(dialog).toHaveCount(0);
    const bodies = supabase.bodiesOf(
      '/rest/v1/rpc/admin_publish_flow_version',
    ) as unknown as Published[];
    expect(bodies[0]!.p_definition.inputSlots[0]).not.toHaveProperty('accept');
    expect(JSON.stringify(bodies[0]!.p_definition)).not.toContain('.csv');
  });

  test('a clean definition shows no notice', async ({ page }) => {
    await openImport(page, 'sach.json');
    await expect(importDialog(page).getByText('Đã tự điều chỉnh:')).toHaveCount(0);
  });
});

test.describe('version list', () => {
  test('versions newest first with status chips and effective ranges', async ({
    page,
    supabase,
  }) => {
    supabase.setVersions([
      { no: 1, from: '2025-01-01', to: '2025-07-01' },
      { no: 2, from: '2025-07-01', to: '2026-01-01' },
      { no: 3, from: '2026-01-01' },
    ]);
    supabase.versions.push({
      ...supabase.versions[2]!,
      id: '00000000-0000-4000-8000-000000000999',
      version_no: 4,
      status: 'draft',
      effective_from: '2027-01-01',
      effective_to: null,
    });
    supabase.versions.push({
      ...supabase.versions[0]!,
      id: '00000000-0000-4000-8000-000000000998',
      version_no: 0,
      status: 'retired',
      effective_from: '2024-01-01',
      effective_to: '2025-01-01',
    });
    await page.goto('/admin/flows');
    const items = page.getByRole('row', { name: /Đối chiếu bảng lương/ }).getByRole('listitem');
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toContainText('v4');
    await expect(items.nth(0)).toContainText('Draft');
    await expect(items.nth(1)).toContainText('v3');
    await expect(items.nth(1)).toContainText('Published');
    await expect(items.nth(1)).toContainText('từ 01/01/2026');
    await expect(items.nth(1)).not.toContainText('đến trước');
    await expect(items.nth(2)).toContainText('từ 01/07/2025 đến trước 01/01/2026');
    await expect(items.nth(3)).toContainText('từ 01/01/2025 đến trước 01/07/2025');
    await expect(items.nth(4)).toContainText('Retired');
    // Reading the list never downloads definitions (only metadata columns).
    const versionsCall = supabase.calls.find((c) => c.path.startsWith('/rest/v1/flow_versions'))!;
    expect(decodeURIComponent(versionsCall.path)).not.toContain('definition');
  });

  test('empty state when there is no flow', async ({ page, supabase }) => {
    supabase.flows = [];
    supabase.versions = [];
    await page.goto('/admin/flows');
    await expect(page.getByText('Chưa có flow nào. Bấm "Nhập flow JSON"')).toBeVisible();
    await expect(pickerPopover(page)).toHaveCount(0);
  });
});
