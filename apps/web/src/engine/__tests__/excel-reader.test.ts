import type { InputSlotInput } from '@hrflow/flow-schema';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { Big } from '../core/decimal';
import { createEngineTranslator } from '../core/i18n';
import { normalizeKeyPart } from '../core/keys';
import { readSlot } from '../io/excel-reader';
import { formatIssue, type ValidationReport } from '../io/validation';
import { csvFile, slot, xlsxFile } from './helpers';

const t = createEngineTranslator('vi');

/** Issues except the "optional column not present" warnings that minimal test files trigger. */
const relevant = (report: ValidationReport) =>
  report.issues.filter((i) => i.messageKey !== 'validation.columnMissingOptional');

const employeeSlot = (extra: Partial<InputSlotInput> = {}) =>
  slot({
    sheet: { mode: 'byName', value: 'Data' },
    skipRows: { whenBlank: ['ma_nv'] },
    multiple: { enabled: true },
    columns: [
      {
        key: 'ma_nv',
        label: 'Mã NV',
        aliases: ['Mã NV', 'MSNV'],
        type: 'string',
        required: true,
        rules: [{ unique: true }, { regex: '^NV\\d{5}$' }],
      },
      { key: 'ho_ten', aliases: ['Họ và tên'], type: 'string' },
      { key: 'cong', aliases: ['Công'], type: 'decimal', rules: [{ min: 0 }, { max: 31 }] },
      {
        key: 'ngay_vao',
        aliases: ['Ngày vào làm'],
        type: 'date',
        dateFormats: ['dd/MM/yyyy', 'excelSerial'],
      },
    ],
    ...extra,
  });

