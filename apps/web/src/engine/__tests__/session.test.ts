import ExcelJS from 'exceljs';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RunProgressEvent, RunSummary, UploadFile } from '../protocol';
import { EngineSession } from '../session';

const FIXTURES = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');
const flowJson: unknown = JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8'));

function uploads(prefix: string): UploadFile[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((name) => ({ name, blob: new Blob([readFileSync(join(FIXTURES, name))]) }));
}

describe('EngineSession (worker logic)', () => {
  const session = new EngineSession('vi');
  let summary: RunSummary;
  const events: RunProgressEvent[] = [];

  beforeAll(async () => {
    expect(session.loadFlow(flowJson).ok).toBe(true);
    const pay = await session.setSlotFiles('bang_luong', uploads('bang_luong_'));
    const ts = await session.setSlotFiles('cham_cong', uploads('cham_cong_'));
    expect(pay.report.errorCount).toBe(0);
    expect(ts.report.errorCount).toBe(0);
    expect(pay.rowCount).toBe(75);
    const outcome = await session.run({ ky_luong: '2026-09' }, (e) => events.push(e));
    if (!outcome.ok) throw new Error(outcome.error.messageKey);
    summary = outcome.summary;
  });

  it('returns KPIs, sheets and the artifact', () => {
    expect(summary.compare).toMatchObject({
      matched: 63,
      mismatched: 9,
      onlyLeft: 3,
      onlyRight: 3,
      sideLabels: { left: 'lương', right: 'chấm công' },
    });
    expect(summary.compare!.metrics).toEqual([
      { label: 'Công', tolerance: '0.5' },
      { label: 'OT (giờ)', tolerance: '1' },
      { label: 'Phép', tolerance: '0' },
      { label: 'Không lương', tolerance: '0' },
    ]);
    expect(summary.sheets.map((s) => [s.name, s.role, s.rowCount])).toEqual([
      ['Tổng hợp', 'summary', 5],
      ['Lệch', 'mismatched', 9],
      ['Chỉ có trong lương', 'only_left', 3],
      ['Chỉ có trong chấm công', 'only_right', 3],
    ]);
    expect(summary.inputs.map((i) => i.rows)).toEqual([75, 75]);
    expect(summary.artifacts).toEqual([
      expect.objectContaining({ index: 0, fileName: 'DoiChieu_092026.xlsx' }),
    ]);
    expect(events.filter((e) => e.type === 'node-finished')).toHaveLength(4);
  });

  it('pages rows with decimals as strings and highlights failing diff cells', () => {
    const lech = summary.sheets[1]!;
    const page = session.getRows(lech.id, { offset: 0, limit: 5 });
    expect(page.total).toBe(9);
    expect(page.rows).toHaveLength(5);
    const keys = lech.columns.map((c) => c.key);
    const first = Object.fromEntries(keys.map((k, i) => [k, page.rows[0]![i]]));
    expect(first.ma_nv).toBe('NV00001');
    expect(first.cong__diff).toBe('-2');
    expect(page.highlights[0]).toEqual(['cong__diff']);
    const rest = session.getRows(lech.id, { offset: 5, limit: 100 });
    expect(rest.rows).toHaveLength(4);
  });

  it('offers branch + metric filters on "Lệch" and applies them', () => {
    const lech = summary.sheets[1]!;
    const options = session.getFilterOptions(lech.id);
    expect(options.map((o) => [o.column, o.kind, o.values])).toEqual([
      ['chi_nhanh', 'column', ['CN01', 'CN02', 'CN03']],
      ['_mismatched_metrics', 'metric', ['Công', 'OT (giờ)', 'Phép', 'Không lương']],
    ]);
    const cn01 = session.getRows(lech.id, {
      offset: 0,
      limit: 50,
      filters: [{ column: 'chi_nhanh', op: 'eq', value: 'CN01' }],
    });
    expect(cn01.total).toBe(3);
    const phep = session.getRows(lech.id, {
      offset: 0,
      limit: 50,
      filters: [{ column: '_mismatched_metrics', op: 'listIncludes', value: 'Phép' }],
    });
    expect(phep.total).toBe(3);
    expect(session.getFilterOptions(summary.sheets[0]!.id)).toEqual([]);
  });

  it('serves the output file repeatedly', async () => {
    const a = session.getArtifact(0);
    const b = session.getArtifact(0);
    expect(a.data.byteLength).toBeGreaterThan(0);
    expect(b.data.byteLength).toBe(a.data.byteLength);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(a.data);
    expect(wb.worksheets).toHaveLength(4);
  });
});

describe('EngineSession validation', () => {
  it('reports duplicates across files and builds the error report .xlsx', async () => {
    const session = new EngineSession('vi');
    session.loadFlow(flowJson);
    const files = uploads('cham_cong_');
    // Same file twice under two names → every Mã NV is duplicated.
    const dup = [...files, { name: 'copy.xlsx', blob: files[0]!.blob }];
    const v = await session.setSlotFiles('cham_cong', dup);
    expect(v.report.errorCount).toBeGreaterThan(0);
    expect(v.report.issues.some((i) => i.messageKey === 'validation.unique')).toBe(true);

    const outcome = await session.run({ ky_luong: '2026-09' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.cancelled).toBe(false);
      expect(['in_luong', 'in_cc']).toContain(outcome.error.nodeId);
    }

    const report = await session.validationReportFile();
    expect(report.fileName).toBe('BaoCaoKiemTra.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(report.data);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Báo cáo kiểm tra');
    expect(ws.rowCount).toBe(1 + v.report.issues.length + v.report.skippedRows.length);
    expect(ws.getRow(2).getCell(7).text).toContain('trùng');
  });

  it('rejects an invalid flow definition', () => {
    const session = new EngineSession('vi');
    const res = session.loadFlow({ schemaVersion: 1, nodes: [] });
    expect(res.ok).toBe(false);
  });
});
