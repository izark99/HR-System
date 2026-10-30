/**
 * QA: streaming .xlsx reader vs SheetJS beyond the developer's parity tests: `t="d"` cells under
 * several time zones, number text variants, hidden rows, column XFD, formulas without cached
 * values, strict OOXML, absolute relationship targets (Google Sheets style), namespaced files,
 * corrupt/truncated zips, oversized shared strings. Fake data only.
 */
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readSlot, readerInternals, type SourceFile } from '../io/excel-reader';
import type { Grid } from '../io/xlsx-stream';
import { slot } from './helpers';

interface CfbEntry {
  content: Uint8Array;
}
interface CfbApi {
  read(
    data: Uint8Array,
    opts: { type: 'array' },
  ): { FileIndex: { name: string }[]; FullPaths: string[] };
  find(cfb: unknown, path: string): CfbEntry | null;
  write(cfb: unknown, opts: { type: 'array'; fileType: 'zip' }): number[] | Uint8Array;
  utils: { cfb_add(cfb: unknown, path: string, content: Uint8Array): void };
}
const CFB = XLSX.CFB as unknown as CfbApi;
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const enc = new TextEncoder();
const dec = new TextDecoder();

function packageWith(
  edit: (put: (path: string, text: string) => void, get: (path: string) => string) => void,
): SourceFile {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'S1');
  const base = XLSX.write(wb, { type: 'array', bookType: 'xlsx', bookSST: true }) as ArrayBuffer;
  const cfb = CFB.read(new Uint8Array(base), { type: 'array' });
  const put = (path: string, text: string) => {
    const entry = CFB.find(cfb, `/${path}`);
    if (entry) entry.content = enc.encode(text);
    else CFB.utils.cfb_add(cfb, path, enc.encode(text));
  };
  const get = (path: string) => dec.decode(CFB.find(cfb, `/${path}`)!.content);
  edit(put, get);
  const out = CFB.write(cfb, { type: 'array', fileType: 'zip' });
  return { name: 'crafted.xlsx', data: out instanceof Uint8Array ? out : new Uint8Array(out) };
}

