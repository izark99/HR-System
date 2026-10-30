import { CompareConfigSchema, type CompareConfigInput } from '@hrflow/flow-schema';
import { describe, expect, it } from 'vitest';
import { Big, type Decimal } from '../core/decimal';
import { createEngineTranslator } from '../core/i18n';
import { EngineError, type Table, type Value } from '../core/types';
import { controlComparePlugin, executeCompare } from '../nodes/control-compare';
import { asTable } from './helpers';

const ctx = { t: createEngineTranslator('vi') };

function table(rows: [string, Value][]): Table {
  return asTable({
    columns: [
      { key: 'ma_nv', type: 'string' },
      { key: 'cong', type: 'decimal' },
    ],
    rows: rows.map(([ma_nv, cong]) => ({ ma_nv, cong })),
  });
}

const d = (s: string) => new Big(s);

function run(left: Table, right: Table, cfg: Partial<CompareConfigInput> = {}) {
  const config = CompareConfigSchema.parse({
    keys: ['ma_nv'],
    metrics: [{ left: 'cong', right: 'cong', label: 'Công', tolerance: '0.5' }],
    ...cfg,
  });
  return executeCompare(config, left, right, ctx);
}

describe('control.compare', () => {
  it('diff exactly equal to tolerance is matched; just above is mismatched (AC-05)', () => {
    const left = table([
      ['NV00001', d('26')],
      ['NV00002', d('26')],
      ['NV00003', d('26')],
    ]);
    const right = table([
      ['NV00001', d('25.5')],
      ['NV00002', d('26.5')],
      ['NV00003', d('25.49')],
    ]);
    const out = run(left, right);
    expect(out.mismatched.rows.map((r) => r.ma_nv)).toEqual(['NV00003']);
    expect((out.mismatched.rows[0]!.cong__diff as Decimal).toString()).toBe('-0.51');
    const total = out.summary.rows.at(-1)!;
    expect(total).toMatchObject({ matched: 2, mismatched: 1, only_left: 0, only_right: 0 });
  });

  it('uses decimal arithmetic (0.1 + 0.2 style values do not drift)', () => {
    const out = run(table([['NV00001', d('0.3')]]), table([['NV00001', d('0.1').plus('0.2')]]), {
      metrics: [{ left: 'cong', right: 'cong', label: 'Công', tolerance: '0' }],
    });
    expect(out.mismatched.rows).toEqual([]);
  });

  it('splits only-left / only-right and carries columns', () => {
    const left: Table = asTable({
      columns: [
        { key: 'ma_nv', type: 'string' },
        { key: 'ho_ten', type: 'string' },
        { key: 'cong', type: 'decimal' },
      ],
      rows: [
        { ma_nv: 'NV00001', ho_ten: 'A', cong: d('26') },
        { ma_nv: 'NV00002', ho_ten: 'B', cong: d('26') },
      ],
    });
    const right = table([
      ['NV00001', d('20')],
      ['NV00009', d('1')],
    ]);
    const out = run(left, right, {
      carryColumns: ['ho_ten'],
      sideLabels: { left: 'lương', right: 'chấm công' },
    });
    expect(out.only_left.rows.map((r) => r.ma_nv)).toEqual(['NV00002']);
    expect(out.only_right.rows.map((r) => r.ma_nv)).toEqual(['NV00009']);
    expect(out.mismatched.rows[0]).toMatchObject({
      ma_nv: 'NV00001',
      ho_ten: 'A',
      _mismatched_metrics: 'Công',
    });
    expect(out.mismatched.columns.map((c) => c.title ?? c.key)).toEqual([
      'ma_nv',
      'ho_ten',
      'Công (lương)',
      'Công (chấm công)',
      'Công (chênh lệch)',
      'Chỉ tiêu lệch',
    ]);
    expect(out.summary.columns.map((c) => c.title)).toContain('Chỉ có ở lương');
  });

  it('nullAsZero (default) treats null as 0; when off, null vs number mismatches', () => {
    const left = table([
      ['NV00001', null],
      ['NV00002', null],
    ]);
    const right = table([
      ['NV00001', d('0')],
      ['NV00002', null],
    ]);
    expect(run(left, right).mismatched.rows).toEqual([]);
    const off = run(left, right, { nullAsZero: false });
    expect(off.mismatched.rows.map((r) => r.ma_nv)).toEqual(['NV00001']);
    expect(off.mismatched.rows[0]!.cong__diff).toBeNull();
  });

  it('accepts integer metric columns', () => {
    const l: Table = asTable({
      columns: [
        { key: 'ma_nv', type: 'string' },
        { key: 'cong', type: 'integer' },
      ],
      rows: [{ ma_nv: 'NV1', cong: 3 }],
    });
    const r: Table = asTable({ ...l, rows: [{ ma_nv: 'NV1', cong: 5 }] });
    const out = run(l, r, {
      metrics: [{ left: 'cong', right: 'cong', label: 'Công', tolerance: 1 }],
    });
    expect((out.mismatched.rows[0]!.cong__diff as Decimal).toString()).toBe('2');
  });

  it('rejects duplicate keys, missing and non-numeric columns with i18n keys', () => {
    const dup = table([
      ['NV00001', d('1')],
      ['NV00001', d('2')],
    ]);
    expect(() => run(dup, table([]))).toThrowError(EngineError);
    try {
      run(dup, table([]));
    } catch (e) {
      expect((e as EngineError).messageKey).toBe('compare.error.duplicateKey');
    }
    expect(() => run(table([]), table([]), { keys: ['nope'] })).toThrow(
      'compare.error.missingColumn',
    );
    const textCol: Table = asTable({
      columns: [
        { key: 'ma_nv', type: 'string' },
        { key: 'cong', type: 'string' },
      ],
      rows: [],
    });
    expect(() => run(textCol, table([]))).toThrow('compare.error.notNumeric');
  });

  it('infers output schemas without data', () => {
    const config = CompareConfigSchema.parse({
      keys: ['ma_nv'],
      metrics: [{ left: 'cong', right: 'cong', label: 'Công' }],
    });
    const schemas = controlComparePlugin.inferSchema(
      config,
      { left: table([]).columns, right: table([]).columns },
      ctx,
    );
    expect(Object.keys(schemas)).toEqual(['summary', 'mismatched', 'only_left', 'only_right']);
    expect(schemas.mismatched!.map((c) => c.key)).toEqual([
      'ma_nv',
      'cong__left',
      'cong__right',
      'cong__diff',
      '_mismatched_metrics',
    ]);
  });
});
