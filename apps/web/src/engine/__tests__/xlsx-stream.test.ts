/**
 * Streaming .xlsx reader (io/xlsx-stream.ts) vs SheetJS: the compact grid must expose exactly the
 * cells the SheetJS-based grid exposes (values, errors, number formats, merges, blank rows), for
 * the acceptance fixtures, workbooks written by SheetJS and ExcelJS, and hand-written sheet XML
 * with unusual constructs; whatever the chunk boundaries. Fake data only.
 */
import ExcelJS from 'exceljs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readerInternals, readSlot, readSlotAsync, type SourceFile } from '../io/excel-reader';
import type { Grid } from '../io/xlsx-stream';
import { slot, xlsxFile } from './helpers';
import { FIXTURES } from './qa-helpers';

function dump(grid: Grid, follow: boolean) {
  const out: unknown[] = [];
  for (let r = 0; r <= grid.lastRow; r++) {
    const row: unknown[] = [grid.isRowBlank(r)];
    for (let c = 0; c <= grid.lastCol + 1; c++) row.push(grid.cell(r, c, follow));
    out.push(row);
  }
  return out;
}

/** Cells of every sheet, from both readers; also through the async reader in tiny chunks. */
async function expectParity(file: SourceFile) {
  const pkg = readerInternals.openXlsx(file);
  expect(pkg).not.toBeNull();
  for (let i = 0; i < pkg!.sheetNames.length; i++) {
    const ref = readerInternals.sheetJsGrid(file, i);
    const mine = pkg!.readSheet(i);
    // SheetJS's range may extend over trailing empty rows: compare the common span.
    const rows = Math.max(ref.lastRow, mine.lastRow);
    const span = { lastRow: rows, lastCol: Math.max(ref.lastCol, mine.lastCol) };
    const view = (g: Grid): Grid => ({
      ...span,
      cell: g.cell.bind(g),
      isRowBlank: g.isRowBlank.bind(g),
    });
    for (const follow of [false, true]) {
      expect(dump(view(mine), follow)).toEqual(dump(view(ref), follow));
    }
    for (const chunk of [1, 7, 64]) {
      const chunked = await pkg!.readSheetAsync(i, chunk);
      expect(dump(view(chunked), true)).toEqual(dump(view(ref), true));
    }
  }
}

/** Replace the first sheet's XML (and optionally the shared strings) of a SheetJS workbook. */
function withSheetXml(sheetXml: string, sst?: string, workbookPr?: string): SourceFile {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'S1');
  const base = XLSX.write(wb, { type: 'array', bookType: 'xlsx', bookSST: true }) as ArrayBuffer;
  const cfb = CFB.read(new Uint8Array(base), { type: 'array' });
  const enc = new TextEncoder();
  const put = (path: string, text: string) => {
    const entry = CFB.find(cfb, `/${path}`);
    if (entry) entry.content = enc.encode(text);
    else CFB.utils.cfb_add(cfb, path, enc.encode(text));
  };
  put('xl/worksheets/sheet1.xml', sheetXml);
  if (sst) put('xl/sharedStrings.xml', sst);
  if (workbookPr) {
    const entry = CFB.find(cfb, '/xl/workbook.xml')!;
    const xml = new TextDecoder().decode(entry.content);
    put(
      'xl/workbook.xml',
      xml.replace(/<workbookPr[^>]*\/>/, '').replace('<sheets>', workbookPr + '<sheets>'),
    );
  }
  const out = CFB.write(cfb, { type: 'array', fileType: 'zip' });
  return { name: 'crafted.xlsx', data: out instanceof Uint8Array ? out : new Uint8Array(out) };
}

interface CfbEntry {
  content: Uint8Array;
}
interface CfbApi {
  read(data: Uint8Array, opts: { type: 'array' }): unknown;
  find(cfb: unknown, path: string): CfbEntry | null;
  write(cfb: unknown, opts: { type: 'array'; fileType: 'zip' }): number[] | Uint8Array;
  utils: { cfb_add(cfb: unknown, path: string, content: Uint8Array): void };
}
const CFB = XLSX.CFB as unknown as CfbApi;

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