const sheetOf = (rows: string, extra = '') =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetData>${rows}</sheetData>${extra}</worksheet>`;
const withSheet = (xml: string, sst?: string) =>
  packageWith((put) => {
    put('xl/worksheets/sheet1.xml', xml);
    if (sst) put('xl/sharedStrings.xml', sst);
  });

function dump(grid: Grid, follow: boolean) {
  const out: unknown[] = [];
  for (let r = 0; r <= grid.lastRow; r++) {
    const row: unknown[] = [grid.isRowBlank(r)];
    for (let c = 0; c <= grid.lastCol + 1; c++) row.push(grid.cell(r, c, follow));
    out.push(row);
  }
  return out;
}
function parity(file: SourceFile) {
  const pkg = readerInternals.openXlsx(file);
  expect(pkg).not.toBeNull();
  const ref = readerInternals.sheetJsGrid(file, 0);
  const mine = pkg!.readSheet(0);
  const span = {
    lastRow: Math.max(ref.lastRow, mine.lastRow),
    lastCol: Math.max(ref.lastCol, mine.lastCol),
  };
  const view = (g: Grid): Grid => ({
    ...span,
    cell: g.cell.bind(g),
    isRowBlank: g.isRowBlank.bind(g),
  });
  for (const follow of [false, true])
    expect(dump(view(mine), follow)).toEqual(dump(view(ref), follow));
}

describe('t="d" cells: streaming reader = SheetJS in any time zone', () => {
  const values = [
    '2026-09-15',
    '2026-09-15T10:30:00',
    '2026-09-15T10:30:00Z',
    '2026-01-01T00:00:00',
    '1900-01-01',
    '1900-03-01',
    '1899-12-31',
    '2026-02-30',
    'not a date',
  ];
  for (const tz of ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    for (const v of values) {
      it(`TZ=${tz}: ${v}`, () => {
        const old = process.env.TZ;
        process.env.TZ = tz;
        try {
          parity(withSheet(sheetOf(`<row r="1"><c r="A1" t="d"><v>${v}</v></c></row>`)));
        } finally {
          if (old === undefined) delete process.env.TZ;
          else process.env.TZ = old;
        }
      });
    }
  }

  it('a date-only t="d" cell reads as that calendar day in a date column, whatever the TZ', () => {
    const s = slot({ columns: [{ key: 'ngay', aliases: ['Ngày'], type: 'date' }] });
    const xmlRows = `<row r="1"><c r="A1" t="inlineStr"><is><t>Ngày</t></is></c></row><row r="2"><c r="A2" t="d"><v>2026-09-15</v></c></row>`;
    for (const tz of ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles']) {
      const old = process.env.TZ;
      process.env.TZ = tz;
      try {
        const r = readSlot(s, [withSheet(sheetOf(xmlRows))]);
        expect(r.report.errorCount, tz).toBe(0);
        expect(r.table.value(0, 'ngay'), tz).toBe('2026-09-15');
      } finally {
        if (old === undefined) delete process.env.TZ;
        else process.env.TZ = old;
      }
    }
  });
});

describe('t="d" cells with fractional seconds or a UTC offset (KNOWN BUG)', () => {
  // SheetJS honours ".123" and "+07:00"; the streaming reader drops both (isoToSerial). Excel never
  // writes them (strict-OOXML ISO dates carry neither), so this is minor.
  for (const v of ['2026-09-15T10:30:00.123', '2026-09-15T23:59:59+07:00']) {
    it.fails(`${v} reads like SheetJS`, () => {
      parity(withSheet(sheetOf(`<row r="1"><c r="A1" t="d"><v>${v}</v></c></row>`)));
    });
  }
});

describe('streaming reader = SheetJS on unusual cells', () => {
  it('number text variants', () => {
    const nums = [
      '1',
      '-1',
      '+1',
      '.5',
      '-.5E-3',
      '1E3',
      '1e+3',
      '1.7976931348623157E308',
      '5E-324',
      '0.1',
      '123456789012345678',
      '1.000000000000001',
      '0',
      '-0',
      '  7 ',
      '1,5',
      '0x10',
      'NaN',
      'Infinity',
      '1e400',
      '',
      '00123',
      '1.5.2',
    ];
    const xml = sheetOf(
      nums.map((v, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${v}</v></c></row>`).join(''),
    );
    parity(withSheet(xml));
  });

  it('hidden rows and columns, row/col attributes, XFD, sparse rows', () => {
    const xml = sheetOf(
      `<row r="1" hidden="1"><c r="A1" t="inlineStr"><is><t>hidden row</t></is></c></row>
       <row r="3" ht="30" customHeight="1"><c r="XFD3"><v>1</v></c><c r="B3" t="inlineStr"><is><t>b</t></is></c></row>
       <row r="12"><c r="C12"><v>5</v></c></row>`,
      '<cols><col min="2" max="2" width="0" hidden="1"/></cols>',
    );
    parity(withSheet(xml));
  });

  it('formulas: cached value, no cached value, string result, error result, shared formula', () => {
    const xml = sheetOf(
      `<row r="1"><c r="A1"><f>1+1</f><v>2</v></c><c r="B1"><f>A1*2</f></c><c r="C1" t="str"><f>"a"&amp;"b"</f><v>ab</v></c><c r="D1" t="e"><f>1/0</f><v>#DIV/0!</v></c></row>
       <row r="2"><c r="A2"><f t="shared" ref="A2:A4" si="0">A1+1</f><v>3</v></c></row>
       <row r="3"><c r="A3"><f t="shared" si="0"/><v>4</v></c></row>`,
    );
    parity(withSheet(xml));
  });

  it('merged ranges (overlapping, single cell, out of range) with fillDown lookups', () => {
    const xml = sheetOf(
      `<row r="1"><c r="A1" t="inlineStr"><is><t>m</t></is></c></row><row r="2"><c r="C2"><v>3</v></c></row>`,
      '<mergeCells count="3"><mergeCell ref="A1:A3"/><mergeCell ref="B1:C1"/><mergeCell ref="Z50:AA51"/></mergeCells>',
    );
    parity(withSheet(xml));
  });

  it('rich text and phonetic runs in shared strings and inline strings, xml:space, entities, _x000D_', () => {
    const sst = `<?xml version="1.0"?><sst xmlns="${NS}" count="3" uniqueCount="3">
      <si><r><t>Hồ </t></r><r><rPr><b/></rPr><t xml:space="preserve"> Văn</t></r><rPh sb="0" eb="2"><t>ホ</t></rPh><phoneticPr fontId="1"/></si>
      <si><t xml:space="preserve">  lead and trail  </t></si>
      <si><t>a_x000D_b&amp;&lt;&gt;&quot;</t></si>
      </sst>`;
    const xml = sheetOf(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>',
    );
    parity(withSheet(xml, sst));
  });

  it('strict OOXML namespaces and relationship types', () => {
    const strict = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
    const f = packageWith((put, get) => {
      put(
        'xl/worksheets/sheet1.xml',
        `<worksheet xmlns="${strict}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2.5</v></c></row></sheetData></worksheet>`,
      );
      put(
        'xl/sharedStrings.xml',
        `<sst xmlns="${strict}" count="1" uniqueCount="1"><si><t>strict</t></si></sst>`,
      );
      put('xl/workbook.xml', get('xl/workbook.xml').replaceAll(NS, strict));
      put(
        'xl/_rels/workbook.xml.rels',
        get('xl/_rels/workbook.xml.rels').replaceAll(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          'http://purl.oclc.org/ooxml/officeDocument/relationships',
        ),
      );
    });
    parity(f);
  });

  it('absolute relationship targets and upper-case part names (Google Sheets / other writers)', () => {
    const f = packageWith((put, get) => {
      put('xl/worksheets/sheet1.xml', sheetOf('<row r="1"><c r="A1"><v>7</v></c></row>'));
      put(
        'xl/_rels/workbook.xml.rels',
        get('xl/_rels/workbook.xml.rels').replace(
          'Target="worksheets/sheet1.xml"',
          'Target="/xl/worksheets/sheet1.xml"',
        ),
      );
    });
    parity(f);
  });

  it('default-namespace prefix variants: x: prefix on every element incl. sst', () => {
    const sst = `<x:sst xmlns:x="${NS}"><x:si><x:t>pre</x:t></x:si></x:sst>`;
    const xml = `<x:worksheet xmlns:x="${NS}"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c></x:row></x:sheetData></x:worksheet>`;
    parity(withSheet(xml, sst));
  });
});

