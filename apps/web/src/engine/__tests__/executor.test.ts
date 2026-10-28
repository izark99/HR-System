import { FlowDefinitionSchema, type FlowDefinition } from '@hrflow/flow-schema';
import ExcelJS from 'exceljs';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  checkParams,
  isCancelled,
  planFlow,
  runFlow,
  type RunProgressEvent,
} from '../core/executor';
import { createEngineTranslator } from '../core/i18n';
import type { AnyNodePlugin, NodeOutputs } from '../core/plugin';
import { EngineError, type Table } from '../core/types';
import type { SourceFile } from '../io/excel-reader';
import { nodePlugins } from '../nodes';
import { resolveFileName } from '../nodes/output-excel';
import { asTable } from './helpers';

const FIXTURES = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');
const t = createEngineTranslator('vi');
const acceptance = FlowDefinitionSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8')),
);

function fixtureFiles(prefix: string): SourceFile[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((name) => ({ name, data: new Uint8Array(readFileSync(join(FIXTURES, name))) }));
}

// ---- small test plugins -------------------------------------------------------------------

const emptyTable = (n = 0): Table =>
  asTable({
    columns: [{ key: 'v', type: 'integer' }],
    rows: Array.from({ length: n }, (_, i) => ({ v: i })),
  });

function sourcePlugin(rows = 2): AnyNodePlugin {
  return {
    type: 'test.source',
    configSchema: z.object({}),
    inputs: [],
    outputs: [{ name: 'out', required: false }],
    inferSchema: () => ({ out: emptyTable().columns }),
    execute: () => ({ out: emptyTable(rows) }),
  };
}

const passPlugin: AnyNodePlugin = {
  type: 'test.pass',
  configSchema: z.object({}),
  inputs: [{ name: 'in', required: true }],
  outputs: [{ name: 'out', required: false }],
  inferSchema: (_c, inputs) => ({ out: inputs.in ?? [] }),
  execute: (_c, inputs: Record<string, Table>): NodeOutputs => ({ out: inputs.in! }),
};

const twoInPlugin: AnyNodePlugin = {
  type: 'test.two',
  configSchema: z.object({}),
  inputs: [
    { name: 'a', required: true },
    { name: 'b', required: false },
  ],
  outputs: [
    { name: 'x', required: false },
    { name: 'y', required: false },
  ],
  inferSchema: () => ({}),
  execute: (_c, inputs: Record<string, Table>): NodeOutputs => ({ x: inputs.a!, y: inputs.a! }),
};

const plugins = {
  'test.source': sourcePlugin(),
  'test.pass': passPlugin,
  'test.two': twoInPlugin,
};

/** Build a flow without schema validation, so graph errors reach the executor. */
function graph(
  nodes: [id: string, type: string][],
  edges: FlowDefinition['edges'],
): FlowDefinition {
  return {
    schemaVersion: 1,
    params: [],
    inputSlots: [],
    nodes: nodes.map(([id, type]) => ({ id, type, config: {} })),
    edges,
  };
}

function engineError(fn: () => unknown): EngineError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    return err as EngineError;
  }
  throw new Error('expected an EngineError');
}

// ---- planning -----------------------------------------------------------------------------

