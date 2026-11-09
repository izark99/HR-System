import { InputSlotSchema, type InputSlotInput } from '@hrflow/flow-schema';
import { isDecimal } from '../core/decimal';
import { normalizeKeyPart } from '../core/keys';
import type { Value } from '../core/types';
import { readSlotFile, type SourceFile } from './excel-reader';
import { normalizeHeader } from './normalize';
import { buildReport, type ValidationIssue, type ValidationReport } from './validation';

/**
 * Import of an Excel file into the draft of a reference table (spec §34 AC-RT-03), in the engine
 * worker: same reader as the input slots (zip-bomb limits, header aliases, type checks), the
 * table's columns as a one-file slot. Values never leave the worker except as the returned rows
 * (shown in the preview and saved as reference data by the Admin); nothing is logged.
 */

export type RefImportType = 'string' | 'integer' | 'decimal' | 'date' | 'boolean';

export interface RefImportColumn {
  key: string;
  title: string;
  type: RefImportType;
  aliases: string[];
  isKey: boolean;
}

export type RefImportValue = string | number | boolean;
export type RefImportRow = Record<string, RefImportValue>;

export interface RefImportResult {
  report: ValidationReport;
  /** Sheet read (when one matched). */
  sheet: string | null;
  /** Data rows read (skipped blank-key rows excluded). */
  rowCount: number;
  /** Every row when the report has no error, else null. Blank cells are left out. */
  rows: RefImportRow[] | null;
  /** First rows for the preview (also with errors). */
  preview: RefImportRow[];
}

export const REF_IMPORT_PREVIEW_ROWS = 200;

/** Decimal storage limits of reference tables (database CHECK: 28 + 10 digits). */
const MAX_INT_DIGITS = 28;
const MAX_FRACTION_DIGITS = 10;

function slotOf(columns: readonly RefImportColumn[]): InputSlotInput {
  const keys = columns.filter((c) => c.isKey).map((c) => c.key);
  return {
    key: 'ref_import',
    label: 'ref_import',
    accept: ['.xlsx', '.xls'],
    sheet: { mode: 'firstMatchingHeaders' },
    headerRow: 1,
    columns: columns.map((c) => {
      const seen = new Set<string>();
      const aliases = [c.title, ...c.aliases, c.key].filter((a) => {
        const n = normalizeHeader(a);
        if (!n || seen.has(n)) return false;
        seen.add(n);
        return true;
      });
      return {
        key: c.key,
        label: c.title,
        aliases,
        type: c.type,
        presence: 'required' as const,
        required: c.isKey,
      };
    }),
    // A row whose key columns are all blank (total line, signature…) is not data.
    ...(keys.length > 0 ? { skipRows: { whenBlank: keys } } : {}),
    extraColumns: 'keep',
  };
}

function plain(v: Value | undefined): RefImportValue | null {
  if (v === null || v === undefined) return null;
  return isDecimal(v) ? v.toFixed() : v;
}

function issueAt(
  severity: ValidationIssue['severity'],
  rule: ValidationIssue['rule'],
  messageKey: string,
  params: ValidationIssue['params'],
  extra: Partial<ValidationIssue>,
): ValidationIssue {
  return { severity, rule, messageKey, params, ...extra };
}

/**
 * Read one file with the table's columns. `maxRows`: more data rows is an error (no rows are
 * returned then, the preview still is).
 */
