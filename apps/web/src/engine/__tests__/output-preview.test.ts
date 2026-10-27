import ExcelJS from 'exceljs';
import { FlowDefinitionSchema } from '@hrflow/flow-schema';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { planFlow } from '../core/executor';
import type { DuckDbProvider } from '../duckdb/db';
import type { RunSummary, UploadFile } from '../protocol';
import { EngineSession } from '../session';
import { nodeDuckDb } from './duckdb-node';

/** output.preview end to end in the worker session (spec §12.1.10, US-B3-06 engine parts). */

const FIXTURES = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');
const base = JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8')) as {
  nodes: { id: string; type: string; config: Record<string, unknown> }[];
  edges: Record<string, string>[];
};

function uploads(prefix: string): UploadFile[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((name) => ({ name, blob: new Blob([readFileSync(join(FIXTURES, name))]) }));
}

/** Acceptance flow with a 2-sheet output.excel and 2 previews, in this node order. */
function flowWithPreviews(extra: Record<string, unknown> = {}) {
  const [inLuong, inCc, cmp, out] = base.nodes;
  return {
    ...base,
    nodes: [
      inLuong,
      inCc,
      cmp,
      {
        id: 'g',
        type: 'transform.groupBy',
        config: {
          by: ['chi_nhanh'],
          aggregations: [
            { key: 'so_nv', fn: 'countRows', title: 'Số NV' },
            { key: 'tong_cong', fn: 'sum', column: 'cong' },
          ],
        },
      },
      { id: 'p1', type: 'output.preview', config: { title: 'Theo chi nhánh' } },
      {
        ...out,
        config: {
          ...out!.config,
          sheets: [
            { name: 'Tổng hợp', port: 'summary' },
            { name: 'Lệch', port: 'mismatched' },
          ],
        },
      },
      {
        id: 'p2',
        type: 'output.preview',
        config: { title: 'Top lệch', columns: ['cong__diff', 'ma_nv'], maxRows: 4, ...extra },
      },
    ],
    edges: [
      ...base.edges.filter((e) => e.toPort !== 'only_left' && e.toPort !== 'only_right'),
      { from: 'in_luong', to: 'g' },
      { from: 'g', to: 'p1' },
      { from: 'cmp', fromPort: 'mismatched', to: 'p2' },
    ],
  };
}

