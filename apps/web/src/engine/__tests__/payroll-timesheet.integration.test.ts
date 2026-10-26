import {
  CompareConfigSchema,
  FlowDefinitionSchema,
  OutputExcelConfigSchema,
} from '@hrflow/flow-schema';
import ExcelJS from 'exceljs';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import { createEngineTranslator } from '../core/i18n';
import type { Table } from '../core/types';
import { readSlot, type SourceFile } from '../io/excel-reader';
import { writeWorkbook } from '../io/excel-writer';
import { controlComparePlugin, MISMATCHED_METRICS_COLUMN } from '../nodes/control-compare';

const FIXTURES = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');

interface Expected {
  counts: Record<string, number>;
  mismatched: { ma_nv: string; diffs: Record<string, string> }[];
  only_in_payroll: string[];
  only_in_timesheet: string[];
}

const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as Expected;
const flow = FlowDefinitionSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8')),
);
const t = createEngineTranslator('vi');
const ctx = { t };

function loadFiles(prefix: string): SourceFile[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((name) => ({ name, data: new Uint8Array(readFileSync(join(FIXTURES, name))) }));
}

function slot(key: string) {
  const s = flow.inputSlots.find((x) => x.key === key);
  if (!s) throw new Error(`slot ${key} missing`);
  return s;
}

function nodeConfig(id: string) {
  const n = flow.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return n.config;
}

