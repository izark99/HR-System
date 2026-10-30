import type { InputSlot, SlotColumn } from '@hrflow/flow-schema';
import * as XLSX from 'xlsx';
import { Big, decimalFrom, isDecimal } from '../core/decimal';
import { normalizeKeyPart } from '../core/keys';
import type { DecimalBuilder } from '../core/table';
import { columnBuilder, exactDouble, StringBuilder, type ColumnBuilder } from '../core/table';
import { Table, type ColumnDef, type Value } from '../core/types';
import { coerceValue, isBlank, type RawValue } from './coerce';
import { normalizeHeader, slugifyHeader } from './normalize';
import {
  buildReport,
  type FileSummary,
  type IssueParams,
  type SkippedRow,
  type ValidationIssue,
  type ValidationReport,
} from './validation';
import {
  mergeOrigins,
  openXlsx,
  XlsxTooLargeError,
  type CellRead,
  type Grid,
  type XlsxPackage,
} from './xlsx-stream';

/** File content handed over by the UI. The name stays in the browser (never logged/uploaded). */
export interface SourceFile {
  name: string;
  data: ArrayBuffer | Uint8Array;
}

export interface SlotReadResult {
  table: Table;
  report: ValidationReport;
}

/** System column with the originating file name (multi-file slots, spec §10). */
export const SOURCE_FILE_COLUMN = '_source_file';

const EXCEL_ERRORS: Record<number, string> = {
  0: '#NULL!',
  7: '#DIV/0!',
  15: '#VALUE!',
  23: '#REF!',
  29: '#NAME?',
  36: '#NUM!',
  42: '#N/A',
  43: '#GETTING_DATA',
};

/** Excel row of every table row (1-based), for cross-file `unique` messages. */
interface FileReadResult {
  table: Table;
  excelRows: Int32Array;
  extraColumns: ColumnDef[];
  issues: ValidationIssue[];
  skipped: SkippedRow[];
  summary: FileSummary;
}

/** The sheets of one file; `grid(i)` parses sheet `i` on first use. */
interface Book {
  sheetNames: string[];
  date1904: boolean;
  grid(index: number): Grid;
}

/**
 * Read every file of one input slot: validate each file with the slot config, union the rows
 * (adding `_source_file` when the slot accepts multiple files), then check `unique` rules on the
 * union so duplicates across files are reported with file + row of both occurrences.
 */
export function readSlot(slot: InputSlot, files: readonly SourceFile[]): SlotReadResult {
  const pre = slotFileIssues(slot, files);
  return unionFiles(
    slot,
    files.map((f) => (pre.accepted.has(f) ? readSlotFile(slot, f) : rejected(slot, f))),
    pre.issues,
  );
}

/**
 * Same as `readSlot`, for the app: .xlsx sheets are inflated in chunks with the native
 * decompressor (lower peak memory, faster). Results are identical.
 */
export async function readSlotAsync(
  slot: InputSlot,
  files: readonly SourceFile[],
): Promise<SlotReadResult> {
  const pre = slotFileIssues(slot, files);
  const results: FileReadResult[] = [];
  for (const f of files) {
    results.push(pre.accepted.has(f) ? await readSlotFileAsync(slot, f) : rejected(slot, f));
  }
  return unionFiles(slot, results, pre.issues);
}

function slotFileIssues(slot: InputSlot, files: readonly SourceFile[]) {
  const issues: ValidationIssue[] = [];
  const maxFiles = slot.multiple.enabled ? slot.multiple.maxFiles : 1;
  const minFiles = slot.multiple.enabled ? slot.multiple.minFiles : 1;
  if (files.length === 0) {
    if (slot.required) {
      issues.push(issue('error', 'files', 'validation.slotRequired', { slot: slot.label }));
    }
  } else if (files.length < minFiles) {
    issues.push(
      issue('error', 'files', 'validation.filesTooFew', { min: minFiles, count: files.length }),
    );
  } else if (files.length > maxFiles) {
    issues.push(
      issue('error', 'files', 'validation.filesTooMany', { max: maxFiles, count: files.length }),
    );
  }
  const accepted = new Set(
    files.filter((f) => (slot.accept as readonly string[]).includes(extensionOf(f.name))),
  );
  return { issues, accepted };
}

function rejected(slot: InputSlot, file: SourceFile): FileReadResult {
  return {
    ...emptyResult(slot, file),
    issues: [
      {
        ...issue('error', 'file', 'validation.fileTypeNotAccepted', {
          file: file.name,
          accept: slot.accept.join(', '),
        }),
        file: file.name,
      },
    ],
  };
}

