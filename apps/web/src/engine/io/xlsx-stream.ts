import * as XLSX from 'xlsx';
import type { RawValue } from './coerce';

/**
 * Streaming .xlsx reader (spec §10, §13 memory): reads only the sheet that is needed, inflates it
 * in chunks and scans the XML bytes directly into a compact typed-array grid — no XML string, no
 * object per cell. SheetJS (whole workbook in memory, one object per cell, the sheet XML as one
 * JS string) cannot read a 1-million-row sheet; it stays the reader for .xls, HTML/XML exports and
 * packages this reader does not understand (`openXlsx` returns null).
 *
 * Cell values follow SheetJS's (`dense`, `cellNF`, `cellText: false`, `cellDates: false`), so the
 * validation code sees the same values whichever reader produced the grid.
 */

export interface CellRead {
  value: RawValue;
  error?: string;
  /** Excel number format of a numeric cell (absent / "General" when unformatted). */
  numFmt?: string;
}

/** A sheet as the validation code reads it (0-based rows/columns). */
export interface Grid {
  lastRow: number;
  lastCol: number;
  cell(r: number, c: number, followMerges: boolean): CellRead;
  isRowBlank(r: number): boolean;
}

export interface MergeRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/** Merge origin lookup: every non-origin cell of a merged range → its top-left cell. */
export function mergeOrigins(merges: readonly MergeRange[]): Map<string, [number, number]> {
  const origin = new Map<string, [number, number]>();
  for (const m of merges) {
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r !== m.s.r || c !== m.s.c) origin.set(`${r},${c}`, [m.s.r, m.s.c]);
      }
    }
  }
  return origin;
}

// ---------------------------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------------------------

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  localHeader: number;
}