describe('readSlot: header matching', () => {
  it('matches aliases after normalization (case, diacritics, spaces)', () => {
    const file = xlsxFile('a.xlsx', {
      Data: [
        ['  msnv ', 'HO VA TEN', 'công', 'Ngày vào  làm'],
        ['NV00001', 'Nguyễn Văn An', 26, 46266],
      ],
    });
    const { table, report } = readSlot(employeeSlot(), [file]);
    expect(report.issues).toEqual([]);
    expect(table.rows[0]).toMatchObject({
      ma_nv: 'NV00001',
      ho_ten: 'Nguyễn Văn An',
      ngay_vao: '2026-09-01',
      _source_file: 'a.xlsx',
    });
    expect((table.rows[0]!.cong as InstanceType<typeof Big>).eq(26)).toBe(true);
  });

  it('reports a missing required column with file and column (AC-08)', () => {
    const file = xlsxFile('thieu_cot.xlsx', {
      Data: [
        ['Họ và tên', 'Công'],
        ['A', 1],
      ],
    });
    const { report } = readSlot(employeeSlot(), [file]);
    const missing = report.issues.find((i) => i.messageKey === 'validation.columnMissing');
    expect(missing).toMatchObject({
      severity: 'error',
      rule: 'column',
      file: 'thieu_cot.xlsx',
      sheet: 'Data',
      column: 'ma_nv',
    });
    expect(formatIssue(missing!, t)).toContain('thieu_cot.xlsx');
    expect(formatIssue(missing!, t)).toContain('Mã NV');
    // No per-row "required" flood for a column that does not exist.
    expect(report.issues.filter((i) => i.rule === 'required')).toEqual([]);
    expect(report.errorCount).toBeGreaterThan(0);
  });

  it('warns on a missing optional column and fills null', () => {
    const file = xlsxFile('a.xlsx', {
      Data: [
        ['Mã NV', 'Công', 'Ngày vào làm'],
        ['NV00001', 1, 46266],
      ],
    });
    const { table, report } = readSlot(employeeSlot(), [file]);
    expect(report.errorCount).toBe(0);
    expect(report.issues).toMatchObject([
      { severity: 'warning', messageKey: 'validation.columnMissingOptional', column: 'ho_ten' },
    ]);
    expect(table.rows[0]!.ho_ten).toBeNull();
  });

  it('reports a missing sheet', () => {
    const file = xlsxFile('a.xlsx', { Other: [['Mã NV']] });
    const { report } = readSlot(employeeSlot(), [file]);
    expect(report.issues).toMatchObject([
      { messageKey: 'validation.sheetNotFound', file: 'a.xlsx' },
    ]);
  });

  it('joins multi-row merged headers with " / "', () => {
    const file = xlsxFile(
      'a.xlsx',
      {
        Data: [
          ['Mã NV', 'Nghỉ', null],
          [null, 'Phép', 'Không lương'],
          ['NV00001', 1, 0],
        ],
      },
      {
        Data: [
          { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
          { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
        ],
      },
    );
    const s = slot({
      headerRow: 1,
      headerRows: 2,
      columns: [
        { key: 'ma_nv', aliases: ['Mã NV'], type: 'string', required: true },
        { key: 'phep', aliases: ['Nghỉ / Phép'], type: 'decimal' },
        { key: 'khong_luong', aliases: ['Nghỉ / Không lương'], type: 'decimal' },
      ],
    });
    const { table, report } = readSlot(s, [file]);
    expect(report.issues).toEqual([]);
    expect(table.rows).toHaveLength(1);
    expect(String(table.rows[0]!.phep)).toBe('1');
    expect(String(table.rows[0]!.khong_luong)).toBe('0');
  });
});

describe('readSlot: rows', () => {
  it('skips total rows (blank key) as info, honors stopAt, reports original Excel rows', () => {
    const file = xlsxFile('a.xlsx', {
      Data: [
        ['BẢNG LƯƠNG'],
        [],
        ['Mã NV', 'Họ và tên', 'Công'],
        ['NV00001', 'A', 26],
        ['NV00002', 'B', 'x'],
        [],
        [null, 'TỔNG CỘNG', 52],
        [],
        [],
        ['NV00099', 'after stop', 1],
      ],
    });
    const { table, report } = readSlot(employeeSlot({ headerRow: 3, stopAt: { blankRows: 2 } }), [
      file,
    ]);
    expect(table.rows.map((r) => r.ma_nv)).toEqual(['NV00001', 'NV00002']);
    expect(report.skippedRows).toMatchObject([
      { file: 'a.xlsx', row: 7, messageKey: 'skipped.keyBlank' },
    ]);
    expect(relevant(report)).toMatchObject([
      { rule: 'type', row: 5, column: 'cong', params: { value: 'x', type: 'decimal' } },
    ]);
    expect(formatIssue(relevant(report)[0]!, t)).toBe(
      'File a.xlsx, dòng 5: giá trị "x" ở cột "Công" không phải số.',
    );
  });

  it('without skipRows, a blank required key is an error', () => {
    const file = xlsxFile('a.xlsx', {
      Data: [
        ['Mã NV', 'Công'],
        [null, 5],
      ],
    });
    const s = employeeSlot();
    delete (s as { skipRows?: unknown }).skipRows;
    const { report } = readSlot(s, [file]);
    expect(relevant(report)).toMatchObject([
      { rule: 'required', row: 2, column: 'ma_nv', severity: 'error' },
    ]);
  });

  it('applies regex/min/max rules with severity', () => {
    const s = employeeSlot();
    s.columns[2]!.rules = [{ min: 0, severity: 'warning' }];
    const file = xlsxFile('a.xlsx', {
      Data: [
        ['Mã NV', 'Công'],
        ['X1', -1],
      ],
    });
    const { report } = readSlot(s, [file]);
    expect(relevant(report)).toMatchObject([
      { rule: 'regex', severity: 'error', row: 2 },
      { rule: 'min', severity: 'warning', row: 2, params: { min: '0', value: '-1' } },
    ]);
    expect(report.errorCount).toBe(1);
  });

  it('reports Excel error cells as type errors', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Mã NV', 'Công'],
      ['NV00001', 1],
    ]);
    ws.B2 = { t: 'e', v: 42 }; // #N/A
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { report } = readSlot(employeeSlot(), [{ name: 'a.xlsx', data }]);
    expect(relevant(report)).toMatchObject([
      { rule: 'type', row: 2, column: 'cong', params: { value: '#N/A' } },
    ]);
  });

  it('keeps extra columns when configured', () => {
    const file = xlsxFile('a.xlsx', {
      Data: [
        ['Mã NV', 'Phòng ban', 'Ghi chú'],
        ['NV00001', 'QA', 'x'],
      ],
    });
    const { table } = readSlot(employeeSlot({ extraColumns: 'keep' }), [file]);
    expect(table.columns.map((c) => c.key)).toEqual(
      expect.arrayContaining(['phong_ban', 'ghi_chu', '_source_file']),
    );
    expect(table.rows[0]).toMatchObject({ phong_ban: 'QA', ghi_chu: 'x' });
  });

  it('rejects CSV as an unsupported format (MEMORY 13:08: no CSV)', () => {
    const csv = csvFile('a.csv', '﻿Mã NV,Họ và tên\nNV00001,Trần Thị Bình\n');
    const s = employeeSlot({ sheet: { mode: 'byIndex', value: 0 } });
    const { table, report } = readSlot(s, [csv]);
    expect(table.rows).toEqual([]);
    expect(report.issues).toMatchObject([
      { severity: 'error', messageKey: 'validation.fileTypeNotAccepted', file: 'a.csv' },
    ]);
    expect(formatIssue(report.issues[0]!, t)).toBe(
      'File a.csv: định dạng không được hỗ trợ (chỉ nhận .xlsx, .xls).',
    );
  });
});