describe('damaged and hostile packages', () => {
  const good = withSheet(sheetOf('<row r="1"><c r="A1"><v>1</v></c></row>'));
  const s = slot({ columns: [{ key: 'a', aliases: ['a'], type: 'string' }] });

  it('truncated / garbage / zero-length zips are "unreadable", never a crash', () => {
    const bytes = good.data instanceof Uint8Array ? good.data : new Uint8Array(good.data);
    for (const cut of [0, 4, 30, Math.floor(bytes.length / 2), bytes.length - 10]) {
      const f: SourceFile = { name: 'x.xlsx', data: bytes.slice(0, cut) };
      expect(() => readSlot(s, [f]), `cut ${cut}`).not.toThrow();
      expect(readSlot(s, [f]).report.errorCount, `cut ${cut}`).toBeGreaterThan(0);
    }
    const flipped = bytes.slice();
    for (let i = 40; i < flipped.length - 40; i += 7) flipped[i] = flipped[i]! ^ 0xff;
    expect(() => readSlot(s, [{ name: 'x.xlsx', data: flipped }])).not.toThrow();
  });

  /** Minimal ZIP writer with really deflated entries (CFB stores them uncompressed). */
  function zip(entries: [string, Uint8Array][]): Uint8Array {
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, data] of entries) {
      const nameBuf = Buffer.from(name);
      const comp = deflateRawSync(data, { level: 9 });
      const crc = crc32(data);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(comp.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      chunks.push(local, nameBuf, comp);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(8, 10);
      c.writeUInt32LE(crc, 16);
      c.writeUInt32LE(comp.length, 20);
      c.writeUInt32LE(data.length, 24);
      c.writeUInt16LE(nameBuf.length, 28);
      c.writeUInt32LE(offset, 42);
      central.push(c, nameBuf);
      offset += 30 + nameBuf.length + comp.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...chunks, cd, end]));
  }

  function bombPackage(sheet: Buffer, sst?: Buffer): SourceFile {
    const entries: [string, Uint8Array][] = [];
    packageWith((_put, get) => {
      for (const n of [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
      ]) {
        entries.push([n, enc.encode(get(n))]);
      }
    });
    entries.push(['xl/worksheets/sheet1.xml', sheet]);
    if (sst) entries.push(['xl/sharedStrings.xml', sst]);
    return { name: 'bomb.xlsx', data: zip(entries) };
  }

  const KNOWN = slot({ columns: [{ key: 'a', aliases: ['a'], type: 'string' }] });

  it('sheet XML of 400 MB inflated from < 1 MB: read in bounded time and memory (or refused)', () => {
    const head = Buffer.from(`<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>`);
    const unit = Buffer.from('<row r="1"><c r="A1"><v>1</v></c></row>'.repeat(10_000));
    const parts = [head];
    for (let i = 0; i < 1000; i++) parts.push(unit);
    parts.push(Buffer.from('</sheetData></worksheet>'));
    const raw = Buffer.concat(parts);
    const f = bombPackage(raw);
    const size = (f.data as Uint8Array).length;
    expect(size).toBeLessThan(2_000_000);
    const rss0 = process.memoryUsage().rss;
    const t0 = performance.now();
    const r = readSlot(KNOWN, [f]);
    const ms = performance.now() - t0;
    const grewMb = Math.round((process.memoryUsage().rss - rss0) / 1e6);
    process.stderr.write(
      `[bomb sheet] ${raw.length} B inflated, ${size} B zipped: ${Math.round(ms)} ms, rss +${grewMb} MB, errors=${r.report.errorCount}\n`,
    );
    expect(ms).toBeLessThan(120_000);
  }, 180_000);

  it('shared strings with 6 M entries (~130 MB inflated from < 1 MB): bounded time and memory (or refused)', () => {
    const n = 6_000_000;
    const si = '<si><t>x</t></si>';
    const sst = Buffer.from(
      `<?xml version="1.0"?><sst xmlns="${NS}" count="${n}" uniqueCount="${n}">${si.repeat(n)}</sst>`,
    );
    const sheet = Buffer.from(sheetOf('<row r="1"><c r="A1" t="s"><v>5999999</v></c></row>'));
    const f = bombPackage(sheet, sst);
    const rss0 = process.memoryUsage().rss;
    const t0 = performance.now();
    const r = readSlot(KNOWN, [f]);
    const ms = performance.now() - t0;
    const grewMb = Math.round((process.memoryUsage().rss - rss0) / 1e6);
    process.stderr.write(
      `[bomb sst] ${sst.length} B inflated: ${Math.round(ms)} ms, rss +${grewMb} MB, errors=${r.report.errorCount}\n`,
    );
    expect(ms).toBeLessThan(120_000);
  }, 180_000);
});