function unionFiles(
  slot: InputSlot,
  results: readonly FileReadResult[],
  issues: ValidationIssue[],
): SlotReadResult {
  const skipped: SkippedRow[] = [];
  const summaries: FileSummary[] = [];
  const extraByKey = new Map<string, ColumnDef>();
  for (const result of results) {
    // No `push(...arr)`: spreading a large array as call arguments overflows the stack (~125k).
    appendAll(issues, result.issues);
    appendAll(skipped, result.skipped);
    summaries.push(result.summary);
    for (const col of result.extraColumns) {
      if (!extraByKey.has(col.key)) extraByKey.set(col.key, col);
    }
  }
  const columns: ColumnDef[] = [
    ...slot.columns.map((c) => ({ key: c.key, type: c.type, title: columnTitle(c) })),
    ...extraByKey.values(),
  ];
  if (slot.multiple.enabled) columns.push({ key: SOURCE_FILE_COLUMN, type: 'string' });
  // Union by column key: a kept extra column missing in some file becomes null there.
  const table = Table.concat(
    columns,
    results.map((r) => r.table),
  );
  appendAll(issues, checkUnique(slot, table, results));
  return { table, report: buildReport(issues, skipped, summaries) };
}

function emptyResult(slot: InputSlot, file: SourceFile, sheet?: string): FileReadResult {
  return {
    table: Table.empty(slot.columns.map((c) => ({ key: c.key, type: c.type }))),
    excelRows: new Int32Array(0),
    extraColumns: [],
    issues: [],
    skipped: [],
    summary: { file: file.name, ...(sheet ? { sheet } : {}), dataRows: 0, skippedRows: 0 },
  };
}

function unreadable(slot: InputSlot, file: SourceFile, err?: unknown): FileReadResult {
  const key =
    err instanceof XlsxTooLargeError ? 'validation.fileTooLarge' : 'validation.fileUnreadable';
  return {
    ...emptyResult(slot, file),
    issues: [{ ...issue('error', 'file', key, { file: file.name }), file: file.name }],
  };
}

/** Files below this size are retried with SheetJS when the streaming reader fails. */
const FALLBACK_MAX_BYTES = 64 * 1024 * 1024;

function bytesOf(file: SourceFile): Uint8Array {
  return file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
}

/** Open the workbook: streaming reader for OOXML packages, SheetJS for the rest. */
function openBook(file: SourceFile): { book: Book; pkg: XlsxPackage | null } {
  const bytes = bytesOf(file);
  if (!hasExcelSignature(bytes)) throw new Error('not an Excel file');
  let pkg: XlsxPackage | null;
  try {
    pkg = startsWith(bytes, ZIP_SIGNATURE) ? openXlsx(bytes) : null;
  } catch (err) {
    // A zip bomb must not reach SheetJS either.
    if (err instanceof XlsxTooLargeError) throw err;
    pkg = null;
  }
  if (pkg) {
    const p = pkg;
    const cache = new Map<number, Grid>();
    return {
      pkg,
      book: {
        sheetNames: p.sheetNames,
        date1904: p.date1904,
        grid(i) {
          let g = cache.get(i);
          if (!g) cache.set(i, (g = p.readSheet(i)));
          return g;
        },
      },
    };
  }
  return { book: sheetJsBook(parseWorkbook(file)), pkg: null };
}

function sheetJsBook(wb: XLSX.WorkBook): Book {
  return {
    sheetNames: wb.SheetNames,
    date1904: Boolean(wb.Workbook?.WBProps?.date1904),
    grid: (i) => makeGrid(wb.Sheets[wb.SheetNames[i]!]!),
  };
}

/** Read and validate a single file (no cross-file checks). */
export function readSlotFile(slot: InputSlot, file: SourceFile): FileReadResult {
  let opened: ReturnType<typeof openBook>;
  try {
    opened = openBook(file);
  } catch (err) {
    return unreadable(slot, file, err);
  }
  try {
    return readBook(slot, file, opened.book);
  } catch (err) {
    if (err instanceof XlsxTooLargeError) return unreadable(slot, file, err);
    if (!opened.pkg || bytesOf(file).length > FALLBACK_MAX_BYTES) return unreadable(slot, file);
  }
  // The streaming reader failed on this package: let SheetJS try.
  try {
    return readBook(slot, file, sheetJsBook(parseWorkbook(file)));
  } catch {
    return unreadable(slot, file);
  }
}

async function readSlotFileAsync(slot: InputSlot, file: SourceFile): Promise<FileReadResult> {
  let opened: ReturnType<typeof openBook>;
  try {
    opened = openBook(file);
  } catch (err) {
    return unreadable(slot, file, err);
  }
  const pkg = opened.pkg;
  if (!pkg) return readSlotFile(slot, file);
  try {
    // Parse (in chunks) exactly the sheets `pickSheet` will look at, then validate.
    const grids = new Map<number, Grid>();
    const book: Book = {
      sheetNames: pkg.sheetNames,
      date1904: pkg.date1904,
      grid: (i) => grids.get(i) ?? pkg.readSheet(i),
    };
    for (const i of sheetCandidates(slot, pkg.sheetNames)) {
      const grid = await pkg.readSheetAsync(i);
      grids.set(i, grid);
      if (slot.sheet.mode !== 'firstMatchingHeaders' || sheetMatches(slot, mapHeaders(slot, grid)))
        break;
    }
    return readBook(slot, file, book);
  } catch (err) {
    // Too large: stop here (the synchronous retry would inflate it all again).
    if (err instanceof XlsxTooLargeError) return unreadable(slot, file, err);
    return readSlotFile(slot, file);
  }
}

