import { FlowDefinitionSchema, flowRefTables } from '@hrflow/flow-schema';
import { describe, expect, it } from 'vitest';
import { isDecimal } from '../core/decimal';
import { runFlow } from '../core/executor';
import type { RefColumnDef, RefTableDef } from '../core/types';
import { checkDesign } from '../design';
import { buildRefTable, castRefValue, RefStore, refRunOptions } from '../io/ref-data';
import { nodeDuckDb } from './duckdb-node';
import { t } from './sql-helpers';

/** Fake reference data (branch list), never personal data. */
const COLUMNS: RefColumnDef[] = [
  { key: 'ma_cn', title: 'Mã chi nhánh', type: 'string' },
  { key: 'ten_cn', title: 'Tên chi nhánh', type: 'string' },
  { key: 'vung', title: 'Vùng', type: 'integer' },
];
const DM_CN: RefTableDef = { code: 'DM_CN', name: 'Danh mục chi nhánh', columns: COLUMNS };
const ROWS = [
  { ma_cn: 'CN01', ten_cn: 'Chi nhánh Một', vung: 1 },
  { ma_cn: 'CN02', ten_cn: 'Chi nhánh Hai', vung: 2 },
];

function flowWith(extra: { nodes?: unknown[]; edges?: unknown[]; params?: unknown[] } = {}) {
  return {
    schemaVersion: 1,
    params: extra.params ?? [],
    nodes: [
      { id: 'ref_cn', type: 'input.refTable', label: 'Chi nhánh', config: { refTable: 'DM_CN' } },
      ...(extra.nodes ?? []),
    ],
    edges: extra.edges ?? [],
    inputSlots: [],
  };
}

describe('flowRefTables (same rule as flow_versions.ref_tables)', () => {
  it('lists node tables and list-param tables once, sorted, ignoring ill-formed parts', () => {
    expect(
      flowRefTables({
        nodes: [
          { id: 'a', type: 'input.refTable', config: { refTable: 'HE_SO' } },
          { id: 'b', type: 'input.refTable', config: { refTable: 'DM_CN' } },
          { id: 'c', type: 'input.refTable', config: { refTable: 'DM_CN' } },
          { id: 'd', type: 'input.refTable', config: { refTable: 'lower' } },
          { id: 'e', type: 'input.excel', config: { refTable: 'KHAC' } },
          { id: 'f', type: 'input.refTable', config: 'x' },
          null,
        ],
        params: [
          { key: 'p', options: { fromRefTable: 'BAC', valueColumn: 'a', labelColumn: 'b' } },
          { key: 'q', options: [{ value: 'KHAC', label: 'x' }] },
        ],
      }),
    ).toEqual(['BAC', 'DM_CN', 'HE_SO']);
    expect(flowRefTables(null)).toEqual([]);
    expect(flowRefTables({ nodes: {}, params: 'x' })).toEqual([]);
  });
});

describe('castRefValue (AC-RT-15 b: lossless conversions only)', () => {
  it('keeps values of the right type and blanks', () => {
    expect(castRefValue('CN01', 'string')).toEqual({ ok: true, value: 'CN01' });
    expect(castRefValue(3, 'integer')).toEqual({ ok: true, value: 3 });
    expect(castRefValue(true, 'boolean')).toEqual({ ok: true, value: true });
    expect(castRefValue('2026-07-01', 'date')).toEqual({ ok: true, value: '2026-07-01' });
    expect(castRefValue(null, 'decimal')).toEqual({ ok: true, value: null });
    expect(castRefValue(undefined, 'date')).toEqual({ ok: true, value: null });
    expect(castRefValue('  ', 'integer')).toEqual({ ok: true, value: null });
  });

  it('converts integer → decimal and standard text → number / date / boolean', () => {
    const d = castRefValue(12, 'decimal');
    expect(d.ok && isDecimal(d.value) && d.value.toFixed()).toBe('12');
    const s = castRefValue('1.25', 'decimal');
    expect(s.ok && isDecimal(s.value) && s.value.toFixed()).toBe('1.25');
    expect(castRefValue('12', 'integer')).toEqual({ ok: true, value: 12 });
    expect(castRefValue('12.00', 'integer')).toEqual({ ok: true, value: 12 });
    expect(castRefValue('01/07/2026', 'date')).toEqual({ ok: true, value: '2026-07-01' });
    expect(castRefValue('2026-7-1', 'date')).toEqual({ ok: true, value: '2026-07-01' });
    expect(castRefValue('TRUE', 'boolean')).toEqual({ ok: true, value: true });
    expect(castRefValue(7, 'string')).toEqual({ ok: true, value: '7' });
  });

  it('refuses anything that would lose or invent information', () => {
    expect(castRefValue('12.5', 'integer').ok).toBe(false);
    expect(castRefValue('1,500', 'decimal').ok).toBe(false);
    expect(castRefValue('Hà Nội', 'integer').ok).toBe(false);
    expect(castRefValue(1.5, 'integer').ok).toBe(false);
    expect(castRefValue('31/02/2026', 'date').ok).toBe(false);
    expect(castRefValue('07-2026', 'date').ok).toBe(false);
    expect(castRefValue(1, 'boolean').ok).toBe(false);
    expect(castRefValue('có', 'boolean').ok).toBe(false);
    expect(castRefValue(true, 'date').ok).toBe(false);
    expect(castRefValue('99999999999999999', 'integer').ok).toBe(false);
    expect(castRefValue({ a: 1 }, 'string').ok).toBe(false);
  });
});

