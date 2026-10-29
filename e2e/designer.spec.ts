/**
 * Flow Designer (spec §15.3, AC-B3-30..47). Supabase is mocked (e2e/supabase-mock.ts); fake flow
 * configurations only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { baseFlowDefinition, type SupabaseMock } from './supabase-mock';

test.use({ signedInAs: ADMIN, viewport: { width: 1440, height: 900 } });

const FLOW_ID = '00000000-0000-4000-8000-0000000000f1';
const DRAFT_ID = '00000000-0000-4000-8000-000000000777';
const DESIGNER = '/admin/flows/payroll-timesheet/designer';

function withDraft(supabase: SupabaseMock, definition: unknown = baseFlowDefinition()) {
  supabase.setVersions([{ no: 1, from: '2026-01-01', to: null }]);
  supabase.versions.push({
    id: DRAFT_ID,
    flow_id: FLOW_ID,
    version_no: 2,
    status: 'draft',
    effective_from: '',
    effective_to: null,
    definition,
    published_at: null,
    updated_at: '2026-10-27T01:00:00.000001+00:00',
  });
}

const canvasNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const statusBar = (page: Page) => page.getByRole('button', { name: /lỗi · / });

test('smoke: the draft opens on the canvas, checked without errors', async ({ page, supabase }) => {
  withDraft(supabase);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(DESIGNER);
  await expect(canvasNode(page, 'in_luong')).toBeVisible();
  await expect(canvasNode(page, 'cmp')).toBeVisible();
  await expect(statusBar(page)).toContainText('0 lỗi');
  await page.screenshot({ path: '/tmp/claude-0/shots/designer.png' });
  await canvasNode(page, 'cmp').click();
  await page.screenshot({ path: '/tmp/claude-0/shots/designer-compare.png' });
  expect(errors).toEqual([]);
});
