import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDesign, type DesignCheckResult } from '../design';
import { nodeDuckDb } from './duckdb-node';
import { t } from './sql-helpers';

/**
 * QA (R3): the Designer's realtime check on big or malformed drafts. Drafts are always savable
 * (MEMORY 2026-10-29 21:18), so the check must neither hang nor throw on anything that parses as
 * JSON. Budgets are generous (shared CI machine); they catch accidental O(n^3) behaviour.
 */
const FLOW = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet/flow.json'),
    'utf8',
  ),
) as Record<string, unknown> & {
  nodes: { id: string; type: string; config: Record<string, unknown> }[];
  edges: Record<string, unknown>[];
  inputSlots: unknown[];
  params: unknown[];
};
const clone = () => structuredClone(FLOW);
const check = (raw: unknown) => checkDesign(raw, { t, duck: nodeDuckDb });
const errors = (r: DesignCheckResult) => r.issues.filter((i) => i.severity === 'error');

/** input -> N x (sort) chain -> preview. */
function chain(n: number) {
  const f = clone();
  f.nodes = [f.nodes.find((x) => x.id === 'in_luong')!];
  f.edges = [];
  let prev = 'in_luong';
  let prevPort = 'table';
  for (let i = 0; i < n; i++) {
    const id = `s${i}`;
    f.nodes.push({ id, type: 'transform.sort', config: { by: [{ column: 'ma_nv' }] } });
    f.edges.push({ from: prev, fromPort: prevPort, to: id, toPort: 'in' });
    prev = id;
    prevPort = 'out';
  }
  f.nodes.push({ id: 'p', type: 'output.preview', config: { title: 'Xem' } });
  f.edges.push({ from: prev, fromPort: prevPort, to: 'p', toPort: 'in' });
  return f;
}

/** K parallel inputs fanned out to M filters each: K*M + K nodes, all wired. */
function wide(k: number, m: number) {
  const f = clone();
  const input = f.nodes.find((x) => x.id === 'in_luong')!;
  f.nodes = [];
  f.edges = [];
  for (let i = 0; i < k; i++) {
    f.nodes.push({ ...structuredClone(input), id: `in${i}` });
    for (let j = 0; j < m; j++) {
      const id = `f${i}_${j}`;
      f.nodes.push({
        id,
        type: 'transform.filter',
        config: { match: 'all', conditions: [], normalizeText: true },
      });
      f.edges.push({ from: `in${i}`, fromPort: 'table', to: id, toPort: 'in' });
    }
  }
  return f;
}

describe('checkDesign on large flows', () => {
  it('a 100-node chain: every node gets columns; the check finishes within 5 s', async () => {
    const f = chain(100);
    const t0 = performance.now();
    const r = await check(f);
    const ms = performance.now() - t0;
    expect(errors(r)).toEqual([]);
    expect(r.nodes.s99!.status).toBe('ok');
    expect(r.nodes.s99!.outputs!.out!.map((c) => c.key)).toContain('ma_nv');
    expect(ms).toBeLessThan(5000);
  });

  it('a 400-node chain: finishes within 15 s (no quadratic blow-up in the graph walks)', async () => {
    const t0 = performance.now();
    const r = await check(chain(400));
    expect(errors(r)).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(15000);
  });

  it('60 inputs x 3 filters (240 nodes, 180 edges) within 15 s', async () => {
    const f = wide(60, 3);
    expect(f.nodes.length).toBe(240);
    const t0 = performance.now();
    const r = await check(f);
    // The slot is shared by 60 input nodes; only the missing-output-consumer warnings may remain.
    expect(errors(r).filter((i) => i.messageKey === 'design.flow.noNodes')).toEqual([]);
    expect(Object.keys(r.nodes)).toHaveLength(240);
    expect(performance.now() - t0).toBeLessThan(15000);
  });

  it('a long cycle (200 nodes in a ring) is reported on its nodes, quickly', async () => {
    const f = chain(200);
    // close the ring: last sort -> first sort
    f.edges = f.edges.filter((e) => e.to !== 'p');
    f.edges.push({ from: 's199', fromPort: 'out', to: 's0', toPort: 'in' });
    f.edges = f.edges.filter((e) => !(e.from === 'in_luong' && e.to === 's0'));
    const t0 = performance.now();
    const r = await check(f);
    const cyc = errors(r).filter((i) => i.messageKey === 'executor.error.cycle');
    expect(cyc.length).toBe(200);
    expect(performance.now() - t0).toBeLessThan(10000);
  });
});

describe('checkDesign on malformed drafts (saved with errors, reopened later)', () => {
  const cases: [string, (f: ReturnType<typeof clone>) => unknown][] = [
    ['duplicate node ids', (f) => ({ ...f, nodes: [...f.nodes, structuredClone(f.nodes[0]!)] })],
    [
      'edge to a node that does not exist',
      (f) => ({
        ...f,
        edges: [...f.edges, { from: 'ghost', fromPort: 'x', to: 'cmp', toPort: 'left' }],
      }),
    ],
    [
      'edge from an unknown port',
      (f) => ({
        ...f,
        edges: [...f.edges, { from: 'in_luong', fromPort: 'nope', to: 'out', toPort: 'nope' }],
      }),
    ],
    ['nodes is not an array', (f) => ({ ...f, nodes: 'oops' })],
    ['edges is an object', (f) => ({ ...f, edges: { a: 1 } })],
    ['node without id/type', (f) => ({ ...f, nodes: [...f.nodes, {}, null, 7, 'x'] })],
    [
      'node id with regex/SQL characters',
      (f) => ({
        ...f,
        nodes: [
          ...f.nodes,
          { id: "a'); drop table x; --", type: 'transform.sort', config: { by: [] } },
        ],
      }),
    ],
    ['config is null', (f) => ({ ...f, nodes: f.nodes.map((n) => ({ ...n, config: null })) })],
    [
      'params with a regex-special key',
      (f) => ({
        ...f,
        params: [...f.params, { key: 'so_ngay(', label: 'X', type: 'string' }],
      }),
    ],
    [
      '__proto__ / constructor ids',
      (f) => ({
        ...f,
        nodes: [
          ...f.nodes,
          { id: '__proto__', type: 'transform.sort', config: { by: [] } },
          { id: 'constructor', type: 'transform.sort', config: { by: [] } },
        ],
      }),
    ],
    ['no schemaVersion', (f) => ({ ...f, schemaVersion: undefined })],
    ['schemaVersion in the future', (f) => ({ ...f, schemaVersion: 99 })],
  ];
  for (const [name, mutate] of cases) {
    it(`${name}: the check answers, never throws`, async () => {
      const r = await check(mutate(clone()));
      expect(typeof r.errorCount).toBe('number');
      expect(Array.isArray(r.issues)).toBe(true);
    });
  }

  it('a code.sql that tries to read a file is an error on the node at design time, nothing is read', async () => {
    const f = clone();
    f.nodes.push({
      id: 'q',
      type: 'code.sql',
      config: { inputs: [{ port: 'luong' }], sql: "SELECT * FROM read_csv('/etc/passwd')" },
    });
    f.edges.push({ from: 'in_luong', fromPort: 'table', to: 'q', toPort: 'luong' });
    const r = await check(f);
    const q = errors(r).filter((i) => i.nodeId === 'q');
    expect(q.length).toBeGreaterThan(0);
    expect(q[0]!.messageKey).toMatch(/^sql\.error\./);
    expect(JSON.stringify(q)).not.toContain('root:');
  });
});
