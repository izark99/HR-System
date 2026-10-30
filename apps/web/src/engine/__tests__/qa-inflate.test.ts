/**
 * QA (verifier) — .xlsx entry inflate (xlsx-stream: fflate on the sync path, native
 * DecompressionStream or fflate on the async path; AC-B4-90, MEMORY 2026-10-30 22:59), through the
 * public reader API. Differential against Node's zlib on random data; corrupted, truncated and
 * hand-made hostile DEFLATE streams must never hang or crash: the file is reported
 * `validation.fileUnreadable` / `validation.fileTooLarge`. Fake (random, seeded) data only.
 */
import { constants, crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { readSlot, readSlotAsync, type SourceFile } from '../io/excel-reader';
import { slot } from './helpers';

const enc = new TextEncoder();
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

let seed = 0x5eed;
const rnd = (n: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};

interface Entry {
  name: string;
  /** Uncompressed bytes (for size and CRC unless overridden). */
  data: Uint8Array;
  /** Raw DEFLATE stream stored instead of deflating `data`. */
  compressed?: Uint8Array;
  method?: 0 | 8;
}

function zip(entries: Entry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const method = e.method ?? 8;
    const comp = method === 0 ? e.data : (e.compressed ?? new Uint8Array(deflateRawSync(e.data)));
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, comp.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, comp);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, method, true);
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