describe('buildRefTable / RefStore', () => {
  it('builds a typed table in column order, unknown keys ignored', () => {
    const r = buildRefTable(COLUMNS, [...ROWS, { ma_cn: 'CN03', vung: '3', extra: 'x' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.columns.map((c) => c.key)).toEqual(['ma_cn', 'ten_cn', 'vung']);
    expect(r.table.row(2)).toEqual({ ma_cn: 'CN03', ten_cn: null, vung: 3 });
  });

  it('names the first column that does not fit (no cell value)', () => {
    const r = buildRefTable(COLUMNS, [...ROWS, { ma_cn: 'CN03', vung: 'Vùng ba' }]);
    expect(r).toEqual({ ok: false, column: COLUMNS[2] });
  });

  it('keeps usable tables, reports the others, replaces everything on each call', () => {
    const store = new RefStore();
    const status = store.set([
      {
        code: 'DM_CN',
        name: 'Danh mục',
        versionId: 'v3',
        versionNo: 3,
        columns: COLUMNS,
        rows: ROWS,
      },
      {
        code: 'HE_SO',
        name: 'Hệ số',
        versionId: 'v5',
        versionNo: 5,
        columns: [{ key: 'he_so', title: 'Hệ số', type: 'decimal' }],
        rows: [{ he_so: 'một' }],
      },
    ]);
    expect(status).toEqual([
      { code: 'DM_CN', ok: true, rowCount: 2 },
      { code: 'HE_SO', ok: false, columnKey: 'he_so', column: 'Hệ số' },
    ]);
    expect(store.read('DM_CN').rowCount).toBe(2);
    expect(() => store.read('HE_SO')).toThrow('refTable.error.notLoaded');
    expect(Object.keys(store.definitions())).toEqual(['DM_CN', 'HE_SO']);
    store.set([]);
    expect(() => store.read('DM_CN')).toThrow('refTable.error.notLoaded');
  });
});

describe('input.refTable', () => {
  it('runs with the rows of the chosen version and feeds downstream nodes', async () => {
    const store = new RefStore();
    store.set([
      {
        code: 'DM_CN',
        name: 'Danh mục',
        versionId: 'v3',
        versionNo: 3,
        columns: COLUMNS,
        rows: ROWS,
      },
    ]);
    const flow = FlowDefinitionSchema.parse(
      flowWith({
        nodes: [
          {
            id: 'chon',
            type: 'transform.select',
            config: { columns: [{ from: 'ten_cn' }, { from: 'vung' }] },
          },
        ],
        edges: [{ from: 'ref_cn', to: 'chon' }],
      }),
    );
    const r = await runFlow(flow, {
      t,
      duck: nodeDuckDb,
      ...refRunOptions(store),
      collect: ['chon'],
    });
    const out = r.outputs.chon!.out!;
    expect(out.columns.map((c) => [c.key, c.type, c.title])).toEqual([
      ['ten_cn', 'string', 'Tên chi nhánh'],
      ['vung', 'integer', 'Vùng'],
    ]);
    expect(out.row(1)).toEqual({ ten_cn: 'Chi nhánh Hai', vung: 2 });
  });

  it('fails with a clear message when no data was loaded for the table', async () => {
    const flow = FlowDefinitionSchema.parse(flowWith());
    await expect(runFlow(flow, { t, refTables: { DM_CN: DM_CN } })).rejects.toMatchObject({
      messageKey: 'refTable.error.notLoaded',
      nodeId: 'ref_cn',
    });
  });
});

describe('checkDesign with reference tables (AC-RT-07, AC-RT-02, AC-RT-10)', () => {
  const errors = (r: Awaited<ReturnType<typeof checkDesign>>) =>
    r.issues.filter((i) => i.severity === 'error');

  it('infers the columns of the table without data', async () => {
    const r = await checkDesign(flowWith(), { t, refTables: { DM_CN } });
    expect(r.issues).toEqual([]);
    expect(r.nodes.ref_cn!.outputs!.table!.map((c) => c.key)).toEqual(['ma_cn', 'ten_cn', 'vung']);
  });

  it('reports a table that does not exist and an unloaded catalog on the node', async () => {
    const r = await checkDesign(flowWith(), { t, refTables: {} });
    expect(errors(r)).toMatchObject([
      {
        messageKey: 'refTable.error.unknownTable',
        nodeId: 'ref_cn',
        path: 'refTable',
        text: 'Node "Chi nhánh": bảng tham chiếu "DM_CN" không tồn tại.',
      },
    ]);
    const none = await checkDesign(flowWith(), { t });
    expect(errors(none).map((i) => i.messageKey)).toEqual(['refTable.error.catalogUnavailable']);
  });

  it('warns when the table has no published version (does not block)', async () => {
    const r = await checkDesign(flowWith(), {
      t,
      refTables: { DM_CN: { ...DM_CN, published: false } },
    });
    expect(errors(r)).toEqual([]);
    expect(r.issues.map((i) => i.messageKey)).toEqual(['refTable.warning.noPublished']);
  });

  it('a downstream node using a column the table no longer has is an error', async () => {
    const def = flowWith({
      nodes: [
        { id: 'chon', type: 'transform.select', config: { columns: [{ from: 'he_so_cu' }] } },
      ],
      edges: [{ from: 'ref_cn', to: 'chon' }],
    });
    const r = await checkDesign(def, { t, refTables: { DM_CN } });
    expect(errors(r)).toHaveLength(1);
    expect(errors(r)[0]!.nodeId).toBe('chon');
    expect(errors(r)[0]!.text).toContain('he_so_cu');
  });

  it('checks list params: table, value and label columns, no published version', async () => {
    const param = (options: Record<string, string>) => ({
      key: 'chi_nhanh',
      label: 'Chi nhánh',
      type: 'select',
      options,
    });
    const ok = await checkDesign(
      flowWith({
        params: [param({ fromRefTable: 'DM_CN', valueColumn: 'ma_cn', labelColumn: 'ten_cn' })],
      }),
      { t, refTables: { DM_CN } },
    );
    expect(ok.issues).toEqual([]);

    const bad = await checkDesign(
      flowWith({
        params: [param({ fromRefTable: 'DM_CN', valueColumn: 'ma_cu', labelColumn: 'ten_cn' })],
      }),
      { t, refTables: { DM_CN } },
    );
    expect(errors(bad)).toMatchObject([
      {
        messageKey: 'design.param.refColumnUnknown',
        paramIndex: 0,
        path: 'options.valueColumn',
        text: 'Tham số "Chi nhánh": bảng "Danh mục chi nhánh" không còn cột "ma_cu".',
      },
    ]);

    const unknown = await checkDesign(
      flowWith({
        params: [param({ fromRefTable: 'KHAC', valueColumn: 'a', labelColumn: 'b' })],
      }),
      { t, refTables: { DM_CN } },
    );
    expect(errors(unknown).map((i) => [i.messageKey, i.path])).toEqual([
      ['design.param.refTableUnknown', 'options.fromRefTable'],
    ]);

    const draftOnly = await checkDesign(
      flowWith({
        params: [param({ fromRefTable: 'DM_CN', valueColumn: 'ma_cn', labelColumn: 'ten_cn' })],
      }),
      { t, refTables: { DM_CN: { ...DM_CN, published: false } } },
    );
    expect(errors(draftOnly)).toEqual([]);
    expect(draftOnly.issues.filter((i) => i.paramIndex === 0).map((i) => i.severity)).toEqual([
      'warning',
    ]);
  });
});