describe('streaming xlsx reader = SheetJS', () => {
  it('acceptance fixtures', async () => {
    for (const f of readdirSync(FIXTURES).filter((n) => n.endsWith('.xlsx'))) {
      await expectParity({ name: f, data: readFileSync(join(FIXTURES, f)) });
    }
  });

  it('SheetJS-written workbook: types, formats, merges, several sheets', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['BẢNG GIẢ', null, null],
      [],
      ['Mã', 'Tên', 'Số', 'Ngày', 'Cờ'],
      ['00123', 'Nguyễn Văn Á & <B>', 1.5, 46000, true],
      ['NV2', '  ', -0.000001, 46001.5, false],
      [null, 'line\r\nbreak', 1e21, null, null],
    ]);
    ws['!merges'] = [XLSX.utils.decode_range('A1:C1'), XLSX.utils.decode_range('A5:A6')];
    (ws.C4 as XLSX.CellObject).z = '#,##0.00';
    (ws.D4 as XLSX.CellObject).z = 'dd/mm/yyyy';
    (ws.D5 as XLSX.CellObject).z = 'm/d/yy h:mm';
    ws.A7 = { t: 'e', v: 7 };
    ws.B7 = { t: 'n', v: 123, z: '00000' };
    ws['!ref'] = 'A1:E7';
    XLSX.utils.book_append_sheet(wb, ws, 'Dữ liệu');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a'], [1]]), 'Khác');
    for (const bookSST of [false, true]) {
      const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx', bookSST }) as ArrayBuffer;
      await expectParity({ name: 'sheetjs.xlsx', data });
    }
  });

  it('ExcelJS-written workbook (shared strings, styles, dates, rich text)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(['Mã NV', 'Họ tên', 'Lương', 'Ngày vào', 'Ghi chú']);
    ws.addRow([
      'NV001',
      'Trần Thị Giả',
      15000000,
      new Date(Date.UTC(2020, 0, 15)),
      { richText: [{ text: 'Đậm ', font: { bold: true } }, { text: 'thường' }] },
    ]);
    ws.addRow([
      'NV002',
      null,
      26.25,
      new Date(Date.UTC(2021, 5, 1)),
      { formula: '1+1', result: 2 },
    ]);
    ws.addRow([]);
    ws.addRow(['NV003', 'Lê Giả', { formula: 'C2*2', result: 30000000 }, null, true]);
    ws.getCell('C2').numFmt = '#,##0';
    ws.getCell('D2').numFmt = 'dd/mm/yyyy';
    ws.getCell('D3').numFmt = 'dd/mm/yyyy';
    ws.mergeCells('E3:E4');
    const data = new Uint8Array(await wb.xlsx.writeBuffer());
    await expectParity({ name: 'exceljs.xlsx', data });
  });

  it('hand-written XML: prefixes, inline/str/bool/error/date cells, missing refs, entities', async () => {
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<x:dimension ref="A1:F9"/>
<x:sheetData>
<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t xml:space="preserve"> in &amp; line </x:t></x:is></x:c></x:row>
<x:row><x:c t="str"><x:v>a&amp;amp;b</x:v></x:c><x:c t="b"><x:v>1</x:v></x:c><x:c t="e"><x:v>#N/A</x:v></x:c><x:c t="e"><x:v>#SPILL!</x:v></x:c><x:c t="d"><x:v>2026-09-15</x:v></x:c></x:row>
<x:row r="4"/>
<x:row r="5" spans="1:3"><x:c r="A5"><x:v>1.25E-3</x:v></x:c><x:c r="B5"><x:f>A5*2</x:f><x:v>0.0025</x:v></x:c><x:c r="C5" t="s"><x:v>2</x:v></x:c><x:c r="D5"/><x:c r="E5" t="n"><x:v></x:v></x:c></x:row>
<x:row r="7"><x:c r="A7" t="inlineStr"><x:is><x:r><x:t>Rich </x:t></x:r><x:r><x:rPr><x:b/></x:rPr><x:t>text</x:t></x:r><x:rPh sb="0" eb="1"><x:t>phonetic</x:t></x:rPh></x:is></x:c><x:c r="B7" t="s"><x:v>3</x:v></x:c><x:c r="C7"><x:v>&#52;2</x:v></x:c></x:row>
<x:row r="9"><x:c r="F9" t="inlineStr"><x:is><x:t>_x0041_ &lt;tag&gt; &#x1EA0;</x:t></x:is></x:c></x:row>
</x:sheetData>
<x:mergeCells count="1"><x:mergeCell ref="C1:D2"/></x:mergeCells>
</x:worksheet>`;
    const sst = `<?xml version="1.0" encoding="UTF-8"?>
<sst ${NS} count="4" uniqueCount="4">
<si><t>Mã NV</t></si>
<si><r><t>Họ </t></r><r><rPr><b/></rPr><t>tên</t></r><rPh sb="0" eb="1"><t>ho</t></rPh></si>
<si><t>   </t></si>
<si><t/></si>
</sst>`;
    await expectParity(withSheetXml(sheet, sst));
    await expectParity(withSheetXml(sheet, sst, '<workbookPr date1904="1"/>'));
  });

  it('readSlot and readSlotAsync give the same result', async () => {
    const s = slot({
      columns: [
        { key: 'ma', aliases: ['Mã'], type: 'string', rules: [{ unique: true }] },
        { key: 'so', aliases: ['Số'], type: 'decimal', rules: [{ min: 0 }] },
        { key: 'ngay', aliases: ['Ngày'], type: 'date' },
      ],
    });
    const rows: (string | number | null)[][] = [['Mã', 'Số', 'Ngày']];
    for (let i = 0; i < 3000; i++)
      rows.push([`NV${i % 2900}`, i % 17 === 0 ? -1 : i / 4, 46000 + (i % 40)]);
    const f = xlsxFile('a.xlsx', { S: rows });
    const sync = readSlot(s, [f]);
    const async = await readSlotAsync(s, [f]);
    expect(async.report).toEqual(sync.report);
    expect(async.table.rows).toEqual(sync.table.rows);
    expect(sync.report.errorCount).toBeGreaterThan(0);
    expect(sync.table.rowCount).toBe(3000);
  });
});
