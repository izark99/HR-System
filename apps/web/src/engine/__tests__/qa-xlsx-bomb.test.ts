/**
 * QA (verifier) — AC-B4-90 zip-bomb guard, independent of the developer's tests. Fake data only;
 * every file is built in memory. The synchronous inflater (SheetJS `CFB.utils._inflateRaw`) is
 * spied on to read the size of what it actually produced (deterministic, unlike memory sampling).
 */
import { crc32, deflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSlot, readSlotAsync, type SourceFile } from '../io/excel-reader';
import { slot } from './helpers';

const enc = new TextEncoder();
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

interface Entry {
  name: string;
  data: Uint8Array;
  /** Uncompressed size written in both headers (a lying file). */
  declaredSize?: number;
  /** General-purpose flags of the central directory record only. */
  cdFlags?: number;
}

function zip(entries: Entry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const comp = new Uint8Array(deflateRawSync(e.data, { level: 9 }));
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
    cd.setUint16(8, e.cdFlags ?? 0, true);
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

const text = (name: string, s: string): Entry => ({ name, data: enc.encode(s) });
const ROOT_RELS = `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WB_RELS = `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const WB_HEAD = `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${R}"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets>`;
const SHEET = `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Mã NV</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>NV001</t></is></c></row></sheetData></worksheet>`;

/** `head` + `padding` spaces + `tail` (compresses ~1:1000). */
function padded(head: string, padding: number, tail: string): Uint8Array {
  const h = enc.encode(head);
  const t = enc.encode(tail);
  const out = new Uint8Array(h.length + padding + t.length);
  out.set(h);
  out.fill(32, h.length, h.length + padding);
  out.set(t, h.length + padding);
  return out;
}

const MiB = 1024 * 1024;
const S = slot({
  columns: [{ key: 'ma_nv', label: 'Mã NV', aliases: ['Mã NV'], type: 'string' }],
});
const keys = (r: { report: { issues: { messageKey: string }[] } }) =>
  r.report.issues.map((i) => i.messageKey);

const CFB = XLSX.CFB as unknown as {
  utils: { _inflateRaw(data: Uint8Array, size: number): ArrayLike<number> };
};

/** Spy on the synchronous inflater; returns the largest output it produced. */
function watchInflate(): () => number {
  let max = 0;
  const real = CFB.utils._inflateRaw.bind(CFB.utils);
  vi.spyOn(CFB.utils, '_inflateRaw').mockImplementation((data, size) => {
    const out = real(data, size);
    max = Math.max(max, out.length);
    return out;
  });
  return () => max;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QA zip bomb (AC-B4-90): regular files still read', () => {
  it('a normal small package reads without issues (sync and async)', async () => {
    const f: SourceFile = {
      name: 'ok.xlsx',
      data: zip([
        text('_rels/.rels', ROOT_RELS),
        text('xl/workbook.xml', `${WB_HEAD}</workbook>`),
        text('xl/_rels/workbook.xml.rels', WB_RELS),
        text('xl/worksheets/sheet1.xml', SHEET),
      ]),
    };
    expect(keys(await readSlotAsync(S, [f]))).toEqual([]);
    expect(keys(readSlot(S, [f]))).toEqual([]);
    expect((await readSlotAsync(S, [f])).table.rowCount).toBe(1);
  });
});