describe('output.preview in the session', () => {
  const duck = vi.fn<DuckDbProvider>(nodeDuckDb);
  const session = new EngineSession('vi', { duck });
  let summary: RunSummary;

  beforeAll(async () => {
    const loaded = session.loadFlow(flowWithPreviews());
    expect(loaded).toMatchObject({ ok: true });
    await session.setSlotFiles('bang_luong', uploads('bang_luong_'));
    await session.setSlotFiles('cham_cong', uploads('cham_cong_'));
    const outcome = await session.run({ ky_luong: '2026-09' });
    if (!outcome.ok) throw new Error(outcome.error.messageKey);
    summary = outcome.summary;
  });

  it('AC-B3-27: tabs follow the node order; previews are marked; the file has only the sheets', async () => {
    expect(summary.sheets.map((s) => [s.name, s.kind])).toEqual([
      ['Theo chi nhánh', 'preview'],
      ['Tổng hợp', 'excel'],
      ['Lệch', 'excel'],
      ['Top lệch', 'preview'],
    ]);
    expect(summary.artifacts).toHaveLength(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(session.getArtifact(0).data);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Tổng hợp', 'Lệch']);
    expect(duck).toHaveBeenCalledTimes(1);
  });

  it('AC-B3-28: only the configured columns, in order; all columns by default', () => {
    const top = summary.sheets[3]!;
    expect(top.columns.map((c) => c.key)).toEqual(['cong__diff', 'ma_nv']);
    const branches = summary.sheets[0]!;
    expect(branches.columns.map((c) => [c.key, c.title])).toEqual([
      ['chi_nhanh', 'Chi nhánh'],
      ['so_nv', 'Số NV'],
      ['tong_cong', 'tong_cong'],
    ]);
    const page = session.getRows(branches.id, { offset: 0, limit: 10 });
    expect(page.rows.map((r) => [r[0], r[1]])).toEqual([
      ['CN01', 30],
      ['CN02', 25],
      ['CN03', 20],
    ]);
  });

  it('AC-B3-29: maxRows keeps the first rows and reports the total', () => {
    const top = summary.sheets[3]!;
    expect(top.rowCount).toBe(4);
    expect(top.totalRows).toBe(9);
    expect(session.getRows(top.id, { offset: 0, limit: 100 }).total).toBe(4);
  });

  it('pages with sort and search applied in the worker', () => {
    const branches = summary.sheets[0]!;
    const desc = session.getRows(branches.id, {
      offset: 0,
      limit: 10,
      sort: { column: 'chi_nhanh', direction: 'desc' },
    });
    expect(desc.rows.map((r) => r[0])).toEqual(['CN03', 'CN02', 'CN01']);
    const found = session.getRows(branches.id, { offset: 0, limit: 10, search: ' cn02 ' });
    expect(found.total).toBe(1);
    expect(found.rows[0]![0]).toBe('CN02');
  });

  it('AC-B3-29d: a new run releases the previous previews', async () => {
    const id = summary.sheets[0]!.id;
    await session.run({ ky_luong: '2026-09' });
    expect(() => session.getRows('nope', { offset: 0, limit: 1 })).toThrow();
    expect(session.getRows(id, { offset: 0, limit: 1 }).total).toBe(3);
    session.loadFlow(flowWithPreviews());
    expect(() => session.getRows(id, { offset: 0, limit: 1 })).toThrow();
  });
});

describe('output.preview only (AC-B3-29b)', () => {
  it('no artifact, no DuckDB for a TS-only flow', async () => {
    const duck = vi.fn<DuckDbProvider>(nodeDuckDb);
    const session = new EngineSession('vi', { duck });
    const [inLuong] = base.nodes;
    expect(
      session.loadFlow({
        ...base,
        nodes: [inLuong, { id: 'p', type: 'output.preview', config: { title: 'Bảng lương' } }],
        edges: [{ from: 'in_luong', to: 'p' }],
      }),
    ).toMatchObject({ ok: true });
    await session.setSlotFiles('bang_luong', uploads('bang_luong_'));
    const outcome = await session.run({ ky_luong: '2026-09' });
    if (!outcome.ok) throw new Error(outcome.error.messageKey);
    expect(outcome.summary.artifacts).toEqual([]);
    expect(outcome.summary.sheets).toEqual([
      expect.objectContaining({ name: 'Bảng lương', kind: 'preview', rowCount: 75, totalRows: 75 }),
    ]);
    expect(duck).not.toHaveBeenCalled();
  });
});

describe('output.preview config checks (AC-B3-29c)', () => {
  const plan = (flow: unknown) => planFlow(FlowDefinitionSchema.parse(flow));

  it('duplicate title with another preview or an Excel sheet (case-insensitive) blocks the flow', () => {
    expect(() => plan(flowWithPreviews({ title: 'LỆCH' }))).toThrow(
      expect.objectContaining({ messageKey: 'preview.error.duplicateTitle', nodeId: 'p2' }),
    );
    expect(() => plan(flowWithPreviews({ title: 'theo chi nhánh' }))).toThrow(
      expect.objectContaining({ messageKey: 'preview.error.duplicateTitle' }),
    );
    expect(() => plan(flowWithPreviews())).not.toThrow();
  });

  it('unknown column → preview.error.unknownColumn', async () => {
    const session = new EngineSession('vi', { duck: nodeDuckDb });
    session.loadFlow(flowWithPreviews({ columns: ['nope'] }));
    await session.setSlotFiles('bang_luong', uploads('bang_luong_'));
    await session.setSlotFiles('cham_cong', uploads('cham_cong_'));
    const outcome = await session.run({ ky_luong: '2026-09' });
    expect(outcome).toMatchObject({
      ok: false,
      error: { messageKey: 'preview.error.unknownColumn', nodeId: 'p2' },
    });
  });
});
