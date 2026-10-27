import { describe, expect, it, vi } from 'vitest';
import { Big } from '../core/decimal';
import { z } from 'zod';
import type { TsNodePlugin } from '../core/plugin';
import type { DuckDbProvider } from '../duckdb/db';
import { nodeDuckDb } from './duckdb-node';
import { rowsOf, runWith, table } from './sql-helpers';

/** Executor + DuckDB: pushdown, materialization, lazy loading (spec §13.1). */

const data = table(
  [
    ['ma', 'string'],
    ['cn', 'string'],
    ['tien', 'decimal'],
  ],
  [
    ['a', 'CN01', new Big('1.5')],
    ['b', 'CN02', new Big('2')],
    ['c', 'CN01', new Big('3')],
  ],
);

const chain = [
  {
    id: 'sel',
    type: 'transform.select',
    config: { columns: [{ from: 'ma' }, { from: 'cn' }, { from: 'tien' }] },
  },
  {
    id: 'f',
    type: 'transform.filter',
    config: { conditions: [{ column: 'cn', op: 'eq', value: 'cn01' }] },
  },
  {
    id: 'g',
    type: 'transform.groupBy',
    config: { by: ['cn'], aggregations: [{ key: 's', fn: 'sum', column: 'tien' }] },
  },
];
const chainEdges = [
  { from: 'src', to: 'sel' },
  { from: 'sel', to: 'f' },
  { from: 'f', to: 'g' },
];

describe('pushdown of consecutive DuckDB nodes', () => {
  it('keeps the middle of a chain as CTEs (no row counts) and materializes only the end', async () => {
    const r = await runWith({ src: data }, chain, chainEdges, { collect: ['g'] });
    const rows = Object.fromEntries(r.nodes.map((n) => [n.nodeId, n.rows]));
    expect(rows.sel).toEqual({});
    expect(rows.f).toEqual({});
    expect(rows.g).toEqual({ out: 1 });
    expect(rowsOf(r.outputs.g!.out)).toEqual([['CN01', '4.5']]);
    // Lazy outputs are not returned unless collected.
    expect(r.outputs.sel).toEqual({});
  });

  it('materializes an output read by several nodes', async () => {
    const r = await runWith(
      { src: data },
      [
        chain[0]!,
        {
          id: 's1',
          type: 'transform.filter',
          config: { conditions: [{ column: 'ma', op: 'eq', value: 'a' }] },
        },
        {
          id: 's2',
          type: 'transform.filter',
          config: { conditions: [{ column: 'ma', op: 'neq', value: 'a' }] },
        },
      ],
      [
        { from: 'src', to: 'sel' },
        { from: 'sel', to: 's1' },
        { from: 'sel', to: 's2' },
      ],
      { collect: ['s1', 's2'] },
    );
    expect(r.nodes.find((n) => n.nodeId === 'sel')?.rows).toEqual({ out: 3 });
    expect(rowsOf(r.outputs.s1!.out, ['ma'])).toEqual([['a']]);
    expect(rowsOf(r.outputs.s2!.out, ['ma'])).toEqual([['b'], ['c']]);
  });

  it('a TS node reading a DuckDB relation gets a TS table (output.preview)', async () => {
    const r = await runWith(
      { src: data },
      [chain[0]!, { id: 'p', type: 'output.preview', config: { title: 'Xem', maxRows: 2 } }],
      [
        { from: 'src', to: 'sel' },
        { from: 'sel', to: 'p' },
      ],
    );
    expect(r.views).toHaveLength(1);
    expect(r.views[0]!.totalRows).toBe(3);
    expect(rowsOf(r.views[0]!.table)).toEqual([
      ['a', 'CN01', '1.5'],
      ['b', 'CN02', '2'],
    ]);
  });

  it('an error in a pushed-down chain surfaces on a node of the chain', async () => {
    const big = table(
      [['x', 'decimal']],
      [[new Big('9999999999999999999999999999')], [new Big('9999999999999999999999999999')]],
    );
    await expect(
      runWith(
        { src: big },
        [
          {
            id: 'g',
            type: 'transform.groupBy',
            config: { aggregations: [{ key: 's', fn: 'sum', column: 'x' }] },
          },
        ],
        [{ from: 'src', to: 'g' }],
      ),
    ).rejects.toMatchObject({ messageKey: 'duckdb.error.decimalOverflow', nodeId: 'g' });
  });
});

