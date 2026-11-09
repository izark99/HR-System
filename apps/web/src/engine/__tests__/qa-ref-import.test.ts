/**
 * Verifier checks of the reference table import (spec §34 AC-RT-03, round 1), independent of the
 * developer's tests: zip-bomb guard through `readRefImport`, legacy .xls, Excel date serials,
 * floating-point cells kept as exact decimals, values typed as the database CHECK expects
 * (integer → JSON number, decimal → canonical text, date → yyyy-mm-dd), header row offset and
 * duplicate header columns. Fake reference data only; files built in memory.
 */
import { crc32, deflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { readRefImport, type RefImportColumn } from '../io/ref-import';
import { xlsxFile } from './helpers';

const COLS: RefImportColumn[] = [
  { key: 'ma_cn', title: 'Mã chi nhánh', type: 'string', aliases: ['Mã CN'], isKey: true },
  { key: 'vung', title: 'Vùng', type: 'integer', aliases: [], isKey: false },
  { key: 'he_so', title: 'Hệ số', type: 'decimal', aliases: [], isKey: false },
  { key: 'tu_ngay', title: 'Từ ngày', type: 'date', aliases: [], isKey: false },
  { key: 'hoat_dong', title: 'Hoạt động', type: 'boolean', aliases: [], isKey: false },
];
const HEAD = ['Mã CN', 'Vùng', 'Hệ số', 'Từ ngày', 'Hoạt động'];

/** Database CHECK of `private.assert_ref_rows` (migration 20261109150000), per type. */
const DB_VALUE: Record<RefImportColumn['type'], (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  integer: (v) => typeof v === 'number' && /^-?[0-9]{1,16}$/.test(String(v)),
  decimal: (v) => typeof v === 'string' && /^-?[0-9]{1,28}(\.[0-9]{1,10})?$/.test(v),
  date: (v) => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v),
  boolean: (v) => typeof v === 'boolean',
};

function fitsDatabase(rows: Record<string, unknown>[]): boolean {
  return rows.every((r) =>
    Object.entries(r).every(([k, v]) => {
      const c = COLS.find((x) => x.key === k);
      return c !== undefined && DB_VALUE[c.type](v);
    }),
  );
}

const enc = new TextEncoder();

/** Minimal deflate ZIP writer (same layout as xlsx-bomb.test.ts). */
function zip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const comp = new Uint8Array(deflateRawSync(e.data));
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, comp.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, comp);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, comp.length, true);
    cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + comp.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

function bombXlsx(padding: number) {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const text = (name: string, s: string) => ({ name, data: enc.encode(s) });
  const head = enc.encode(
    `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Mã CN</t></is></c></row>`,
  );
  const tail = enc.encode('</sheetData></worksheet>');
  const sheet = new Uint8Array(head.length + padding + tail.length);
  sheet.set(head);
  sheet.fill(32, head.length, head.length + padding);
  sheet.set(tail, head.length + padding);
  return {
    name: 'bom.xlsx',
    data: zip([
      text(
        '[Content_Types].xml',
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
      ),
      text(
        '_rels/.rels',
        `<?xml version="1.0"?><Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
      text(
        'xl/workbook.xml',
        `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${R}"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      text(
        'xl/_rels/workbook.xml.rels',
        `<?xml version="1.0"?><Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]),
  };
}

describe('QA: reference table import (AC-RT-03)', () => {
  it('a zip bomb is refused as "file too large", nothing to save', () => {
    const r = readRefImport(bombXlsx(40 * 1024 * 1024), COLS, 50_000);
    expect(r.report.issues.map((i) => i.messageKey)).toContain('validation.fileTooLarge');
    expect(r.report.errorCount).toBeGreaterThan(0);
    expect(r.rows).toBeNull();
  });

  it('reads a legacy .xls (BIFF8) file like an .xlsx', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([HEAD, ['CN01', 1, 1.5, null, true]]),
      'DanhMuc',
    );
    const data = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer;
    const r = readRefImport({ name: 'dm.xls', data }, COLS, 50_000);
    expect(r.report.errorCount).toBe(0);
    expect(r.rows).toEqual([{ ma_cn: 'CN01', vung: 1, he_so: '1.5', hoat_dong: true }]);
  });

  it('Excel date cells, float cells and booleans become the values the database accepts', () => {
    const file = xlsxFile('dm.xlsx', {
      S: [
        HEAD,
        ['CN01', 3, 0.1 + 0.2, new Date(Date.UTC(2026, 0, 31)) as unknown as string, false],
        ['CN02', '4', 1234567.891, 46022, 'TRUE'],
        [123, -2, -0.000_000_1, '31/12/2026', 1],
      ],
    });
    const r = readRefImport(file, COLS, 50_000);
    expect(r.report.errorCount).toBe(0);
    expect(r.rows).not.toBeNull();
    const rows = r.rows!;
    // No binary floating-point artefacts (0.30000000000000004).
    expect(rows[0]!.he_so).toBe('0.3');
    expect(rows[1]!.he_so).toBe('1234567.891');
    expect(rows[2]!.he_so).toBe('-0.0000001');
    expect(rows[0]!.tu_ngay).toBe('2026-01-31');
    expect(rows[2]!.tu_ngay).toBe('2026-12-31');
    // A numeric key cell is kept as the text Excel shows.
    expect(rows[2]!.ma_cn).toBe('123');
    expect(rows[1]!.vung).toBe(4);
    expect(fitsDatabase(rows)).toBe(true);
  });

  it('decimals the database cannot keep are errors, not silently rounded', () => {
    const file = xlsxFile('dm.xlsx', {
      S: [HEAD, ['CN01', 1, '0.12345678901', null, null]],
    });
    const r = readRefImport(file, COLS, 50_000);
    expect(r.report.errorCount).toBeGreaterThan(0);
    expect(r.rows).toBeNull();
  });

  it('two file columns matching the same table column is an error', () => {
    const file = xlsxFile('dm.xlsx', {
      S: [
        ['Mã CN', 'Mã chi nhánh', 'Vùng', 'Hệ số', 'Từ ngày', 'Hoạt động'],
        ['CN01', 'CN09', 1, null, null, null],
      ],
    });
    const r = readRefImport(file, COLS, 50_000);
    expect(r.report.errorCount).toBeGreaterThan(0);
    expect(r.rows).toBeNull();
  });

  it('an empty sheet (header only) saves nothing but is not an error', () => {
    const r = readRefImport(xlsxFile('dm.xlsx', { S: [HEAD] }), COLS, 50_000);
    expect(r.report.errorCount).toBe(0);
    expect(r.rows).toEqual([]);
  });

  it('exactly the row limit is accepted, one more is refused', () => {
    const rows = (n: number) => [HEAD, ...Array.from({ length: n }, (_, i) => [`CN${i}`])];
    expect(readRefImport(xlsxFile('a.xlsx', { S: rows(20) }), COLS, 20).rows).toHaveLength(20);
    const over = readRefImport(xlsxFile('b.xlsx', { S: rows(21) }), COLS, 20);
    expect(over.rows).toBeNull();
    expect(over.report.issues.map((i) => i.messageKey)).toContain('refTables:import.tooManyRows');
  });
});
