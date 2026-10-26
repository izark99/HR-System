/**
 * QA (tester) — control.compare at engine level, alone and fed by the reader (spec §24.2,
 * AC-04, AC-05, AC-07 at compare level, engine half of AC-10). Fake data only.
 */
import { CompareConfigSchema, type CompareConfigInput } from '@hrflow/flow-schema';
import { describe, expect, it } from 'vitest';
import { Big, isDecimal } from '../core/decimal';
import { createEngineTranslator } from '../core/i18n';
import { EngineError, type Table, type Value } from '../core/types';
import { readSlot } from '../io/excel-reader';
import { executeCompare, MISMATCHED_METRICS_COLUMN } from '../nodes/control-compare';
import {
  acceptanceNodeConfig,
  acceptanceSlot,
  fakeEmployees,
  nv,
  payrollFile,
  timesheetFile,
  type EmpRow,
} from './qa-helpers';

const ctx = { t: createEngineTranslator('vi') };
const d = (s: string | number) => new Big(s);
const str = (v: Value | undefined) => (isDecimal(v) ? v.toString() : v);

function tbl(rows: Record<string, Value>[], decimals = ['cong', 'ot']): Table {
  return {
    columns: [
      { key: 'ma_nv', type: 'string' },
      ...decimals.map((k) => ({ key: k, type: 'decimal' as const })),
    ],
    rows,
  };
}

function cmp(left: Table, right: Table, cfg: Partial<CompareConfigInput> = {}) {
  return executeCompare(
    CompareConfigSchema.parse({
      keys: ['ma_nv'],
      metrics: [
        { left: 'cong', right: 'cong', label: 'Công', tolerance: '0.5' },
        { left: 'ot', right: 'ot', label: 'OT', tolerance: '1' },
      ],
      ...cfg,
    }),
    left,
    right,
    ctx,
  );
}

const total = (out: ReturnType<typeof cmp>) => out.summary.rows.at(-1)!;

