import { describe, expect, it } from 'vitest';
import { readRefImport, type RefImportColumn } from '../io/ref-import';
import { xlsxFile } from './helpers';

// Fake reference data only (branch list, rates).
const COLS: RefImportColumn[] = [
  { key: 'ma_cn', title: 'Mã chi nhánh', type: 'string', aliases: ['Mã CN'], isKey: true },
  { key: 'ten_cn', title: 'Tên chi nhánh', type: 'string', aliases: [], isKey: false },
  { key: 'vung', title: 'Vùng', type: 'integer', aliases: [], isKey: false },
  { key: 'he_so', title: 'Hệ số', type: 'decimal', aliases: [], isKey: false },
  { key: 'tu_ngay', title: 'Từ ngày', type: 'date', aliases: [], isKey: false },
];

const HEAD = ['Mã CN', 'Tên chi nhánh', 'Vùng', 'Hệ số', 'Từ ngày'];

describe('import Excel into a reference table draft (AC-RT-03)', () => {
  it('reads typed rows by header alias, leaving blank cells out', () => {
    const file = xlsxFile('dm.xlsx', {
      DanhMuc: [
        HEAD,
        ['CN01', 'Hồ Chí Minh', 1, 1.25, '01/07/2026'],
        ['CN02', 'Hà Nội', 1, null, null],
        ['CN03', null, '2', '0.5', '2026-01-01'],
      ],
    });
    const r = readRefImport(file, COLS, 50_000);
    expect(r.report.errorCount).toBe(0);
    expect(r.sheet).toBe('DanhMuc');
    expect(r.rowCount).toBe(3);
    expect(r.rows).toEqual([
      { ma_cn: 'CN01', ten_cn: 'Hồ Chí Minh', vung: 1, he_so: '1.25', tu_ngay: '2026-07-01' },
      { ma_cn: 'CN02', ten_cn: 'Hà Nội', vung: 1 },
      { ma_cn: 'CN03', vung: 2, he_so: '0.5', tu_ngay: '2026-01-01' },
    ]);
    expect(r.preview).toEqual(r.rows);
  });

  it('reports missing columns once per column, from the first sheet', () => {
    const file = xlsxFile('dm.xlsx', {
      Sheet1: [
        ['Mã CN', 'Vùng'],
        ['CN01', 1],
      ],
    });
    const r = readRefImport(file, COLS, 50_000);
    expect(r.rows).toBeNull();
    expect(r.report.issues.map((i) => [i.messageKey, i.column])).toEqual([
      ['validation.columnMissing', 'ten_cn'],
      ['validation.columnMissing', 'he_so'],
      ['validation.columnMissing', 'tu_ngay'],
    ]);
  });

  it('flags wrong types, blank keys and duplicate keys (case / spaces) with Excel rows', () => {
    const file = xlsxFile('dm.xlsx', {
      S: [
        HEAD,
        ['CN01', 'A', 'một', 1, null],
        ['  cn01 ', 'B', 1, 1, null],
        [null, 'Chỉ có tên', 1, 1, null],
        ['CN04', 'D', 1, 1, 'không phải ngày'],
      ],
    });
    const r = readRefImport(file, COLS, 50_000);
    expect(r.rows).toBeNull();
    const errors = r.report.issues.filter((i) => i.severity === 'error');
    expect(errors.map((i) => [i.messageKey, i.row, i.column])).toEqual([
      ['validation.type', 2, 'vung'],
      ['validation.type', 5, 'tu_ngay'],
      ['refTables:import.duplicateKey', 3, 'ma_cn'],
    ]);
    // The row with a blank key is not data (skipped, listed), not an error.
    expect(r.report.skippedRows.map((s) => s.row)).toEqual([4]);
    expect(r.preview).toHaveLength(3);
  });

  it('checks the key over every key column together', () => {
    const cols: RefImportColumn[] = [
      { ...COLS[0]!, isKey: true },
      { ...COLS[2]!, isKey: true },
    ];
    const file = xlsxFile('k.xlsx', {
      S: [
        ['Mã CN', 'Vùng'],
        ['CN01', 1],
        ['CN01', 2],
        ['CN01', 1],
      ],
    });
    const r = readRefImport(file, cols, 50_000);
    const dup = r.report.issues.filter((i) => i.messageKey === 'refTables:import.duplicateKey');
    expect(dup.map((i) => [i.row, i.params.otherRow, i.params.value])).toEqual([
      [4, 2, 'CN01 · 1'],
    ]);
  });

  it('warns about columns the table does not define (ignored)', () => {
    const file = xlsxFile('dm.xlsx', {
      S: [
        [...HEAD, 'Ghi chú'],
        ['CN01', 'A', 1, 1, null, 'x'],
      ],
    });
    const r = readRefImport(file, COLS, 50_000);
    expect(r.report.errorCount).toBe(0);
    expect(r.report.issues.map((i) => [i.severity, i.messageKey, i.params.column])).toEqual([
      ['warning', 'refTables:import.extraColumn', 'Ghi chú'],
    ]);
    expect(r.rows![0]).not.toHaveProperty('ghi_chu');
  });

  it('refuses more rows than the limit and decimals the database cannot keep', () => {
    const rows = Array.from({ length: 6 }, (_, i) => [`CN${i}`, 'X', 1, 1, null]);
    const tooMany = readRefImport(xlsxFile('dm.xlsx', { S: [HEAD, ...rows] }), COLS, 5);
    expect(tooMany.rows).toBeNull();
    expect(tooMany.report.issues.at(-1)).toMatchObject({
      messageKey: 'refTables:import.tooManyRows',
      params: { count: 6, max: 5 },
    });
    const precise = readRefImport(
      xlsxFile('dm.xlsx', { S: [HEAD, ['CN01', 'X', 1, '0.123456789012', null]] }),
      COLS,
      5,
    );
    expect(precise.report.issues.map((i) => i.messageKey)).toEqual(['refTables:import.tooPrecise']);
  });

  it('accepts only Excel files and reports unreadable ones', () => {
    const csv = readRefImport({ name: 'dm.csv', data: new TextEncoder().encode('a,b') }, COLS, 9);
    expect(csv.report.issues[0]!.messageKey).toBe('validation.fileTypeNotAccepted');
    const broken = readRefImport({ name: 'dm.xlsx', data: new Uint8Array([1, 2, 3]) }, COLS, 9);
    expect(broken.report.issues[0]!.messageKey).toBe('validation.fileUnreadable');
    expect(broken.rows).toBeNull();
  });
});