describe('planFlow', () => {
  it('orders nodes topologically and resolves default ports', () => {
    const flow = graph(
      [
        ['c', 'test.pass'],
        ['b', 'test.pass'],
        ['a', 'test.source'],
      ],
      [
        { from: 'b', to: 'c' },
        { from: 'a', to: 'b' },
      ],
    );
    const plan = planFlow(flow, plugins);
    expect(plan.map((p) => p.node.id)).toEqual(['a', 'b', 'c']);
    expect(plan[1]!.inputs).toEqual([{ port: 'in', from: 'a', fromPort: 'out' }]);
  });

  it('plans the acceptance flow (input.excel → control.compare → output.excel)', () => {
    const plan = planFlow(acceptance);
    expect(plan.map((p) => p.node.id)).toEqual(['in_luong', 'in_cc', 'cmp', 'out']);
    expect(plan[3]!.inputs.map((l) => l.port).sort()).toEqual([
      'mismatched',
      'only_left',
      'only_right',
      'summary',
    ]);
  });

  it('rejects a cycle with the node id attached', () => {
    const flow = graph(
      [
        ['s', 'test.source'],
        ['a', 'test.two'],
        ['b', 'test.pass'],
      ],
      [
        { from: 's', to: 'a', toPort: 'a' },
        { from: 'a', fromPort: 'x', to: 'b' },
        { from: 'b', to: 'a', toPort: 'b' },
      ],
    );
    const err = engineError(() => planFlow(flow, plugins));
    expect(err.messageKey).toBe('executor.error.cycle');
    expect(['a', 'b']).toContain(err.nodeId);
  });

  it('names a node on the cycle even when a downstream node is listed first', () => {
    // d depends on the cycle a <-> b but is not part of it.
    const flow = graph(
      [
        ['d', 'test.pass'],
        ['s', 'test.source'],
        ['a', 'test.two'],
        ['b', 'test.pass'],
      ],
      [
        { from: 's', to: 'a', toPort: 'a' },
        { from: 'a', fromPort: 'x', to: 'b' },
        { from: 'b', to: 'a', toPort: 'b' },
        { from: 'a', fromPort: 'y', to: 'd' },
      ],
    );
    const err = engineError(() => planFlow(flow, plugins));
    expect(err.messageKey).toBe('executor.error.cycle');
    expect(['a', 'b']).toContain(err.nodeId);
    expect(err.params.node).toBe(err.nodeId);
  });

  it('rejects input.excel pointing at an undeclared slot, with the node id', () => {
    const flow: FlowDefinition = {
      ...acceptance,
      nodes: acceptance.nodes.map((n) =>
        n.id === 'in_cc' ? { ...n, config: { ...n.config, slot: 'khong_co' } } : n,
      ),
    };
    const err = engineError(() => planFlow(flow));
    expect(err.messageKey).toBe('executor.error.nodeUnknownSlot');
    expect(err.nodeId).toBe('in_cc');
    expect(err.params).toMatchObject({ slot: 'khong_co' });
    expect(t(err.messageKey, err.params)).toContain('khong_co');
  });

  it('rejects a self loop', () => {
    const flow = graph([['a', 'test.pass']], [{ from: 'a', to: 'a' }]);
    expect(engineError(() => planFlow(flow, plugins)).messageKey).toBe('executor.error.cycle');
  });

  it('rejects an unconnected required port', () => {
    const flow = graph([['p', 'test.pass']], []);
    const err = engineError(() => planFlow(flow, plugins));
    expect(err.messageKey).toBe('executor.error.missingPort');
    expect(err.nodeId).toBe('p');
    expect(err.params).toMatchObject({ port: 'in' });
  });

  it('rejects an unknown port and an ambiguous default port', () => {
    const unknown = graph(
      [
        ['s', 'test.source'],
        ['p', 'test.pass'],
      ],
      [{ from: 's', to: 'p', toPort: 'nope' }],
    );
    const e1 = engineError(() => planFlow(unknown, plugins));
    expect(e1.messageKey).toBe('executor.error.unknownPort');
    expect(e1.nodeId).toBe('p');

    const ambiguous = graph(
      [
        ['s', 'test.source'],
        ['two', 'test.two'],
      ],
      [{ from: 's', to: 'two' }],
    );
    const e2 = engineError(() => planFlow(ambiguous, plugins));
    expect(e2.messageKey).toBe('executor.error.ambiguousPort');
    expect(e2.nodeId).toBe('two');
  });

  it('rejects a port connected twice, unknown node types and invalid configs', () => {
    const twice = graph(
      [
        ['s1', 'test.source'],
        ['s2', 'test.source'],
        ['p', 'test.pass'],
      ],
      [
        { from: 's1', to: 'p' },
        { from: 's2', to: 'p' },
      ],
    );
    expect(engineError(() => planFlow(twice, plugins)).messageKey).toBe(
      'executor.error.portConnectedTwice',
    );

    const unknownType = graph([['x', 'test.nope']], []);
    const e = engineError(() => planFlow(unknownType, plugins));
    expect(e.messageKey).toBe('executor.error.unknownNodeType');
    expect(e.nodeId).toBe('x');

    const badConfig: FlowDefinition = {
      ...acceptance,
      nodes: acceptance.nodes.map((n) => (n.id === 'cmp' ? { ...n, config: { keys: [] } } : n)),
    };
    const e3 = engineError(() => planFlow(badConfig));
    expect(e3.messageKey).toBe('executor.error.invalidConfig');
    expect(e3.nodeId).toBe('cmp');
  });

  it('requires every sheet port of output.excel to be connected', () => {
    const flow: FlowDefinition = {
      ...acceptance,
      edges: acceptance.edges.filter((e) => e.toPort !== 'only_right'),
    };
    const err = engineError(() => planFlow(flow));
    expect(err.messageKey).toBe('executor.error.missingPort');
    expect(err.nodeId).toBe('out');
  });
});