const text = (name: string, s: string): Entry => ({ name, data: enc.encode(s) });
const FRAME = [
  text(
    '_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  ),
  text(
    'xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${R}"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  ),
  text(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  ),
];

/** Sheet XML: header "Mã NV" then `rows` rows of random text (repeats included). */
function sheetXml(rows: number): Uint8Array {
  const words = ['NV', 'Nguyễn', 'Trần', 'CN01', 'abc', 'x'.repeat(50), '00123', 'Ồ'];
  let x = `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Mã NV</t></is></c></row>`;
  for (let r = 2; r <= rows + 1; r++) {
    let v = '';
    for (let k = 0; k < 1 + rnd(6); k++) v += words[rnd(words.length)]! + String(rnd(100000));
    x += `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>${v}</t></is></c></row>`;
  }
  return enc.encode(`${x}</sheetData></worksheet>`);
}

const S = slot({
  columns: [{ key: 'ma_nv', label: 'Mã NV', aliases: ['Mã NV'], type: 'string' }],
});
type Result = Awaited<ReturnType<typeof readSlotAsync>>;
const keys = (r: Result) => r.report.issues.map((i) => i.messageKey);
const column = (r: Result) => r.table.rows.map((row) => row.ma_nv);

type Path = 'sync' | 'native' | 'fflate';
const PATHS: Path[] = ['sync', 'native', 'fflate'];

async function read(f: SourceFile, path: Path): Promise<Result> {
  if (path === 'sync') return readSlot(S, [f]);
  if (path === 'fflate') vi.stubGlobal('DecompressionStream', undefined);
  try {
    return await readSlotAsync(S, [f]);
  } finally {
    vi.unstubAllGlobals();
  }
}

const STRATEGIES = [
  constants.Z_DEFAULT_STRATEGY,
  constants.Z_FILTERED,
  constants.Z_HUFFMAN_ONLY,
  constants.Z_RLE,
  constants.Z_FIXED,
];

/** LSB-first bit writer (DEFLATE order); Huffman codes are written most significant bit first. */
class Bits {
  private bytes: number[] = [];
  private acc = 0;
  private n = 0;
  put(value: number, count: number): this {
    for (let i = 0; i < count; i++) {
      this.acc |= ((value >> i) & 1) << this.n;
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
    return this;
  }
  code(code: number, len: number): this {
    for (let i = len - 1; i >= 0; i--) this.put((code >> i) & 1, 1);
    return this;
  }
  raw(b: number[]): this {
    if (this.n > 0) this.put(0, 8 - this.n);
    this.bytes.push(...b);
    return this;
  }
  done(): Uint8Array {
    if (this.n > 0) this.put(0, 8 - this.n);
    return new Uint8Array(this.bytes);
  }
}

describe('QA inflate: differential against zlib (sync, native async, fflate async)', () => {
  it('random sheets, every level/strategy/window: same rows as the stored (uncompressed) file', async () => {
    for (let t = 0; t < 24; t++) {
      const xml = sheetXml(t < 20 ? 1 + rnd(400) : 5000 + rnd(20000));
      const stored = await read(
        {
          name: 's.xlsx',
          data: zip([...FRAME, { name: 'xl/worksheets/sheet1.xml', data: xml, method: 0 }]),
        },
        'sync',
      );
      expect(keys(stored)).toEqual([]);
      const z = new Uint8Array(
        deflateRawSync(xml, {
          level: rnd(10),
          strategy: STRATEGIES[rnd(STRATEGIES.length)]!,
          windowBits: 9 + rnd(7),
          memLevel: 1 + rnd(9),
        }),
      );
      const f: SourceFile = {
        name: 'd.xlsx',
        data: zip([...FRAME, { name: 'xl/worksheets/sheet1.xml', data: xml, compressed: z }]),
      };
      for (const path of PATHS) {
        const r = await read(f, path);
        expect(keys(r), `case ${t} ${path}`).toEqual([]);
        expect(column(r), `case ${t} ${path}`).toEqual(column(stored));
      }
    }
  }, 180_000);

  it('corrupted streams (bit flips, truncation, garbage): unreadable/too large or zlib-identical, never a crash or hang', async () => {
    for (let t = 0; t < 90; t++) {
      const xml = sheetXml(1 + rnd(300));
      const good = new Uint8Array(deflateRawSync(xml, { level: rnd(10) }));
      let bad = good.slice();
      const kind = t % 4;
      if (kind === 0) for (let k = 0; k < 1 + rnd(4); k++) bad[rnd(bad.length)]! ^= 1 << rnd(8);
      else if (kind === 1) bad = bad.slice(0, rnd(bad.length));
      else if (kind === 2) for (let k = 0; k < bad.length; k++) bad[k] = rnd(256);
      else bad[rnd(Math.min(bad.length, 4))] = rnd(256);
      const f: SourceFile = {
        name: 'bad.xlsx',
        data: zip([...FRAME, { name: 'xl/worksheets/sheet1.xml', data: xml, compressed: bad }]),
      };
      let ref: Uint8Array | null;
      try {
        ref = new Uint8Array(inflateRawSync(bad));
      } catch {
        ref = null;
      }
      const intact = ref !== null && Buffer.from(ref).equals(Buffer.from(xml));
      const baseline = await read(
        {
          name: 's.xlsx',
          data: zip([...FRAME, { name: 'xl/worksheets/sheet1.xml', data: xml, method: 0 }]),
        },
        'sync',
      );
      for (const path of PATHS) {
        const t0 = performance.now();
        const r = await read(f, path);
        expect(performance.now() - t0, `case ${t} ${path}`).toBeLessThan(2000);
        if (intact) {
          expect(keys(r), `case ${t} ${path}`).toEqual([]);
        } else if (path === 'sync') {
          // The sync path checks the CRC-32: either refused, or the original bytes came out
          // (a change zlib rejects but that does not alter the output, e.g. unused bits).
          const k = keys(r)[0];
          if (k === undefined) expect(column(r), `case ${t}`).toEqual(column(baseline));
          else
            expect(['validation.fileUnreadable', 'validation.fileTooLarge'], `case ${t}`).toContain(
              k,
            );
        } else {
          // The async path has no CRC: a stream that still inflates to the declared size may
          // read (as different XML) — but never crashes.
          expect(r.report).toBeDefined();
        }
      }
    }
  }, 180_000);
});

describe('QA inflate: hand-made hostile DEFLATE streams', () => {
  const SIZE = 64;
  const target = new Uint8Array(SIZE).fill(0x20);
  const file = (stream: Uint8Array): SourceFile => ({
    name: 'h.xlsx',
    data: zip([...FRAME, { name: 'xl/worksheets/sheet1.xml', data: target, compressed: stream }]),
  });
  const cases: [string, Uint8Array][] = [
    // Stored block, LEN 3 / NLEN not its complement.
    ['stored LEN ≠ ~NLEN', new Bits().put(1, 1).put(0, 2).raw([3, 0, 0xfc, 0xfe, 1, 2, 3]).done()],
    // Stored block with LEN past the end of the input.
    ['stored LEN past input', new Bits().put(1, 1).put(0, 2).raw([200, 0, 55, 0xff, 1]).done()],
    // Reserved block type 3.
    ['block type 3', new Bits().put(1, 1).put(3, 2).put(0, 16).done()],
    // Fixed block: literal, then length 3 with distance 5 > 1 byte written.
    [
      'distance before the start',
      new Bits()
        .put(1, 1)
        .put(1, 2)
        .code(0x71, 8)
        .code(1, 7)
        .code(4, 5)
        .put(0, 1)
        .code(0, 7)
        .done(),
    ],
    // Fixed block: literal then length symbol 286 (invalid).
    ['length symbol 286', new Bits().put(1, 1).put(1, 2).code(0x31, 8).code(0xc6, 8).done()],
    // Fixed block: literal, length 3, distance symbol 30 (invalid).
    [
      'distance symbol 30',
      new Bits().put(1, 1).put(1, 2).code(0x31, 8).code(1, 7).code(30, 5).put(0, 16).done(),
    ],
    // Dynamic block, 19 code-length codes all of length 1 (over-subscribed).
    [
      'over-subscribed code lengths',
      (() => {
        const b = new Bits().put(1, 1).put(2, 2).put(0, 5).put(0, 5).put(15, 4);
        for (let i = 0; i < 19; i++) b.put(1, 3);
        return b.put(0, 32).done();
      })(),
    ],
    // Dynamic block whose first code length is a repeat (16) of nothing.
    [
      'repeat with no previous length',
      new Bits()
        .put(1, 1)
        .put(2, 2)
        .put(0, 5)
        .put(0, 5)
        .put(0, 4)
        .put(1, 3)
        .put(0, 3)
        .put(0, 3)
        .put(1, 3)
        .code(1, 1)
        .put(0, 32)
        .done(),
    ],
    // Non-final empty stored blocks forever (until the input ends).
    [
      'endless empty blocks',
      (() => {
        const b = new Bits();
        for (let i = 0; i < 20000; i++) b.put(0, 1).put(0, 2).raw([0, 0, 0xff, 0xff]);
        return b.done();
      })(),
    ],
    ['empty input', new Uint8Array(0)],
  ];

  it.each(cases)('%s → fileUnreadable on every path, quickly', async (_name, stream) => {
    for (const path of PATHS) {
      const t0 = performance.now();
      const r = await read(file(stream), path);
      expect(performance.now() - t0, path).toBeLessThan(2000);
      expect(['validation.fileUnreadable', 'validation.fileTooLarge'], path).toContain(keys(r)[0]);
    }
  });

  it('20,000 tiny dynamic blocks with 15-bit codes (~280 KB): bounded time, reported', async () => {
    // One empty dynamic block (~14 bytes): code-length codes {0, 15, 18} of length 2, literal
    // lengths 256 × 0 + 15 for end-of-block, one distance code of length 15, then end-of-block.
    const b = new Bits();
    for (let i = 0; i < 20000; i++) {
      b.put(0, 1).put(2, 2).put(0, 5).put(0, 5).put(15, 4);
      const len: Record<number, number> = { 18: 2, 0: 2, 15: 2 };
      for (const s of [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
        b.put(len[s] ?? 0, 3);
      b.code(2, 2).put(127, 7).code(2, 2).put(107, 7).code(1, 2).code(1, 2).code(0, 15);
    }
    // Final stored block: the 64 spaces of the target.
    const stream = b
      .put(1, 1)
      .put(0, 2)
      .raw([SIZE, 0, ~SIZE & 0xff, 0xff, ...target])
      .done();
    expect(stream.length).toBeLessThan(400_000);
    for (const path of PATHS) {
      const t0 = performance.now();
      const r = await read(file(stream), path);
      const ms = performance.now() - t0;
      // Measured alone: sync 1.25 s, native 0.73 s, fflate 0.81 s (~100× slower per input byte
      // than ordinary data; see verifier report). Bound generously to catch a hang/quadratic
      // regression without flaking under CI load.
      expect(ms, path).toBeLessThan(6000);
      // Incomplete Huffman codes: zlib refuses them; a decoder may too. Either way: reported.
      expect(r.report).toBeDefined();
    }
  }, 60_000);
});