// -------------------------------------------------------------------------------------------
describe('QA compare: decimal correctness & tolerance boundary (AC-05)', () => {
  it('Excel doubles 26.3 vs 25.8 (float diff 0.5000000000000036) are within tolerance 0.5', () => {
    // End to end through the reader: float subtraction would wrongly flag this as a mismatch.
    const pay = payrollFile('bl.xlsx', [[nv(1), 'A', 'CN01', 26.3, 4, 1, 0]]);
    const ts = timesheetFile('cc.xlsx', [[nv(1), 'A', 'CN01', 25.8, 4, 1, 0]]);
    const left = readSlot(acceptanceSlot('bang_luong'), [pay]);
    const right = readSlot(acceptanceSlot('cham_cong'), [ts]);
    expect(left.report.errorCount + right.report.errorCount).toBe(0);
    const out = executeCompare(
      CompareConfigSchema.parse(acceptanceNodeConfig('cmp')),
      left.table,
      right.table,
      ctx,
    );
    expect(out.mismatched.rows).toEqual([]);
    expect(str(out.summary.rows[0]!.total_diff)).toBe('-0.5');
  });

  it('0.1 + 0.2 computed in Excel (0.30000000000000004) equals 0.3 with tolerance 0', () => {
    const pay = payrollFile('bl.xlsx', [[nv(1), 'A', 'CN01', 26, 4, 0.1 + 0.2, 0]]);
    const ts = timesheetFile('cc.xlsx', [[nv(1), 'A', 'CN01', 26, 4, 0.3, 0]]);
    const out = executeCompare(
      CompareConfigSchema.parse(acceptanceNodeConfig('cmp')),
      readSlot(acceptanceSlot('bang_luong'), [pay]).table,
      readSlot(acceptanceSlot('cham_cong'), [ts]).table,
      ctx,
    );
    expect(out.mismatched.rows).toEqual([]);
  });

  it('boundaries: |diff| == tolerance matches, tolerance + 0.01 mismatches, both signs', () => {
    const left = tbl([
      { ma_nv: nv(1), cong: d(26), ot: d(4) },
      { ma_nv: nv(2), cong: d(26), ot: d(4) },
      { ma_nv: nv(3), cong: d(26), ot: d(4) },
      { ma_nv: nv(4), cong: d(26), ot: d(4) },
    ]);
    const right = tbl([
      { ma_nv: nv(1), cong: d('26.5'), ot: d(5) }, // +0.5 / +1 → match
      { ma_nv: nv(2), cong: d('25.5'), ot: d(3) }, // −0.5 / −1 → match
      { ma_nv: nv(3), cong: d('26.51'), ot: d(4) }, // công +0.51 → mismatch
      { ma_nv: nv(4), cong: d(26), ot: d('2.99') }, // OT −1.01 → mismatch
    ]);
    const out = cmp(left, right);
    expect(out.mismatched.rows.map((r) => [r.ma_nv, r[MISMATCHED_METRICS_COLUMN]])).toEqual([
      [nv(3), 'Công'],
      [nv(4), 'OT'],
    ]);
    expect(total(out)).toMatchObject({ matched: 2, mismatched: 2 });
  });

  it('tolerance 0: any non-zero diff mismatches, even 0.000001', () => {
    const out = cmp(
      tbl([{ ma_nv: nv(1), cong: d(1), ot: d(0) }]),
      tbl([{ ma_nv: nv(1), cong: d('1.000001'), ot: d(0) }]),
      {
        metrics: [{ left: 'cong', right: 'cong', label: 'Công', tolerance: '0' }],
      },
    );
    expect(str(out.mismatched.rows[0]!.cong__diff)).toBe('0.000001');
  });

  it('diff is right − left and summary total_diff sums every key-matched diff exactly', () => {
    const left = tbl([
      { ma_nv: nv(1), cong: d('0.1'), ot: d(0) },
      { ma_nv: nv(2), cong: d('0.2'), ot: d(0) },
      { ma_nv: nv(3), cong: d('10'), ot: d(0) },
    ]);
    const right = tbl([
      { ma_nv: nv(1), cong: d('0.3'), ot: d(0) },
      { ma_nv: nv(2), cong: d('0.4'), ot: d(0) },
      { ma_nv: nv(3), cong: d('7.7'), ot: d(0) },
    ]);
    const out = cmp(left, right);
    expect(str(out.summary.rows[0]!.total_diff)).toBe('-1.9'); // 0.2 + 0.2 − 2.3
    expect(str(out.mismatched.rows[0]!.cong__diff)).toBe('-2.3');
  });

  it('engine half of AC-10: OT tolerance 5 makes a 4-hour OT diff match', () => {
    const left = tbl([{ ma_nv: nv(25), cong: d(26), ot: d(4) }]);
    const right = tbl([{ ma_nv: nv(25), cong: d(26), ot: d(8) }]);
    expect(total(cmp(left, right)).mismatched).toBe(1);
    const out = cmp(left, right, {
      metrics: [
        { left: 'cong', right: 'cong', label: 'Công', tolerance: '0.5' },
        { left: 'ot', right: 'ot', label: 'OT', tolerance: 5 },
      ],
    });
    expect(total(out)).toMatchObject({ matched: 1, mismatched: 0 });
  });
});

