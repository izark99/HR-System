import type { InputSlot, SlotColumn } from '@hrflow/flow-schema';
import * as XLSX from 'xlsx';
import { Big, decimalFrom, isDecimal } from '../core/decimal';
import type { ColumnDef, Row, Table, Value } from '../core/types';
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

interface RowRef {
  file: string;
  row: number;
}

interface FileReadResult {
  rows: Row[];
  refs: RowRef[];
  extraColumns: ColumnDef[];
  issues: ValidationIssue[];
  skipped: SkippedRow[];
  summary: FileSummary;
}

/**
 * Read every file of one input slot: validate each file with the slot config, union the rows
 * (adding `_source_file` when the slot accepts multiple files), then check `unique` rules on the
 * union so duplicates across files are reported with file + row of both occurrences.
 */
export function readSlot(slot: InputSlot, files: readonly SourceFile[]): SlotReadResult {
  const issues: ValidationIssue[] = [];
  const skipped: SkippedRow[] = [];
  const summaries: FileSummary[] = [];
  const rows: Row[] = [];
  const refs: RowRef[] = [];
  const extraByKey = new Map<string, ColumnDef>();

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

  for (const file of files) {
    const ext = extensionOf(file.name);
    if (!slot.accept.includes(ext)) {
      issues.push({
        ...issue('error', 'file', 'validation.fileTypeNotAccepted', {
          file: file.name,
          accept: slot.accept.join(', '),
        }),
        file: file.name,
      });
      summaries.push({ file: file.name, dataRows: 0, skippedRows: 0 });
      continue;
    }
    const result = readSlotFile(slot, file);
    // No `push(...arr)`: spreading a large array as call arguments overflows the stack (~125k).
    appendAll(issues, result.issues);
    appendAll(skipped, result.skipped);
    summaries.push(result.summary);
    appendAll(rows, result.rows);
    appendAll(refs, result.refs);
    for (const col of result.extraColumns) {
      if (!extraByKey.has(col.key)) extraByKey.set(col.key, col);
    }
  }

  appendAll(issues, checkUnique(slot, rows, refs));

  const columns: ColumnDef[] = [
    ...slot.columns.map((c) => ({ key: c.key, type: c.type, title: columnTitle(c) })),
    ...extraByKey.values(),
  ];
  if (slot.multiple.enabled) columns.push({ key: SOURCE_FILE_COLUMN, type: 'string' });
  // Union by column key: a kept extra column missing in some file becomes null there.
  for (const row of rows) {
    for (const col of columns) if (!(col.key in row)) row[col.key] = null;
  }

  return { table: { columns, rows }, report: buildReport(issues, skipped, summaries) };
}

/** Read and validate a single file (no cross-file checks). */
export function readSlotFile(slot: InputSlot, file: SourceFile): FileReadResult {
  const empty = (issues: ValidationIssue[], sheet?: string): FileReadResult => ({
    rows: [],
    refs: [],
    extraColumns: [],
    issues,
    skipped: [],
    summary: { file: file.name, ...(sheet ? { sheet } : {}), dataRows: 0, skippedRows: 0 },
  });

  let wb: XLSX.WorkBook;
  try {
    wb = parseWorkbook(file);
  } catch {
    return empty([
      {
        ...issue('error', 'file', 'validation.fileUnreadable', { file: file.name }),
        file: file.name,
      },
    ]);
  }
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);

  const picked = pickSheet(slot, wb, file.name);
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
    .map((col) => ({ col, c: mapping.matches.get(col.key)?.[0], fallback: blankValue(col) }))
    .filter((m): m is { col: SlotColumn; c: number; fallback: Value } => m.c !== undefined);

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

  const rows: Row[] = [];
  const refs: RowRef[] = [];
  const skipped: SkippedRow[] = [];
  const dataStart = (slot.dataStartRow ?? slot.headerRow + slot.headerRows) - 1;
  const fillDataMerges = slot.unmergeCells === 'fillDown';
  let blankRun = 0;

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

    const row: Row = {};
    for (const col of slot.columns) row[col.key] = null;
    const rowAt = { ...at, row: excelRow };

    for (const { col, c, fallback } of mapped) {
      const cell = cellAt(c);
      const { error } = cell;
      const raw = displayRaw(cell, col.type, date1904);
      const colParams = { ...rowAt, column: columnTitle(col) };
      if (error) {
        issues.push(
          cellIssue('error', 'type', 'validation.type', col, rowAt, {
            ...colParams,
            value: error,
            type: col.type,
          }),
        );
        continue;
      }
      if (isBlank(raw)) {
        if (col.required) {
          issues.push(cellIssue('error', 'required', 'validation.required', col, rowAt, colParams));
        } else {
          row[col.key] = fallback;
        }
        continue;
      }
      // A real Excel date cell is always accepted by a date column, whatever dateFormats says.
      const dateCell = isDateCell(cell) && (col.type === 'date' || col.type === 'datetime');
      const dateFormats = dateCell ? ['excelSerial'] : col.dateFormats;
      const coerced = coerceValue(raw, col.type, {
        decimalSeparator: col.decimalSeparator,
        date1904,
        ...(dateFormats ? { dateFormats } : {}),
      });
      if (!coerced.ok) {
        issues.push(
          cellIssue('error', 'type', 'validation.type', col, rowAt, {
            ...colParams,
            value: String(raw),
            type: col.type,
          }),
        );
        continue;
      }
      row[col.key] = coerced.value;
      if (coerced.ambiguous) {
        issues.push(
          cellIssue('warning', 'type', 'validation.numberAmbiguous', col, rowAt, {
            ...colParams,
            value: String(raw),
            parsed: displayValue(coerced.value),
          }),
        );
      }
      appendAll(issues, checkValueRules(col, coerced.value, rowAt, colParams));
    }

    for (const { key, c } of extraIdx) {
      const coerced = coerceValue(displayRaw(cellAt(c), 'string', date1904), 'string');
      row[key] = coerced.ok ? coerced.value : null;
    }
    if (slot.multiple.enabled) row[SOURCE_FILE_COLUMN] = file.name;
    rows.push(row);
    refs.push({ file: file.name, row: excelRow });
  }

  if (rows.length === 0 && mapped.length > 0) {
    issues.push({ ...issue('warning', 'rows', 'validation.noDataRows', { ...at }), ...at });
  }
  if (slot.maxRows !== undefined && rows.length > slot.maxRows) {
    issues.push({
      ...issue('warning', 'rows', 'validation.rowsTooMany', {
        file: file.name,
        count: rows.length,
        max: slot.maxRows,
      }),
      ...at,
    });
  }

  return {
    rows,
    refs,
    extraColumns,
    issues,
    skipped,
    summary: { ...at, dataRows: rows.length, skippedRows: skipped.length },
  };
}

