import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PREVIEW_ROWS, PreviewSession } from '../preview';
import { nodeDuckDb } from './duckdb-node';
import { t } from './sql-helpers';

const DIR = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');
const FLOW = JSON.parse(readFileSync(join(DIR, 'flow.json'), 'utf8')) as {
  nodes: { id: string; type: string; config: Record<string, unknown> }[];
  edges: Record<string, string>[];
  inputSlots: { key: string; sheet: unknown }[];
};
const EXPECTED = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as {
  counts: Record<string, number>;
};
const files = (prefix: string) =>
  readdirSync(DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((f) => ({ name: f, blob: new Blob([readFileSync(join(DIR, f))]) }));

const withBranch = () => {
  const f = structuredClone(FLOW);
  f.nodes.push(
    {
      id: 'loc',
      type: 'transform.filter',
      config: { conditions: [{ column: 'chi_nhanh', op: 'eq', value: 'cn01' }] },
    },
    { id: 'xep', type: 'transform.sort', config: { by: [{ column: 'ma_nv' }] } },
    { id: 'bo_trung', type: 'transform.dedupe', config: { keys: ['chi_nhanh'] } },
  );
  f.edges.push(
    { from: 'in_luong', to: 'loc' },
    { from: 'in_cc', to: 'xep' },
    { from: 'in_luong', to: 'bo_trung' },
  );
  return f;
};

const P = { ky_luong: '2026-09' };
let session: PreviewSession;
beforeAll(async () => {
  session = new PreviewSession(t, nodeDuckDb);
  const v1 = await session.setSampleFiles('bang_luong', files('bang_luong_'), FLOW.inputSlots[0]);
  const v2 = await session.setSampleFiles('cham_cong', files('cham_cong_'), FLOW.inputSlots[1]);
  expect(v1?.report.errorCount).toBe(0);
  expect(v2?.rowCount).toBe(EXPECTED.counts.timesheet_rows);
});

describe('PreviewSession (spec §13.3)', () => {
  it('compare: the 4 tables with expected.json numbers; the output node did not run (AC-B3-53)', async () => {
    const r = await session.preview(FLOW, 'cmp', { ky_luong: '2026-09' });
    if (!r.ok) throw new Error(r.error.messageKey);
    expect(r.tables.map((x) => [x.name, x.total])).toEqual([
      ['summary', 5],
      ['mismatched', EXPECTED.counts.mismatched],
      ['only_left', EXPECTED.counts.only_in_payroll],
      ['only_right', EXPECTED.counts.only_in_timesheet],
    ]);
    expect(r.ran).toEqual(['in_luong', 'in_cc', 'cmp']);
  });

  it('only ancestors run; 200 rows + total; ports of dedupe as tabs (AC-B3-51/52)', async () => {
    const f = withBranch();
    const r = await session.preview(f, 'loc', P);
    if (!r.ok) throw new Error(r.error.messageKey);
    expect(r.ran).toEqual(['in_luong', 'loc']);
    expect(r.tables[0]!.total).toBeGreaterThan(0);
    const d = await session.preview(f, 'bo_trung', P);
    if (!d.ok) throw new Error(d.error.messageKey);
    expect(d.tables.map((x) => x.name)).toEqual(['out', 'removed']);
    expect(d.tables[0]!.total + d.tables[1]!.total).toBe(EXPECTED.counts.payroll_rows);
    const big = await session.preview(f, 'in_luong', P);
    if (!big.ok) throw new Error(big.error.messageKey);
    expect(big.tables[0]!.rows.length).toBeLessThanOrEqual(PREVIEW_ROWS);
    // Decimals cross as strings.
    const cong = big.tables[0]!.columns.findIndex((c) => c.key === 'cong');
    expect(typeof big.tables[0]!.rows[0]![cong]).toBe('string');
  });

  it('output.excel shows its sheets; no artifact is created', async () => {
    const r = await session.preview(FLOW, 'out', { ky_luong: '2026-09' });
    if (!r.ok) throw new Error(r.error.messageKey);
    expect(r.tables.map((x) => x.name)).toEqual([
      'Tổng hợp',
      'Lệch',
      'Chỉ có trong lương',
      'Chỉ có trong chấm công',
    ]);
    expect(r.ran).not.toContain('out');
  });

  it('missing or invalid samples name the slot; required params are asked for (AC-B3-55)', async () => {
    const other = new PreviewSession(t, nodeDuckDb);
    const r = await other.preview(FLOW, 'cmp', { ky_luong: '2026-09' });
    expect(r).toMatchObject({ ok: false, error: { messageKey: 'preview.error.noSample' } });
    const broken = structuredClone(FLOW);
    broken.inputSlots[0]!.sheet = { mode: 'byName', value: 'KhongCo' };
    const v = await other.setSampleFiles('bang_luong', files('bang_luong_'), broken.inputSlots[0]);
    expect(v!.report.errorCount).toBeGreaterThan(0);
    const r2 = await other.preview(broken, 'in_luong', {});
    expect(r2).toMatchObject({
      ok: false,
      error: {
        messageKey: 'preview.error.sampleInvalid',
        params: { slot: 'Bảng lương (nhiều chi nhánh)' },
      },
    });
    const r3 = await session.preview(FLOW, 'out', {});
    expect(r3).toMatchObject({ ok: false, error: { messageKey: 'executor.error.paramRequired' } });
  });

  it('uses the given (unsaved) definition and re-validates with the current slot config', async () => {
    const f = structuredClone(FLOW);
    (f.nodes.find((n) => n.id === 'cmp')!.config.metrics as { tolerance: string }[])[0]!.tolerance =
      '5';
    const r = await session.preview(f, 'cmp', P);
    if (!r.ok) throw new Error(r.error.messageKey);
    expect(r.tables[1]!.total).toBeLessThan(EXPECTED.counts.mismatched!);
    expect(
      session.validate('bang_luong', {
        ...FLOW.inputSlots[0],
        sheet: { mode: 'byName', value: 'X' },
      })!.report.errorCount,
    ).toBeGreaterThan(0);
  });
});
