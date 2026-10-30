/**
 * AC-B4-90 (HANDOFF §4 #1): zip-bomb guard of the streaming .xlsx reader. An entry that inflates
 * past 2 GiB, or past 200 × its compressed size (above 16 MiB), is refused early with
 * `validation.fileTooLarge` on that file; the inflate stops as soon as the limit is passed, even
 * when the declared size lies. Fake data only; files are built in memory.
 */
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readSlot, readSlotAsync, type SourceFile } from '../io/excel-reader';
import { MAX_ENTRY_BYTES, MAX_RATIO, RATIO_FLOOR_BYTES } from '../io/xlsx-stream';
import { slot, xlsxFile } from './helpers';

const enc = new TextEncoder();

interface Entry {
  name: string;
  data: Uint8Array;
  /** Override the uncompressed size written in the headers (a lying file). */
  declaredSize?: number;
  /** Raw deflate stream to store instead of deflating `data`. */
  compressed?: Uint8Array;
}

/** Minimal ZIP writer (deflate), enough for the reader under test. */
function zip(entries: Entry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const comp = e.compressed ?? new Uint8Array(deflateRawSync(e.data));
    const size = e.declaredSize ?? e.data.length;
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, comp.length, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, comp);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, comp.length, true);
    cd.setUint32(24, size, true);
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

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function base(sheet: Omit<Entry, 'name'>): SourceFile {
  const text = (name: string, s: string): Entry => ({ name, data: enc.encode(s) });
  const data = zip([
    text(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    text(
      '_rels/.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    text(
      'xl/workbook.xml',
      `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${R}"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    text(
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    { name: 'xl/worksheets/sheet1.xml', ...sheet },
  ]);
  return { name: 'bom.xlsx', data };
}

/** Sheet XML with a header cell then `padding` bytes of whitespace (compresses ~1:1000). */
function bombSheet(padding: number): Uint8Array {
  const head = enc.encode(
    `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Mã NV</t></is></c></row>`,
  );
  const tail = enc.encode('</sheetData></worksheet>');
  const out = new Uint8Array(head.length + padding + tail.length);
  out.set(head);
  out.fill(32, head.length, head.length + padding);
  out.set(tail, head.length + padding);
  return out;
}

const S = slot({
  multiple: { enabled: true, minFiles: 1, maxFiles: 5 },
  columns: [{ key: 'ma_nv', label: 'Mã NV', aliases: ['Mã NV'], type: 'string' }],
});

function issueKeys(r: { report: { issues: { messageKey: string; file?: string }[] } }) {
  return r.report.issues.map((i) => [i.messageKey, i.file]);
}

describe('zip-bomb guard (AC-B4-90)', () => {
  it('limits are 2 GiB per entry and 1:200 above 16 MiB (MEMORY 2026-10-30 17:32)', () => {
    expect(MAX_ENTRY_BYTES).toBe(2 * 1024 ** 3);
    expect(MAX_RATIO).toBe(200);
    expect(RATIO_FLOOR_BYTES).toBe(16 * 1024 ** 2);
  });

  it('a highly compressed sheet (ratio > 1:200, > 16 MiB) → "File quá lớn để xử lý" on that file', async () => {
    const sheet = bombSheet(40 * 1024 * 1024);
    const f = base({ data: sheet });
    expect(f.data.byteLength * MAX_RATIO).toBeLessThan(sheet.length);
    const r = await readSlotAsync(S, [f, xlsxFile('ok.xlsx', { S1: [['Mã NV'], ['NV001']] })]);
    expect(issueKeys(r)).toEqual([['validation.fileTooLarge', 'bom.xlsx']]);
    expect(r.table.rowCount).toBe(1);
    expect(issueKeys(readSlot(S, [f]))).toEqual([['validation.fileTooLarge', 'bom.xlsx']]);
  });

  it('a lying declared size is caught while inflating, which stops early', async () => {
    const sheet = bombSheet(40 * 1024 * 1024);
    const f = base({ data: sheet, declaredSize: 1000 });
    // The worker reads in chunks: stopped at the 16 MiB limit, in linear time.
    const t0 = performance.now();
    expect(issueKeys(await readSlotAsync(S, [f]))).toEqual([
      ['validation.fileTooLarge', 'bom.xlsx'],
    ]);
    expect(performance.now() - t0).toBeLessThan(5000);
    // The synchronous path (fflate, 4 KiB steps) stops past the declared size: memory stays
    // bounded (each step produces at most ~4 MiB).
    const before = process.memoryUsage().arrayBuffers;
    expect(() => readSlot(S, [f])).not.toThrow();
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(16 * 1024 * 1024);
  });

  it('an entry declared above 2 GiB is refused before inflating (nothing allocated)', async () => {
    // 3 GiB of zeros is never produced: the deflate stream is a small stand-in.
    const f = base({
      data: bombSheet(0),
      declaredSize: 3 * 1024 ** 3,
      compressed: new Uint8Array(deflateRawSync(new Uint8Array(1024 * 1024))),
    });
    const before = process.memoryUsage().arrayBuffers;
    const r = await readSlotAsync(S, [f]);
    expect(issueKeys(r)).toEqual([['validation.fileTooLarge', 'bom.xlsx']]);
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(64 * 1024 * 1024);
  });

  it('ZIP64 size markers are refused too', async () => {
    const f = base({ data: bombSheet(0), declaredSize: 0xffffffff });
    expect(issueKeys(await readSlotAsync(S, [f]))).toEqual([
      ['validation.fileTooLarge', 'bom.xlsx'],
    ]);
  });

  it('a normal sheet that compresses well but stays under the floor still reads', async () => {
    const f = base({ data: bombSheet(8 * 1024 * 1024) });
    const r = await readSlotAsync(S, [f]);
    expect(r.report.errorCount).toBe(0);
  });
});
