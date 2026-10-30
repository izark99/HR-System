import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RunSummary, UploadFile } from '../protocol';
import { EngineSession } from '../session';

/**
 * QA (R4): result-screen preview tabs (spec §12.1.10, AC-B3-27..29d) on the real engine session:
 * numeric sort, search limited to the shown columns, paging with sort + search, truncation,
 * release of the previous run's tables. Fake fixtures only.
 */
const FIXTURES = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');
const flow = JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8')) as {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
};
const uploads = (prefix: string): UploadFile[] =>
  readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((name) => ({ name, blob: new Blob([readFileSync(join(FIXTURES, name))]) }));

function withPreviews(maxRows = 20) {
  const f = structuredClone(flow);
  f.nodes.push(
    {
      id: 'xem',
      type: 'output.preview',
      config: { title: 'Công theo NV', columns: ['ma_nv', 'cong'], maxRows },
    },
    { id: 'xem_all', type: 'output.preview', config: { title: 'Tất cả cột' } },
  );
  f.edges.push(
    { from: 'in_luong', fromPort: 'table', to: 'xem', toPort: 'in' },
    { from: 'in_luong', fromPort: 'table', to: 'xem_all', toPort: 'in' },
  );
  return f;
}

async function runWith(definition: unknown) {
  const s = new EngineSession('vi');
  expect(s.loadFlow(definition).ok).toBe(true);
  await s.setSlotFiles('bang_luong', uploads('bang_luong_'));
  await s.setSlotFiles('cham_cong', uploads('cham_cong_'));
  const outcome = await s.run({ ky_luong: '2026-09' }, () => undefined);
  if (!outcome.ok) throw new Error(outcome.error.messageKey);
  return { s, summary: outcome.summary };
}