// ---- running ------------------------------------------------------------------------------

describe('runFlow', () => {
  it('runs the acceptance flow end to end with progress events', async () => {
    const events: RunProgressEvent[] = [];
    const result = await runFlow(acceptance, {
      t,
      params: { ky_luong: '2026-09' },
      files: { bang_luong: fixtureFiles('bang_luong_'), cham_cong: fixtureFiles('cham_cong_') },
      onProgress: (e) => events.push(e),
    });

    const summary = result.outputs.cmp!.summary!.rows;
    expect(summary[summary.length - 1]).toMatchObject({
      matched: 63,
      mismatched: 9,
      only_left: 3,
      only_right: 3,
    });
    expect(result.outputs.in_luong!.table!.rows).toHaveLength(75);

    expect(events[0]).toMatchObject({ type: 'run-started' });
    const finished = events.filter((e) => e.type === 'node-finished');
    expect(finished.map((e) => e.nodeId)).toEqual(['in_luong', 'in_cc', 'cmp', 'out']);
    expect(finished[2]).toMatchObject({ rows: { mismatched: 9, only_left: 3, only_right: 3 } });
    for (const e of finished) expect(e.durationMs).toBeGreaterThanOrEqual(0);
    // Progress carries counts/timings only, never cell values.
    expect(JSON.stringify(events)).not.toContain('NV000');

    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0]!;
    expect(artifact).toMatchObject({ nodeId: 'out', fileName: 'DoiChieu_2026-09.xlsx' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(artifact.data.slice().buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Tổng hợp',
      'Lệch',
      'Chỉ có trong lương',
      'Chỉ có trong chấm công',
    ]);
  });

  it('fails at the input node when a slot has validation errors', async () => {
    const err = await runFlow(acceptance, {
      t,
      params: { ky_luong: '2026-09' },
      files: { bang_luong: fixtureFiles('bang_luong_') },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).messageKey).toBe('executor.error.inputInvalid');
    expect((err as EngineError).nodeId).toBe('in_cc');
  });

  it('rejects missing or malformed required params before running', async () => {
    const err = await runFlow(acceptance, { t, params: {} }).catch((e: unknown) => e);
    expect((err as EngineError).messageKey).toBe('executor.error.paramRequired');
    expect(checkParams(acceptance.params, { ky_luong: '2026-13' })?.messageKey).toBe(
      'executor.error.paramInvalid',
    );
    expect(checkParams(acceptance.params, { ky_luong: '2026-09' })).toBeNull();
  });

  it('attaches the node id to errors thrown by a plugin', async () => {
    const boom: AnyNodePlugin = {
      ...passPlugin,
      type: 'test.boom',
      execute: () => {
        throw new Error('kaboom');
      },
    };
    const flow = graph(
      [
        ['s', 'test.source'],
        ['b', 'test.boom'],
      ],
      [{ from: 's', to: 'b', toPort: 'in' }],
    );
    const err = await runFlow(flow, { t, plugins: { ...plugins, 'test.boom': boom } }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).messageKey).toBe('executor.error.nodeFailed');
    expect((err as EngineError).nodeId).toBe('b');
    // Raw exception text never travels with the error (it may quote cell values).
    expect(JSON.stringify((err as EngineError).params)).not.toContain('kaboom');
  });

  it('cancels between nodes', async () => {
    const controller = new AbortController();
    let passRuns = 0;
    const counting: AnyNodePlugin = {
      ...passPlugin,
      execute: (_c, inputs: Record<string, Table>) => {
        passRuns++;
        return { out: inputs.in! };
      },
    };
    const flow = graph(
      [
        ['s', 'test.source'],
        ['p', 'test.pass'],
      ],
      [{ from: 's', to: 'p' }],
    );
    const err = await runFlow(flow, {
      t,
      plugins: { ...plugins, 'test.pass': counting },
      signal: controller.signal,
      onProgress: (e) => {
        if (e.type === 'node-finished' && e.nodeId === 's') controller.abort();
      },
    }).catch((e: unknown) => e);
    expect(isCancelled(err)).toBe(true);
    expect(passRuns).toBe(0);
  });

  it('cancels while an async node is still running', async () => {
    const controller = new AbortController();
    const slow: AnyNodePlugin = {
      ...passPlugin,
      execute: () => new Promise<NodeOutputs>(() => undefined), // never settles
    };
    const flow = graph(
      [
        ['s', 'test.source'],
        ['p', 'test.pass'],
      ],
      [{ from: 's', to: 'p' }],
    );
    const running = runFlow(flow, {
      t,
      plugins: { ...plugins, 'test.pass': slow },
      signal: controller.signal,
      onProgress: (e) => {
        if (e.type === 'node-started' && e.nodeId === 'p') setTimeout(() => controller.abort(), 5);
      },
    });
    const err = await running.catch((e: unknown) => e);
    expect(isCancelled(err)).toBe(true);
  });

  it('is cancelled immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const err = await runFlow(acceptance, {
      t,
      params: { ky_luong: '2026-09' },
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect(isCancelled(err)).toBe(true);
  });
});