/** Decimal column cell kept as a double (fast path) — see `readBook`. */
const AS_DOUBLE = Symbol('double');

function readBook(slot: InputSlot, file: SourceFile, book: Book): FileReadResult {
  const empty = (issues: ValidationIssue[], sheet?: string): FileReadResult => ({
    ...emptyResult(slot, file, sheet),
    issues,
  });
  const date1904 = book.date1904;

  const picked = pickSheet(slot, book, file.name);
  if ('issue' in picked) return empty([picked.issue]);
  const { sheetName, grid, mapping } = picked;

  const issues: ValidationIssue[] = [];
  const at = { file: file.name, sheet: sheetName };
  for (const col of slot.columns) {
    const found = mapping.matches.get(col.key) ?? [];
    if (found.length === 0) {
      issues.push({
        ...issue(
          col.presence === 'required' ? 'error' : 'warning',
          'column',
          col.presence === 'required'
            ? 'validation.columnMissing'
            : 'validation.columnMissingOptional',
          {
            ...at,
            column: columnTitle(col),
            aliases: col.aliases.join(', '),
            headerRow: slot.headerRow,
          },
        ),
        ...at,
        column: col.key,
      });
    } else if (found.length > 1) {
      // Several matching headers: an error when the column must exist (which one is right?).
      const req = col.presence === 'required';
      issues.push({
        ...issue(
          req ? 'error' : 'warning',
          'column',
          req ? 'validation.columnAmbiguousRequired' : 'validation.columnAmbiguous',
          {
            ...at,
            column: columnTitle(col),
            headers: found.map((c) => `"${mapping.headers[c]}"`).join(', '),
          },
        ),
        ...at,
        column: col.key,
      });
    }
  }

  // A missing key column (`skipRows.whenBlank`, presence required) makes every row unidentifiable:
  // report only the missing column, not one error per row.
  const keyMissing = (slot.skipRows?.whenBlank ?? []).some(
    (k) =>
      slot.columns.find((c) => c.key === k)?.presence === 'required' &&
      (mapping.matches.get(k) ?? []).length === 0,
  );
  if (keyMissing) return empty(issues, sheetName);

  const mapped = slot.columns
    .map((col, index) => ({
      col,
      index,
      c: mapping.matches.get(col.key)?.[0],
      fallback: blankValue(col),
      bounds: ruleBounds(col),
    }))
    .filter((m): m is typeof m & { c: number } => m.c !== undefined);

  // Extra columns kept as strings under a slug of their header.
  const extraColumns: ColumnDef[] = [];
  const extraIdx: { key: string; c: number }[] = [];
  if (slot.extraColumns === 'keep') {
    const used = new Set(mapped.map((m) => m.c));
    const taken = new Set([...slot.columns.map((c) => c.key), SOURCE_FILE_COLUMN]);
    mapping.headers.forEach((h, c) => {
      if (used.has(c) || h === '') return;
      let key = slugifyHeader(h);
      for (let i = 2; taken.has(key); i++) key = `${slugifyHeader(h)}_${i}`;
      taken.add(key);
      extraColumns.push({ key, type: 'string', title: h });
      extraIdx.push({ key, c });
    });
  }

  // Row exclusion rules: skip when every `skipRows.whenBlank` (key) column is blank, or when a key
  // column contains a `whenKeyContains` text. Only applied when all key columns were found;
  // otherwise every row would vanish silently.
  const skipCols = slot.skipRows?.whenBlank ?? [];
  const skipIdx = skipCols.map((k) => mapping.matches.get(k)?.[0]);
  const skipActive = skipIdx.length > 0 && skipIdx.every((c) => c !== undefined);
  const skipTexts = (slot.skipRows?.whenKeyContains ?? [])
    .map((text) => ({ text, norm: normalizeHeader(text) }))
    .filter((x) => x.norm !== '');

  const dataStart = (slot.dataStartRow ?? slot.headerRow + slot.headerRows) - 1;
  const capacity = Math.max(16, grid.lastRow - dataStart + 1);
  const builders: ColumnBuilder[] = slot.columns.map((c) => columnBuilder(c.type, capacity));
  const extraBuilders = extraIdx.map(() => new StringBuilder('string', capacity));
  const sourceBuilder = slot.multiple.enabled ? new StringBuilder('string', capacity) : null;
  const excelRows: number[] = [];
  const skipped: SkippedRow[] = [];
  const fillDataMerges = slot.unmergeCells === 'fillDown';
  let blankRun = 0;
  // One row's values; decimal fast path: AS_DOUBLE + the double in `doubles`.
  const values = new Array<Value | typeof AS_DOUBLE>(slot.columns.length);
  const doubles = new Float64Array(slot.columns.length);
  const dateCache = new Map<number, string | null>();
  const datetimeCache = new Map<number, string | null>();

  for (let r = dataStart; r <= grid.lastRow; r++) {
    const cellAt = (c: number) => grid.cell(r, c, fillDataMerges);
    if (grid.isRowBlank(r)) {
      blankRun++;
      if (slot.stopAt && blankRun >= slot.stopAt.blankRows) break;
      continue;
    }
    blankRun = 0;
    const excelRow = r + 1;

    if (skipActive && skipIdx.every((c) => isBlank(cellAt(c).value))) {
      skipped.push({
        file: file.name,
        sheet: sheetName,
        row: excelRow,
        messageKey: 'skipped.keyBlank',
        params: {
          file: file.name,
          row: excelRow,
          columns: skipCols
            .map((k) => columnTitle(slot.columns.find((c) => c.key === k)!))
            .join(', '),
        },
      });
      continue;
    }
    if (skipActive && skipTexts.length > 0) {
      const hit = findKeyText(skipCols, skipIdx, skipTexts, cellAt);
      if (hit) {
        skipped.push({
          file: file.name,
          sheet: sheetName,
          row: excelRow,
          messageKey: 'skipped.keyContains',
          params: {
            file: file.name,
            row: excelRow,
            column: columnTitle(slot.columns.find((c) => c.key === hit.key)!),
            text: hit.text,
          },
        });
        continue;
      }
    }

    values.fill(null);
    const rowAt = { ...at, row: excelRow };

    for (const { col, index, c, fallback, bounds } of mapped) {
      const cell = cellAt(c);
      const { error } = cell;
      if (error) {
        issues.push(
          cellIssue('error', 'type', 'validation.type', col, rowAt, {
            ...rowAt,
            column: columnTitle(col),
            value: error,
            type: col.type,
          }),
        );
        continue;
      }
      const raw = displayRaw(cell, col.type, date1904);
      if (isBlank(raw)) {
        if (col.required) {
          issues.push(
            cellIssue('error', 'required', 'validation.required', col, rowAt, {
              ...rowAt,
              column: columnTitle(col),
            }),
          );
        } else {
          values[index] = fallback;
        }
        continue;
      }
      // Fast path (no allocation): an Excel number in a decimal column becomes the double of its
      // 15-significant-digit value, which the decimal vector stores exactly.
      if (col.type === 'decimal' && typeof raw === 'number' && Number.isFinite(raw)) {
        const x = round15(raw);
        values[index] = AS_DOUBLE;
        doubles[index] = x;
        if (bounds) checkDoubleRules(col, bounds, x, rowAt, issues);
        continue;
      }
      // A real Excel date cell is always accepted by a date column, whatever dateFormats says.
      const dateCell = isDateCell(cell) && (col.type === 'date' || col.type === 'datetime');
      const dateFormats = dateCell ? ['excelSerial'] : col.dateFormats;
      // Excel serials repeat a lot (same days): cache their ISO text per file.
      const cache =
        typeof raw === 'number' &&
        (dateFormats ?? ['excelSerial']).includes('excelSerial') &&
        (col.type === 'date' || col.type === 'datetime')
          ? col.type === 'date'
            ? dateCache
            : datetimeCache
          : null;
      const cached = cache?.get(raw as number);
      if (cached !== undefined && cached !== null && col.rules.length === 0) {
        values[index] = cached;
        continue;
      }
      const coerced = coerceValue(raw, col.type, {
        decimalSeparator: col.decimalSeparator,
        date1904,
        ...(dateFormats ? { dateFormats } : {}),
      });
      if (cache) cache.set(raw as number, coerced.ok ? (coerced.value as string) : null);
      if (!coerced.ok) {
        issues.push(
          cellIssue('error', 'type', 'validation.type', col, rowAt, {
            ...rowAt,
            column: columnTitle(col),
            value: String(raw),
            type: col.type,
          }),
        );
        continue;
      }
      values[index] = coerced.value;
      if (coerced.ambiguous) {
        issues.push(
          cellIssue('warning', 'type', 'validation.numberAmbiguous', col, rowAt, {
            ...rowAt,
            column: columnTitle(col),
            value: String(raw),
            parsed: displayValue(coerced.value),
          }),
        );
      }
      if (col.rules.length > 0) {
        appendAll(
          issues,
          checkValueRules(col, coerced.value, rowAt, { ...rowAt, column: columnTitle(col) }),
        );
      }
    }

    for (let k = 0; k < builders.length; k++) {
      const v = values[k];
      if (v === AS_DOUBLE) (builders[k] as DecimalBuilder).pushDouble(doubles[k]!);
      else builders[k]!.push(v);
    }
    extraIdx.forEach(({ c }, k) => {
      const coerced = coerceValue(displayRaw(cellAt(c), 'string', date1904), 'string');
      extraBuilders[k]!.push(coerced.ok ? coerced.value : null);
    });
    sourceBuilder?.push(file.name);
    excelRows.push(excelRow);
  }

  const rowCount = excelRows.length;
  if (rowCount === 0 && mapped.length > 0) {
    issues.push({ ...issue('warning', 'rows', 'validation.noDataRows', { ...at }), ...at });
  }
  if (slot.maxRows !== undefined && rowCount > slot.maxRows) {
    issues.push({
      ...issue('warning', 'rows', 'validation.rowsTooMany', {
        file: file.name,
        count: rowCount,
        max: slot.maxRows,
      }),
      ...at,
    });
  }

  const columns: ColumnDef[] = [
    ...slot.columns.map((c) => ({ key: c.key, type: c.type })),
    ...extraColumns,
    ...(sourceBuilder ? [{ key: SOURCE_FILE_COLUMN, type: 'string' as const }] : []),
  ];
  const table = new Table(
    columns,
    [
      ...builders.map((b) => b.finish()),
      ...extraBuilders.map((b) => b.finish()),
      ...(sourceBuilder ? [sourceBuilder.finish()] : []),
    ],
    rowCount,
  );
  return {
    table,
    excelRows: Int32Array.from(excelRows),
    extraColumns,
    issues,
    skipped,
    summary: { ...at, dataRows: rowCount, skippedRows: skipped.length },
  };
}