describe('readSlot: multiple files', () => {
  it('checks unique after union and reports file + row of both duplicates (AC-07)', () => {
    const a = xlsxFile('cn01.xlsx', { Data: [['Mã NV'], ['NV00001'], ['NV00002']] });
    const b = xlsxFile('cn02.xlsx', { Data: [['MSNV'], ['NV00003'], ['NV00002']] });
    const { table, report } = readSlot(employeeSlot(), [a, b]);
    expect(table.rows).toHaveLength(4);
    expect(table.rows.map((r) => r._source_file)).toEqual([
      'cn01.xlsx',
      'cn01.xlsx',
      'cn02.xlsx',
      'cn02.xlsx',
    ]);
    const dup = report.issues.filter((i) => i.rule === 'unique');
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({
      severity: 'error',
      file: 'cn02.xlsx',
      row: 3,
      column: 'ma_nv',
      relatedFile: 'cn01.xlsx', // MEMORY 13:08: both files get the error status
      params: { value: 'NV00002', file: 'cn02.xlsx', row: 3, otherFile: 'cn01.xlsx', otherRow: 3 },
    });
    expect(report.errorCount).toBe(1);
    expect(formatIssue(dup[0]!, t)).toBe(
      'Cột "Mã NV" bị trùng giá trị: "NV00002" ở cn02.xlsx dòng 3 và "NV00002" ở cn01.xlsx dòng 3.',
    );
  });

  it('a duplicate inside one file has no relatedFile', () => {
    const a = xlsxFile('cn01.xlsx', { Data: [['Mã NV'], ['NV00001'], ['NV00001']] });
    const dup = readSlot(employeeSlot(), [a]).report.issues.filter((i) => i.rule === 'unique');
    expect(dup).toHaveLength(1);
    expect(dup[0]!.relatedFile).toBeUndefined();
  });

  it('enforces file count limits and accepted extensions', () => {
    const s = employeeSlot({ multiple: { enabled: true, maxFiles: 1 } });
    const a = xlsxFile('a.xlsx', { Data: [['Mã NV'], ['NV00001']] });
    const b = xlsxFile('b.xlsx', { Data: [['Mã NV'], ['NV00002']] });
    expect(relevant(readSlot(s, [a, b]).report)).toMatchObject([
      { messageKey: 'validation.filesTooMany' },
    ]);
    expect(readSlot(s, []).report.issues).toMatchObject([
      { messageKey: 'validation.slotRequired' },
    ]);
    const bad = { name: 'x.pdf', data: new Uint8Array([1, 2, 3]) };
    expect(readSlot(employeeSlot(), [bad]).report.issues).toMatchObject([
      { messageKey: 'validation.fileTypeNotAccepted', file: 'x.pdf' },
    ]);
  });

  it('reports an unreadable file', () => {
    const junk = { name: 'broken.xlsx', data: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]) };
    const { report } = readSlot(employeeSlot(), [junk]);
    expect(report.errorCount).toBe(1);
    expect(report.issues[0]!.rule === 'file' || report.issues[0]!.rule === 'sheet').toBe(true);
  });

  it('0-byte, text and random bytes named .xlsx/.xls are "unreadable", not "sheet not found"', () => {
    const random = new Uint8Array(4096).map((_, i) => (i * 7919 + 13) % 256);
    const files = [
      { name: 'zero.xlsx', data: new Uint8Array(0) },
      { name: 'text.xlsx', data: new TextEncoder().encode('Mã NV\nNV00001\n') },
      { name: 'random.xlsx', data: random },
      { name: 'zero.xls', data: new Uint8Array(0) },
      { name: 'text.xls', data: new TextEncoder().encode('Mã NV,Công\nNV00001,1\n') },
      { name: 'random.xls', data: random },
      // Valid OLE header, garbage body: SheetJS throws → unreadable.
      {
        name: 'brokenole.xls',
        data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...random]),
      },
    ];
    const s = employeeSlot({ multiple: { enabled: true, maxFiles: 10 } });
    const { report } = readSlot(s, files);
    for (const f of files) {
      const own = report.issues.filter((i) => i.file === f.name);
      expect(
        own.map((i) => i.messageKey),
        f.name,
      ).toEqual(['validation.fileUnreadable']);
    }
    expect(
      formatIssue(
        report.issues.find((i) => i.file === 'zero.xlsx')!,
        t,
      ),
    ).toContain('Không đọc được file zero.xlsx');
  });

  it('still reads a real .xls (BIFF8) and an HTML table saved as .xls', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Mã NV'], ['NV00001']]), 'Data');
    const biff = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer;
    const html = new TextEncoder().encode(
      '\n  <html><body><table><tr><td>Mã NV</td></tr><tr><td>NV00002</td></tr></table></body></html>',
    );
    const s = employeeSlot({ sheet: { mode: 'byIndex', value: 0 } });
    const a = readSlot(s, [{ name: 'a.xls', data: biff }]);
    expect(a.report.errorCount).toBe(0);
    expect(a.table.rows.map((r) => r.ma_nv)).toEqual(['NV00001']);
    const b = readSlot(s, [{ name: 'b.xls', data: html }]);
    expect(b.report.errorCount).toBe(0);
    expect(b.table.rows.map((r) => r.ma_nv)).toEqual(['NV00002']);
  });
});