describe('KNOWN BUG — zip bomb guard bypasses (AC-B4-90)', () => {
  // xl/workbook.xml declared with uncompressed size 0: `checkDeclared` passes (0 ≤ limit) and
  // SheetJS's `_inflateRaw(data, 0)` treats 0 as "unknown" and grows its buffer without bound; the
  // limit is only checked after the whole entry is inflated. Read through `part()` (inflateSync),
  // i.e. also in the worker's async path. 64 KiB file → > 64 MiB allocated (limit 16 MiB).
  it.fails('declared size 0: the inflate stops near the 16 MiB limit (async path)', async () => {
    const f: SourceFile = {
      name: 'zero.xlsx',
      data: zip([
        text('_rels/.rels', ROOT_RELS),
        {
          name: 'xl/workbook.xml',
          data: padded(WB_HEAD, 64 * MiB, '</workbook>'),
          declaredSize: 0,
        },
        text('xl/_rels/workbook.xml.rels', WB_RELS),
        text('xl/worksheets/sheet1.xml', SHEET),
      ]),
    };
    expect(f.data.byteLength).toBeLessThan(MiB);
    const largest = watchInflate();
    const r = await readSlotAsync(S, [f]);
    expect(keys(r)).toEqual(['validation.fileTooLarge']);
    expect(largest()).toBeLessThanOrEqual(16 * MiB + 64 * 1024);
  });

  // A central-directory flag the streaming reader refuses (0x40) makes `openXlsx` return null, so
  // the whole package goes to SheetJS, which ignores that flag and inflates every entry with no
  // limit at all (here a 256 MiB entry from a < 1 MiB file is inflated and the file "reads").
  it.fails(
    'a package the streaming reader refuses is not inflated unguarded by SheetJS',
    async () => {
      const f: SourceFile = {
        name: 'fallback.xlsx',
        data: zip([
          text(
            '[Content_Types].xml',
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
          ),
          text('_rels/.rels', ROOT_RELS),
          text('xl/workbook.xml', `${WB_HEAD}</workbook>`),
          text('xl/_rels/workbook.xml.rels', WB_RELS),
          text('xl/worksheets/sheet1.xml', SHEET),
          {
            name: 'xl/media/x.bin',
            data: new Uint8Array(256 * MiB),
            declaredSize: 0,
            cdFlags: 0x40,
          },
        ]),
      };
      expect(f.data.byteLength).toBeLessThan(MiB);
      const r = await readSlotAsync(S, [f]);
      // Today: read by SheetJS without any issue (the 256 MiB entry was inflated).
      expect(keys(r)).toEqual(['validation.fileTooLarge']);
    },
  );
});

describe('KNOWN BUG — no cumulative inflate budget per file (AC-B4-90, decision 2026-10-30)', () => {
  // The 1:200 ratio is only checked per entry above 16 MiB. With `sheet.mode:
  // 'firstMatchingHeaders'` every sheet is inflated (and its grid kept) until one matches, so N
  // sheets × 16 MiB each come from a file of N × ~16 KiB. Measured while verifying: 24 sheets of
  // 915k cells (1.3 MB file) → 430 MB RSS, 9.6 s; it grows linearly with N. Proposed budget: total
  // bytes produced for one file ≤ min(2 GiB, max(64 MiB, 200 × file size)).
  it.fails(
    '40 sheets × 15 MiB from a < 1 MiB file: inflate stops at the per-file budget',
    async () => {
      const N = 40;
      const sheetXml = padded(
        `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>`,
        15 * MiB,
        '</sheetData></worksheet>',
      );
      const sheets = Array.from(
        { length: N },
        (_, i) => `<sheet name="S${i}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      ).join('');
      const rels = Array.from(
        { length: N },
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      ).join('');
      const f: SourceFile = {
        name: 'many.xlsx',
        data: zip([
          text('_rels/.rels', ROOT_RELS),
          text(
            'xl/workbook.xml',
            `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${R}"><sheets>${sheets}</sheets></workbook>`,
          ),
          text(
            'xl/_rels/workbook.xml.rels',
            `<?xml version="1.0"?><Relationships xmlns="${PKG}">${rels}</Relationships>`,
          ),
          ...Array.from({ length: N }, (_, i) => ({
            name: `xl/worksheets/sheet${i + 1}.xml`,
            data: sheetXml,
          })),
        ]),
      };
      expect(f.data.byteLength).toBeLessThan(MiB);

      // Count what the native inflater produces.
      let produced = 0;
      const Real = globalThis.DecompressionStream;
      class Counting {
        readonly writable: WritableStream<Uint8Array>;
        readonly readable: ReadableStream<Uint8Array>;
        constructor(format: CompressionFormat) {
          const inner = new Real(format);
          this.writable = inner.writable as WritableStream<Uint8Array>;
          this.readable = (inner.readable as ReadableStream<Uint8Array>).pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, ctl) {
                produced += chunk.length;
                ctl.enqueue(chunk);
              },
            }),
          );
        }
      }
      vi.stubGlobal('DecompressionStream', Counting);
      try {
        const strict = slot({
          sheet: { mode: 'firstMatchingHeaders' },
          columns: [
            {
              key: 'ma_nv',
              label: 'Mã NV',
              aliases: ['Mã NV'],
              type: 'string',
              presence: 'required',
            },
          ],
        } as never);
        const r = await readSlotAsync(strict, [f]);
        expect(produced).toBeGreaterThan(0);
        expect(produced).toBeLessThanOrEqual(Math.max(64 * MiB, 200 * f.data.byteLength) + MiB);
        expect(keys(r)).toEqual(['validation.fileTooLarge']);
      } finally {
        vi.unstubAllGlobals();
      }
    },
    120_000,
  );
});
