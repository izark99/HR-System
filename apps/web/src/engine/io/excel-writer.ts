import type { DataType } from '@hrflow/flow-schema';
import ExcelJS from 'exceljs';
import { isDecimal } from '../core/decimal';
import type { ColumnDef, Table, Value } from '../core/types';

export interface SheetSpec {
  name: string;
  table: Table;
}

const DEFAULT_NUM_FMT: Partial<Record<DataType, string>> = {
  integer: '#,##0',
  decimal: '#,##0.00',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm:ss',
};

const MIN_WIDTH = 8;
const MAX_WIDTH = 50;
/** Rows sampled for column width estimation. */
const WIDTH_SAMPLE = 1000;

/**
 * Build a multi-sheet .xlsx (spec §11 `output.excel`): bold header, frozen first row,
 * auto-filter, column widths, number format by column type.
 */
export async function writeWorkbook(sheets: readonly SheetSpec[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const usedNames = new Set<string>();

  for (const spec of sheets) {
    const name = uniqueSheetName(spec.name, usedNames);
    const { columns, rows } = spec.table;
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });

    ws.columns = columns.map((col) => ({
      header: col.title ?? col.key,
      key: col.key,
      width: estimateWidth(col, spec.table),
      style: numFmtStyle(col),
    }));
    for (const row of rows) {
      ws.addRow(columns.map((col) => toCellValue(row[col.key] ?? null, col.type)));
    }

    const header = ws.getRow(1);
    header.font = { bold: true };
    // Column styles also apply to the header row; keep header cells unformatted text.
    header.eachCell((cell) => {
      cell.numFmt = 'General';
    });
    if (columns.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function numFmtStyle(col: ColumnDef): Partial<ExcelJS.Style> {
  const numFmt = col.numFmt ?? DEFAULT_NUM_FMT[col.type];
  return numFmt ? { numFmt } : {};
}

/** Convert engine values to ExcelJS cell values. Decimals become Excel numbers only here. */
function toCellValue(v: Value, type: DataType): ExcelJS.CellValue {
  if (v === null) return null;
  if (isDecimal(v)) return Number(v.toString());
  if ((type === 'date' || type === 'datetime') && typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/.exec(v);
    if (m) {
      const [, y, mo, d, hh = '0', mi = '0', ss = '0'] = m;
      // ExcelJS converts Dates using UTC, so build the wall time in UTC.
      return new Date(Date.UTC(+y!, +mo! - 1, +d!, +hh, +mi, +ss));
    }
  }
  return v;
}

function displayLength(v: Value, type: DataType): number {
  if (v === null) return 0;
  if (type === 'date') return 10;
  if (type === 'datetime') return 19;
  const s = isDecimal(v) ? v.toFixed(2) : String(v);
  // Room for thousands separators on numbers.
  return typeof v === 'number' || isDecimal(v) ? s.length + Math.floor(s.length / 3) : s.length;
}

function estimateWidth(col: ColumnDef, table: Table): number {
  let max = (col.title ?? col.key).length;
  const n = Math.min(table.rows.length, WIDTH_SAMPLE);
  for (let i = 0; i < n; i++) {
    max = Math.max(max, displayLength(table.rows[i]![col.key] ?? null, col.type));
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, max + 2));
}

/**
 * Excel sheet names: max 31 chars, no : \ / ? * [ ], no leading/trailing apostrophe, unique
 * case-insensitively. The schema rejects such names at design time; this keeps the writer from
 * throwing if one slips through.
 */
export function uniqueSheetName(requested: string, used: Set<string>): string {
  const clean = (s: string) =>
    s
      .trim()
      .replace(/^'+|'+$/g, '')
      .trim();
  const base = clean(clean(requested.replace(/[:\\/?*[\]]/g, '_')).slice(0, 31)) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}