describe('acceptance flow: payroll ↔ timesheet', () => {
  let payroll: ReturnType<typeof readSlot>;
  let timesheet: ReturnType<typeof readSlot>;
  let result: Record<string, Table>;

  beforeAll(() => {
    payroll = readSlot(slot('bang_luong'), loadFiles('bang_luong_'));
    timesheet = readSlot(slot('cham_cong'), loadFiles('cham_cong_'));
    const config = CompareConfigSchema.parse(nodeConfig('cmp'));
    result = controlComparePlugin.execute(
      config,
      { left: payroll.table, right: timesheet.table },
      ctx,
    );
  });

  it('AC-01: validation report has no errors or warnings', () => {
    expect(payroll.report.issues).toEqual([]);
    expect(timesheet.report.issues).toEqual([]);
    expect(payroll.report.files).toHaveLength(3);
    expect(timesheet.report.files).toHaveLength(3);
  });

  it('AC-02: CN02 "MSNV" header is mapped to ma_nv', () => {
    const cn02 = payroll.table.rows.filter((r) => r._source_file === 'bang_luong_CN02_092026.xlsx');
    expect(cn02).toHaveLength(25);
    expect(cn02.every((r) => typeof r.ma_nv === 'string' && /^NV\d{5}$/.test(r.ma_nv))).toBe(true);
  });

  it('AC-03: only employee rows are read; the "TỔNG CỘNG" rows are skipped, not errors', () => {
    expect(payroll.table.rows).toHaveLength(expected.counts.payroll_rows!);
    expect(timesheet.table.rows).toHaveLength(expected.counts.timesheet_rows!);
    expect(payroll.report.skippedRows).toHaveLength(3);
    for (const s of payroll.report.skippedRows) {
      expect(s.messageKey).toBe('skipped.keyBlank');
    }
    expect(timesheet.report.skippedRows).toHaveLength(0);
    expect(payroll.table.rows.some((r) => r.ho_ten === 'TỔNG CỘNG')).toBe(false);
    expect(payroll.table.columns.map((c) => c.key)).toContain('_source_file');
  });

  it('AC-04: compare result equals expected.json', () => {
    const summary = result.summary!.rows;
    const total = summary[summary.length - 1]!;
    expect(total.matched).toBe(expected.counts.matched);
    expect(total.mismatched).toBe(expected.counts.mismatched);
    expect(total.only_left).toBe(expected.counts.only_in_payroll);
    expect(total.only_right).toBe(expected.counts.only_in_timesheet);
    const byMetric: Record<string, unknown> = Object.fromEntries(
      summary.slice(0, -1).map((r) => [String(r.metric), r.mismatched]),
    );
    expect(byMetric).toEqual({ Công: 6, 'OT (giờ)': 3, Phép: 3, 'Không lương': 0 });

    const mismatched = result.mismatched!.rows;
    const actual = mismatched
      .map((row) => {
        const diffs: Record<string, string> = {};
        for (const m of ['cong', 'ot', 'phep', 'khong_luong']) {
          const d = row[`${m}__diff`];
          const tol = new Big(
            CompareConfigSchema.parse(nodeConfig('cmp')).metrics.find((x) => x.left === m)!
              .tolerance,
          );
          if (d instanceof Big && d.abs().gt(tol)) diffs[m] = d.toString();
        }
        return { ma_nv: row.ma_nv as string, diffs };
      })
      .sort((a, b) => a.ma_nv.localeCompare(b.ma_nv));

    expect(actual.map((a) => a.ma_nv)).toEqual(expected.mismatched.map((m) => m.ma_nv));
    actual.forEach((a, i) => {
      const exp = expected.mismatched[i]!;
      expect(Object.keys(a.diffs).sort()).toEqual(Object.keys(exp.diffs).sort());
      for (const [k, v] of Object.entries(exp.diffs)) {
        expect(new Big(a.diffs[k]!).eq(new Big(v)), `${a.ma_nv}.${k}`).toBe(true);
      }
    });
    for (const row of mismatched) {
      expect(typeof row[MISMATCHED_METRICS_COLUMN]).toBe('string');
      expect(row.ho_ten).not.toBeNull();
    }

    const ids = (tbl: Table) => tbl.rows.map((r) => r.ma_nv as string).sort();
    expect(ids(result.only_left!)).toEqual(expected.only_in_payroll);
    expect(ids(result.only_right!)).toEqual(expected.only_in_timesheet);
  });

  it('AC-05: a 0.5 công difference with tolerance 0.5 counts as matched', () => {
    // Every branch has one in-tolerance công diff of exactly −0.5; none may appear as mismatched.
    const congRow = result.summary!.rows.find((r) => r.metric === 'Công')!;
    expect(congRow.mismatched).toBe(6);
    const pay = new Map(payroll.table.rows.map((r) => [r.ma_nv, r]));
    const halfDiff = timesheet.table.rows.filter((r) => {
      const p = pay.get(r.ma_nv);
      return (
        p && (r.cong as InstanceType<typeof Big>).minus(p.cong as InstanceType<typeof Big>).eq(-0.5)
      );
    });
    expect(halfDiff).toHaveLength(3);
    const mismatchedIds = new Set(result.mismatched!.rows.map((r) => r.ma_nv));
    for (const r of halfDiff) expect(mismatchedIds.has(r.ma_nv)).toBe(false);
  });

  it('AC-06: writes one .xlsx with the 4 sheets, bold header, frozen row and auto-filter', async () => {
    const out = OutputExcelConfigSchema.parse(nodeConfig('out'));
    const bytes = await writeWorkbook(
      out.sheets.map((s) => ({ name: s.name, table: result[s.port]! })),
    );
    const dir = mkdtempSync(join(tmpdir(), 'hrflow-'));
    const path = join(dir, 'DoiChieu_092026.xlsx');
    writeFileSync(path, bytes);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Tổng hợp',
      'Lệch',
      'Chỉ có trong lương',
      'Chỉ có trong chấm công',
    ]);
    for (const ws of wb.worksheets) {
      expect(ws.getRow(1).font?.bold).toBe(true);
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.autoFilter).toBeTruthy();
    }
    const lech = wb.getWorksheet('Lệch')!;
    expect(lech.rowCount).toBe(1 + expected.counts.mismatched!);
    const headers = (lech.getRow(1).values as unknown[]).slice(1);
    expect(headers).toContain('Công (lương)');
    expect(headers).toContain('Công (chấm công)');
    expect(headers).toContain('Công (chênh lệch)');
    expect(headers).toContain('Chỉ tiêu lệch');
    expect(wb.getWorksheet('Chỉ có trong lương')!.rowCount).toBe(1 + 3);
    expect(wb.getWorksheet('Chỉ có trong chấm công')!.rowCount).toBe(1 + 3);
  });
});