function u16(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}
function u32(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

/** Central directory of a ZIP file (lower-cased names), or null (ZIP64, encrypted, corrupt). */
function zipDirectory(bytes: Uint8Array): Map<string, ZipEntry> | null {
  const min = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  if (count === 0xffff || p === 0xffffffff) return null;
  const latin1 = new TextDecoder('latin1');
  const out = new Map<string, ZipEntry>();
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) return null;
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localHeader = u32(bytes, p + 42);
    if (flags & 0x41) return null; // encrypted
    // ZIP64 sizes: an entry of 4 GiB or more is past the inflate limit anyway.
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new XlsxTooLargeError();
    if (localHeader === 0xffffffff) return null;
    const name = latin1.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.set(name.replace(/^\/+/, '').toLowerCase(), {
      method,
      compressedSize,
      size,
      localHeader,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Zip-bomb guard (HANDOFF §4 #1, AC-B4-90): an entry may inflate to at most `MAX_ENTRY_BYTES`, and
 * beyond `RATIO_FLOOR_BYTES` to at most `MAX_RATIO` × its compressed size. Checked on the declared
 * sizes when the package opens and again on the bytes actually produced, stopping the inflate as
 * soon as a limit is passed (the declared size may lie).
 */
export const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;
export const MAX_RATIO = 200;
/** Small parts compress very well (repeated XML) and cannot exhaust memory: no ratio check. */
export const RATIO_FLOOR_BYTES = 16 * 1024 * 1024;

/** The package expands beyond the limits: reported as "File quá lớn để xử lý". */
export class XlsxTooLargeError extends Error {
  constructor() {
    super('xlsx entry too large');
    this.name = 'XlsxTooLargeError';
  }
}

/** Largest output allowed for an entry. */
function inflateLimit(e: ZipEntry): number {
  return Math.min(MAX_ENTRY_BYTES, Math.max(RATIO_FLOOR_BYTES, e.compressedSize * MAX_RATIO));
}

function checkDeclared(e: ZipEntry): void {
  if (e.method !== 0 && e.size > inflateLimit(e)) throw new XlsxTooLargeError();
}

function entryData(bytes: Uint8Array, e: ZipEntry): Uint8Array {
  const h = e.localHeader;
  if (u32(bytes, h) !== 0x04034b50) throw new Error('bad zip entry');
  const start = h + 30 + u16(bytes, h + 26) + u16(bytes, h + 28);
  return bytes.subarray(start, start + e.compressedSize);
}

const CFB = XLSX.CFB as unknown as {
  utils: { _inflateRaw(data: Uint8Array, size: number): ArrayLike<number> };
};

/** Whole entry, inflated synchronously (SheetJS's inflater). */
function inflateSync(bytes: Uint8Array, e: ZipEntry): Uint8Array {
  const data = entryData(bytes, e);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error('unsupported zip method');
  checkDeclared(e);
  const out = CFB.utils._inflateRaw(data, e.size);
  if (out.length > inflateLimit(e)) throw new XlsxTooLargeError();
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

/** Entry inflated in chunks (native DecompressionStream) when available, else in one piece. */
async function* inflateChunks(bytes: Uint8Array, e: ZipEntry): AsyncGenerator<Uint8Array> {
  const data = entryData(bytes, e);
  if (e.method === 0) {
    yield data;
    return;
  }
  if (e.method !== 8) throw new Error('unsupported zip method');
  if (typeof DecompressionStream === 'undefined') {
    yield inflateSync(bytes, e);
    return;
  }
  checkDeclared(e);
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const limit = inflateLimit(e);
  let produced = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    produced += value.length;
    if (produced > limit) {
      // Stop inflating now: the rest is never produced.
      void reader.cancel().catch(() => undefined);
      throw new XlsxTooLargeError();
    }
    yield value;
  }
}

// ---------------------------------------------------------------------------------------------
// XML scanning (bytes)
// ---------------------------------------------------------------------------------------------

const LT = 60;
const GT = 62;
const SLASH = 47;
const QUOT = 34;
const APOS = 39;

interface XmlHandler {
  /** `attrs` = bytes [a, b) between the name and `>` / `/>`. */
  open(name: string, buf: Uint8Array, a: number, b: number, selfClosing: boolean): void;
  close(name: string): void;
  text(buf: Uint8Array, a: number, b: number): void;
}

/** Local element name (namespace prefix dropped), interned for the few names we care about. */
const NAME_CACHE = new Map<number, string>();
function localName(buf: Uint8Array, a: number, b: number): string {
  for (let i = a; i < b; i++) if (buf[i] === 58) a = i + 1; // ':'
  const len = b - a;
  if (len <= 4) {
    let key = len;
    for (let i = a; i < b; i++) key = key * 256 + buf[i]!;
    let s = NAME_CACHE.get(key);
    if (s === undefined) {
      s = String.fromCharCode.apply(null, buf.subarray(a, b) as never);
      NAME_CACHE.set(key, s);
    }
    return s;
  }
  return String.fromCharCode.apply(null, buf.subarray(a, b) as never);
}

function isNameEnd(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === SLASH || c === GT;
}

/**
 * Incremental XML tokenizer. `feed` processes everything before the last `<` of the buffer and
 * keeps the rest (an incomplete tag / its following text) for the next chunk.
 */
class XmlScanner {
  /**
   * Bytes not scanned yet (an unfinished construct, or text without `<`), at the start of a buffer
   * that grows geometrically, so a long run without `<` costs linear time (zip-bomb guard: the
   * inflate is stopped at its limit, not after a quadratic copy).
   */
  private store: Uint8Array | null = null;
  private carryLen = 0;
  /** Offset of the last `<` in the carried bytes, -1 when none. */
  private carryLt = -1;

  constructor(private readonly h: XmlHandler) {}

  feed(chunk: Uint8Array, final: boolean): void {
    let buf = chunk;
    let base = 0;
    if (this.carryLen > 0) {
      const n = this.carryLen + chunk.length;
      let store = this.store!;
      if (store.length < n) {
        const grown = new Uint8Array(Math.max(n, store.length * 2));
        grown.set(store.subarray(0, this.carryLen));
        store = grown;
      }
      store.set(chunk, this.carryLen);
      this.store = store;
      base = this.carryLen;
      buf = store.subarray(0, n);
    }
    const carriedLt = this.carryLt;
    this.carryLen = 0;
    this.carryLt = -1;
    let end = buf.length;
    if (!final) {
      const lt = chunk.lastIndexOf(LT);
      end = lt >= 0 ? base + lt : carriedLt;
      if (end < 0) {
        this.keep(buf, 0, -1);
        return;
      }
    }
    const done = this.scan(buf, end, final);
    // `scan` stops at a `<` (≤ end, the last `<` of buf).
    if (done < buf.length) this.keep(buf, done, final ? -1 : end - done);
  }

  /** Carry `buf[from…]` to the next chunk; in place when it already starts the store. */
  private keep(buf: Uint8Array, from: number, lastLt: number): void {
    if (
      from === 0 &&
      this.store !== null &&
      buf.buffer === this.store.buffer &&
      buf.byteOffset === 0
    ) {
      this.carryLen = buf.length;
    } else {
      const rest = buf.slice(from);
      this.store = rest;
      this.carryLen = rest.length;
    }
    this.carryLt = lastLt;
  }

  /** Returns the index up to which bytes were consumed. */
  private scan(buf: Uint8Array, end: number, final: boolean): number {
    const h = this.h;
    let i = 0;
    while (i < end) {
      const lt = buf.indexOf(LT, i);
      if (lt < 0 || lt >= end) {
        // Not final: `end` is a `<`, so the text before it is complete.
        if (final) h.text(buf, i, buf.length);
        else if (i < end) h.text(buf, i, end);
        return final ? buf.length : end;
      }
      if (lt > i) h.text(buf, i, lt);
      const c1 = buf[lt + 1];
      if (c1 === 33) {
        // <!-- … -->, <![CDATA[ … ]]>, <!DOCTYPE …>
        if (buf[lt + 2] === 91 && buf[lt + 3] === 67) {
          const close = indexOfSeq(buf, CDATA_END, lt + 9);
          if (close < 0) return final ? buf.length : lt;
          h.text(buf, lt + 9, close);
          i = close + 3;
        } else if (buf[lt + 2] === 45) {
          const close = indexOfSeq(buf, COMMENT_END, lt + 4);
          if (close < 0) return final ? buf.length : lt;
          i = close + 3;
        } else {
          const gt = buf.indexOf(GT, lt);
          if (gt < 0) return final ? buf.length : lt;
          i = gt + 1;
        }
        continue;
      }
      if (c1 === 63) {
        const gt = buf.indexOf(GT, lt);
        if (gt < 0) return final ? buf.length : lt;
        i = gt + 1;
        continue;
      }
      // Find the end of the tag, skipping quoted attribute values.
      let j = lt + 1;
      let quote = 0;
      for (; j < buf.length; j++) {
        const c = buf[j]!;
        if (quote) {
          if (c === quote) quote = 0;
        } else if (c === QUOT || c === APOS) quote = c;
        else if (c === GT) break;
      }
      if (j >= buf.length) return final ? buf.length : lt;
      if (c1 === SLASH) {
        let n = lt + 2;
        while (n < j && !isNameEnd(buf[n]!)) n++;
        h.close(localName(buf, lt + 2, n));
      } else {
        let n = lt + 1;
        while (n < j && !isNameEnd(buf[n]!)) n++;
        const self = buf[j - 1] === SLASH;
        h.open(localName(buf, lt + 1, n), buf, n, self ? j - 1 : j, self);
        if (self) h.close(localName(buf, lt + 1, n));
      }
      i = j + 1;
    }
    return i;
  }
}

const CDATA_END = [93, 93, 62];
const COMMENT_END = [45, 45, 62];
function indexOfSeq(buf: Uint8Array, seq: readonly number[], from: number): number {
  for (let i = buf.indexOf(seq[0]!, from); i >= 0; i = buf.indexOf(seq[0]!, i + 1)) {
    if (buf[i + 1] === seq[1] && buf[i + 2] === seq[2]) return i;
  }
  return -1;
}

const utf8 = new TextDecoder();

/** Attribute `name` (exact, without prefix handling) of a tag's attribute bytes, decoded. */
function attr(buf: Uint8Array, a: number, b: number, name: string): string | undefined {
  let i = a;
  while (i < b) {
    while (i < b && (buf[i] === 32 || buf[i] === 9 || buf[i] === 10 || buf[i] === 13)) i++;
    const ns = i;
    while (i < b && buf[i] !== 61 && buf[i] !== 32) i++;
    const ne = i;
    while (i < b && buf[i] !== QUOT && buf[i] !== APOS) i++;
    const q = buf[i];
    const vs = i + 1;
    const ve = buf.indexOf(q!, vs);
    if (ve < 0 || ve > b) return undefined;
    i = ve + 1;
    if (ne - ns !== name.length) continue;
    let match = true;
    for (let k = 0; k < name.length; k++) {
      if (buf[ns + k] !== name.charCodeAt(k)) {
        match = false;
        break;
      }
    }
    if (match) return utf8.decode(buf.subarray(vs, ve));
  }
  return undefined;
}

/** All attributes of a tag (small tags only: workbook, rels, styles). */
function attrs(buf: Uint8Array, a: number, b: number): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const s = utf8.decode(buf.subarray(a, b));
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const key = m[1]!.includes(':') && !m[1]!.startsWith('r:') ? m[1]!.split(':')[1]! : m[1]!;
    out[key] = m[2] ?? m[3] ?? '';
  }
  return out;
}

const ENTITY = /&(?:quot|apos|gt|lt|amp|#x?([\da-fA-F]+));/gi;
const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&amp;': '&',
};
const CODE = /_x([\da-fA-F]{4})_/gi;

/** SheetJS `unescapexml(text, true)`: entities, `_xHHHH_` escapes, CRLF → LF. */
export function unescapeXml(s: string): string {
  if (s.indexOf('&') < 0 && s.indexOf('_x') < 0 && s.indexOf('\r') < 0) return s;
  return s
    .replace(ENTITY, (all: string, code: string | undefined) => {
      const known = ENTITIES[all.toLowerCase()];
      if (known !== undefined && !code) return known;
      const n = parseInt(code ?? '', all.includes('x') || all.includes('X') ? 16 : 10);
      return String.fromCharCode(n) || all;
    })
    .replace(CODE, (_, c: string) => String.fromCharCode(parseInt(c, 16)))
    .replace(/\r\n/g, '\n');
}

function decodeText(buf: Uint8Array, a: number, b: number): string {
  return utf8.decode(buf.subarray(a, b));
}

// ---------------------------------------------------------------------------------------------
// Workbook parts
// ---------------------------------------------------------------------------------------------

function parseSmall(xml: Uint8Array, h: XmlHandler): void {
  new XmlScanner(h).feed(xml, true);
}

interface Rel {
  type: string;
  target: string;
}

function parseRels(xml: Uint8Array): Map<string, Rel> {
  const out = new Map<string, Rel>();
  parseSmall(xml, {
    open(name, buf, a, b) {
      if (name !== 'Relationship') return;
      const at = attrs(buf, a, b);
      if (at.Id) out.set(at.Id, { type: at.Type ?? '', target: at.Target ?? '' });
    },
    close() {},
    text() {},
  });
  return out;
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1).toLowerCase();
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/').toLowerCase();
}

function relsPath(part: string): string {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`.toLowerCase();
}

/** Built-in number formats as SheetJS knows them before reading any file. */
const SSF_TABLE = (XLSX.SSF as { get_table(): Record<number, string> }).get_table();
const BUILTIN_FORMATS: Readonly<Record<number, string>> = { ...SSF_TABLE };

function parsexmlbool(v: string | undefined): boolean {
  return v === '1' || v === 'true';
}

/** Cell style index → number format string (SheetJS `cell.z` with `cellNF`). */
function parseStyles(xml: Uint8Array | null): (string | undefined)[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  const xfIds: number[] = [];
  let inCellXfs = false;
  parseSmall(xml, {
    open(name, buf, a, b, self) {
      if (name === 'numFmt') {
        const at = attrs(buf, a, b);
        const id = parseInt(at.numFmtId ?? '', 10);
        if (!Number.isNaN(id)) custom.set(id, unescapeXml(at.formatCode ?? ''));
      } else if (name === 'cellXfs') inCellXfs = !self;
      else if (name === 'xf' && inCellXfs) {
        const id = attr(buf, a, b, 'numFmtId');
        xfIds.push(id === undefined ? 0 : parseInt(id, 10));
      }
    },
    close(name) {
      if (name === 'cellXfs') inCellXfs = false;
    },
    text() {},
  });
  return xfIds.map((id) => custom.get(id) ?? BUILTIN_FORMATS[id]);
}

export interface XlsxPackage {
  sheetNames: string[];
  date1904: boolean;
  /** Read one sheet into a grid (synchronous inflate). */
  readSheet(index: number): Grid;
  /**
   * Read one sheet, inflating in chunks (lower peak memory, native inflate). `maxChunk` re-slices
   * the chunks (tests: chunk boundaries anywhere).
   */
  readSheetAsync(index: number, maxChunk?: number): Promise<Grid>;
}

/**
 * Open an OOXML workbook package. Returns null when the bytes are not a ZIP package this reader
 * understands (the caller falls back to SheetJS).
 */
export function openXlsx(bytes: Uint8Array): XlsxPackage | null {
  const zip = zipDirectory(bytes);
  if (!zip) return null;
  // Refuse up front, so no fallback reader (SheetJS) inflates the entry either.
  for (const e of zip.values()) checkDeclared(e);
  const part = (path: string) => {
    const e = zip.get(path.toLowerCase());
    return e ? inflateSync(bytes, e) : null;
  };
  let wbPath = 'xl/workbook.xml';
  const rootRels = part('_rels/.rels');
  if (rootRels) {
    for (const r of parseRels(rootRels).values()) {
      if (/\/officeDocument$/.test(r.type)) wbPath = resolvePath('', r.target);
    }
  }
  if (!wbPath.endsWith('.xml')) return null; // e.g. xlsb
  const wbXml = part(wbPath);
  if (!wbXml) return null;
  const sheets: { name: string; rid: string }[] = [];
  let date1904 = false;
  parseSmall(wbXml, {
    open(name, buf, a, b) {
      if (name === 'sheet') {
        const at = attrs(buf, a, b);
        sheets.push({ name: unescapeXml(at.name ?? ''), rid: at['r:id'] ?? at.id ?? '' });
      } else if (name === 'workbookPr') {
        date1904 = parsexmlbool(attrs(buf, a, b).date1904);
      }
    },
    close() {},
    text() {},
  });
  const wbRelsXml = part(relsPath(wbPath));
  const wbRels = wbRelsXml ? parseRels(wbRelsXml) : new Map<string, Rel>();
  let sstPath: string | null = null;
  let stylesPath: string | null = null;
  for (const r of wbRels.values()) {
    if (/\/sharedStrings$/.test(r.type)) sstPath = resolvePath(wbPath, r.target);
    if (/\/styles$/.test(r.type)) stylesPath = resolvePath(wbPath, r.target);
  }
  sstPath ??= zip.has('xl/sharedstrings.xml') ? 'xl/sharedstrings.xml' : null;
  stylesPath ??= zip.has('xl/styles.xml') ? 'xl/styles.xml' : null;
  const formats = parseStyles(stylesPath ? part(stylesPath) : null);
  const sheetPaths = sheets.map((s, i) => {
    const rel = wbRels.get(s.rid);
    return rel ? resolvePath(wbPath, rel.target) : `xl/worksheets/sheet${i + 1}.xml`;
  });

  let sst: SharedStrings | null = null;
  const sharedSync = (): SharedStrings => {
    if (sst) return sst;
    const p = new SstParser();
    const e = sstPath ? zip.get(sstPath) : undefined;
    if (e) p.scanner.feed(inflateSync(bytes, e), true);
    return (sst = p.result());
  };
  const sharedAsync = async (): Promise<SharedStrings> => {
    if (sst) return sst;
    const p = new SstParser();
    const e = sstPath ? zip.get(sstPath) : undefined;
    if (e) {
      for await (const chunk of inflateChunks(bytes, e)) p.scanner.feed(chunk, false);
      p.scanner.feed(new Uint8Array(0), true);
    }
    return (sst = p.result());
  };

  return {
    sheetNames: sheets.map((s) => s.name),
    date1904,
    readSheet(index) {
      const e = zip.get(sheetPaths[index]!);
      const parser = new SheetParser(formats, date1904);
      if (e) parser.scanner.feed(inflateSync(bytes, e), true);
      return parser.grid(parser.usesShared ? sharedSync() : EMPTY_SST);
    },
    async readSheetAsync(index, maxChunk) {
      const e = zip.get(sheetPaths[index]!);
      const parser = new SheetParser(formats, date1904);
      if (e) {
        for await (const chunk of inflateChunks(bytes, e)) {
          if (!maxChunk) parser.scanner.feed(chunk, false);
          else {
            for (let i = 0; i < chunk.length; i += maxChunk) {
              parser.scanner.feed(chunk.slice(i, i + maxChunk), false);
            }
          }
        }
        parser.scanner.feed(new Uint8Array(0), true);
      }
      return parser.grid(parser.usesShared ? await sharedAsync() : EMPTY_SST);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Shared strings
// ---------------------------------------------------------------------------------------------

interface SharedStrings {
  strings: string[];
  /** 1 = whitespace-only / empty (a blank cell for `isRowBlank`). */
  blank: Uint8Array;
}

const EMPTY_SST: SharedStrings = { strings: [], blank: new Uint8Array(0) };

/** `<si>` → text of its `<t>` runs, phonetic runs (`<rPh>`) excluded (SheetJS `parse_si`). */
class SstParser implements XmlHandler {
  readonly scanner = new XmlScanner(this);
  private readonly strings: string[] = [];
  private parts: string[] = [];
  private inSi = false;
  private inT = false;
  private inRph = 0;
  private plain = true;
  private tCount = 0;

  open(name: string, _b: Uint8Array, _a: number, _e: number, self: boolean): void {
    if (name === 'si' || name === 'sstItem') {
      this.inSi = true;
      this.parts = [];
      this.plain = true;
      this.tCount = 0;
      if (self) this.inSi = true;
    } else if (!this.inSi) return;
    else if (name === 'rPh') this.inRph++;
    else if (name === 'r') this.plain = false;
    else if (name === 't' && !this.inRph) {
      this.tCount++;
      // Plain `<si><t>a</t>…`: SheetJS keeps only the first <t>.
      if (!(this.plain && this.tCount > 1)) this.inT = !self;
    }
  }

  close(name: string): void {
    if (name === 'si' || name === 'sstItem') {
      if (this.inSi) this.strings.push(unescapeXml(this.parts.join('')));
      this.inSi = false;
    } else if (name === 'rPh') this.inRph = Math.max(0, this.inRph - 1);
    else if (name === 't') this.inT = false;
  }

  text(buf: Uint8Array, a: number, b: number): void {
    if (this.inT && !this.inRph) this.parts.push(decodeText(buf, a, b));
  }

  result(): SharedStrings {
    const blank = new Uint8Array(this.strings.length);
    this.strings.forEach((s, i) => {
      if (s.trim() === '') blank[i] = 1;
    });
    return { strings: this.strings, blank };
  }
}

// ---------------------------------------------------------------------------------------------
// Sheet → compact grid
// ---------------------------------------------------------------------------------------------

const enum Kind {
  Empty = 0,
  Number = 1,
  Shared = 2,
  Inline = 3,
  Bool = 4,
  Error = 5,
}

const ERROR_TEXTS = [
  '#NULL!',
  '#DIV/0!',
  '#VALUE!',
  '#REF!',
  '#NAME?',
  '#NUM!',
  '#N/A',
  '#GETTING_DATA',
  '#WTF?',
];
/** Error text as the SheetJS-based grid reports it (`EXCEL_ERRORS[code] ?? '#ERROR'`). */
const ERROR_SHOWN = ERROR_TEXTS.map((t) => (t === '#WTF?' ? '#ERROR' : t));

class GridColumn {
  kind: Uint8Array;
  num: Float64Array;
  fmt: Uint16Array;
  constructor(capacity: number) {
    this.kind = new Uint8Array(capacity);
    this.num = new Float64Array(capacity);
    this.fmt = new Uint16Array(capacity);
  }
  ensure(r: number): void {
    if (r < this.kind.length) return;
    const cap = Math.max(r + 1, Math.ceil(this.kind.length * 1.5), 64);
    const kind = new Uint8Array(cap);
    kind.set(this.kind);
    const num = new Float64Array(cap);
    num.set(this.num);
    const fmt = new Uint16Array(cap);
    fmt.set(this.fmt);
    this.kind = kind;
    this.num = num;
    this.fmt = fmt;
  }
}

function colIndex(ref: string): { c: number; r: number } {
  let c = 0;
  let i = 0;
  for (; i < ref.length; i++) {
    const cc = ref.charCodeAt(i) - 64;
    if (cc < 1 || cc > 26) break;
    c = 26 * c + cc;
  }
  const r = parseInt(ref.slice(i), 10);
  return { c: c - 1, r: Number.isNaN(r) ? -1 : r - 1 };
}

const POW10 = Array.from({ length: 23 }, (_, i) => 10 ** i);

/** Number text (ASCII) → double, as `parseFloat` (fast path for plain decimals). */
function parseNumber(buf: Uint8Array, a: number, b: number): number {
  let i = a;
  let neg = false;
  if (buf[i] === 45) {
    neg = true;
    i++;
  }
  let m = 0;
  let digits = 0;
  let frac = -1;
  for (; i < b; i++) {
    const c = buf[i]!;
    if (c === 46 && frac < 0) {
      frac = 0;
      continue;
    }
    const d = c - 48;
    if (d < 0 || d > 9) return parseFloat(decodeText(buf, a, b));
    m = m * 10 + d;
    digits++;
    if (frac >= 0) frac++;
  }
  if (digits === 0 || digits > 15 || frac > 22) return parseFloat(decodeText(buf, a, b));
  const x = frac > 0 ? m / POW10[frac]! : m;
  return neg ? -x : x;
}

const MS_PER_DAY = 86_400_000;
/** SheetJS `datenum(parseDate(text))` for ISO cells (`t="d"`), in UTC. */
function isoToSerial(text: string, date1904: boolean): number {
  const m = /^(\d+)-(\d+)-(\d+)(?:[T ](\d+):(\d+)(?::(\d+))?(?:\.(\d+))?)?/.exec(text);
  const ms = m
    ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
    : new Date(text).getTime();
  let res = (ms - Date.UTC(1899, 11, 30)) / MS_PER_DAY;
  if (date1904) {
    res -= 1462;
    return res < -1402 ? res - 1 : res;
  }
  return res < 60 ? res - 1 : res;
}

/** Attributes of a `<c>` tag, parsed from bytes without allocating (except unusual `t`). */
const CELL = { c: -1, r: -1, s: -1, t: undefined as string | undefined };
const CELL_TYPES = new Map<number, string>([
  [115, 's'],
  [110, 'n'],
  [98, 'b'],
  [101, 'e'],
  [100, 'd'],
]);

function cellAttrs(buf: Uint8Array, a: number, b: number, out: typeof CELL): void {
  out.c = -1;
  out.r = -1;
  out.s = -1;
  out.t = undefined;
  let i = a;
  while (i < b) {
    const c0 = buf[i]!;
    if (c0 === 32 || c0 === 9 || c0 === 10 || c0 === 13) {
      i++;
      continue;
    }
    const ns = i;
    while (i < b && buf[i] !== 61 && buf[i] !== 32) i++;
    const nameLen = i - ns;
    while (i < b && buf[i] !== QUOT && buf[i] !== APOS) i++;
    const q = buf[i]!;
    const vs = i + 1;
    let ve = vs;
    while (ve < b && buf[ve] !== q) ve++;
    i = ve + 1;
    if (nameLen !== 1) continue;
    const n = buf[ns];
    if (n === 114) {
      // r="AB12"
      let col = 0;
      let k = vs;
      for (; k < ve; k++) {
        const cc = buf[k]! - 64;
        if (cc < 1 || cc > 26) break;
        col = 26 * col + cc;
      }
      let row = 0;
      let any = false;
      for (; k < ve; k++) {
        const d = buf[k]! - 48;
        if (d < 0 || d > 9) break;
        row = row * 10 + d;
        any = true;
      }
      out.c = col - 1;
      out.r = any ? row - 1 : -1;
    } else if (n === 115) {
      let s = 0;
      for (let k = vs; k < ve; k++) s = s * 10 + (buf[k]! - 48);
      out.s = ve > vs ? s : -1;
    } else if (n === 116) {
      out.t =
        ve - vs === 1
          ? (CELL_TYPES.get(buf[vs]!) ?? decodeText(buf, vs, ve))
          : decodeText(buf, vs, ve);
    }
  }
}

class SheetParser implements XmlHandler {
  readonly scanner = new XmlScanner(this);
  usesShared = false;
  private readonly cols: GridColumn[] = [];
  private readonly inline: string[] = [];
  private readonly fmtIds = new Map<string, number>([['', 0]]);
  private readonly fmtList: string[] = [''];
  private readonly merges: MergeRange[] = [];
  private capacity = 64;
  private lastRow = -1;
  private lastCol = -1;
  private rowTag = -1;
  private colTag = -1;
  private inData = false;
  // Current cell
  private inCell = false;
  private cellR = 0;
  private cellC = 0;
  private cellT: string | undefined;
  private cellS = 0;
  private vParts: string[] | null = null;
  private vBuf: { buf: Uint8Array; a: number; b: number } | null = null;
  private inV = false;
  private inIs = false;
  private inT = false;
  private inRph = 0;
  private isParts: string[] = [];
  private isPlain = true;
  private isT = 0;
  private hasIs = false;

  constructor(
    private readonly formats: readonly (string | undefined)[],
    private readonly date1904: boolean,
  ) {}

  open(name: string, buf: Uint8Array, a: number, b: number, self: boolean): void {
    if (this.inCell) {
      if (name === 'v') {
        this.inV = !self;
        this.vParts = [];
        this.vBuf = null;
      } else if (name === 'is') {
        this.inIs = !self;
        this.hasIs = true;
        this.isParts = [];
        this.isPlain = true;
        this.isT = 0;
      } else if (this.inIs) {
        if (name === 'rPh') this.inRph++;
        else if (name === 'r') this.isPlain = false;
        else if (name === 't' && !this.inRph) {
          this.isT++;
          if (!(this.isPlain && this.isT > 1)) this.inT = !self;
        }
      }
      return;
    }
    if (name === 'c' && this.inData) {
      cellAttrs(buf, a, b, CELL);
      let r = this.rowTag;
      let c: number;
      if (CELL.c >= 0) {
        c = CELL.c;
        if (CELL.r >= 0) r = CELL.r;
      } else c = this.colTag + 1;
      this.colTag = c;
      this.inCell = true;
      this.cellR = r;
      this.cellC = c;
      this.cellT = CELL.t;
      this.cellS = CELL.s;
      this.vParts = null;
      this.vBuf = null;
      this.hasIs = false;
      this.isParts = [];
      if (self) this.endCell();
    } else if (name === 'row' && this.inData) {
      if (self) return; // SheetJS ignores self-closing rows
      const r = attr(buf, a, b, 'r');
      this.rowTag = r !== undefined ? parseInt(r, 10) - 1 : this.rowTag + 1;
      this.colTag = -1;
      if (this.rowTag > this.lastRow) this.lastRow = this.rowTag;
    } else if (name === 'sheetData') this.inData = !self;
    else if (name === 'dimension') {
      const ref = attr(buf, a, b, 'ref');
      const end = ref?.split(':')[1];
      if (end) {
        const pos = colIndex(end);
        if (pos.r > 0 && pos.r < 2_000_000) this.capacity = pos.r + 1;
      }
    } else if (name === 'mergeCell') {
      const ref = attr(buf, a, b, 'ref');
      if (ref) {
        const [s, e] = ref.split(':');
        const sp = colIndex(s!);
        const ep = colIndex(e ?? s!);
        if (sp.c >= 0 && sp.r >= 0 && ep.c >= 0 && ep.r >= 0) this.merges.push({ s: sp, e: ep });
      }
    }
  }

  close(name: string): void {
    if (!this.inCell) {
      if (name === 'sheetData') this.inData = false;
      return;
    }
    if (name === 'c') this.endCell();
    else if (name === 'v') this.inV = false;
    else if (name === 'is') this.inIs = false;
    else if (name === 'rPh') this.inRph = Math.max(0, this.inRph - 1);
    else if (name === 't') this.inT = false;
  }

  text(buf: Uint8Array, a: number, b: number): void {
    if (this.inV) {
      // Usually the whole value arrives in one piece: keep the bytes, decode lazily.
      if (this.vBuf === null && this.vParts!.length === 0) this.vBuf = { buf, a, b };
      else {
        if (this.vBuf) this.vParts!.push(decodeText(this.vBuf.buf, this.vBuf.a, this.vBuf.b));
        this.vBuf = null;
        this.vParts!.push(decodeText(buf, a, b));
      }
    } else if (this.inT && !this.inRph) this.isParts.push(decodeText(buf, a, b));
  }

  private vText(): string | undefined {
    if (this.vParts === null) return undefined;
    const s = this.vBuf
      ? decodeText(this.vBuf.buf, this.vBuf.a, this.vBuf.b)
      : this.vParts.join('');
    return s === '' ? undefined : unescapeXml(s);
  }

  private column(c: number): GridColumn {
    let col = this.cols[c];
    if (!col) {
      col = new GridColumn(this.capacity);
      this.cols[c] = col;
    }
    return col;
  }

  private set(kind: Kind, num: number, fmt: number): void {
    const { cellR: r, cellC: c } = this;
    if (r < 0 || c < 0) return;
    const col = this.column(c);
    col.ensure(r);
    col.kind[r] = kind;
    col.num[r] = num;
    col.fmt[r] = fmt;
    if (r > this.lastRow) this.lastRow = r;
    if (c > this.lastCol) this.lastCol = c;
  }

  private fmtIndex(): number {
    const z = this.cellS >= 0 ? this.formats[this.cellS] : 'General';
    if (z === undefined || z === 'General') return 0;
    let id = this.fmtIds.get(z);
    if (id === undefined) {
      id = this.fmtList.length;
      this.fmtList.push(z);
      this.fmtIds.set(z, id);
    }
    return id;
  }

  private endCell(): void {
    this.inCell = false;
    this.inV = false;
    this.inIs = false;
    this.inT = false;
    this.inRph = 0;
    const t = this.cellT;
    // Fast path: a plain number, value bytes still in the chunk.
    if ((t === undefined || t === 'n') && this.vBuf && this.vParts!.length === 0) {
      const { buf, a, b } = this.vBuf;
      this.vBuf = null;
      if (b > a) {
        let plain = true;
        for (let k = a; k < b; k++) {
          if (buf[k] === 38) {
            plain = false;
            break;
          }
        }
        const x = plain ? parseNumber(buf, a, b) : parseFloat(unescapeXml(decodeText(buf, a, b)));
        this.set(Kind.Number, x, this.fmtIndex());
      }
      return;
    }
    const v = this.vText();
    this.vBuf = null;
    switch (t ?? 'n') {
      case 'n':
        if (v !== undefined) this.set(Kind.Number, parseFloat(v), this.fmtIndex());
        return;
      case 's': {
        if (v === undefined) return;
        this.usesShared = true;
        this.set(Kind.Shared, parseInt(v, 10), 0);
        return;
      }
      case 'str':
        this.setInline(v === undefined ? '' : unescapeXml(v));
        return;
      case 'inlineStr':
        this.setInline(this.hasIs ? unescapeXml(this.isParts.join('')) : '');
        return;
      case 'b':
        this.set(Kind.Bool, parsexmlbool(v) ? 1 : 0, 0);
        return;
      case 'd':
        if (v === undefined) return;
        this.set(Kind.Number, isoToSerial(v, this.date1904), this.fmtIndex());
        return;
      case 'e': {
        const code = v === undefined ? -1 : ERROR_TEXTS.indexOf(v);
        // Unknown error text: SheetJS keeps no value (the cell reads as blank).
        if (code >= 0) this.set(Kind.Error, code, 0);
        return;
      }
      default:
        if (v !== undefined) this.setInline(v);
    }
  }

  private setInline(s: string): void {
    this.inline.push(s);
    this.set(Kind.Inline, this.inline.length - 1, 0);
  }

  grid(sst: SharedStrings): Grid {
    return new CompactGrid(
      this.cols,
      this.inline,
      sst,
      this.fmtList,
      this.merges,
      this.lastRow,
      this.lastCol,
    );
  }
}

class CompactGrid implements Grid {
  private readonly origin: Map<string, [number, number]>;

  constructor(
    private readonly cols: (GridColumn | undefined)[],
    private readonly inline: string[],
    private readonly sst: SharedStrings,
    private readonly fmts: string[],
    merges: MergeRange[],
    readonly lastRow: number,
    readonly lastCol: number,
  ) {
    this.origin = mergeOrigins(merges);
    for (const col of cols) {
      if (!col) continue;
      for (let r = 0; r < col.kind.length; r++) {
        if (col.kind[r] === Kind.Shared && col.num[r]! >= sst.strings.length) {
          // SheetJS throws on a dangling shared-string index: the file is unreadable.
          throw new Error('bad shared string index');
        }
      }
    }
  }

  private raw(r: number, c: number): CellRead {
    const col = this.cols[c];
    if (!col || r < 0 || r >= col.kind.length) return { value: null };
    const num = col.num[r]!;
    switch (col.kind[r] as Kind) {
      case Kind.Number: {
        const f = col.fmt[r]!;
        return f === 0 ? { value: num } : { value: num, numFmt: this.fmts[f]! };
      }
      case Kind.Shared:
        return { value: this.sst.strings[num]! };
      case Kind.Inline:
        return { value: this.inline[num]! };
      case Kind.Bool:
        return { value: num === 1 };
      case Kind.Error:
        return { value: null, error: ERROR_SHOWN[num]! };
      default:
        return { value: null };
    }
  }

  cell(r: number, c: number, followMerges: boolean): CellRead {
    const own = this.raw(r, c);
    if (!followMerges || own.error) return own;
    const v = own.value;
    if (!(v === null || (typeof v === 'string' && v.trim() === ''))) return own;
    const o = this.origin.size > 0 ? this.origin.get(`${r},${c}`) : undefined;
    return o ? this.raw(o[0], o[1]) : own;
  }

  isRowBlank(r: number): boolean {
    for (const col of this.cols) {
      if (!col || r >= col.kind.length) continue;
      switch (col.kind[r] as Kind) {
        case Kind.Empty:
          continue;
        case Kind.Shared:
          if (this.sst.blank[col.num[r]!] === 1) continue;
          return false;
        case Kind.Inline:
          if (this.inline[col.num[r]!]!.trim() === '') continue;
          return false;
        default:
          return false;
      }
    }
    return true;
  }
}