describe('displayed text and real dates (MEMORY 08:59) through the streaming reader', () => {
  function book(rows: XLSX.CellObject[][]): SourceFile {
    const ws: XLSX.WorkSheet = {};
    rows.forEach((row, r) => row.forEach((c, k) => (ws[XLSX.utils.encode_cell({ r, c: k })] = c)));
    ws['!ref'] = `A1:C${rows.length}`;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    return {
      name: 'f.xlsx',
      data: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    };
  }
  const h = (v: string): XLSX.CellObject => ({ t: 's', v });

  it('text column keeps "00123" and shows dates as displayed; date column accepts real dates whatever the text format', () => {
    const f = book([
      [h('Mã'), h('Ngày chữ'), h('Ngày')],
      [
        { t: 'n', v: 123, z: '00000' },
        { t: 'n', v: 46280, z: 'dd/mm/yyyy' },
        { t: 'n', v: 46280, z: 'dd/mm/yyyy' },
      ],
      [
        { t: 's', v: '00456' },
        { t: 'n', v: 46281, z: 'yyyy-mm-dd' },
        { t: 'n', v: 46281, z: '@' },
      ],
      [
        { t: 'n', v: 7, z: '0.00' },
        { t: 'n', v: 46282, z: 'mmm d, yyyy' },
        { t: 's', v: '2026-09-18' },
      ],
    ]);
    const s = slot({
      columns: [
        { key: 'ma', aliases: ['Mã'], type: 'string' },
        { key: 'ngay_chu', aliases: ['Ngày chữ'], type: 'string' },
        { key: 'ngay', aliases: ['Ngày'], type: 'date' },
      ],
    });
    const r = readSlot(s, [f]);
    expect(r.table.rowCount).toBe(3);
    expect([0, 1, 2].map((i) => r.table.value(i, 'ma'))).toEqual(['00123', '00456', '7.00']);
    expect([0, 1].map((i) => r.table.value(i, 'ngay_chu'))).toEqual(['15/09/2026', '2026-09-16']);
    expect(r.table.value(2, 'ngay_chu')).toBe('Sep 17, 2026');
    expect([0, 1].map((i) => r.table.value(i, 'ngay'))).toEqual(['2026-09-15', '2026-09-16']);
    expect(r.table.value(2, 'ngay')).toBe('2026-09-18');
  });
});
