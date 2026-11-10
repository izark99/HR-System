/**
 * Verifier checks (spec §34 AC-RT-02 design part, AC-RT-07, AC-RT-10): the publish check of the
 * Version screen takes reference tables into account — a missing table, a list param whose label
 * column no longer exists block Publish; a table without a published version only warns. Supabase
 * mocked; fake configuration only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { rowAction } from './helpers';
import { REF_DRAFT_ID, refFlowDefinition, seedRefDraft } from './ref-run-helpers';
import type { SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN });

const URL = '/admin/flows/payroll-timesheet/versions';
const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Publish v4' });
const row = (page: Page) =>
  page.getByRole('table', { name: 'Danh sách phiên bản' }).getByRole('row', { name: /^v4\b/ });

function draft(supabase: SupabaseMock, edit: (def: Record<string, unknown>) => void) {
  seedRefDraft(supabase);
  const def = refFlowDefinition();
  edit(def);
  supabase.versions.find((v) => v.id === REF_DRAFT_ID)!.definition = def;
}

test('a node reading a table that does not exist blocks Publish', async ({ page, supabase }) => {
  draft(supabase, (def) => {
    (def.nodes as Record<string, unknown>[]).find((n) => n.id === 'ref_hs')!.config = {
      refTable: 'KHONG_CO',
    };
  });
  await page.goto(URL);
  await rowAction(row(page), 'Publish v4');
  const dialog = dialogOf(page);
  await expect(dialog.getByRole('alert')).toContainText('Chưa publish được:');
  await expect(dialog).toContainText('KHONG_CO');
  await expect(dialog.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  expect(supabase.bodiesOf('/rest/v1/rpc/admin_publish_flow_draft')).toEqual([]);
});

test('a list param whose label column was removed blocks Publish', async ({ page, supabase }) => {
  draft(supabase, (def) => {
    const p = (def.params as { key: string; options?: Record<string, string> }[]).find(
      (x) => x.key === 'chi_nhanh',
    )!;
    p.options!.labelColumn = 'ten_cu';
  });
  await page.goto(URL);
  await rowAction(row(page), 'Publish v4');
  const dialog = dialogOf(page);
  await expect(dialog.getByRole('alert')).toContainText('Chưa publish được:');
  await expect(dialog).toContainText('ten_cu');
  await expect(dialog.getByRole('button', { name: 'Publish' })).toHaveCount(0);
});

test('a valid draft using reference tables can be published', async ({ page, supabase }) => {
  draft(supabase, () => undefined);
  await page.goto(URL);
  await rowAction(row(page), 'Publish v4');
  const dialog = dialogOf(page);
  await expect(dialog.getByLabel(/^Ghi chú thay đổi/)).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});