export function readRefImport(
  file: SourceFile,
  columns: readonly RefImportColumn[],
  maxRows: number,
): RefImportResult {
  const slot = InputSlotSchema.parse(slotOf(columns));
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (file.name.lastIndexOf('.') < 0 || !(slot.accept as readonly string[]).includes(ext)) {
    const issue = issueAt(
      'error',
      'file',
      'validation.fileTypeNotAccepted',
      { file: file.name, accept: slot.accept.join(', ') },
      { file: file.name },
    );
    return {
      report: buildReport([issue], [], []),
      sheet: null,
      rowCount: 0,
      rows: null,
      preview: [],
    };
  }

  let read = readSlotFile(slot, file);
  // No sheet holds every column: read the first sheet for one "missing column" line per column.
  if (read.issues.some((i) => i.messageKey === 'validation.sheetNoMatchingHeaders')) {
    read = readSlotFile({ ...slot, sheet: { mode: 'byIndex', value: 0 } }, file);
  }
  const issues: ValidationIssue[] = [...read.issues];
  const sheet = read.summary.sheet ?? null;
  const at = { file: file.name, ...(sheet ? { sheet } : {}) };

  // Columns of the file that the table does not define: ignored (AC-RT-03, warning).
  for (const extra of read.extraColumns) {
    issues.push(
      issueAt(
        'warning',
        'column',
        'refTables:import.extraColumn',
        { ...at, column: extra.title ?? extra.key },
        { ...at },
      ),
    );
  }

  const table = read.table;
  const n = table.rowCount;
  const vectors = columns.map((c) => ({ c, vec: table.vector(c.key) }));
  const keyCols = vectors.filter((x) => x.c.isKey);

  // Decimal precision the database stores, then duplicate keys (all key columns together, text
  // compared without case / extra spaces like the slot `unique` rule).
  for (const { c, vec } of vectors) {
    if (c.type !== 'decimal' || !vec) continue;
    for (let i = 0; i < n; i++) {
      const v = vec.get(i);
      if (!isDecimal(v)) continue;
      const [int = '', frac = ''] = v.abs().toFixed().split('.');
      if (int.replace(/^0+/, '').length > MAX_INT_DIGITS || frac.length > MAX_FRACTION_DIGITS) {
        const row = read.excelRows[i]!;
        issues.push(
          issueAt(
            'error',
            'type',
            'refTables:import.tooPrecise',
            { ...at, row, column: c.title, value: v.toFixed(), digits: MAX_FRACTION_DIGITS },
            { ...at, row, column: c.key },
          ),
        );
      }
    }
  }
  if (keyCols.length > 0 && keyCols.every((k) => k.vec)) {
    const first = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const parts: string[] = [];
      let blank = false;
      for (const { vec } of keyCols) {
        const v = vec!.get(i);
        if (v === null || v === undefined) blank = true;
        parts.push(normalizeKeyPart(v));
      }
      if (blank) continue; // reported as `required`
      const k = parts.join('\u001f');
      const seen = first.get(k);
      if (seen === undefined) {
        first.set(k, i);
        continue;
      }
      const label = (j: number) =>
        keyCols.map(({ vec }) => String(plain(vec!.get(j)) ?? '')).join(' · ');
      const row = read.excelRows[i]!;
      issues.push(
        issueAt(
          'error',
          'unique',
          'refTables:import.duplicateKey',
          { ...at, row, otherRow: read.excelRows[seen]!, value: label(i), otherValue: label(seen) },
          { ...at, row, column: keyCols[0]!.c.key },
        ),
      );
    }
  }

  if (n > maxRows) {
    issues.push(
      issueAt(
        'error',
        'rows',
        'refTables:import.tooManyRows',
        { ...at, count: n, max: maxRows },
        at,
      ),
    );
  }

  const report = buildReport(issues, read.skipped, [read.summary]);
  const rowAt = (i: number): RefImportRow => {
    const out: RefImportRow = {};
    for (const { c, vec } of vectors) {
      const v = vec ? plain(vec.get(i)) : null;
      if (v !== null && !(typeof v === 'string' && v === '')) out[c.key] = v;
    }
    return out;
  };
  const preview: RefImportRow[] = [];
  for (let i = 0; i < Math.min(n, REF_IMPORT_PREVIEW_ROWS); i++) preview.push(rowAt(i));
  let rows: RefImportRow[] | null = null;
  if (report.errorCount === 0) {
    rows = [];
    for (let i = 0; i < n; i++) rows.push(rowAt(i));
  }
  return { report, sheet, rowCount: n, rows, preview };
}
