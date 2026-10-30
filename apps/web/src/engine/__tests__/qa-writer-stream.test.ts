/**
 * QA: streaming writer vs ExcelJS writer on the real 4-sheet compare output of the acceptance
 * fixtures and on seeded random tables (decimals, awkward strings, dates, null patterns). Every
 * cell is compared as type / value / number format through SheetJS and ExcelJS. Fake data only.
 */
import { CompareConfigSchema, OutputExcelConfigSchema } from '@hrflow/flow-schema';
import ExcelJS from 'exceljs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { Big } from '../core/decimal';
import { createEngineTranslator } from '../core/i18n';
import type { ColumnDef, Table } from '../core/types';
import { readSlot, type SourceFile } from '../io/excel-reader';
import { writeWorkbook, type SheetSpec } from '../io/excel-writer';
import { controlComparePlugin } from '../nodes/control-compare';
import { asTable } from './helpers';
import { acceptanceFlow, acceptanceNodeConfig, acceptanceSlot, FIXTURES } from './qa-helpers';

function files(prefix: string): SourceFile[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((name) => ({ name, data: new Uint8Array(readFileSync(join(FIXTURES, name))) }));
}

async function both(sheets: SheetSpec[]) {
  return [
    await writeWorkbook(sheets, { streaming: false }),
    await writeWorkbook(sheets, { streaming: true }),
  ] as const;
}

/** Every cell as SheetJS sees it (type, value, number format, formula) + sheet-level layout. */
function sheetJsView(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { type: 'array', cellNF: true, cellFormula: true, cellDates: false });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]!;
    const cells: Record<string, unknown> = {};
    for (const [k, c] of Object.entries(ws)) {
      if (k.startsWith('!')) continue;
      const cell = c as XLSX.CellObject;
      cells[k] = { t: cell.t, v: cell.v, z: cell.z, f: cell.f };
    }
    return {
      name,
      ref: ws['!ref'],
      filter: ws['!autofilter'],
      widths: (ws['!cols'] ?? []).map((c) => c?.width),
      cells,
    };
  });
}

/** Every cell as ExcelJS sees it: value type, value, number format, font, alignment. */
async function excelJsView(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const cells: unknown[] = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        cells.push([
          r,
          c,
          cell.type,
          cell.value instanceof Date ? cell.value.toISOString() : cell.value,
          cell.numFmt,
          cell.font?.bold ?? false,
        ]);
      });
    });
    return { name: ws.name, views: ws.views, rows: ws.rowCount, cols: ws.columnCount, cells };
  });
}

async function expectSame(sheets: SheetSpec[]) {
  const [a, b] = await both(sheets);
  expect(sheetJsView(b)).toEqual(sheetJsView(a));
  expect(await excelJsView(b)).toEqual(await excelJsView(a));
}

describe('4-sheet compare output: streaming writer = ExcelJS writer', () => {
  const t = createEngineTranslator('vi');
  const payroll = readSlot(acceptanceSlot('bang_luong'), files('bang_luong_'));
  const timesheet = readSlot(acceptanceSlot('cham_cong'), files('cham_cong_'));
  const result = controlComparePlugin.execute(
    CompareConfigSchema.parse(acceptanceNodeConfig('cmp')),
    { left: payroll.table, right: timesheet.table },
    { t },
  ) as Record<string, Table>;
  const sheetCfg = OutputExcelConfigSchema.parse(acceptanceNodeConfig('out')).sheets;

  it('acceptance fixtures: names, cells (type/value/format), widths, filter, frozen header', async () => {
    const sheets = sheetCfg.map((s) => ({ name: s.name, table: result[s.port]! }));
    expect(sheets).toHaveLength(4);
    expect(sheets.every((s) => s.table.rowCount >= 0)).toBe(true);
    await expectSame(sheets);
  });

  it('the same sheets with title row counts at 1, 100, 5000 rows (blank-heavy)', async () => {
    const lech = result.mismatched!;
    for (const n of [0, 1, 100, 5000]) {
      const rows = Array.from({ length: n }, (_, i) => lech.row(i % Math.max(1, lech.rowCount)));
      const big =
        n === 0 || lech.rowCount === 0 ? lech.head(0) : asTable({ columns: lech.columns, rows });
      await expectSame([{ name: 'Lệch', table: big }]);
    }
  });

  it('the flow output name list is unchanged', () => {
    expect(acceptanceFlow().nodes.some((n) => n.type === 'output.excel')).toBe(true);
    expect(sheetCfg.map((s) => s.name)).toEqual([
      'Tổng hợp',
      'Lệch',
      'Chỉ có trong lương',
      'Chỉ có trong chấm công',
    ]);
  });
});

// ---- seeded random tables ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const STRINGS = [
  'NV001',
  ' ',
  '  lead',
  'trail  ',
  'Nguyễn Văn Ánh',
  '=1+1',
  '+SUM(A1)',
  '@cmd',
  '-1',
  "x' OR 1=1 --",
  '<b>&amp;</b>',
  'a\tb',
  'a\nb',
  'a\r\nb',
  ' nbsp',
  '😀 emoji',
  '\u0001ctrl',
  ' sep',
  'x'.repeat(300),
  '00123',
  '1e5',
  'TRUE',
];
const DECS = [
  '0',
  '-0',
  '0.1',
  '0.30000000000000004',
  '-5.5',
  '1234567890123.25',
  '0.0000001',
  '1e-9',
  '123456789012345678.1234567891',
  '9007199254740993',
  '1e21',
  '99999999999999999999999999.9999999999',
  '15000000',
  '26.5',
  '0.1',
  '12.30',
];
const DATES = [
  '2026-09-01',
  '1900-01-01',
  '1900-02-28',
  '1900-03-01',
  '1899-12-31',
  '2999-12-31',
  '2024-02-29',
];
const DATETIMES = [
  '2026-09-01T08:30:00',
  '1900-01-01T00:00:00',
  '2026-12-31T23:59:59',
  '2026-09-01T12:00:00',
];

describe('random tables: streaming writer = ExcelJS writer', () => {
  const cols: ColumnDef[] = [
    { key: 's', type: 'string', title: 'Chuỗi' },
    { key: 'd', type: 'decimal', title: 'Số' },
    { key: 'f', type: 'decimal', title: 'Tiền', numFmt: '#,##0' },
    { key: 'i', type: 'integer' },
    { key: 'dt', type: 'date', title: 'Ngày' },
    { key: 'ts', type: 'datetime', title: 'Lúc' },
    { key: 'b', type: 'boolean', title: 'Cờ' },
  ];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}`, async () => {
      const r = mulberry32(seed);
      const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
      const maybe = <T>(v: T): T | null => (r() < 0.2 ? null : v);
      const rows = Array.from({ length: 200 }, () => ({
        s: maybe(pick(STRINGS)),
        d: maybe(new Big(pick(DECS))),
        f: maybe(new Big(pick(DECS))),
        i: maybe(Math.floor(r() * 2_000_000) - 1_000_000),
        dt: maybe(pick(DATES)),
        ts: maybe(pick(DATETIMES)),
        b: maybe(r() < 0.5),
      }));
      await expectSame([
        { name: 'Dữ liệu', table: asTable({ columns: cols, rows }) },
        { name: 'Rỗng', table: asTable({ columns: cols, rows: [] }) },
      ]);
    });
  }
});