describe('output.excel file name', () => {
  it('fills params and keeps the name safe', () => {
    expect(resolveFileName('DoiChieu_{ky_luong}.xlsx', { ky_luong: '2026-09' })).toBe(
      'DoiChieu_2026-09.xlsx',
    );
    expect(resolveFileName('A/{x}:B', { x: 'c?d' })).toBe('A_c_d_B.xlsx');
    expect(resolveFileName('{missing}', {})).toBe('output.xlsx');
  });

  it('keeps month params as YYYY-MM and date params as YYYY-MM-DD (sortable names)', () => {
    expect(resolveFileName('BC_{ky}_{ngay}.xlsx', { ky: '2026-09', ngay: '2026-09-26' })).toBe(
      'BC_2026-09_2026-09-26.xlsx',
    );
    const months = ['2026-10', '2025-12', '2026-09'].map((ky) =>
      resolveFileName('BC_{ky}', { ky }),
    );
    expect([...months].sort()).toEqual(['BC_2025-12.xlsx', 'BC_2026-09.xlsx', 'BC_2026-10.xlsx']);
    const days = ['2026-10-01', '2026-09-30', '2025-12-31'].map((d) =>
      resolveFileName('N_{d}', { d }),
    );
    expect([...days].sort()).toEqual([
      'N_2025-12-31.xlsx',
      'N_2026-09-30.xlsx',
      'N_2026-10-01.xlsx',
    ]);
  });

  it('keeps unknown placeholders empty', () => {
    expect(resolveFileName('{missing}', {})).toBe('output.xlsx');
  });

  it('registers the step-1 nodes and the step-3 nodes (spec §12)', () => {
    expect(Object.keys(nodePlugins).sort()).toEqual([
      'code.sql',
      'control.compare',
      'input.excel',
      'output.excel',
      'output.preview',
      'transform.dedupe',
      'transform.filter',
      'transform.groupBy',
      'transform.join',
      'transform.select',
      'transform.sort',
      'transform.union',
    ]);
  });
});
