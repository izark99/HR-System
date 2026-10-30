import type { DataType } from '@hrflow/flow-schema';
import { DecimalVector, type Vector } from '../core/table';
import type { ColumnDef } from '../core/types';

/**
 * Streaming .xlsx writer for large tables (spec §11 `output.excel`, §13 memory). ExcelJS builds
 * one object per cell (a million rows × 30 columns does not fit in the browser heap); this writer
 * renders the sheet XML in row chunks straight from the column vectors and deflates each chunk
 * as it goes (CompressionStream), so only compressed bytes accumulate.
 *
 * Same layout as the ExcelJS writer: bold header row, frozen first row, auto-filter, column
 * widths, number format per column, dates as real date cells, text as inline strings (never
 * formulas).
 */

export interface StreamSheet {
  name: string;
  columns: readonly ColumnDef[];
  vectors: readonly Vector[];
  rowCount: number;
  /** Column widths (characters). */
  widths: readonly number[];
  /** Number format per column (undefined = General). */
  numFmts: readonly (string | undefined)[];
}

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// ZIP (deflate, data descriptors, CRC-32)
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(crc: number, bytes: Uint8Array): number {
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

class ZipWriter {
  private readonly parts: Uint8Array[] = [];
  private offset = 0;
  private readonly central: Uint8Array[] = [];
  private count = 0;

  private push(b: Uint8Array): void {
    this.parts.push(b);
    this.offset += b.length;
  }

  /** Add one entry whose content is produced by `produce(write)`; deflated as written. */
  async entry(name: string, produce: (write: (text: string) => Promise<void>) => Promise<void>) {
    const nameBytes = encoder.encode(name);
    const start = this.offset;
    const header = new Uint8Array(30 + nameBytes.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0808, true); // data descriptor + UTF-8 names
    h.setUint16(8, 8, true);
    h.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    this.push(header);

    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    let compressed = 0;
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        compressed += value.length;
        this.push(value);
      }
    })();
    let crc = 0;
    let size = 0;
    await produce(async (text) => {
      const bytes = encoder.encode(text);
      crc = crc32(crc, bytes);
      size += bytes.length;
      await writer.write(bytes);
    });
    await writer.close();
    await pump;

    const desc = new Uint8Array(16);
    const d = new DataView(desc.buffer);
    d.setUint32(0, 0x08074b50, true);
    d.setUint32(4, crc, true);
    d.setUint32(8, compressed, true);
    d.setUint32(12, size, true);
    this.push(desc);

    const cd = new Uint8Array(46 + nameBytes.length);
    const c = new DataView(cd.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0808, true);
    c.setUint16(10, 8, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, compressed, true);
    c.setUint32(24, size, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, start, true);
    cd.set(nameBytes, 46);
    this.central.push(cd);
    this.count++;
  }

  finish(): Uint8Array {
    const cdStart = this.offset;
    let cdSize = 0;
    for (const c of this.central) {
      this.push(c);
      cdSize += c.length;
    }
    const end = new Uint8Array(22);
    const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, this.count, true);
    e.setUint16(10, this.count, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, cdStart, true);
    this.push(end);
    const out = new Uint8Array(this.offset);
    let p = 0;
    for (const part of this.parts) {
      out.set(part, p);
      p += part.length;
    }
    this.parts.length = 0;
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const XML_CHARS = /[&<>"\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
function esc(s: string): string {
  return s.replace(XML_CHARS, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        // Characters XML 1.0 forbids are dropped (as the ExcelJS writer does).
        return '';
    }
  });
}

function colName(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

const MS_PER_DAY = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/;

/** Excel serial of an ISO date/datetime (UTC wall time, like the ExcelJS writer), or null. */
function isoSerial(v: string): number | null {
  const m = ISO.exec(v);
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return 25569 + ms / MS_PER_DAY;
}

/** Built-in number format ids (Excel), others get custom ids from 164. */
const BUILTIN: Record<string, number> = {
  General: 0,
  '0': 1,
  '0.00': 2,
  '#,##0': 3,
  '#,##0.00': 4,
};

const ROWS_PER_CHUNK = 2000;

function sheetXmlHead(sheet: StreamSheet): string {
  const lastCol = sheet.columns.length > 0 ? colName(sheet.columns.length - 1) : 'A';
  const dimension = sheet.columns.length > 0 ? `A1:${lastCol}${sheet.rowCount + 1}` : 'A1:A1';
  const cols = sheet.widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="${dimension}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    '<sheetData>'
  );
}