const POW10 = [1, 10, 100, 1000, 10000];

/**
 * `Number(n.toPrecision(15))` (the 15 significant digits Excel shows, spec §9.4) without
 * allocating for the usual values: integers and numbers with ≤ 4 decimals already are their own
 * 15-digit value.
 */
export function round15(n: number): number {
  const a = Math.abs(n);
  if (Number.isInteger(n) && a < 1e15) return n === 0 ? 0 : n;
  for (let p = 1; p < POW10.length; p++) {
    const y = Math.round(a * POW10[p]!);
    if (y < 1e15 && y / POW10[p]! === a) return n;
  }
  const x = Number(n.toPrecision(15));
  return x === 0 ? 0 : x;
}

interface RuleBound {
  rule: SlotColumn['rules'][number];
  kind: 'min' | 'max';
  /** The bound as an exact-representation double, or null (compare with big.js). */
  value: number | null;
  big: InstanceType<typeof Big>;
}

/** min/max/regex rules of a decimal column, pre-parsed for the double fast path. */
function ruleBounds(col: SlotColumn): RuleBound[] | null {
  if (col.type !== 'decimal' || col.rules.length === 0) return null;
  const out: RuleBound[] = [];
  for (const rule of col.rules) {
    if ('min' in rule) {
      const big = new Big(rule.min);
      out.push({ rule, kind: 'min', big, value: exactDouble(big.toString()) });
    }
    if ('max' in rule) {
      const big = new Big(rule.max);
      out.push({ rule, kind: 'max', big, value: exactDouble(big.toString()) });
    }
  }
  return out;
}

