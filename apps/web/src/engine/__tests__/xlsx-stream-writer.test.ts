/**
 * Streaming writer (io/xlsx-stream-writer.ts, used for large outputs) vs the ExcelJS writer:
 * the same tables must read back the same (values, types, number formats, sheet names, header,
 * auto-filter, frozen row, widths), with SheetJS and ExcelJS. Fake data only.
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { Big } from '../core/decimal';
import type { ColumnDef, Table } from '../core/types';
import { writeWorkbook } from '../io/excel-writer';
import { asTable } from './helpers';

const cols: ColumnDef[] = [
  { key: 'ma_nv', type: 'string', title: 'Mã NV' },
  { key: 'cong', type: 'decimal', title: 'Công' },
  { key: 'luong', type: 'decimal', title: 'Lương', numFmt: '#,##0' },
  { key: 'n', type: 'integer' },
  { key: 'ngay', type: 'date', title: 'Ngày' },
  { key: 'luc', type: 'datetime', title: 'Lúc' },
  { key: 'ok', type: 'boolean', title: 'Đạt' },
];

function sample(): Table {
  return asTable({
    columns: cols,
    rows: [
      {
        ma_nv: '=HYPERLINK("x")',
        cong: new Big('-0.5'),
        luong: new Big('15000000'),
        n: 3,
        ngay: '2026-09-01',
        luc: '2026-09-01T08:30:00',
        ok: true,
      },
      {
        ma_nv: 'NV\u0001 & <b>"q"\'',
        cong: null,
        luong: null,
        n: null,
        ngay: null,
        luc: null,
        ok: false,
      },
      {
        ma_nv: '  Nguyễn Văn Ánh  ',
        cong: new Big('12345678901234567890.1234567891'),
        luong: new Big('0.0000001'),
        n: -42,
        ngay: '1900-01-15',
        luc: null,
        ok: null,
      },
    ],
  });
}

async function both(sheets: { name: string; table: Table }[]) {
  const a = await writeWorkbook(sheets, { streaming: false });
  const b = await writeWorkbook(sheets, { streaming: true });
  return [a, b] as const;
}

function sheetJsView(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { type: 'array', cellNF: true, cellFormula: true });
  return {
    names: wb.SheetNames,
    sheets: wb.SheetNames.map((n) => {
      const ws = wb.Sheets[n]!;
      const cells: Record<string, unknown> = {};
      for (const [k, c] of Object.entries(ws)) {
        if (k.startsWith('!')) continue;
        const cell = c as XLSX.CellObject;
        cells[k] = { t: cell.t, v: cell.v, z: cell.t === 'n' ? cell.z : undefined, f: cell.f };
      }
      return {
        ref: ws['!ref'],
        filter: ws['!autofilter'],
        widths: (ws['!cols'] ?? []).map((c) => c?.width),
        cells,
      };
    }),
  };
}

async function excelJsView(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => ({
    name: ws.name,
    frozen: ws.views[0],
    bold: ws.getRow(1).getCell(1).font?.bold ?? false,
    rows: ws.actualRowCount,
  }));
}

describe('streaming writer = ExcelJS writer', () => {
  it('values, formats, header, filter, widths, sheet names', async () => {
    const sheets = [
      { name: 'Lệch', table: sample() },
      { name: 'LỆCH', table: sample() },
      { name: "a/b:c?d*e[f]g'", table: asTable({ columns: [], rows: [] }) },
      { name: 'Trống', table: asTable({ columns: cols, rows: [] }) },
    ];
    const [a, b] = await both(sheets);
    expect(sheetJsView(b)).toEqual(sheetJsView(a));
    const [ea, eb] = [await excelJsView(a), await excelJsView(b)];
    expect(eb.map((s) => [s.name, s.bold, s.rows])).toEqual(
      ea.map((s) => [s.name, s.bold, s.rows]),
    );
    for (const s of eb) expect(s.frozen).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('is used automatically for large outputs and stays readable', async () => {
    const rows = Array.from({ length: 70_000 }, (_, i) => ({
      ma_nv: `NV${i}`,
      cong: new Big(i).div(4),
      luong: new Big(i * 1000),
      n: i,
      ngay: '2026-01-31',
      luc: null,
      ok: i % 2 === 0,
    }));
    const table = asTable({ columns: cols, rows });
    const bytes = await writeWorkbook([{ name: 'Lớn', table }], { streamingAbove: 400_000 });
    const wb = XLSX.read(bytes, { type: 'array', cellNF: true });
    const ws = wb.Sheets['Lớn']!;
    expect(ws['!ref']).toBe('A1:G70001');
    expect(ws.A70001).toMatchObject({ t: 's', v: 'NV69999' });
    expect(ws.B70001).toMatchObject({ t: 'n', v: 17499.75, z: '#,##0.00' });
    // Written by the streaming writer (inline strings, no shared strings part).
    const cfbRead = (
      XLSX.CFB as unknown as { read(d: Uint8Array, o: object): { FullPaths: string[] } }
    ).read;
    const cfb = cfbRead(bytes, { type: 'array' });
    expect(cfb.FullPaths.some((p) => /sharedStrings/i.test(p))).toBe(false);
  });
});