// -------------------------------------------------------------------------------------------
describe('QA compare: null handling', () => {
  const left = tbl([
    { ma_nv: nv(1), cong: null, ot: d(0) },
    { ma_nv: nv(2), cong: null, ot: d(0) },
    { ma_nv: nv(3), cong: d('0.4'), ot: d(0) },
  ]);
  const right = tbl([
    { ma_nv: nv(1), cong: null, ot: d(0) },
    { ma_nv: nv(2), cong: d('0.5'), ot: d(0) },
    { ma_nv: nv(3), cong: null, ot: d(0) },
  ]);

  it('nullAsZero = true: null vs 0.5 is within tolerance 0.5; output shows the blank side as blank', () => {
    const out = cmp(left, right, { nullAsZero: true });
    expect(total(out)).toMatchObject({ matched: 3, mismatched: 0 });
    const tight = cmp(left, right, {
      nullAsZero: true,
      metrics: [{ left: 'cong', right: 'cong', label: 'Công', tolerance: '0' }],
    });
    // MEMORY 20261026: blank source cells stay blank in "Lệch" but are compared as 0.
    expect(
      tight.mismatched.rows.map((r) => [
        r.ma_nv,
        str(r.cong__left),
        str(r.cong__right),
        str(r.cong__diff),
      ]),
    ).toEqual([
      [nv(2), null, '0.5', '0.5'],
      [nv(3), '0.4', null, '-0.4'],
    ]);
  });

  it('nullAsZero = false: null vs null matches, null vs number mismatches with a blank diff', () => {
    const out = cmp(left, right, { nullAsZero: false });
    expect(out.mismatched.rows.map((r) => r.ma_nv)).toEqual([nv(2), nv(3)]);
    for (const r of out.mismatched.rows) expect(r.cong__diff).toBeNull();
    expect(str(out.summary.rows[0]!.total_diff)).toBe('0'); // nulls excluded from the total
  });
});