/** `checkValueRules` for a decimal cell kept as a double (same messages, same order). */
function checkDoubleRules(
  col: SlotColumn,
  bounds: RuleBound[],
  x: number,
  at: { file: string; sheet: string; row: number },
  issues: ValidationIssue[],
): void {
  const regex = col.rules.some((r) => 'regex' in r);
  if (!regex && bounds.length === 0) return;
  if (regex) {
    // Rare: keep the exact semantics of the general path.
    appendAll(
      issues,
      checkValueRules(col, new Big(String(x)), at, { ...at, column: columnTitle(col) }),
    );
    return;
  }
  for (const b of bounds) {
    const fails =
      b.value !== null
        ? b.kind === 'min'
          ? x < b.value
          : x > b.value
        : b.kind === 'min'
          ? new Big(String(x)).lt(b.big)
          : new Big(String(x)).gt(b.big);
    if (!fails) continue;
    const severity = b.rule.severity;
    issues.push(
      cellIssue(severity, b.kind, `validation.${b.kind}`, col, at, {
        ...at,
        column: columnTitle(col),
        value: String(x),
        [b.kind]: String(
          b.kind === 'min'
            ? (b.rule as { min: string | number }).min
            : (b.rule as { max: string | number }).max,
        ),
      }),
    );
  }
}

// ---------------------------------------------------------------------------------------------

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // .xlsx (OOXML package)
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // .xls (BIFF in OLE2)

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];
const isSpaceUnit = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/**
 * First non-blank character is "<": an HTML/XML spreadsheet export ("Excel" files many HR systems
 * produce). Plain UTF-8, UTF-8 with BOM and UTF-16 (LE/BE, with BOM) are recognised.
 */