describe('readSlot: unique uses the compare key normalization (decision 20261026)', () => {
  const uniqueOnly = (type: 'string' | 'integer' = 'string') =>
    employeeSlot({
      columns: [
        {
          key: 'ma_nv',
          label: 'Mã NV',
          aliases: ['Mã NV'],
          type,
          required: true,
          rules: [{ unique: true }],
        },
      ],
    });

  it('"NV00001" and " nv00001" in two files (no regex rule) → validation.unique error, run blocked', () => {
    const a = xlsxFile('cn01.xlsx', { Data: [['Mã NV'], ['NV00001']] });
    const b = xlsxFile('cn02.xlsx', { Data: [['Mã NV'], ['NV00002'], [' nv00001']] });
    const { report } = readSlot(uniqueOnly(), [a, b]);
    expect(report.errorCount).toBe(1);
    const dup = report.issues[0]!;
    // Original values of both occurrences are shown (the reader trims, case is kept).
    expect(dup).toMatchObject({
      messageKey: 'validation.unique',
      severity: 'error',
      file: 'cn02.xlsx',
      row: 3,
      column: 'ma_nv',
      params: { value: 'nv00001', otherValue: 'NV00001', otherFile: 'cn01.xlsx', otherRow: 2 },
    });
    expect(formatIssue(dup, t)).toBe(
      'Cột "Mã NV" bị trùng giá trị: "nv00001" ở cn02.xlsx dòng 3 và "NV00001" ở cn01.xlsx dòng 2.',
    );
  });

  it('collapses inner whitespace and applies NFC, like compare key matching', () => {
    const composed = 'NVÁ'; // "NVÁ" precomposed
    const decomposed = 'nvá'; // "nvá" with a combining accent
    const a = xlsxFile('a.xlsx', { Data: [['Mã NV'], ['NV  00001'], [composed]] });
    const b = xlsxFile('b.xlsx', { Data: [['Mã NV'], ['nv 00001'], [decomposed]] });
    const { report } = readSlot(uniqueOnly(), [a, b]);
    expect(report.issues.map((i) => [i.messageKey, i.params.value, i.params.otherValue])).toEqual([
      ['validation.unique', 'nv 00001', 'NV  00001'],
      ['validation.unique', decomposed, composed],
    ]);
  });

  it('agrees with normalizeKeyPart for every pair', () => {
    const values = ['NV00001', 'nv00001', 'NV 00001', 'NV00002', 'NV0000l', 'NV00001x'];
    for (const x of values) {
      for (const y of values) {
        if (x === y) continue;
        const a = xlsxFile('a.xlsx', { Data: [['Mã NV'], [x]] });
        const b = xlsxFile('b.xlsx', { Data: [['Mã NV'], [y]] });
        const dup = readSlot(uniqueOnly(), [a, b]).report.errorCount > 0;
        expect(dup, `${x} vs ${y}`).toBe(normalizeKeyPart(x) === normalizeKeyPart(y));
      }
    }
  });

  it('non-string columns keep value equality', () => {
    const a = xlsxFile('a.xlsx', { Data: [['Mã NV'], [1], [2]] });
    const b = xlsxFile('b.xlsx', { Data: [['Mã NV'], [3], [2]] });
    const { report } = readSlot(uniqueOnly('integer'), [a, b]);
    expect(report.issues.map((i) => i.params.value)).toEqual(['2']);
  });
});
