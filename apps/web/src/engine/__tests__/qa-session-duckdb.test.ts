import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DuckDb, DuckDbProvider } from '../duckdb/db';
import type { RunOutcome, RunProgressEvent, UploadFile } from '../protocol';
import { EngineSession } from '../session';
import { nodeDuckDb } from './duckdb-node';
import { runNode, table } from './sql-helpers';

/**
 * QA at session level (what the worker runs): cancel around DuckDB nodes, clean-up after errors
 * and cancels, error info without raw text, decimal display strings. Fake fixture data only.
 */

const FIXTURES = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');
const base = JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8')) as {
  nodes: { id: string; type: string; config: Record<string, unknown> }[];
  edges: Record<string, string>[];
};
function uploads(prefix: string): UploadFile[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((name) => ({ name, blob: new Blob([readFileSync(join(FIXTURES, name))]) }));
}

/** in_luong → select → filter → groupBy → preview, plus a code.sql branch. */
function duckFlow(
  sql = 'SELECT chi_nhanh, count(*) AS n FROM luong GROUP BY chi_nhanh ORDER BY 1',
) {
  const [inLuong] = base.nodes;
  return {
    ...base,
    nodes: [
      inLuong,
      {
        id: 'sel',
        type: 'transform.select',
        config: { columns: [{ from: 'ma_nv' }, { from: 'chi_nhanh' }, { from: 'cong' }] },
      },
      {
        id: 'fil',
        type: 'transform.filter',
        config: { conditions: [{ column: 'chi_nhanh', op: 'neq', value: 'CN03' }] },
      },
      {
        id: 'grp',
        type: 'transform.groupBy',
        config: { by: ['chi_nhanh'], aggregations: [{ key: 'tong', fn: 'sum', column: 'cong' }] },
      },
      { id: 'p1', type: 'output.preview', config: { title: 'Nhóm' } },
      { id: 'sql', type: 'code.sql', config: { inputs: [{ port: 'luong' }], sql } },
      { id: 'p2', type: 'output.preview', config: { title: 'SQL' } },
    ],
    edges: [
      { from: 'in_luong', to: 'sel' },
      { from: 'sel', to: 'fil' },
      { from: 'fil', to: 'grp' },
      { from: 'grp', to: 'p1' },
      { from: 'in_luong', to: 'sql', toPort: 'luong' },
      { from: 'sql', to: 'p2' },
    ],
  };
}

async function ready(duck: DuckDbProvider, flow: unknown = duckFlow()) {
  const session = new EngineSession('vi', { duck });
  const loaded = session.loadFlow(flow);
  if (!loaded.ok) throw new Error(loaded.problems.join('; '));
  await session.setSlotFiles('bang_luong', uploads('bang_luong_'));
  await session.setSlotFiles('cham_cong', uploads('cham_cong_'));
  return session;
}

/** Objects the engine leaves behind in DuckDB (its tables and the port views of code.sql). */
function leftovers(db: DuckDb): string[] {
  const t = db.query(
    `SELECT table_name AS n FROM duckdb_tables() WHERE table_name LIKE 'hr$%'
     UNION ALL SELECT view_name FROM duckdb_views() WHERE NOT internal AND view_name NOT LIKE 'duckdb_%' AND view_name NOT LIKE 'pragma_%' AND view_name NOT LIKE 'sqlite_%'`,
  );
  return Array.from({ length: t.numRows }, (_, i) => String(t.getChild('n')?.get(i)));
}

function dropLeftovers(db: DuckDb): void {
  for (const name of leftovers(db)) {
    try {
      db.exec(`DROP TABLE IF EXISTS "${name}"`);
    } catch {
      db.exec(`DROP VIEW IF EXISTS "${name}"`);
    }
  }
}

const params = { ky_luong: '2026-09' };
const okSummary = (o: RunOutcome) => {
  if (!o.ok) throw new Error(o.error.messageKey);
  return o.summary;
};

describe('cancel around DuckDB nodes (AC-B3-25, engine part)', () => {
  it('cancel while DuckDB is still loading: cancelled, nothing left, the same instance serves the next run', async () => {
    let release!: (db: DuckDb) => void;
    const gate = new Promise<DuckDb>((r) => (release = r));
    let calls = 0;
    const duck: DuckDbProvider = () => {
      calls++;
      return calls === 1 ? gate : nodeDuckDb();
    };
    const session = await ready(duck);
    const pending = session.run(params);
    await new Promise((r) => setTimeout(r, 20));
    session.cancel();
    const outcome = await pending;
    expect(outcome).toMatchObject({
      ok: false,
      cancelled: true,
      error: { messageKey: 'executor.error.cancelled' },
    });
    release(await nodeDuckDb()); // the abandoned load finishes later: must be harmless
    const second = okSummary(await session.run(params));
    expect(second.sheets.map((s) => s.name)).toEqual(['Nhóm', 'SQL']);
    expect(leftovers(await nodeDuckDb())).toEqual([]);
  });

  it.each(['sel', 'fil', 'grp', 'sql'])(
    'cancel when node "%s" starts: run ends as cancelled, DuckDB is clean, rerun works',
    async (nodeId) => {
      const session = await ready(nodeDuckDb);
      const outcome = await session.run(params, (e: RunProgressEvent) => {
        if (e.type === 'node-started' && e.nodeId === nodeId) session.cancel();
      });
      expect(outcome).toMatchObject({ ok: false, cancelled: true });
      expect(() => session.getRows('x', { offset: 0, limit: 1 })).toThrow(); // no half results
      expect(leftovers(await nodeDuckDb())).toEqual([]);
      expect(okSummary(await session.run(params)).sheets).toHaveLength(2);
      expect(leftovers(await nodeDuckDb())).toEqual([]);
    },
  );

  it('cancel after a node finished (between nodes of a pushed-down chain)', async () => {
    const session = await ready(nodeDuckDb);
    const outcome = await session.run(params, (e) => {
      if (e.type === 'node-finished' && e.nodeId === 'fil') session.cancel();
    });
    expect(outcome).toMatchObject({ ok: false, cancelled: true });
    expect(leftovers(await nodeDuckDb())).toEqual([]);
  });

  it('cancel() with no run in progress is a no-op', async () => {
    const session = await ready(nodeDuckDb);
    session.cancel();
    expect(okSummary(await session.run(params)).sheets).toHaveLength(2);
  });
});

