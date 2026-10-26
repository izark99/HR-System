/**
 * QA (tester) — input slot reader & validation report edge cases (spec §10, AC-01..03, 07, 08).
 * Fake data only. Tests in the "KNOWN BUGS" block use `it.fails`: they assert the expected
 * behaviour and currently fail; flip them to `it` once the bug is fixed.
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { Big, isDecimal } from '../core/decimal';
import { createEngineTranslator } from '../core/i18n';
import type { Value } from '../core/types';
import { readSlot, SOURCE_FILE_COLUMN } from '../io/excel-reader';
import { formatIssue, type ValidationIssue, type ValidationReport } from '../io/validation';
import { csvFile, slot } from './helpers';
import {
  acceptanceSlot,
  fakeEmployees,
  nv,
  payrollFile,
  timesheetFile,
  workbookFile,
  type EmpRow,
} from './qa-helpers';

const t = createEngineTranslator('vi');
const errors = (r: ValidationReport) => r.issues.filter((i) => i.severity === 'error');
const keys = (issues: ValidationIssue[]) => issues.map((i) => i.messageKey);
const dec = (v: Value | undefined) => {
  if (!isDecimal(v)) throw new Error(`not a decimal: ${String(v)}`);
  return v.toString();
};

// -------------------------------------------------------------------------------------------
describe('QA reader: skipRows / total rows (AC-03)', () => {
  it('drops the "TỔNG CỘNG" row (blank Mã NV) as skipped info, even when it carries SUM values', () => {
    const file = payrollFile('bl.xlsx', fakeEmployees(3), {
      tail: [[null, null, 'TỔNG CỘNG', null, 78, 12, 3, 0]],
    });
    const { table, report } = readSlot(acceptanceSlot('bang_luong'), [file]);
    expect(report.issues).toEqual([]);
    expect(table.rows).toHaveLength(3);
    expect(report.skippedRows).toHaveLength(1);
    expect(report.skippedRows[0]).toMatchObject({ row: 8, messageKey: 'skipped.keyBlank' });
    expect(report.errorCount).toBe(0);
  });

  it('a total row with text in the key column is NOT skipped: it fails the regex rule (blocks the run)', () => {
    // Real files often merge "TỔNG CỘNG" across STT+Mã NV, so the text lands in the key column.
    const file = payrollFile('bl.xlsx', fakeEmployees(2), {
      tail: [[null, 'TỔNG CỘNG', null, null, 52, 8, 2, 0]],
    });
    const { table, report } = readSlot(acceptanceSlot('bang_luong'), [file]);
    expect(keys(errors(report))).toEqual(['validation.regex']);
    expect(errors(report)[0]).toMatchObject({ row: 7, column: 'ma_nv' });
    // The row is still in the table (with an error) — the run is blocked by errorCount > 0.
    expect(table.rows.map((r) => r.ma_nv)).toContain('TỔNG CỘNG');
  });

  it('without a regex rule, a total row with text in the key column becomes an "employee" silently', () => {
    const s = acceptanceSlot('bang_luong');
    s.columns[0]!.rules = [{ unique: true, severity: 'error' }];
    const file = payrollFile('bl.xlsx', fakeEmployees(2), {
      tail: [[null, 'TỔNG CỘNG', null, null, 52, 8, 2, 0]],
    });
    const { table, report } = readSlot(s, [file]);
    expect(report.errorCount).toBe(0);
    expect(table.rows).toHaveLength(3); // documented: needs a regex (or a future text rule) to catch
  });

  it('a signature block below the total row is skipped when the key column is blank', () => {
    const file = payrollFile('bl.xlsx', fakeEmployees(2), {
      tail: [
        [null, null, 'TỔNG CỘNG', null, 52, 8, 2, 0],
        [],
        [null, null, 'Người lập biểu', null, null, 'Kế toán trưởng', null, null],
      ],
    });
    const { table, report } = readSlot(acceptanceSlot('bang_luong'), [file]);
    expect(report.errorCount).toBe(0);
    expect(table.rows).toHaveLength(2);
    expect(report.skippedRows.map((s) => s.row)).toEqual([7, 9]);
  });

  it('skipRows column missing from the file: rule is inactive and the missing column is an error (not silent)', () => {
    // Header "Mã số" is not an alias → ma_nv missing; the total row must not vanish silently.
    const file = payrollFile('bl.xlsx', fakeEmployees(2), { idHeader: 'Mã số' });
    const { table, report } = readSlot(acceptanceSlot('bang_luong'), [file]);
    const missing = errors(report).filter((i) => i.messageKey === 'validation.columnMissing');
    expect(missing.map((i) => i.column)).toEqual(['ma_nv']);
    expect(report.skippedRows).toEqual([]);
    // Side effect today: the total row (row 7) is read as data and its blank metrics add extra
    // "required" errors on row 7 (noisy, not silent). Any other error must be on that row.
    const others = errors(report).filter((i) => i.messageKey !== 'validation.columnMissing');
    expect(others.every((i) => i.row === 7)).toBe(true);
    // All rows incl. the total row are read with ma_nv = null; the run is blocked anyway.
    expect(table.rows).toHaveLength(3);
    expect(table.rows.every((r) => r.ma_nv === null)).toBe(true);
  });

  it('skipRows on an optional column that is missing: total row is read and caught by required key', () => {
    const s = acceptanceSlot('bang_luong');
    s.skipRows = { whenBlank: ['ho_ten'] }; // admin chose an optional column
    const headers = [
      'STT',
      'Mã NV',
      'Tên',
      'Chi nhánh',
      'Công tính lương',
      'Giờ OT',
      'Ngày phép',
      'Nghỉ không lương',
    ];
    const file = payrollFile('bl.xlsx', fakeEmployees(2), { headers });
    const { report } = readSlot(s, [file]);
    expect(keys(report.issues)).toContain('validation.columnMissingOptional');
    // "TỔNG CỘNG" row: ma_nv blank and every metric blank → required errors, not silent data.
    expect(errors(report).every((i) => i.row === 7)).toBe(true);
    expect(keys(errors(report))).toContain('validation.required');
  });
});

// -------------------------------------------------------------------------------------------
describe('QA reader: metric columns must exist; key value must be filled', () => {
  // Blank metric cells → 0 is decided (docs/MEMORY.md 20261026) but not implemented yet;
  // see "KNOWN BUGS (reader)" below for those tests.
  it('blank Mã NV on an employee row (no skipRows) is still a required error', () => {
    const s = acceptanceSlot('bang_luong');
    delete s.skipRows;
    const rows = fakeEmployees(2);
    rows[1]![0] = null;
    const { report } = readSlot(s, [payrollFile('a.xlsx', rows, { tail: [] })]);
    expect(errors(report).map((i) => [i.messageKey, i.column, i.row])).toEqual([
      ['validation.required', 'ma_nv', 6],
    ]);
  });

  it('a "-" placeholder typed as text in a decimal column is a type error', () => {
    const rows = fakeEmployees(1);
    rows[0]![4] = '-';
    const { report } = readSlot(acceptanceSlot('bang_luong'), [payrollFile('a.xlsx', rows)]);
    expect(keys(errors(report))).toEqual(['validation.type']);
  });

  it('a whole required metric column missing → one columnMissing error naming file + column (AC-08)', () => {
    const headers = [
      'STT',
      'Mã NV',
      'Họ và tên',
      'Chi nhánh',
      'Công tính lương',
      'OT',
      'Ngày phép',
      'Nghỉ không lương',
    ];
    const { report } = readSlot(acceptanceSlot('bang_luong'), [
      payrollFile('CN09.xlsx', fakeEmployees(2), { headers }),
    ]);
    expect(keys(errors(report))).toEqual(['validation.columnMissing']);
    const msg = formatIssue(errors(report)[0]!, t);
    expect(msg).toContain('CN09.xlsx');
    expect(msg).toContain('OT (giờ)');
    expect(msg).toContain('Giờ OT'); // accepted aliases are listed
    expect(msg).toContain('dòng tiêu đề 4');
  });

  it('missing Mã NV column in one of several files names that file only (AC-08)', () => {
    const ok = payrollFile('CN01.xlsx', fakeEmployees(2));
    const bad = payrollFile('CN02.xlsx', fakeEmployees(2, 10), { idHeader: 'Mã' });
    const { report } = readSlot(acceptanceSlot('bang_luong'), [ok, bad]);
    const missing = errors(report).filter((i) => i.messageKey === 'validation.columnMissing');
    expect(missing).toHaveLength(1);
    // Only CN02 has errors (column missing + the total row's blank metrics, see skipRows test).
    expect(errors(report).every((i) => i.file === 'CN02.xlsx')).toBe(true);
    expect(missing[0]).toMatchObject({
      messageKey: 'validation.columnMissing',
      file: 'CN02.xlsx',
      column: 'ma_nv',
    });
    expect(formatIssue(missing[0]!, t)).toMatch(/CN02\.xlsx.*"Mã NV"/);
  });
});

// -------------------------------------------------------------------------------------------
describe('QA reader: numbers (decimalSeparator, float noise)', () => {
  const numSlot = (sep: '.' | ',') =>
    slot({
      columns: [
        { key: 'ma_nv', aliases: ['Mã NV'], type: 'string', required: true },
        { key: 'cong', aliases: ['Công'], type: 'decimal', decimalSeparator: sep },
      ],
    });
  const read = (sep: '.' | ',', values: (string | number)[]) =>
    readSlot(numSlot(sep), [
      workbookFile('n.xlsx', {
        Sheet1: [['Mã NV', 'Công'], ...values.map((v, i): (string | number)[] => [nv(i + 1), v])],
      }),
    ]);

  it('decimalSeparator "," parses "1.234,5" and "1,5" typed as text', () => {
    const { table, report } = read(',', ['1.234,5', '1,5', '26', ' 1 234,50 ']);
    expect(report.issues).toEqual([]);
    expect(table.rows.map((r) => dec(r.cong))).toEqual(['1234.5', '1.5', '26', '1234.5']);
  });

  it('decimalSeparator "." rejects "1,5" (type error) but reads "1,234.5"', () => {
    const { table, report } = read('.', ['1,5', '1,234.5']);
    expect(keys(errors(report))).toEqual(['validation.type']);
    expect(errors(report)[0]!.row).toBe(2);
    expect(dec(table.rows[1]!.cong)).toBe('1234.5');
  });

  it('decimalSeparator "." silently reads "1,500" as 1500 (thousands grouping)', () => {
    // Documented ambiguity: a VN-style "1,500" meaning 1.5 becomes 1500 with the default ".".
    const { table, report } = read('.', ['1,500']);
    expect(report.issues).toEqual([]);
    expect(dec(table.rows[0]!.cong)).toBe('1500');
  });

  it('numeric cells are independent of decimalSeparator', () => {
    const { table } = read(',', [26.5]);
    expect(dec(table.rows[0]!.cong)).toBe('26.5');
  });

  it('15-significant-digit cleanup of Excel doubles', () => {
    const { table } = read('.', [25.499999999999996, 0.1 + 0.2, 26.3 - 0.8, 1e-7, 123456789.12]);
    expect(table.rows.map((r) => dec(r.cong))).toEqual([
      '25.5',
      '0.3',
      '25.5',
      '1e-7',
      '123456789.12',
    ]);
    expect(new Big(dec(table.rows[3]!.cong)).eq('0.0000001')).toBe(true);
  });

  it('rejects junk numerics', () => {
    const { report } = read('.', ['abc', '1.2.3', '', 'Infinity', '(5)']);
    // '' is blank (not required) → no issue; the other 4 are type errors.
    expect(errors(report).map((i) => i.row)).toEqual([2, 3, 5, 6]);
  });
});

// -------------------------------------------------------------------------------------------
describe('QA reader: dates', () => {
  const dateSlot = (formats?: string[]) =>
    slot({
      columns: [
        { key: 'ma_nv', aliases: ['Mã NV'], type: 'string', required: true },
        {
          key: 'ngay',
          aliases: ['Ngày'],
          type: 'date',
          ...(formats ? { dateFormats: formats } : {}),
        },
        { key: 'ghi_chu', aliases: ['Ghi chú'], type: 'string' },
      ],
    });

  it('Excel serial, dd/MM/yyyy text and single-digit day/month', () => {
    const file = workbookFile('d.xlsx', {
      Sheet1: [
        ['Mã NV', 'Ngày', 'Ghi chú'],
        [nv(1), 46266, null],
        [nv(2), '01/09/2026', null],
        [nv(3), '1/9/2026', null],
        [nv(4), 46266.75, null], // datetime serial in a date column → date part
        [nv(5), 61, null], // 1900-03-01 (after the 1900 leap-year bug)
        [nv(6), 1, null], // 1900-01-01
      ],
    });
    const { table, report } = readSlot(dateSlot(), [file]);
    expect(report.issues).toEqual([]);
    expect(table.rows.map((r) => r.ngay)).toEqual([
      '2026-09-01',
      '2026-09-01',
      '2026-09-01',
      '2026-09-01',
      '1900-03-01',
      '1900-01-01',
    ]);
  });

  it('invalid dates are type errors: 31/09, US-style 09/31, 1900-02-29 (serial 60), negative serial', () => {
    const file = workbookFile('d.xlsx', {
      Sheet1: [
        ['Mã NV', 'Ngày'],
        [nv(1), '31/09/2026'],
        [nv(2), '09/31/2026'],
        [nv(3), 60],
        [nv(4), -1],
      ],
    });
    const { report } = readSlot(dateSlot(), [file]);
    expect(errors(report).map((i) => i.row)).toEqual([2, 3, 4, 5]);
  });

  it('1904 date system (SheetJS-written workbook): serial 0 → 1904-01-01', () => {
    const file = workbookFile(
      'mac.xlsx',
      {
        Sheet1: [
          ['Mã NV', 'Ngày'],
          [nv(1), 0],
          [nv(2), 44804], // 46266 − 1462 → 2026-09-01
        ],
      },
      { date1904: true },
    );
    const { table, report } = readSlot(dateSlot(), [file]);
    expect(report.errorCount).toBe(0);
    expect(table.rows.map((r) => r.ngay)).toEqual(['1904-01-01', '2026-09-01']);
  });

  it('a date column restricted to dd/MM/yyyy rejects a real Excel date cell (serial)', () => {
    // Documented: the admin must add "excelSerial" to dateFormats — easy to forget (product Q).
    const file = workbookFile('d.xlsx', {
      Sheet1: [
        ['Mã NV', 'Ngày'],
        [nv(1), 46266],
      ],
    });
    const { report } = readSlot(dateSlot(['dd/MM/yyyy']), [file]);
    expect(keys(errors(report))).toEqual(['validation.type']);
  });

  it('a date text with a time part fails a date-only format', () => {
    const file = workbookFile('d.xlsx', {
      Sheet1: [
        ['Mã NV', 'Ngày'],
        [nv(1), '01/09/2026 08:00'],
      ],
    });
    const { report } = readSlot(dateSlot(), [file]);
    expect(keys(errors(report))).toEqual(['validation.type']);
  });

  it('a string column receiving a date cell gets the raw serial, not the displayed date', () => {
    // Current behaviour (cellText: false). Product question: should string columns use the
    // formatted text ("01/09/2026")?
    const file = workbookFile(
      'd.xlsx',
      { Sheet1: [['Mã NV', 'Ngày', 'Ghi chú']] },
      {
        cells: {
          Sheet1: {
            A2: { t: 's', v: nv(1) },
            C2: { t: 'n', v: 46266, z: 'dd/mm/yyyy' },
          },
        },
      },
    );
    const { table } = readSlot(dateSlot(), [file]);
    expect(table.rows[0]!.ghi_chu).toBe('46266');
  });

  it('a numeric id with a "00000" number format loses its leading zeros in a string column', () => {
    // Current behaviour. Matters for flows whose key is a numeric employee code (product Q).
    const file = workbookFile(
      'id.xlsx',
      { Sheet1: [['Mã NV', 'Ngày']] },
      { cells: { Sheet1: { A2: { t: 'n', v: 123, z: '00000' } } } },
    );
    const { table } = readSlot(dateSlot(), [file]);
    expect(table.rows[0]!.ma_nv).toBe('123');
  });
});

// -------------------------------------------------------------------------------------------
describe('QA reader: headers, sheets, layout', () => {
  it('header normalization: diacritics, NBSP, line breaks, case, decomposed Unicode', () => {
    const headers = [
      'STT',
      'MÃ NV',
      'Họ\nvà   tên',
      'CHI NHÁNH',
      'Cong tinh luong',
      'Giờ OT'.normalize('NFD'),
      ' ngày phép ',
      'Nghỉ không lương​',
    ];
    const { table, report } = readSlot(acceptanceSlot('bang_luong'), [
      payrollFile('h.xlsx', fakeEmployees(2), { headers }),
    ]);
    expect(report.issues).toEqual([]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toMatchObject({ ma_nv: nv(1), ho_ten: 'Nhân viên 1' });
  });

  it('header with a trailing "*" or ":" does not match (alias must be exact after normalization)', () => {
    const headers = [
      'STT',
      'Mã NV*',
      'Họ và tên',
      'Chi nhánh',
      'Công tính lương:',
      'Giờ OT',
      'Ngày phép',
      'Nghỉ không lương',
    ];
    const { report } = readSlot(acceptanceSlot('bang_luong'), [
      payrollFile('h.xlsx', fakeEmployees(1), { headers }),
    ]);
    const missing = errors(report).filter((i) => i.messageKey === 'validation.columnMissing');
    expect(missing.map((i) => i.column)).toEqual(['ma_nv', 'cong']);
  });

  it('duplicate header (two "Mã NV" columns) → ambiguity warning, first column used', () => {
    const file = workbookFile('dup.xlsx', {
      Sheet1: [
        ['Mã NV', 'Công', 'Mã NV'],
        [nv(1), 26, 'XX'],
      ],
    });
    const s = slot({
      columns: [
        { key: 'ma_nv', aliases: ['Mã NV'], type: 'string', required: true },
        { key: 'cong', aliases: ['Công'], type: 'decimal' },
      ],
    });
    const { table, report } = readSlot(s, [file]);
    expect(keys(report.issues)).toEqual(['validation.columnAmbiguous']);
    expect(report.issues[0]!.severity).toBe('warning');
    expect(table.rows[0]!.ma_nv).toBe(nv(1));
  });

  it('wrong header row offset (header actually on row 5) → required columns reported missing', () => {
    const s = acceptanceSlot('bang_luong');
    const file = payrollFile('off.xlsx', fakeEmployees(2), {});
    s.headerRow = 3;
    s.dataStartRow = 4;
    const { report } = readSlot(s, [file]);
    expect(errors(report).filter((i) => i.messageKey === 'validation.columnMissing')).toHaveLength(
      5,
    );
    expect(errors(report)[0]!.params.headerRow).toBe(3);
  });

  it('sheet byName matches "Lương" / " LUONG " via normalization; wrong name is a clear error', () => {
    const okA = payrollFile('a.xlsx', fakeEmployees(1), { sheetName: 'Lương' });
    const okB = payrollFile('b.xlsx', fakeEmployees(1, 2), { sheetName: ' LUONG ' });
    const bad = payrollFile('c.xlsx', fakeEmployees(1, 3), { sheetName: 'Sheet1' });
    const { table, report } = readSlot(acceptanceSlot('bang_luong'), [okA, okB, bad]);
    expect(table.rows).toHaveLength(2);
    expect(errors(report)).toHaveLength(1);
    expect(errors(report)[0]).toMatchObject({
      messageKey: 'validation.sheetNotFound',
      file: 'c.xlsx',
    });
    expect(formatIssue(errors(report)[0]!, t)).toBe('File c.xlsx: không tìm thấy sheet "Luong".');
  });

  it('empty workbook sheet → missing required columns (errors), 0 rows', () => {
    const file = workbookFile('empty.xlsx', { Luong: [] });
    const { table, report } = readSlot(acceptanceSlot('bang_luong'), [file]);
    expect(table.rows).toEqual([]);
    expect(errors(report).every((i) => i.messageKey === 'validation.columnMissing')).toBe(true);
    expect(errors(report)).toHaveLength(5);
  });

  it('header-only file passes validation with 0 data rows (no warning today)', () => {
    // Product question: should an empty branch file at least warn?
    const file = payrollFile('h.xlsx', [], { tail: [] });
    const { report } = readSlot(acceptanceSlot('bang_luong'), [file]);
    expect(report.issues).toEqual([]);
    expect(report.files[0]!.dataRows).toBe(0);
  });

  it('0-byte and garbage files are reported as unreadable or as missing sheet, never crash', () => {
    const zero = { name: 'zero.xlsx', data: new Uint8Array(0) };
    const junk = { name: 'junk.xlsx', data: new TextEncoder().encode('not an excel file') };
    const zip = { name: 'trunc.xlsx', data: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) };
    const { report } = readSlot(acceptanceSlot('bang_luong'), [zero, junk, zip]);
    expect(report.errorCount).toBeGreaterThanOrEqual(3);
    for (const f of ['zero.xlsx', 'junk.xlsx', 'trunc.xlsx']) {
      expect(errors(report).some((i) => i.file === f)).toBe(true);
    }
  });

  it('merged data cells: "none" leaves the merged-away cells blank, "fillDown" repeats the value', () => {
    const aoa = [
      ['Mã NV', 'Chi nhánh'],
      [nv(1), 'CN01'],
      [nv(2), null],
      [nv(3), null],
    ];
    const merges = { Sheet1: [XLSX.utils.decode_range('B2:B4')] };
    const cols = [
      { key: 'ma_nv', aliases: ['Mã NV'], type: 'string' as const, required: true },
      { key: 'chi_nhanh', aliases: ['Chi nhánh'], type: 'string' as const },
    ];
    const none = readSlot(slot({ columns: cols }), [
      workbookFile('m.xlsx', { Sheet1: aoa }, { merges }),
    ]);
    expect(none.table.rows.map((r) => r.chi_nhanh)).toEqual(['CN01', null, null]);
    const filled = readSlot(slot({ columns: cols, unmergeCells: 'fillDown' }), [
      workbookFile('m.xlsx', { Sheet1: aoa }, { merges }),
    ]);
    expect(filled.table.rows.map((r) => r.chi_nhanh)).toEqual(['CN01', 'CN01', 'CN01']);
  });

  it('reads a legacy .xls (BIFF8) file', () => {
    const file = workbookFile(
      'old.xls',
      {
        Sheet1: [
          ['Mã NV', 'Công'],
          [nv(1), 26.5],
        ],
      },
      { bookType: 'biff8' },
    );
    const s = slot({
      columns: [
        { key: 'ma_nv', aliases: ['Mã NV'], type: 'string', required: true },
        { key: 'cong', aliases: ['Công'], type: 'decimal' },
      ],
    });
    const { table, report } = readSlot(s, [file]);
    expect(report.issues).toEqual([]);
    expect(dec(table.rows[0]!.cong)).toBe('26.5');
  });

  it('CSV with UTF-8 BOM and Vietnamese headers', () => {
    const s = slot({
      columns: [
        { key: 'ma_nv', aliases: ['Mã NV'], type: 'string', required: true },
        { key: 'cong', aliases: ['Công'], type: 'decimal', decimalSeparator: ',' },
      ],
    });
    const { table, report } = readSlot(s, [csvFile('a.csv', '﻿Mã NV,Công\nNV00001,"26,5"\n')]);
    expect(report.issues).toEqual([]);
    expect(dec(table.rows[0]!.cong)).toBe('26.5');
  });
});

// -------------------------------------------------------------------------------------------
describe('QA reader: multiple files & unique after union (AC-07)', () => {
  it('duplicate Mã NV across 2 files → error naming both files and rows; run blocked', () => {
    const a = payrollFile('bang_luong_CN01.xlsx', fakeEmployees(3));
    const b = payrollFile('bang_luong_CN02.xlsx', [
      [nv(10), 'X', 'CN02', 26, 0, 0, 0],
      [nv(2), 'Trùng', 'CN02', 26, 0, 0, 0],
    ]);
    const { report } = readSlot(acceptanceSlot('bang_luong'), [a, b]);
    expect(report.errorCount).toBe(1);
    const u = errors(report)[0]!;
    expect(u).toMatchObject({
      messageKey: 'validation.unique',
      file: 'bang_luong_CN02.xlsx',
      row: 6,
    });
    expect(u.params).toMatchObject({
      otherFile: 'bang_luong_CN01.xlsx',
      otherRow: 6,
      value: nv(2),
    });
    expect(formatIssue(u, t)).toBe(
      'Giá trị "NV00002" của cột "Mã NV" bị trùng: bang_luong_CN02.xlsx dòng 6 và bang_luong_CN01.xlsx dòng 6.',
    );
  });

  it('duplicate detection ignores surrounding spaces in the key', () => {
    const a = timesheetFile('cc1.xlsx', [[nv(1), 'A', 'CN01', 26, 0, 0, 0]]);
    const b = timesheetFile('cc2.xlsx', [[` ${nv(1)} `, 'A', 'CN02', 26, 0, 0, 0]]);
    const { report } = readSlot(acceptanceSlot('cham_cong'), [a, b]);
    expect(keys(errors(report))).toEqual(['validation.unique']);
  });

  it('three occurrences → two unique errors, each pointing at the first occurrence', () => {
    const f = (n: string) => timesheetFile(n, [[nv(7), 'A', 'CN01', 26, 0, 0, 0]]);
    const { report } = readSlot(acceptanceSlot('cham_cong'), [
      f('x.xlsx'),
      f('y.xlsx'),
      f('z.xlsx'),
    ]);
    const u = errors(report);
    expect(u.map((i) => [i.file, i.params.otherFile])).toEqual([
      ['y.xlsx', 'x.xlsx'],
      ['z.xlsx', 'x.xlsx'],
    ]);
  });

  it('file count limits: min/max, 0 files on a required slot, single-file slot given 2 files', () => {
    const s = acceptanceSlot('cham_cong');
    s.multiple = { enabled: true, minFiles: 2, maxFiles: 3 };
    const f = (i: number) => timesheetFile(`cc${i}.xlsx`, [[nv(i), 'A', 'CN', 26, 0, 0, 0]]);
    expect(keys(readSlot(s, [f(1)]).report.issues)).toEqual(['validation.filesTooFew']);
    expect(readSlot(s, [f(1), f(2)]).report.errorCount).toBe(0);
    expect(readSlot(s, [f(1), f(2), f(3)]).report.errorCount).toBe(0);
    expect(keys(readSlot(s, [f(1), f(2), f(3), f(4)]).report.issues)).toEqual([
      'validation.filesTooMany',
    ]);
    expect(keys(readSlot(s, []).report.issues)).toEqual(['validation.slotRequired']);
    s.required = false;
    expect(readSlot(s, []).report.issues).toEqual([]);
    const single = acceptanceSlot('cham_cong');
    single.multiple = { enabled: false, minFiles: 1, maxFiles: 50 };
    const r = readSlot(single, [f(1), f(2)]);
    expect(keys(r.report.issues)).toEqual(['validation.filesTooMany']);
    expect(r.table.columns.map((c) => c.key)).not.toContain(SOURCE_FILE_COLUMN);
  });

  it('extension check is case-insensitive on the file name; unknown extension rejected', () => {
    const s = acceptanceSlot('cham_cong');
    const up = timesheetFile('CC01.XLSX', [[nv(1), 'A', 'CN', 26, 0, 0, 0]]);
    const txt = { ...timesheetFile('cc.txt', [[nv(2), 'A', 'CN', 26, 0, 0, 0]]) };
    const { report } = readSlot(s, [up, txt]);
    expect(keys(report.issues)).toEqual(['validation.fileTypeNotAccepted']);
    expect(report.issues[0]!.file).toBe('cc.txt');
  });
});

// -------------------------------------------------------------------------------------------
describe('QA reader: injection-ish cell values stay data', () => {
  it('formula-looking and template-looking strings are kept verbatim and not re-interpolated in messages', () => {
    const rows: EmpRow[] = [
      [
        '=HYPERLINK("http://example.invalid","x")',
        '{{file}} $t(validation.required)',
        'CN',
        26,
        0,
        0,
        0,
      ],
      ["'; DROP TABLE run_logs; --", '<script>alert(1)</script>', 'CN', 26, 0, 0, 0],
    ];
    const s = acceptanceSlot('cham_cong');
    const { table, report } = readSlot(s, [timesheetFile('inj.xlsx', rows)]);
    expect(table.rows[0]!.ho_ten).toBe('{{file}} $t(validation.required)');
    expect(table.rows[1]!.ho_ten).toBe('<script>alert(1)</script>');
    const regex = errors(report).filter((i) => i.messageKey === 'validation.regex');
    expect(regex).toHaveLength(2);
    expect(formatIssue(regex[0]!, t)).toContain('"=HYPERLINK("http://example.invalid","x")"');
    expect(formatIssue(regex[1]!, t)).toContain(`"'; DROP TABLE run_logs; --"`);
  });

  it('a cell value of "{{row}}" in a message param is not interpolated again', () => {
    const s = slot({
      columns: [{ key: 'ma_nv', aliases: ['Mã NV'], type: 'string', rules: [{ regex: '^NV' }] }],
    });
    const { report } = readSlot(s, [workbookFile('x.xlsx', { Sheet1: [['Mã NV'], ['{{row}}']] })]);
    expect(formatIssue(report.issues[0]!, t)).toBe(
      'File x.xlsx, dòng 2: giá trị "{{row}}" ở cột "Mã NV" không đúng định dạng.',
    );
  });
});

// -------------------------------------------------------------------------------------------
describe('KNOWN BUGS (reader)', () => {
  // Decision docs/MEMORY.md 20261026: blank metric cells (công, OT, phép, không lương) = 0; the
  // metric column must still exist. Current code: required:true → blank cell is an error.
  it.fails('BUG-R1: blank OT cell on an employee row is read as 0 without an error', () => {
    const rows = fakeEmployees(3);
    rows[1]![4] = null; // OT blank for NV00002
    const { table, report } = readSlot(acceptanceSlot('bang_luong'), [payrollFile('a.xlsx', rows)]);
    expect(report.errorCount).toBe(0);
    expect(dec(table.rows[1]!.ot)).toBe('0');
  });

  it.fails('BUG-R1: blank cells in all 4 metric columns of the timesheet are read as 0', () => {
    const { table, report } = readSlot(acceptanceSlot('cham_cong'), [
      timesheetFile('cc.xlsx', [[nv(1), 'A', 'CN01', null, '   ', null, null]]),
    ]);
    expect(report.errorCount).toBe(0);
    const r = table.rows[0]!;
    expect([r.cong, r.ot, r.phep, r.khong_luong].map(dec)).toEqual(['0', '0', '0', '0']);
  });

  // Guard for the fix: the column itself must still be mandatory (passes today, must keep passing).
  it('BUG-R1 guard: a missing metric column is still an error', () => {
    const headers = TS_HEADERS_WITHOUT_OT;
    const { report } = readSlot(acceptanceSlot('cham_cong'), [
      timesheetFile('cc.xlsx', [[nv(1), 'A', 'CN01', 26, 0, 0, null]], { headers }),
    ]);
    expect(errors(report).map((i) => [i.messageKey, i.column])).toEqual([
      ['validation.columnMissing', 'ot'],
    ]);
  });

  // excel-reader.ts readSlot: `rows.push(...result.rows)` (and issues/refs/skipped) spreads the
  // whole array as call arguments → RangeError above ~125k rows in ONE file (V8 arg limit).
  // Spec §13 / MEMORY: target is ~1M rows per run.
  it.fails(
    'BUG-R2: a single file with 200k rows is read without "Maximum call stack size exceeded"',
    () => {
      const n = 200_000;
      const text = 'Mã NV\n' + Array.from({ length: n }, (_, i) => `NV${i}`).join('\n');
      const s = slot({ columns: [{ key: 'ma_nv', aliases: ['Mã NV'], type: 'string' }] });
      const { table } = readSlot(s, [csvFile('big.csv', text)]);
      expect(table.rows).toHaveLength(n);
    },
  );
});

const TS_HEADERS_WITHOUT_OT = [
  'Mã nhân viên',
  'Họ tên',
  'Chi nhánh',
  'Công thực tế',
  'Phép (ngày)',
  'Không lương (ngày)',
];
