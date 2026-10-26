/**
 * QA helpers: fake payroll / timesheet workbooks shaped like the acceptance fixtures
 * (spec §24.1, fixtures/payroll-timesheet), built in memory. Fake data only.
 */
import { FlowDefinitionSchema, type FlowDefinition, type InputSlot } from '@hrflow/flow-schema';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import type { SourceFile } from '../io/excel-reader';

export type Cell = string | number | boolean | null;

export const FIXTURES = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');

let cachedFlow: FlowDefinition | undefined;
export function acceptanceFlow(): FlowDefinition {
  cachedFlow ??= FlowDefinitionSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8')),
  );
  return cachedFlow;
}

export function acceptanceSlot(key: 'bang_luong' | 'cham_cong'): InputSlot {
  const s = acceptanceFlow().inputSlots.find((x) => x.key === key);
  if (!s) throw new Error(`slot ${key} missing`);
  // Deep copy so a test can tweak it without leaking into other tests.
  return structuredClone(s);
}

export function acceptanceNodeConfig(id: string): Record<string, unknown> {
  const n = acceptanceFlow().nodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return structuredClone(n.config);
}

/** [ma_nv, ho_ten, chi_nhanh, cong, ot, phep, khong_luong] */
export type EmpRow = [Cell, Cell, Cell, Cell, Cell, Cell, Cell];

export const PAYROLL_HEADERS = [
  'STT',
  'Mã NV',
  'Họ và tên',
  'Chi nhánh',
  'Công tính lương',
  'Giờ OT',
  'Ngày phép',
  'Nghỉ không lương',
];

export const TIMESHEET_HEADERS = [
  'Mã nhân viên',
  'Họ tên',
  'Chi nhánh',
  'Công thực tế',
  'OT (giờ)',
  'Phép (ngày)',
  'Không lương (ngày)',
];

export interface PayrollOptions {
  idHeader?: string;
  headers?: string[];
  /** Extra rows appended after the data (default: the "TỔNG CỘNG" row like the fixture). */
  tail?: Cell[][];
  sheetName?: string;
  date1904?: boolean;
}

/** Payroll sheet like the fixture: merged title row 1, blank rows 2–3, header row 4, data from 5. */
export function payrollAoa(rows: EmpRow[], opts: PayrollOptions = {}): Cell[][] {
  const headers = opts.headers ?? [...PAYROLL_HEADERS];
  if (opts.idHeader) headers[1] = opts.idHeader;
  const tail = opts.tail ?? [[null, null, 'TỔNG CỘNG', null, null, null, null, null]];
  return [
    ['BẢNG LƯƠNG THÁNG 09/2026', null, null, null, null, null, null, null],
    [],
    [],
    headers,
    ...rows.map((r, i): Cell[] => [i + 1, ...r]),
    ...tail,
  ];
}

export function payrollFile(name: string, rows: EmpRow[], opts: PayrollOptions = {}): SourceFile {
  return workbookFile(
    name,
    { [opts.sheetName ?? 'Luong']: payrollAoa(rows, opts) },
    {
      merges: { [opts.sheetName ?? 'Luong']: [XLSX.utils.decode_range('A1:H1')] },
      ...(opts.date1904 !== undefined ? { date1904: opts.date1904 } : {}),
    },
  );
}

export function timesheetFile(
  name: string,
  rows: EmpRow[],
  opts: { headers?: string[]; tail?: Cell[][] } = {},
): SourceFile {
  return workbookFile(name, {
    ChamCong: [opts.headers ?? TIMESHEET_HEADERS, ...rows, ...(opts.tail ?? [])],
  });
}

export interface WorkbookOptions {
  merges?: Record<string, XLSX.Range[]>;
  date1904?: boolean;
  /** Per-sheet cell overrides, e.g. number formats: { Data: { B2: { t: 'n', v: 123, z: '00000' } } } */
  cells?: Record<string, Record<string, XLSX.CellObject>>;
  bookType?: XLSX.BookType;
}

export function workbookFile(
  name: string,
  sheets: Record<string, Cell[][]>,
  opts: WorkbookOptions = {},
): SourceFile {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, aoa] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (opts.merges?.[sheetName]) ws['!merges'] = opts.merges[sheetName];
    for (const [addr, cell] of Object.entries(opts.cells?.[sheetName] ?? {})) {
      ws[addr] = cell;
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      const pos = XLSX.utils.decode_cell(addr);
      range.e.r = Math.max(range.e.r, pos.r);
      range.e.c = Math.max(range.e.c, pos.c);
      ws['!ref'] = XLSX.utils.encode_range(range);
    }
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  if (opts.date1904) wb.Workbook = { ...(wb.Workbook ?? {}), WBProps: { date1904: true } };
  const data = XLSX.write(wb, { type: 'array', bookType: opts.bookType ?? 'xlsx' }) as ArrayBuffer;
  return { name, data };
}

/** Deterministic fake employee id NV00001… */
export const nv = (i: number) => `NV${String(i).padStart(5, '0')}`;

/** n fake employees with fixed, clean metric values. */
export function fakeEmployees(n: number, start = 1, branch = 'CN01'): EmpRow[] {
  return Array.from({ length: n }, (_, k): EmpRow => {
    const i = start + k;
    return [nv(i), `Nhân viên ${i}`, branch, 26, 4, 1, 0];
  });
}