// -------------------------------------------------------------------------------------------
describe('QA compare: keys', () => {
  it('duplicate keys reaching compare (unique rule downgraded to warning) → EngineError, no output', () => {
    const s = acceptanceSlot('cham_cong');
    s.columns[0]!.rules = [
      { unique: true, severity: 'warning' },
      { regex: '^NV\\d{5}$', severity: 'error' },
    ];
    const dupRows: EmpRow[] = [
      [nv(1), 'A', 'CN01', 26, 0, 0, 0],
      [nv(1), 'A', 'CN02', 20, 0, 0, 0],
    ];
    const right = readSlot(s, [timesheetFile('cc.xlsx', dupRows)]);
    expect(right.report.errorCount).toBe(0);
    expect(right.report.warningCount).toBe(1);
    const left = readSlot(acceptanceSlot('bang_luong'), [payrollFile('bl.xlsx', fakeEmployees(1))]);
    let err: unknown;
    try {
      executeCompare(
        CompareConfigSchema.parse(acceptanceNodeConfig('cmp')),
        left.table,
        right.table,
        ctx,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({
      messageKey: 'compare.error.duplicateKey',
      params: { side: 'chấm công', key: nv(1) },
    });
  });

  it('keys match case-insensitively and ignore extra whitespace; output keeps the left value', () => {
    // MEMORY 20261026: "So khớp khóa không phân biệt hoa thường, bỏ khoảng trắng thừa".
    const out = cmp(
      tbl([
        { ma_nv: 'nv00001', cong: d(1), ot: d(0) },
        { ma_nv: 'NV 00002', cong: d(1), ot: d(0) },
      ]),
      tbl([
        { ma_nv: ' NV00001 ', cong: d(3), ot: d(0) },
        { ma_nv: 'nv  00002', cong: d(1), ot: d(0) },
      ]),
    );
    expect(total(out)).toMatchObject({ matched: 1, mismatched: 1, only_left: 0, only_right: 0 });
    expect(out.mismatched.rows[0]!.ma_nv).toBe('nv00001');
  });

  it('key normalization does not merge genuinely different keys', () => {
    const out = cmp(
      tbl([{ ma_nv: 'NV00001', cong: d(1), ot: d(0) }]),
      tbl([{ ma_nv: 'NV000010', cong: d(1), ot: d(0) }]),
    );
    expect(total(out)).toMatchObject({ matched: 0, only_left: 1, only_right: 1 });
  });

  it('keys equal after normalization on one side → duplicateKey (original value in message)', () => {
    expect(() =>
      cmp(
        tbl([
          { ma_nv: 'NV00001', cong: d(1), ot: d(0) },
          { ma_nv: 'nv00001 ', cong: d(1), ot: d(0) },
        ]),
        tbl([]),
      ),
    ).toThrowError(expect.objectContaining({ messageKey: 'compare.error.duplicateKey' }));
  });

  it('composite keys do not collide on separator characters', () => {
    const t2 = (a: string, b: string) => ({
      columns: [
        { key: 'k1', type: 'string' as const },
        { key: 'k2', type: 'string' as const },
        { key: 'cong', type: 'decimal' as const },
      ],
      rows: [{ k1: a, k2: b, cong: d(1) }],
    });
    const out = executeCompare(
      CompareConfigSchema.parse({
        keys: ['k1', 'k2'],
        metrics: [{ left: 'cong', right: 'cong', label: 'C' }],
      }),
      t2('a|b', 'c'),
      t2('a', 'b|c'),
      ctx,
    );
    expect(total(out)).toMatchObject({ matched: 0, only_left: 1, only_right: 1 });
  });

  it('empty tables on both sides → summary rows with zeros, no crash', () => {
    const out = cmp(tbl([]), tbl([]));
    expect(total(out)).toMatchObject({ matched: 0, mismatched: 0, only_left: 0, only_right: 0 });
    expect(out.summary.rows).toHaveLength(3);
  });

  it('only_left / only_right keep the full source row incl. _source_file', () => {
    const left = readSlot(acceptanceSlot('bang_luong'), [payrollFile('bl.xlsx', fakeEmployees(2))]);
    const right = readSlot(acceptanceSlot('cham_cong'), [
      timesheetFile('cc.xlsx', fakeEmployees(1, 2)),
    ]);
    const out = executeCompare(
      CompareConfigSchema.parse(acceptanceNodeConfig('cmp')),
      left.table,
      right.table,
      ctx,
    );
    expect(out.only_left.rows).toHaveLength(1);
    expect(out.only_left.rows[0]).toMatchObject({ ma_nv: nv(1), _source_file: 'bl.xlsx' });
    expect(out.only_left.columns.map((c) => c.key)).toContain('_source_file');
  });
});

// -------------------------------------------------------------------------------------------
describe('QA compare: fixed bugs (were KNOWN BUGS)', () => {
  it('BUG-C1: a negative tolerance is rejected by CompareConfigSchema', () => {
    // "-1" used to be accepted, then every row mismatched (|0| > −1), even identical values.
    const r = CompareConfigSchema.safeParse({
      keys: ['ma_nv'],
      metrics: [{ left: 'cong', right: 'cong', label: 'Công', tolerance: '-1' }],
    });
    expect(r.success).toBe(false);
  });

  it('BUG-C2: two metrics on the same column pair keep separate output columns', () => {
    // e.g. "Công" with tolerance 0.5 and "Công (chặt)" with tolerance 0 used to both map to
    // cong__left / cong__right / cong__diff.
    const out = cmp(
      tbl([{ ma_nv: nv(1), cong: d(26), ot: d(0) }]),
      tbl([{ ma_nv: nv(1), cong: d('26.3'), ot: d(0) }]),
      {
        metrics: [
          { left: 'cong', right: 'cong', label: 'Công', tolerance: '0.5' },
          { left: 'cong', right: 'cong', label: 'Công (chặt)', tolerance: '0' },
        ],
      },
    );
    const colKeys = out.mismatched.columns.map((c) => c.key);
    expect(new Set(colKeys).size).toBe(colKeys.length);
    // First metric keeps its stable keys; the second gets the metric index as suffix.
    expect(colKeys).toEqual(expect.arrayContaining(['cong__diff', 'cong_2__diff']));
    const row = out.mismatched.rows[0]!;
    expect(row.cong__diff?.toString()).toBe('0.3');
    expect(row.cong_2__diff?.toString()).toBe('0.3');
    expect(row._mismatched_metrics).toBe('Công (chặt)');
  });
});