function cellXml(vec: Vector, type: DataType, i: number, ref: string, style: number): string {
  if (vec.isNull(i)) return '';
  const s = style ? ` s="${style}"` : '';
  if (vec instanceof DecimalVector) {
    return `<c r="${ref}"${s}><v>${Number(vec.text(i))}</v></c>`;
  }
  const v = vec.get(i);
  if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  const text = String(v);
  if (type === 'date' || type === 'datetime') {
    const serial = isoSerial(text);
    if (serial !== null) return `<c r="${ref}"${s}><v>${serial}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

/** Write the sheets as one .xlsx package. */
export async function writeStreamingWorkbook(
  sheets: readonly StreamSheet[],
  names: readonly string[],
): Promise<Uint8Array> {
  const zip = new ZipWriter();
  // Styles: xf 0 default, xf 1 bold header, then one xf per distinct number format.
  const fmtIds = new Map<string, number>();
  const xfOf = new Map<string, number>();
  let nextCustom = 164;
  for (const sh of sheets) {
    for (const f of sh.numFmts) {
      if (f === undefined || xfOf.has(f)) continue;
      const id = BUILTIN[f] ?? nextCustom++;
      fmtIds.set(f, id);
      xfOf.set(f, 2 + xfOf.size);
    }
  }

  for (let k = 0; k < sheets.length; k++) {
    const sh = sheets[k]!;
    const styles = sh.numFmts.map((f) => (f === undefined ? 0 : xfOf.get(f)!));
    const refs = sh.columns.map((_, c) => colName(c));
    await zip.entry(`xl/worksheets/sheet${k + 1}.xml`, async (write) => {
      await write(sheetXmlHead(sh));
      if (sh.columns.length > 0) {
        await write(
          `<row r="1" s="1" customFormat="1">${sh.columns
            .map(
              (c, i) =>
                `<c r="${refs[i]}1" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(c.title ?? c.key)}</t></is></c>`,
            )
            .join('')}</row>`,
        );
      }
      let buf: string[] = [];
      for (let i = 0; i < sh.rowCount; i++) {
        const r = i + 2;
        let row = `<row r="${r}">`;
        for (let c = 0; c < sh.columns.length; c++) {
          row += cellXml(sh.vectors[c]!, sh.columns[c]!.type, i, `${refs[c]}${r}`, styles[c]!);
        }
        buf.push(`${row}</row>`);
        if (buf.length === ROWS_PER_CHUNK) {
          await write(buf.join(''));
          buf = [];
        }
      }
      if (buf.length > 0) await write(buf.join(''));
      const filter =
        sh.columns.length > 0 ? `<autoFilter ref="A1:${refs[sh.columns.length - 1]}1"/>` : '';
      await write(
        `</sheetData>${filter}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`,
      );
    });
  }

  const xml = (s: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`;
  const one = (text: string) => async (write: (t: string) => Promise<void>) => write(text);
  const numFmtXml = [...fmtIds]
    .filter(([, id]) => id >= 164)
    .map(([f, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(f)}"/>`)
    .join('');
  const xfs = [...xfOf.keys()]
    .map(
      (f) =>
        `<xf numFmtId="${fmtIds.get(f)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
    )
    .join('');
  await zip.entry(
    'xl/styles.xml',
    one(
      xml(
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          (numFmtXml
            ? `<numFmts count="${numFmtXml.split('<numFmt ').length - 1}">${numFmtXml}</numFmts>`
            : '') +
          '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          `<cellXfs count="${2 + xfOf.size}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>${xfs}</cellXfs>` +
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
          '</styleSheet>',
      ),
    ),
  );
  const sheetEntries = names
    .map((n, k) => `<sheet name="${esc(n)}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`)
    .join('');
  const filters = sheets
    .map((sh, k) =>
      sh.columns.length > 0
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${k}" hidden="1">'${esc(names[k]!.replace(/'/g, "''"))}'!$A$1:$${colName(sh.columns.length - 1)}$1</definedName>`
        : '',
    )
    .join('');
  await zip.entry(
    'xl/workbook.xml',
    one(
      xml(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<bookViews><workbookView/></bookViews><sheets>${sheetEntries}</sheets>` +
          (filters ? `<definedNames>${filters}</definedNames>` : '') +
          '</workbook>',
      ),
    ),
  );
  const rels = names
    .map(
      (_, k) =>
        `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`,
    )
    .join('');
  await zip.entry(
    'xl/_rels/workbook.xml.rels',
    one(
      xml(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    ),
  );
  await zip.entry(
    '_rels/.rels',
    one(
      xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    ),
  );
  const overrides = names
    .map(
      (_, k) =>
        `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  await zip.entry(
    '[Content_Types].xml',
    one(
      xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          `${overrides}</Types>`,
      ),
    ),
  );
  return zip.finish();
}