describe('error paths leave DuckDB clean and never forward raw text', () => {
  it('a failing code.sql: error on the node, views dropped, next run (fixed flow) works', async () => {
    const db = await nodeDuckDb();
    const bad = await ready(
      nodeDuckDb,
      duckFlow('SELECT CAST(chi_nhanh AS INTEGER) AS x FROM luong'),
    );
    const outcome = await bad.run(params);
    expect(outcome).toMatchObject({
      ok: false,
      cancelled: false,
      error: { messageKey: 'sql.error.runtime', nodeId: 'sql' },
    });
    expect(leftovers(db)).toEqual([]);
    const good = await ready(nodeDuckDb);
    expect(okSummary(await good.run(params)).sheets).toHaveLength(2);
  });

  it('an unexpected exception from the DuckDB provider is reported by key only', async () => {
    const duck: DuckDbProvider = () => Promise.reject(new Error('boom NV00001 Nguyễn Giả'));
    const session = await ready(duck);
    const outcome = await session.run(params);
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).not.toMatch(/NV00001|Nguyễn/);
  });

  it('an exception thrown inside DuckDB work is dropped to a key (no raw text)', async () => {
    const real = await nodeDuckDb();
    const original = real.query.bind(real);
    const spy = vi.spyOn(real, 'query').mockImplementation((sql, p) => {
      if (sql.startsWith('CREATE TABLE "hr$')) throw new Error('secret NV00001 in message');
      return original(sql, p);
    });
    try {
      const session = await ready(nodeDuckDb);
      const outcome = await session.run(params);
      expect(outcome).toMatchObject({
        ok: false,
        error: { messageKey: 'executor.error.nodeFailed' },
      });
      expect(JSON.stringify(outcome)).not.toContain('NV00001');
    } finally {
      spy.mockRestore();
    }
    // NOT asserted here: a failed upload leaves `hr$1_raw` behind (see KNOWN BUG below).
    dropLeftovers(real);
  });

  describe('fixed (was KNOWN BUG)', () => {
    // SqlScope.upload registers its tables only after success. When the CREATE TABLE ... AS
    // SELECT CAST(...) over the Arrow staging table fails (here: an invalid date string; in
    // production e.g. a WASM out-of-memory at 1M rows), `hr$N_raw` stays in DuckDB with a full
    // copy of the data, and every later run in the same worker dies on "table already exists"
    // (names restart at hr$1 for each run) until the page is reloaded.
    it('a failed upload leaves nothing behind and the next run still works', async () => {
      const real = await nodeDuckDb();
      try {
        const broken = table([['d', 'date']], [['2026-02-30']]);
        const failed = await runNode(
          'transform.select',
          { columns: [{ from: 'd' }] },
          { in: broken },
        ).catch((e: unknown) => e);
        expect(failed).toBeInstanceOf(Error);
        expect(leftovers(real)).toEqual([]);
        const good = table([['d', 'date']], [['2026-02-28']]);
        const again = await runNode('transform.select', { columns: [{ from: 'd' }] }, { in: good });
        expect(again.out.out!.rows).toHaveLength(1);
      } finally {
        dropLeftovers(real);
      }
    });
  });
});

describe('decimal cells shown in the UI', () => {
  const tinyFlow = () => {
    const [inLuong] = base.nodes;
    return {
      ...base,
      nodes: [
        inLuong,
        {
          id: 'sql',
          type: 'code.sql',
          config: {
            inputs: [{ port: 'luong' }],
            sql: `SELECT CAST(0.000000001 AS DECIMAL(38,10)) AS nho, CAST(5000000000000000000000.5 AS DECIMAL(38,10)) AS lon, CAST(1234.5 AS DECIMAL(38,10)) AS thuong FROM luong LIMIT 1`,
          },
        },
        { id: 'p', type: 'output.preview', config: { title: 'So' } },
      ],
      edges: [
        { from: 'in_luong', to: 'sql', toPort: 'luong' },
        { from: 'sql', to: 'p' },
      ],
    };
  };

  it('ordinary decimals are plain digit strings', async () => {
    const session = await ready(nodeDuckDb, tinyFlow());
    const s = okSummary(await session.run(params));
    const page = session.getRows(s.sheets[0]!.id, { offset: 0, limit: 1 });
    expect(page.rows[0]![2]).toBe('1234.5');
  });

  describe('fixed (was KNOWN BUG)', () => {
    // session.toCell uses big.js toString(), which switches to exponent notation below 1e-6 and
    // from 1e21; lib/format.formatDecimalString does not parse that, so the UI shows "1e-9".
    it('tiny and huge decimals are sent as plain digit strings, never "1e-9" / "5.0000000000000000000005e+21"', async () => {
      const session = await ready(nodeDuckDb, tinyFlow());
      const s = okSummary(await session.run(params));
      const row = session.getRows(s.sheets[0]!.id, { offset: 0, limit: 1 }).rows[0]!;
      expect(row[0]).toBe('0.000000001');
      expect(row[1]).toBe('5000000000000000000000.5');
    });
  });
});
