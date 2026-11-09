/**
 * Verifier checks of the "Văn bản giao diện" tab (spec §33): rows the app must ignore without
 * breaking (forged keys, unknown namespaces, other variables, HTML that slipped past the
 * database), the engine worker refusing an edited text whose variables differ, nothing stored in
 * the browser, and (opt-in, HRFLOW_PERF=1) render / search timings of the ~1.470-row table.
 * Fake data only.
 */
import { ADMIN, expect, test } from './fixtures';
import {
  employees,
  fixtures,
  openFlow,
  payroll,
  payrollInput,
  payrollList,
  reportCard,
  timesheetInput,
  timesheetList,
} from './helpers';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

const STAMP = '2026-11-09T02:30:00+00:00';

function preset(supabase: SupabaseMock, rows: Record<string, string | null>): void {
  supabase.uiTexts = Object.entries(rows).map(([key, value]) => ({
    key,
    value,
    updated_by: ADMIN.id,
    updated_at: STAMP,
  }));
}

test.describe('forged / stale rows are ignored', () => {
  test.use({ signedInAs: null });

  test('login page still renders, defaults kept, no HTML, nothing stored', async ({
    page,
    supabase,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    preset(supabase, {
      'common:__proto__.polluted': 'X',
      'common:constructor.name': 'X',
      'common:toString': 'X',
      'nope:auth.login.title': 'X',
      'common:auth.login': 'object, not a text',
      'common:auth.login.title.length': 'X',
      // Rows that only the database checks would refuse: the client must still render text.
      'common:flows.runNamed': 'Chạy {{other}}',
      'common:auth.login.submit': '<img src=x onerror="window.__xss=1">Vào',
    });
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
    const submit = page.getByRole('button', { name: /Vào/ });
    await expect(submit).toContainText('<img src=x');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBe(
      undefined,
    );
    expect(await page.locator('form img').count()).toBe(0);
    expect(
      await page.evaluate(() => ({ polluted: ({} as Record<string, unknown>).polluted })),
    ).toEqual({ polluted: undefined });
    expect(errors).toEqual([]);
    // Interface wording is never kept in the browser storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(stored).not.toContain('onerror');
  });
});

test('engine worker ignores an edited text whose variables differ from the default', async ({
  page,
  supabase,
}) => {
  preset(supabase, {
    // {{value}} dropped: must not be used, the default stays.
    'engine:validation.unique':
      'Trùng "{{column}}" ở {{file}} dòng {{row}} / {{otherFile}} {{otherRow}} {{otherValue}}',
  });
  await openFlow(page);
  await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
  await expect(timesheetList(page).getByTestId('file-status')).toHaveText([
    /\d+ dòng/,
    /\d+ dòng/,
    /\d+ dòng/,
  ]);
  await payrollInput(page).setInputFiles([
    payroll('luong_A.xlsx', employees(5, 1)),
    payroll('luong_B.xlsx', employees(3, 5, 'CN02')),
  ]);
  await expect(payrollList(page).getByTestId('file-status')).toHaveText(['1 lỗi', '1 lỗi']);
  await expect(reportCard(page).locator('tbody tr').first()).toContainText(
    'Cột "Mã NV" bị trùng giá trị: "NV00005"',
  );
});

test.describe('performance of the ~1.470-row table (HRFLOW_PERF=1)', () => {
  test.use({ signedInAs: ADMIN });
  test.skip(!process.env.HRFLOW_PERF, 'opt-in: HRFLOW_PERF=1');

  test('render, search, dialog with CPU throttling (HRFLOW_CPU, default 4x)', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.HRFLOW_CPU ?? 4) });
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const t0 = Date.now();
    await page
      .getByRole('navigation', { name: 'Menu Admin' })
      .getByRole('link', { name: 'Văn bản giao diện' })
      .click();
    const count = page.locator('[data-ui-text-count]');
    await expect(count).toHaveText(/^1\.\d{3} \/ 1\.\d{3} dòng/);
    const render = Date.now() - t0;
    const box = page.getByRole('searchbox', { name: 'Tìm' });
    // Typing latency: time for one keystroke to show in the box.
    const keyLatency: number[] = [];
    for (const ch of 'dang nhap') {
      const k0 = Date.now();
      await box.press(ch === ' ' ? 'Space' : ch);
      await expect(box).toHaveValue(new RegExp(`${ch === ' ' ? ' ' : ch}$`));
      keyLatency.push(Date.now() - k0);
    }
    const f0 = Date.now();
    await expect(count).toHaveText(/^\d{1,3} \/ 1\.\d{3} dòng/);
    const filter = Date.now() - f0;
    const c0 = Date.now();
    await box.fill('');
    await expect(count).toHaveText(/^1\.\d{3} \/ 1\.\d{3} dòng/);
    const clear = Date.now() - c0;
    const d0 = Date.now();
    await page.getByRole('button', { name: 'Sửa auth.login.title', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Sửa văn bản' })).toBeVisible();
    const dialogOpen = Date.now() - d0;
    const x0 = Date.now();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Sửa văn bản' })).toBeHidden();
    const dialogClose = Date.now() - x0;
    console.log(
      `[ui-text perf ${process.env.HRFLOW_CPU ?? 4}x] dialog open ${dialogOpen} ms, close ${dialogClose} ms`,
    );
    console.log(
      `[ui-text perf ${process.env.HRFLOW_CPU ?? 4}x] render ${render} ms, keystrokes [${keyLatency.join(', ')}] ms, ` +
        `filter settle ${filter} ms, clear (all rows back) ${clear} ms`,
    );
    expect(render).toBeLessThan(10_000);
  });
});