// ---------------------------------------------------------------------------------------------

function parseWorkbook(file: SourceFile): XLSX.WorkBook {
  const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
  const common: XLSX.ParsingOptions = {
    dense: true,
    cellDates: false, // dates as Excel serials; converted by the column's date rules
    cellFormula: false,
    cellHTML: false,
    cellText: false,
    // Keep each cell's number format (cheap string) so string columns can render the displayed
    // text and date columns can recognise real date cells, without formatting every cell.
    cellNF: true,
  };
  if (extensionOf(file.name) === '.csv') {
    // Decode explicitly as UTF-8 (BOM optional) so Vietnamese text survives; `raw` keeps every
    // CSV value as text so "01/09/2026" is not reinterpreted with a US locale.
    const text = new TextDecoder('utf-8').decode(bytes);
    return XLSX.read(text, { ...common, type: 'string', raw: true });
  }
  return XLSX.read(bytes, { ...common, type: 'array' });
}

interface CellRead {
  value: RawValue;
  error?: string;
  /** Excel number format of a numeric cell (absent / "General" when unformatted). */
  numFmt?: string;
}

interface Grid {
  lastRow: number;
  lastCol: number;
  cell(r: number, c: number, followMerges: boolean): CellRead;
  isRowBlank(r: number): boolean;
}

function makeGrid(ws: XLSX.WorkSheet): Grid {
  const data: (XLSX.CellObject | undefined)[][] = ws['!data'] ?? [];
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  const lastRow = range ? range.e.r : -1;
  const lastCol = range ? range.e.c : -1;
  const mergeOrigin = new Map<string, [number, number]>();
  for (const m of ws['!merges'] ?? []) {
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r !== m.s.r || c !== m.s.c) mergeOrigin.set(`${r},${c}`, [m.s.r, m.s.c]);
      }
    }
  }
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

function pickSheet(
  slot: InputSlot,
  wb: XLSX.WorkBook,
  fileName: string,
): { sheetName: string; grid: Grid; mapping: HeaderMapping } | { issue: ValidationIssue } {
  const load = (name: string) => {
    const grid = makeGrid(wb.Sheets[name]!);
    return { sheetName: name, grid, mapping: mapHeaders(slot, grid) };
  };
  const sel = slot.sheet;
  const fileIssue = (key: string, params: IssueParams): { issue: ValidationIssue } => ({
    issue: { ...issue('error', 'sheet', key, { file: fileName, ...params }), file: fileName },
  });

  if (sel.mode === 'byName') {
    const name =
      wb.SheetNames.find((n) => n === sel.value) ??
      wb.SheetNames.find((n) => normalizeHeader(n) === normalizeHeader(sel.value));
    return name ? load(name) : fileIssue('validation.sheetNotFound', { sheet: sel.value });
  }
  if (sel.mode === 'byIndex') {
    const name = wb.SheetNames[sel.value];
    return name ? load(name) : fileIssue('validation.sheetIndexNotFound', { index: sel.value + 1 });
  }
  const required = slot.columns.filter((c) => c.presence === 'required');
  for (const name of wb.SheetNames) {
    const loaded = load(name);
    if (required.every((c) => (loaded.mapping.matches.get(c.key) ?? []).length > 0)) return loaded;
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

function checkUnique(slot: InputSlot, rows: Row[], refs: RowRef[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const col of slot.columns) {
    const rule = col.rules.find((r) => 'unique' in r);
    if (!rule) continue;
    const first = new Map<string, RowRef>();
    rows.forEach((row, i) => {
      const v = row[col.key];
      if (v === null || v === undefined) return;
      const k = displayValue(v);
      const seen = first.get(k);
      const ref = refs[i]!;
      if (!seen) {
        first.set(k, ref);
        return;
      }
      out.push({
        ...issue(rule.severity, 'unique', 'validation.unique', {
          value: k,
          column: columnTitle(col),
          file: ref.file,
          row: ref.row,
          otherFile: seen.file,
          otherRow: seen.row,
        }),
        file: ref.file,
        row: ref.row,
        column: col.key,
      });
    });
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

function displayValue(v: Value): string {
  if (v === null) return '';
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