function looksLikeMarkup(bytes: Uint8Array): boolean {
  const LIMIT = 512;
  if (startsWith(bytes, UTF16LE_BOM) || startsWith(bytes, UTF16BE_BOM)) {
    const le = bytes[0] === 0xff;
    const end = Math.min(bytes.length - 1, 2 + LIMIT * 2);
    for (let i = 2; i < end; i += 2) {
      const unit = le ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!;
      if (!isSpaceUnit(unit)) return unit === 0x3c;
    }
    return false;
  }
  let i = startsWith(bytes, UTF8_BOM) ? 3 : 0;
  const end = Math.min(bytes.length, i + LIMIT);
  while (i < end && isSpaceUnit(bytes[i]!)) i++;
  return bytes[i] === 0x3c;
}

/**
 * SheetJS falls back to reading unknown bytes as plain text (one "Sheet1"), which would surface as
 * a misleading "sheet not found". Check the container format first so empty/corrupt files are
 * reported as unreadable. The extension (already checked against the slot's `accept`) does not
 * decide the parser: SheetJS detects the format from the content, so an OLE workbook named
 * .xlsx or an OOXML package named .xls are read fine. Plain text/CSV/TSV is always refused,
 * whatever its extension (CSV is not accepted, MEMORY 13:08).
 */
function hasExcelSignature(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, ZIP_SIGNATURE) || startsWith(bytes, OLE_SIGNATURE) || looksLikeMarkup(bytes)
  );
}

/**
 * A markup export with a byte-order mark, decoded to text. SheetJS mis-decodes UTF-16 and treats
 * "BOM + line break + <html>" as delimited text, so these are handed over as a string instead.
 */
function decodeBomMarkup(bytes: Uint8Array): string | null {
  const encoding = startsWith(bytes, UTF16LE_BOM)
    ? 'utf-16le'
    : startsWith(bytes, UTF16BE_BOM)
      ? 'utf-16be'
      : startsWith(bytes, UTF8_BOM)
        ? 'utf-8'
        : null;
  if (!encoding || !looksLikeMarkup(bytes)) return null;
  // TextDecoder drops the BOM; leading blanks would make SheetJS sniff plain text.
  return new TextDecoder(encoding).decode(bytes).trimStart();
}

function parseWorkbook(file: SourceFile): XLSX.WorkBook {
  const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
  if (!hasExcelSignature(bytes)) throw new Error('not an Excel file');
  const text = decodeBomMarkup(bytes);
  return XLSX.read(text ?? bytes, {
    type: text === null ? 'array' : 'string',
    dense: true,
    cellDates: false, // dates as Excel serials; converted by the column's date rules
    cellFormula: false,
    cellHTML: false,
    cellText: false,
    // Keep each cell's number format (cheap string) so string columns can render the displayed
    // text and date columns can recognise real date cells, without formatting every cell.
    cellNF: true,
  });
}

function makeGrid(ws: XLSX.WorkSheet): Grid {
  const data: (XLSX.CellObject | undefined)[][] = ws['!data'] ?? [];
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  const lastRow = range ? range.e.r : -1;
  const lastCol = range ? range.e.c : -1;
  const mergeOrigin = mergeOrigins(ws['!merges'] ?? []);
  const raw = (r: number, c: number): CellRead => {
    const cell = data[r]?.[c];
    if (!cell || cell.v === undefined || cell.t === 'z') return { value: null };
    if (cell.t === 'e') {
      const code = typeof cell.v === 'number' ? cell.v : -1;
      return { value: null, error: EXCEL_ERRORS[code] ?? '#ERROR' };
    }
    const v = cell.v;
    if (typeof v === 'number' && cell.z !== undefined && cell.z !== 'General')
      return { value: v, numFmt: String(cell.z) };
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      return { value: v };
    return { value: null };
  };
  return {
    lastRow,
    lastCol,
    cell(r, c, followMerges) {
      const own = raw(r, c);
      if (!followMerges || !isBlank(own.value) || own.error) return own;
      const origin = mergeOrigin.get(`${r},${c}`);
      return origin ? raw(origin[0], origin[1]) : own;
    },
    isRowBlank(r) {
      const row = data[r];
      if (!row) return true;
      return row.every((cell) => {
        if (!cell || cell.t === 'z' || cell.v === undefined) return true;
        return cell.t !== 'e' && typeof cell.v === 'string' && cell.v.trim() === '';
      });
    },
  };
}

interface HeaderMapping {
  /** Header text per column index ("" when empty). */
  headers: string[];
  /** Slot column key → matching column indexes, in sheet order. */
  matches: Map<string, number[]>;
}

