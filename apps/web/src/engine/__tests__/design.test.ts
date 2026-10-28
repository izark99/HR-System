import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDesign, type DesignCheckResult } from '../design';
import { nodeDuckDb } from './duckdb-node';
import { t } from './sql-helpers';

const FLOW = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet/flow.json'),
    'utf8',
  ),
) as Record<string, unknown> & {
  nodes: { id: string; config: Record<string, unknown> }[];
  edges: unknown[];
  inputSlots: { key: string; columns: { key: string }[] }[];
  params: Record<string, unknown>[];
};
const clone = () => structuredClone(FLOW);
const check = (raw: unknown) => checkDesign(raw, { t, duck: nodeDuckDb });
const errors = (r: DesignCheckResult) => r.issues.filter((i) => i.severity === 'error');

describe('checkDesign', () => {
  it('the acceptance flow has no problem and every port has columns', async () => {
    const r = await check(FLOW);
    expect(r.issues).toEqual([]);
    expect(r.nodes.in_luong!.outputs!.table!.map((c) => c.key)).toContain('_source_file');
    expect(Object.keys(r.nodes.cmp!.outputs!)).toEqual([
      'summary',
      'mismatched',
      'only_left',
      'only_right',
    ]);
    expect(r.nodes.cmp!.inputs.left!.map((c) => c.key)).toContain('ma_nv');
    expect(r.nodes.out!.status).toBe('ok');
  });

  it('collects all problems: missing ports, unknown columns, downstream blocked (AC-B3-37)', async () => {
    const f = clone();
    f.inputSlots[1]!.columns[0]!.key = 'ma_nhan_vien';
    (f.inputSlots[1] as unknown as { skipRows: { whenBlank: string[] } }).skipRows.whenBlank = [
      'ma_nhan_vien',
    ];
    f.edges = f.edges.filter((e) => (e as { toPort?: string }).toPort !== 'only_right');
    const r = await check(f);
    const cmp = errors(r).filter((i) => i.nodeId === 'cmp');
    expect(cmp).toHaveLength(1);
    expect(cmp[0]!.messageKey).toMatch(/^compare\.error\./);
    expect(cmp[0]!.text).toContain('ma_nv');
    expect(cmp[0]!.path).toBe('keys.0');
    expect(errors(r).find((i) => i.nodeId === 'out')!.messageKey).toBe(
      'executor.error.missingPort',
    );
    expect(r.nodes.cmp!.status).toBe('error');
    expect(r.nodes.out!.status).toBe('error');
    expect(r.errorCount).toBe(2);
  });

  it('a node after a failing node is blocked, not reported', async () => {
    const f = clone();
    f.nodes.push({
      id: 'sel',
      type: 'transform.select',
      config: { columns: [{ from: 'nope' }] },
    } as never);
    f.nodes.push({ id: 'p', type: 'output.preview', config: { title: 'Xem' } } as never);
    f.edges.push({ from: 'in_luong', to: 'sel', fromPort: 'table', toPort: 'in' });
    f.edges.push({ from: 'sel', to: 'p' });
    const r = await check(f);
    expect(errors(r).map((i) => [i.nodeId, i.messageKey, i.path])).toEqual([
      ['sel', 'select.error.unknownColumn', 'columns.0.from'],
    ]);
    expect(r.nodes.p!.status).toBe('blocked');
  });

  it('invalid config fields carry their path; unknown type; cycle; double connection', async () => {
    const f = clone();
    f.nodes.push({ id: 'x', type: 'transform.sort', config: { by: [] } } as never);
    f.nodes.push({ id: 'y', type: 'transform.nope', config: {} } as never);
    f.nodes.push({ id: 'a', type: 'transform.dedupe', config: { keys: ['ma_nv'] } } as never);
    f.nodes.push({ id: 'b', type: 'transform.dedupe', config: { keys: ['ma_nv'] } } as never);
    f.edges.push({ from: 'a', to: 'b', fromPort: 'out', toPort: 'in' });
    f.edges.push({ from: 'b', to: 'a', fromPort: 'out', toPort: 'in' });
    f.edges.push({ from: 'in_cc', to: 'cmp', toPort: 'left' });
    const r = await check(f);
    const keys = errors(r).map((i) => `${i.nodeId}:${i.messageKey}:${i.path ?? ''}`);
    expect(keys).toContain('x:executor.error.invalidConfig:by');
    expect(keys).toContain('y:executor.error.unknownNodeType:');
    expect(keys).toContain('a:executor.error.cycle:');
    expect(keys).toContain('b:executor.error.cycle:');
    expect(keys).toContain('cmp:executor.error.portConnectedTwice:');
  });

  it('slot form errors carry the slot index and field (AC-B3-34)', async () => {
    const f = clone() as Record<string, unknown> & { inputSlots: Record<string, unknown>[] };
    Object.assign(f.inputSlots[0]!, {
      dataStartRow: 2,
      multiple: { enabled: true, minFiles: 5, maxFiles: 2 },
    });
    const cols = f.inputSlots[0]!.columns as Record<string, unknown>[];
    cols[1]!.defaultValue = 3;
    cols[1]!.rules = [{ regex: '(' }];
    cols[2]!.key = '_x';
    const r = await check(f);
    const slot = errors(r).filter((i) => i.slotIndex === 0);
    expect(slot.map((i) => [i.messageKey, i.path])).toEqual(
      expect.arrayContaining([
        ['design.slot.dataStartRow', 'dataStartRow'],
        ['design.slot.minMaxFiles', 'multiple'],
        ['design.slot.defaultValue', 'columns.1.defaultValue'],
        ['design.slot.rule', 'columns.1.rules.0.regex'],
        ['design.slot.columnKey', 'columns.2.key'],
      ]),
    );
    // The node reading the slot is reported once, its consumers are not.
    expect(errors(r).find((i) => i.nodeId === 'in_luong')!.messageKey).toBe(
      'design.node.slotInvalid',
    );
    expect(errors(r).some((i) => i.nodeId === 'cmp')).toBe(false);
  });

  it('params: at most one as-of date, month/date only, select needs options (AC-B3-35)', async () => {
    const f = clone();
    f.params.push({ key: 'ngay', label: 'Ngày', type: 'date', isAsOfDate: true });
    f.params.push({ key: 'ten', label: 'Tên', type: 'string', isAsOfDate: true });
    f.params.push({ key: 'cn', label: 'CN', type: 'select' });
    f.params.push({ key: 'ky_luong', label: 'Trùng', type: 'month' });
    const r = await check(f);
    expect(errors(r).map((i) => [i.messageKey, i.paramIndex, i.path])).toEqual([
      ['design.param.multipleAsOf', 1, 'isAsOfDate'],
      ['design.param.asOfType', 2, 'type'],
      ['design.param.noOptions', 3, 'options'],
      ['design.param.duplicateKey', 4, 'key'],
    ]);
  });

  it('warnings: extraColumns keep, code.sql without ORDER BY; code.sql columns via DESCRIBE', async () => {
    const f = clone();
    f.inputSlots[0]!.extraColumns = 'keep';
    f.nodes.push({
      id: 'q',
      type: 'code.sql',
      config: { inputs: [{ port: 'luong' }], sql: 'SELECT ma_nv, cong / 3 AS x FROM luong' },
    } as never);
    f.edges.push({ from: 'in_luong', to: 'q', toPort: 'luong' });
    const r = await check(f);
    expect(errors(r)).toEqual([]);
    const warn = r.issues.map((i) => `${i.nodeId}:${i.messageKey}`);
    expect(warn).toEqual(
      expect.arrayContaining([
        'in_luong:inputExcel.warning.extraColumnsRuntimeOnly',
        'q:sql.warning.noOrderBy',
      ]),
    );
    expect(r.nodes.q!.outputs!.out!.map((c) => [c.key, c.type])).toEqual([
      ['ma_nv', 'string'],
      ['x', 'decimal'],
    ]);
  });

  it('an empty flow is an error, not a crash; garbage input too', async () => {
    const r = await check({ schemaVersion: 1, nodes: [], edges: [] });
    expect(errors(r).map((i) => i.messageKey)).toEqual(['design.flow.noNodes']);
    expect((await check(null)).errorCount).toBe(1);
  });

  it('preview title clashing with a sheet name is reported on the title field', async () => {
    const f = clone();
    f.nodes.push({ id: 'p', type: 'output.preview', config: { title: 'lệch' } } as never);
    f.edges.push({ from: 'cmp', fromPort: 'mismatched', to: 'p' });
    const r = await check(f);
    expect(errors(r).map((i) => [i.nodeId, i.messageKey, i.path])).toEqual([
      ['p', 'preview.error.duplicateTitle', 'title'],
    ]);
  });
});