describe('lazy DuckDB loading (AC-B3-05)', () => {
  it('a flow without DuckDB nodes never opens DuckDB', async () => {
    const duck = vi.fn<DuckDbProvider>(nodeDuckDb);
    const r = await runWith(
      { src: data },
      [{ id: 'p', type: 'output.preview', config: { title: 'Xem' } }],
      [{ from: 'src', to: 'p' }],
      { duck },
    );
    expect(duck).not.toHaveBeenCalled();
    expect(r.views[0]!.table.rows).toHaveLength(3);
  });

  it('opens DuckDB once, reporting load progress, when a node needs it', async () => {
    const duck = vi.fn<DuckDbProvider>(async (onProgress) => {
      onProgress?.({ loadedBytes: 10, totalBytes: 10 });
      return nodeDuckDb();
    });
    const events: string[] = [];
    await runWith({ src: data }, chain, chainEdges, {
      duck,
      onProgress: (e) => events.push(e.type),
    });
    expect(duck).toHaveBeenCalledTimes(1);
    expect(events.indexOf('engine-loading')).toBeGreaterThan(events.indexOf('node-started'));
  });

  it('no provider → duckdb.error.unavailable on the first DuckDB node', async () => {
    await expect(
      runWith({ src: data }, chain, chainEdges, { duck: undefined as unknown as DuckDbProvider }),
    ).rejects.toMatchObject({ messageKey: 'duckdb.error.unavailable', nodeId: 'sel' });
  });
});

describe('errors and clean-up of lazy chains', () => {
  it('an error raised while a consumer evaluates a lazy chain names the producing node', async () => {
    const big = table(
      [['x', 'decimal']],
      [[new Big('9999999999999999999999999999')], [new Big('9999999999999999999999999999')]],
    );
    await expect(
      runWith(
        { src: big },
        [
          { id: 'sel', type: 'transform.select', config: { columns: [{ from: 'x' }] } },
          {
            id: 'g',
            type: 'transform.groupBy',
            label: 'Tổng',
            config: { aggregations: [{ key: 's', fn: 'sum', column: 'x' }] },
          },
          { id: 's', type: 'transform.sort', config: { by: [{ column: 's' }] } },
          { id: 'p', type: 'output.preview', config: { title: 'Xem' } },
        ],
        [
          { from: 'src', to: 'sel' },
          { from: 'sel', to: 'g' },
          { from: 'g', to: 's' },
          { from: 's', to: 'p' },
        ],
        { collect: [] },
      ),
    ).rejects.toMatchObject({
      messageKey: 'duckdb.error.decimalOverflow',
      nodeId: 'g',
      params: { node: 'Tổng' },
    });
  });

  it('with releaseIntermediate, DuckDB tables are dropped once nothing reads them', async () => {
    const db = await nodeDuckDb();
    const count = () =>
      Number(db.scalar(`SELECT count(*) FROM duckdb_tables() WHERE table_name LIKE 'hr$%'`));
    let during = -1;
    const probe: TsNodePlugin<Record<string, never>> = {
      type: 'test.probe',
      configSchema: z.strictObject({}),
      inputs: [],
      outputs: [],
      inferSchema: () => ({}),
      execute: () => {
        during = count();
        return {};
      },
    };
    await runWith(
      { src: data },
      [
        chain[0]!,
        chain[1]!,
        { id: 'p', type: 'output.preview', config: { title: 'Xem' } },
        { id: 'probe', type: 'test.probe' },
      ],
      [
        { from: 'src', to: 'sel' },
        { from: 'sel', to: 'f' },
        { from: 'f', to: 'p' },
      ],
      { releaseIntermediate: true, collect: [], extraPlugins: { 'test.probe': probe } },
    );
    // The upload, the chain and the table materialized for the preview are all gone.
    expect(during).toBe(0);
    expect(count()).toBe(0);
  });
});

describe('releaseIntermediate', () => {
  it('drops intermediate TS tables but keeps what output nodes read', async () => {
    const r = await runWith(
      { src: data },
      [
        { id: 's', type: 'transform.sort', config: { by: [{ column: 'ma', direction: 'desc' }] } },
        { id: 'p', type: 'output.preview', config: { title: 'Xem' } },
        { id: 'x', type: 'output.excel', config: { sheets: [{ name: 'S', port: 'in' }] } },
      ],
      [
        { from: 'src', to: 's' },
        { from: 's', to: 'p' },
        { from: 'src', to: 'x', toPort: 'in' },
      ],
      { releaseIntermediate: true, collect: [] },
    );
    expect(r.outputs.src?.out).toBeDefined(); // read by output.excel
    expect(r.outputs.s?.out).toBeUndefined(); // only read by the preview, which keeps its own copy
    expect(rowsOf(r.views[0]!.table, ['ma'])).toEqual([['c'], ['b'], ['a']]);
  });
});