function mapHeaders(slot: InputSlot, grid: Grid): HeaderMapping {
  const headers: string[] = [];
  for (let c = 0; c <= grid.lastCol; c++) {
    const parts: string[] = [];
    for (let h = 0; h < slot.headerRows; h++) {
      // Header cells always follow merges (merged group headers span several columns).
      const { value } = grid.cell(slot.headerRow - 1 + h, c, true);
      const text = isBlank(value) ? '' : String(value).replace(/\s+/g, ' ').trim();
      if (text !== '' && parts[parts.length - 1] !== text) parts.push(text);
    }
    headers.push(parts.join(' / '));
  }
  const normalized = headers.map(normalizeHeader);
  const matches = new Map<string, number[]>();
  for (const col of slot.columns) {
    const aliases = new Set(col.aliases.map(normalizeHeader));
    matches.set(
      col.key,
      normalized.flatMap((h, c) => (h !== '' && aliases.has(h) ? [c] : [])),
    );
  }
  return { headers, matches };
}

/** Sheets `pickSheet` may read, in the order it reads them. */
function sheetCandidates(slot: InputSlot, names: readonly string[]): number[] {
  const sel = slot.sheet;
  if (sel.mode === 'byName') {
    let i = names.findIndex((n) => n === sel.value);
    if (i < 0) i = names.findIndex((n) => normalizeHeader(n) === normalizeHeader(sel.value));
    return i < 0 ? [] : [i];
  }
  if (sel.mode === 'byIndex') return sel.value < names.length ? [sel.value] : [];
  return names.map((_, i) => i);
}

/** `firstMatchingHeaders` sheet mode: every required column has a matching header. */
function sheetMatches(slot: InputSlot, mapping: HeaderMapping): boolean {
  return slot.columns
    .filter((c) => c.presence === 'required')
    .every((c) => (mapping.matches.get(c.key) ?? []).length > 0);
}

function pickSheet(
  slot: InputSlot,
  book: Book,
  fileName: string,
): { sheetName: string; grid: Grid; mapping: HeaderMapping } | { issue: ValidationIssue } {
  const load = (i: number) => {
    const grid = book.grid(i);
    return { sheetName: book.sheetNames[i]!, grid, mapping: mapHeaders(slot, grid) };
  };
  const sel = slot.sheet;
  const fileIssue = (key: string, params: IssueParams): { issue: ValidationIssue } => ({
    issue: { ...issue('error', 'sheet', key, { file: fileName, ...params }), file: fileName },
  });
  const candidates = sheetCandidates(slot, book.sheetNames);
  if (sel.mode === 'byName') {
    return candidates.length > 0
      ? load(candidates[0]!)
      : fileIssue('validation.sheetNotFound', { sheet: sel.value });
  }
  if (sel.mode === 'byIndex') {
    return candidates.length > 0
      ? load(candidates[0]!)
      : fileIssue('validation.sheetIndexNotFound', { index: sel.value + 1 });
  }
  for (const i of candidates) {
    const loaded = load(i);
    if (sheetMatches(slot, loaded.mapping)) return loaded;
  }
  return fileIssue('validation.sheetNoMatchingHeaders', {});
}

function checkValueRules(
  col: SlotColumn,
  value: Value,
  at: { file: string; sheet: string; row: number },
  params: IssueParams,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const display = displayValue(value);
  for (const rule of col.rules) {
    if ('regex' in rule) {
      if (!compiledRegex(rule.regex).test(display)) {
        out.push(
          cellIssue(rule.severity, 'regex', 'validation.regex', col, at, {
            ...params,
            value: display,
          }),
        );
      }
    } else if ('min' in rule || 'max' in rule) {
      const n = numericValue(value);
      if (n === null) continue;
      if ('min' in rule && n.lt(new Big(rule.min))) {
        out.push(
          cellIssue(rule.severity, 'min', 'validation.min', col, at, {
            ...params,
            value: display,
            min: String(rule.min),
          }),
        );
      }
      if ('max' in rule && n.gt(new Big(rule.max))) {
        out.push(
          cellIssue(rule.severity, 'max', 'validation.max', col, at, {
            ...params,
            value: display,
            max: String(rule.max),
          }),
        );
      }
    }
  }
  return out;
}

const regexCache = new Map<string, RegExp>();
function compiledRegex(source: string): RegExp {
  let re = regexCache.get(source);
  if (!re) {
    re = new RegExp(source);
    regexCache.set(source, re);
  }
  return re;
}

/**
 * `unique` rules on the union of all files. String columns compare with the same key
 * normalization as `control.compare` (case, whitespace, NFC; decision 20261026) so a duplicate the
 * compare node would reject is reported here, at validation time. Messages show the original
 * values of both occurrences.
 */