test.describe('formula hover (fixed 2026-11-09)', () => {
  test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

  // MEMORY 2026-11-09 09:14: edited texts are plain text, no HTML / link. The function hover of
  // the formula editor rendered `formula.fn.*.desc` as Markdown, so an edited description with
  // Markdown link syntax became a clickable link; it is now escaped (plain text).
  test('formula hover shows an edited function description as plain text, no link', async ({
    page,
    supabase,
  }) => {
    preset(supabase, {
      'designer:formula.fn.IF.desc': 'Xem [tài liệu](https://example.invalid/doc) về IF.',
    });
    const def = baseFlowDefinition() as Record<string, unknown> & {
      nodes: unknown[];
      edges: unknown[];
    };
    def.nodes.push({
      id: 'formula_1',
      type: 'transform.formula',
      label: 'Công thức',
      config: {
        columns: [
          { key: 'x', title: 'X', formula: '=IF([ot]>1,1,0)', type: 'auto', onError: 'blank' },
        ],
      },
    });
    def.edges.push({ from: 'in_luong', fromPort: 'table', to: 'formula_1', toPort: 'in' });
    supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
    supabase.versions.push({
      id: '00000000-0000-4000-8000-000000000777',
      flow_id: '00000000-0000-4000-8000-0000000000f1',
      version_no: 2,
      status: 'draft',
      effective_from: '',
      effective_to: null,
      definition: def,
      published_at: null,
      updated_at: '2026-10-27T01:00:00.000001+00:00',
    });
    await page.goto('/admin/flows/payroll-timesheet/designer');
    const node = page.getByTestId('rf__node-formula_1');
    await expect(node).toBeVisible();
    const editor = page.getByTestId('formula-editor-0');
    await expect(async () => {
      await node.click();
      await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 60_000 });
    await editor.locator('.view-lines span', { hasText: /^IF$/ }).first().hover();
    const hover = page.locator('.monaco-hover').filter({ hasText: 'về IF' });
    await expect(hover).toBeVisible();
    // The bug: the hover holds a link (<a> with the outside address).
    await expect(hover.locator('a')).toHaveCount(0);
    await expect(hover).toContainText('[tài liệu](https://example.invalid/doc)');
  });
});