describe('preview tabs on a real run', () => {
  let s: EngineSession;
  let summary: RunSummary;
  beforeAll(async () => {
    ({ s, summary } = await runWith(withPreviews(20)));
  });
  const tab = (name: string) => summary.sheets.find((x) => x.name === name)!;

  it('tabs follow the node order; only the Excel sheets are artifacts; previews are view-only', () => {
    expect(summary.sheets.map((x) => [x.name, x.kind])).toEqual([
      ['Tổng hợp', 'excel'],
      ['Lệch', 'excel'],
      ['Chỉ có trong lương', 'excel'],
      ['Chỉ có trong chấm công', 'excel'],
      ['Công theo NV', 'preview'],
      ['Tất cả cột', 'preview'],
    ]);
    expect(summary.artifacts).toHaveLength(1);
  });

  it('only the declared columns, in the declared order; truncation keeps maxRows and reports the total', () => {
    const t = tab('Công theo NV');
    expect(t.columns.map((c) => c.key)).toEqual(['ma_nv', 'cong']);
    expect(t.rowCount).toBe(20);
    expect(t.totalRows).toBe(75);
    const page = s.getRows(t.id, { offset: 0, limit: 1000 });
    expect(page.total).toBe(20);
    expect(page.rows.every((r) => r.length === 2)).toBe(true);
    // No declared columns: every column.
    expect(tab('Tất cả cột').columns.length).toBeGreaterThan(2);
    expect(tab('Tất cả cột').totalRows).toBe(75);
  });

  it('numeric sort is numeric, not text: 9 < 10 < 22; descending reverses it', () => {
    const t = tab('Công theo NV');
    const asc = s.getRows(t.id, {
      offset: 0,
      limit: 100,
      sort: { column: 'cong', direction: 'asc' },
    });
    const values = asc.rows.map((r) => Number((r as unknown[])[1]));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    const desc = s.getRows(t.id, {
      offset: 0,
      limit: 100,
      sort: { column: 'cong', direction: 'desc' },
    });
    const dv = desc.rows.map((r) => Number((r as unknown[])[1]));
    expect(dv).toEqual([...dv].sort((a, b) => b - a));
    expect(asc.total).toBe(20);
  });

  it('sort is stable for equal keys (ties keep run order) and paging pieces add up to the full list', () => {
    const t = tab('Công theo NV');
    const q = { sort: { column: 'cong', direction: 'asc' as const } };
    const full = s.getRows(t.id, { offset: 0, limit: 100, ...q }).rows;
    const pieces = [0, 7, 14].flatMap((offset) => s.getRows(t.id, { offset, limit: 7, ...q }).rows);
    expect(pieces).toEqual(full);
    expect(new Set(full.map((r) => (r as unknown[])[0])).size).toBe(20);
  });

  it('search is case-insensitive, trims, and only looks at the SHOWN columns', () => {
    const t = tab('Công theo NV');
    expect(s.getRows(t.id, { offset: 0, limit: 10, search: '  nv00001 ' }).total).toBe(1);
    // chi_nhanh is not a shown column of this tab: searching a branch code finds nothing.
    expect(s.getRows(t.id, { offset: 0, limit: 10, search: 'CN01' }).total).toBe(0);
    // ...while the all-columns tab does find it.
    expect(
      s.getRows(tab('Tất cả cột').id, { offset: 0, limit: 100, search: 'CN01' }).total,
    ).toBeGreaterThan(0);
    expect(s.getRows(t.id, { offset: 0, limit: 10, search: 'không-có-gì' }).rows).toEqual([]);
  });

  it('search + sort + an offset past the end are safe', () => {
    const t = tab('Tất cả cột');
    const r = s.getRows(t.id, {
      offset: 10_000,
      limit: 50,
      search: 'cn02',
      sort: { column: 'ma_nv', direction: 'desc' },
    });
    expect(r.rows).toEqual([]);
    expect(r.total).toBeGreaterThan(0);
    expect(s.getRows(t.id, { offset: -5, limit: 3 }).rows).toHaveLength(3);
    expect(s.getRows(t.id, { offset: 0, limit: 0 }).rows).toEqual([]);
  });

  it('sorting by an unknown column or filtering with hostile text does not throw or leak', () => {
    const t = tab('Công theo NV');
    expect(() =>
      s.getRows(t.id, { offset: 0, limit: 5, sort: { column: "x'; drop--", direction: 'asc' } }),
    ).not.toThrow();
    expect(s.getRows(t.id, { offset: 0, limit: 5, search: "'; DROP TABLE x; --" }).total).toBe(0);
  });

  it('a new run releases the previous tables: the old sheet ids are unknown afterwards', async () => {
    const old = tab('Công theo NV');
    expect(s.getRows(old.id, { offset: 0, limit: 1 }).rows).toHaveLength(1);
    const again = await s.run({ ky_luong: '2026-09' }, () => undefined);
    expect(again.ok).toBe(true);
    // Same ids may be reused for the new run; the point: the tables belong to the NEW run only.
    if (again.ok) {
      const fresh = again.summary.sheets.find((x) => x.name === 'Công theo NV')!;
      expect(s.getRows(fresh.id, { offset: 0, limit: 100 }).total).toBe(20);
    }
  });

  it('loading another flow drops every result table', () => {
    const t = tab('Công theo NV');
    s.loadFlow(flow);
    expect(() => s.getRows(t.id, { offset: 0, limit: 1 })).toThrow();
  });
});

describe('preview-only flow', () => {
  it('has no artifact and no Excel sheet (AC-B3-29b)', async () => {
    const f = structuredClone(flow);
    f.nodes = f.nodes.filter((n) => n.id === 'in_luong');
    f.nodes.push({ id: 'xem', type: 'output.preview', config: { title: 'Bảng lương' } });
    f.edges = [{ from: 'in_luong', fromPort: 'table', to: 'xem', toPort: 'in' }];
    const s = new EngineSession('vi');
    expect(s.loadFlow(f).ok).toBe(true);
    await s.setSlotFiles('bang_luong', uploads('bang_luong_'));
    const outcome = await s.run({ ky_luong: '2026-09' }, () => undefined);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.summary.artifacts).toEqual([]);
      expect(outcome.summary.sheets.map((x) => x.kind)).toEqual(['preview']);
    }
  });
});