function checkUnique(
  slot: InputSlot,
  table: Table,
  files: readonly FileReadResult[],
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  // Row i of the union → file + Excel row.
  const starts: number[] = [];
  let n = 0;
  for (const f of files) {
    starts.push(n);
    n += f.table.rowCount;
  }
  const refOf = (i: number) => {
    let k = starts.length - 1;
    while (k > 0 && starts[k]! > i) k--;
    const f = files[k]!;
    return { file: f.summary.file, row: f.excelRows[i - starts[k]!]! };
  };
  for (const col of slot.columns) {
    const rule = col.rules.find((r) => 'unique' in r);
    if (!rule) continue;
    const keyOf = col.type === 'string' ? normalizeKeyPart : displayValue;
    const vec = table.vector(col.key)!;
    const first = new Map<string, number>();
    for (let i = 0; i < table.rowCount; i++) {
      const v = vec.get(i);
      if (v === null) continue;
      const k = keyOf(v);
      const seenAt = first.get(k);
      if (seenAt === undefined) {
        first.set(k, i);
        continue;
      }
      const ref = refOf(i);
      const seen = refOf(seenAt);
      out.push({
        ...issue(rule.severity, 'unique', 'validation.unique', {
          value: displayValue(v),
          column: columnTitle(col),
          file: ref.file,
          row: ref.row,
          otherValue: displayValue(vec.get(seenAt)),
          otherFile: seen.file,
          otherRow: seen.row,
        }),
        file: ref.file,
        row: ref.row,
        column: col.key,
        ...(seen.file !== ref.file ? { relatedFile: seen.file } : {}),
      });
    }
  }
  return out;
}

function issue(
  severity: ValidationIssue['severity'],
  rule: ValidationIssue['rule'],
  messageKey: string,
  params: IssueParams,
): ValidationIssue {
  return { severity, rule, messageKey, params };
}

function cellIssue(
  severity: ValidationIssue['severity'],
  rule: ValidationIssue['rule'],
  messageKey: string,
  col: SlotColumn,
  at: { file: string; sheet: string; row: number },
  params: IssueParams,
): ValidationIssue {
  return { ...issue(severity, rule, messageKey, params), ...at, column: col.key };
}

/** SheetJS number-format engine; typed here because the bundled typings declare it as `any`. */
const SSF = XLSX.SSF as {
  format(fmt: string, value: number, opts?: { date1904?: boolean }): string;
  is_date(fmt: string): boolean;
};

/**
 * Raw value as the column should see it: a formatted numeric cell in a `string` column becomes the
 * text Excel displays ("00123", "01/09/2026"). Excel's locale short date (built-in format 14,
 * which SheetJS names "m/d/yy") is rendered as dd/mm/yyyy, the convention of the organisation.
 */
function displayRaw(cell: CellRead, type: SlotColumn['type'], date1904: boolean): RawValue {
  if (type !== 'string' || typeof cell.value !== 'number' || !cell.numFmt) return cell.value;
  const fmt = cell.numFmt === 'm/d/yy' ? 'dd/mm/yyyy' : cell.numFmt;
  try {
    return SSF.format(fmt, cell.value, { date1904 });
  } catch {
    return cell.value;
  }
}

function isDateCell(cell: CellRead): boolean {
  return typeof cell.value === 'number' && !!cell.numFmt && SSF.is_date(cell.numFmt);
}

function findKeyText(
  keys: readonly string[],
  idx: readonly number[],
  texts: readonly { text: string; norm: string }[],
  cellAt: (c: number) => CellRead,
): { key: string; text: string } | null {
  for (let i = 0; i < idx.length; i++) {
    const v = cellAt(idx[i]!).value;
    if (isBlank(v)) continue;
    const norm = normalizeHeader(String(v));
    const hit = texts.find((t) => norm.includes(t.norm));
    if (hit) return { key: keys[i]!, text: hit.text };
  }
  return null;
}

/** Value of a blank cell in a non-required column: `defaultValue` in the column type, or null. */
function blankValue(col: SlotColumn): Value {
  const d = col.defaultValue;
  if (d === undefined) return null;
  switch (col.type) {
    case 'decimal':
      return typeof d === 'boolean' ? null : decimalFrom(d);
    case 'integer':
      return typeof d === 'boolean' ? null : Number(d);
    default:
      // string / boolean / ISO date text: the schema guarantees the JSON type fits.
      return d;
  }
}

/** Append without spreading into call arguments (safe for arrays of any length). */
function appendAll<T>(target: T[], items: readonly T[]): void {
  for (const item of items) target.push(item);
}

function columnTitle(col: SlotColumn): string {
  return col.label ?? col.aliases[0] ?? col.key;
}

function displayValue(v: Value | undefined): string {
  if (v === null || v === undefined) return '';
  if (isDecimal(v)) return v.toString();
  return String(v);
}

function numericValue(v: Value): InstanceType<typeof Big> | null {
  if (isDecimal(v)) return v;
  if (typeof v === 'number') return new Big(v);
  return null;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/** Reader internals for the parity tests (streaming grid vs SheetJS grid). Not used by the app. */
export const readerInternals = {
  sheetJsGrid(file: SourceFile, index: number): Grid {
    return sheetJsBook(parseWorkbook(file)).grid(index);
  },
  openXlsx(file: SourceFile): XlsxPackage | null {
    return openXlsx(bytesOf(file));
  },
};
