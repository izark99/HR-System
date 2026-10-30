import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PreviewSession } from '../preview';
import { nodeDuckDb } from './duckdb-node';
import { t } from './sql-helpers';

/**
 * QA (R4): Designer per-node preview (spec §13.3, AC-B3-50..57) on awkward graphs and failures:
 * which nodes run, error paths never carry raw text or cell values, nothing is created.
 */
const DIR = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');
type Flow = {
  nodes: { id: string; type: string; config: Record<string, unknown> }[];
  edges: Record<string, string>[];
  inputSlots: unknown[];
};
const FLOW = JSON.parse(readFileSync(join(DIR, 'flow.json'), 'utf8')) as Flow;
const files = (prefix: string) =>
  readdirSync(DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((f) => ({ name: f, blob: new Blob([readFileSync(join(DIR, f))]) }));
const P = { ky_luong: '2026-09' };
const sort = (id: string) => ({
  id,
  type: 'transform.sort',
  config: { by: [{ column: 'ma_nv' }] },
});

let session: PreviewSession;
beforeAll(async () => {
  session = new PreviewSession(t, nodeDuckDb);
  await session.setSampleFiles('bang_luong', files('bang_luong_'), FLOW.inputSlots[0]);
  await session.setSampleFiles('cham_cong', files('cham_cong_'), FLOW.inputSlots[1]);
});

describe('which nodes run', () => {
  it('a diamond runs each ancestor once, in dependency order, and nothing downstream', async () => {
    const f = structuredClone(FLOW);
    f.nodes.push(sort('a'), sort('b'), {
      id: 'u',
      type: 'transform.union',
      config: { inputCount: 2, missingColumns: 'null' },
    });
    f.edges.push(
      { from: 'in_luong', to: 'a' },
      { from: 'in_luong', to: 'b' },
      { from: 'a', toPort: 'in_1', to: 'u' },
      { from: 'b', toPort: 'in_2', to: 'u' },
    );
    const r = await session.preview(f, 'u', P);
    if (!r.ok) throw new Error(r.error.messageKey);
    expect(new Set(r.ran).size).toBe(r.ran.length);
    expect([...r.ran].sort()).toEqual(['a', 'b', 'in_luong', 'u']);
    expect(r.ran[0]).toBe('in_luong');
    expect(r.ran.at(-1)).toBe('u');
    expect(r.ran).not.toContain('cmp');
    expect(r.ran).not.toContain('out');
    expect(r.ran).not.toContain('in_cc');
  });

  it('previewing a source runs only that source (the other slot is not even read)', async () => {
    const lonely = new PreviewSession(t, nodeDuckDb);
    await lonely.setSampleFiles('bang_luong', files('bang_luong_'), FLOW.inputSlots[0]);
    // No sample for cham_cong at all: previewing in_luong must still work.
    const r = await lonely.preview(FLOW, 'in_luong', P);
    expect(r).toMatchObject({ ok: true, ran: ['in_luong'] });
  });

  it('an unrelated node with a broken config does not stop the preview of another branch', async () => {
    const f = structuredClone(FLOW);
    f.nodes.push({ id: 'broken', type: 'transform.sort', config: { by: 'nope' } });
    f.edges.push({ from: 'in_luong', to: 'broken' });
    const r = await session.preview(f, 'in_luong', P);
    expect(r.ok).toBe(true);
  });
});

describe('failure paths', () => {
  it('unknown node id, a cycle upstream and garbage definitions answer ok:false, never throw', async () => {
    expect(await session.preview(FLOW, 'nope', P)).toMatchObject({ ok: false });
    const f = structuredClone(FLOW);
    f.nodes.push(sort('x'), sort('y'));
    f.edges.push(
      { from: 'x', to: 'y' },
      { from: 'y', to: 'x' },
      { from: 'y', to: 'cmp', toPort: 'left' },
    );
    f.edges = f.edges.filter(
      (e) => !(e.to === 'cmp' && e.toPort === 'left' && e.from === 'in_luong'),
    );
    const r = await session.preview(f, 'cmp', P);
    expect(r.ok).toBe(false);
    for (const bad of [null, 'x', 7, [], { nodes: 'x' }]) {
      expect((await session.preview(bad, 'cmp', P)).ok).toBe(false);
    }
  });

  it('a crashing DuckDB provider yields the generic crash key: no raw message, no cell value', async () => {
    const secret = 'NV00001 Nguyễn Văn Giả';
    const bad = new PreviewSession(t, () => Promise.reject(new Error(secret)));
    await bad.setSampleFiles('bang_luong', files('bang_luong_'), FLOW.inputSlots[0]);
    const f = structuredClone(FLOW);
    f.nodes.push({
      id: 'q',
      type: 'code.sql',
      config: { inputs: [{ port: 'luong' }], sql: 'SELECT ma_nv FROM luong ORDER BY ma_nv' },
    });
    f.edges.push({ from: 'in_luong', fromPort: 'table', to: 'q', toPort: 'luong' });
    const r = await bad.preview(f, 'q', P);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('NV00001');
    expect(JSON.stringify(r)).not.toContain('Nguyễn');
  });

  it('preview errors about data (e.g. compare on a duplicate key) carry counts, not rows, in params', async () => {
    const f = structuredClone(FLOW);
    const r = await session.preview(f, 'cmp', {});
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/NV0000\d/);
  });

  it('clear() drops the samples: the next preview asks for them again', async () => {
    const s = new PreviewSession(t, nodeDuckDb);
    await s.setSampleFiles('bang_luong', files('bang_luong_'), FLOW.inputSlots[0]);
    expect((await s.preview(FLOW, 'in_luong', P)).ok).toBe(true);
    s.clear();
    expect(await s.preview(FLOW, 'in_luong', P)).toMatchObject({
      ok: false,
      error: { messageKey: 'preview.error.noSample' },
    });
    expect(s.validate('bang_luong', FLOW.inputSlots[0])).toBeNull();
  });

  it('replacing a sample with no files removes it; the old content is not used', async () => {
    const s = new PreviewSession(t, nodeDuckDb);
    await s.setSampleFiles('bang_luong', files('bang_luong_'), FLOW.inputSlots[0]);
    await s.setSampleFiles('bang_luong', [], FLOW.inputSlots[0]);
    expect(await s.preview(FLOW, 'in_luong', P)).toMatchObject({
      ok: false,
      error: { messageKey: 'preview.error.noSample' },
    });
  });
});
