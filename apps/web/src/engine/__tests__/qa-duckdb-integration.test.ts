import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Big, isDecimal } from '../core/decimal';
import { normalizeKeyPart } from '../core/keys';
import { SqlScope } from '../duckdb/scope';
import type { UploadFile } from '../protocol';
import { EngineSession } from '../session';
import { nodeDuckDb } from './duckdb-node';
import { runNode, runWith, table } from './sql-helpers';
import { asTable } from './helpers';

/**
 * QA: the acceptance flow with DuckDB nodes in front of control.compare must still equal
 * expected.json; exactness of mixed integer/decimal comparisons; deep pushed-down chains;
 * SQL ↔ TS normalization parity over the whole BMP. Fake data only.
 */

const FIXTURES = resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet');
const base = JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8')) as {
  nodes: { id: string; type: string; config: Record<string, unknown> }[];
  edges: Record<string, string>[];
};
const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as {
  counts: Record<string, number>;
};
function uploads(prefix: string): UploadFile[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((name) => ({ name, blob: new Blob([readFileSync(join(FIXTURES, name))]) }));
}

describe('acceptance flow through DuckDB nodes (AC-B3-05 sibling: results must not change)', () => {
  it('select → dedupe → filter(any) in front of control.compare gives the same KPIs as expected.json', async () => {
    const [inLuong, inCc, cmp, out] = base.nodes;
    const allCols = ['ma_nv', 'ho_ten', 'chi_nhanh', 'cong', 'ot', 'phep', 'khong_luong'].map(
      (from) => ({ from }),
    );
    const flow = {
      ...base,
      nodes: [
        inLuong,
        inCc,
        { id: 'sel', type: 'transform.select', config: { columns: allCols } },
        { id: 'dd', type: 'transform.dedupe', config: { keys: ['ma_nv'] } },
        {
          id: 'fil',
          type: 'transform.filter',
          config: {
            match: 'any',
            conditions: [
              { column: 'ma_nv', op: 'notBlank' },
              { column: 'cong', op: 'isBlank' },
            ],
          },
        },
        cmp,
        out,
      ],
      edges: [
        { from: 'in_luong', to: 'sel' },
        { from: 'sel', to: 'dd' },
        { from: 'dd', fromPort: 'out', to: 'cmp', toPort: 'left' },
        { from: 'in_cc', to: 'fil' },
        { from: 'fil', to: 'cmp', toPort: 'right' },
        ...base.edges.filter((e) => e.from === 'cmp'),
      ],
    };
    const session = new EngineSession('vi', { duck: nodeDuckDb });
    const loaded = session.loadFlow(flow);
    if (!loaded.ok) throw new Error(loaded.problems.join('; '));
    await session.setSlotFiles('bang_luong', uploads('bang_luong_'));
    await session.setSlotFiles('cham_cong', uploads('cham_cong_'));
    const outcome = await session.run({ ky_luong: '2026-09' });
    if (!outcome.ok) throw new Error(outcome.error.messageKey);
    expect(outcome.summary.compare).toMatchObject({
      matched: expected.counts.matched,
      mismatched: expected.counts.mismatched,
      onlyLeft: expected.counts.only_in_payroll,
      onlyRight: expected.counts.only_in_timesheet,
    });
    expect(outcome.summary.artifacts).toHaveLength(1);
  });
});

describe('exact comparison of integers and decimals (no DOUBLE promotion)', () => {
  it('join integer 2^53-1 with decimal 2^53-1 + 1e-10 does not match; with the exact value it does', async () => {
    const left = table(
      [
        ['k', 'integer'],
        ['x', 'integer'],
      ],
      [
        [9007199254740991, 1],
        [1, 2],
      ],
    );
    const right = table(
      [
        ['k', 'decimal'],
        ['y', 'integer'],
      ],
      [
        [new Big('9007199254740991.0000000001'), 10],
        [new Big('1.0000000000'), 20],
        [new Big('9007199254740991'), 30],
      ],
    );
    const r = await runNode(
      'transform.join',
      { how: 'inner', on: [{ left: 'k', right: 'k' }] },
      { left, right },
    );
    expect(r.out.out!.rows.map((row) => [row.x, row.y])).toEqual([
      [1, 30],
      [2, 20],
    ]);
  });

  it('filter on decimals distinguishes values that DOUBLE could not', async () => {
    const t = table(
      [['v', 'decimal']],
      [
        [new Big('9007199254740991.0000000001')],
        [new Big('9007199254740991.0000000002')],
        [new Big('9007199254740991')],
      ],
    );
    const eq = await runNode(
      'transform.filter',
      { conditions: [{ column: 'v', op: 'eq', value: '9007199254740991.0000000002' }] },
      { in: t },
    );
    expect(eq.out.out!.rows).toHaveLength(1);
    const gt = await runNode(
      'transform.filter',
      { conditions: [{ column: 'v', op: 'gt', value: '9007199254740991.0000000001' }] },
      { in: t },
    );
    expect(gt.out.out!.rows.map((r) => (isDecimal(r.v) ? r.v.toFixed() : r.v))).toEqual([
      '9007199254740991.0000000002',
    ]);
  });

  it('union integer + decimal and groupBy min/max keep 10-place precision', async () => {
    const a = table([['v', 'integer']], [[9007199254740991]]);
    const b = table([['v', 'decimal']], [[new Big('9007199254740991.0000000001')]]);
    const r = await runWith(
      { a, b },
      [
        { id: 'u', type: 'transform.union', config: { inputCount: 2 } },
        {
          id: 'n',
          type: 'transform.groupBy',
          config: {
            aggregations: [
              { key: 'hi', fn: 'max', column: 'v' },
              { key: 'lo', fn: 'min', column: 'v' },
            ],
          },
        },
      ],
      [
        { from: 'a', to: 'u', toPort: 'in_1' },
        { from: 'b', to: 'u', toPort: 'in_2' },
        { from: 'u', to: 'n' },
      ],
    );
    const row = r.outputs.n!.out!.rows[0]!;
    expect([row.hi, row.lo].map((x) => (isDecimal(x) ? x.toFixed() : x))).toEqual([
      '9007199254740991.0000000001',
      '9007199254740991',
    ]);
  });
});

describe('deep pushed-down chains', () => {
  it('60 chained select/filter/sort(non-string) nodes stay correct and fast', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => [`NV${i}`, i % 10, new Big(i)]);
    const t = table(
      [
        ['k', 'string'],
        ['g', 'integer'],
        ['v', 'decimal'],
      ],
      rows,
    );
    const nodes: { id: string; type: string; config: Record<string, unknown> }[] = [];
    const edges: { from: string; to: string }[] = [];
    let prev = 'src';
    for (let i = 0; i < 60; i++) {
      const id = `n${i}`;
      if (i % 3 === 0)
        nodes.push({
          id,
          type: 'transform.select',
          config: { columns: [{ from: 'k' }, { from: 'g' }, { from: 'v' }] },
        });
      else if (i % 3 === 1)
        nodes.push({
          id,
          type: 'transform.filter',
          config: { conditions: [{ column: 'v', op: 'gte', value: 0 }] },
        });
      else
        nodes.push({
          id,
          type: 'transform.sort',
          config: {
            by: [{ column: 'g', direction: i % 2 === 0 ? 'desc' : 'asc' }, { column: 'v' }],
          },
        });
      edges.push({ from: prev, to: id });
      prev = id;
    }
    nodes.push({
      id: 'last',
      type: 'transform.groupBy',
      config: {
        by: ['g'],
        aggregations: [
          { key: 's', fn: 'sum', column: 'v' },
          { key: 'n', fn: 'countRows' },
        ],
      },
    });
    edges.push({ from: prev, to: 'last' });
    const t0 = performance.now();
    const r = await runWith({ src: t }, nodes, edges);
    expect(performance.now() - t0).toBeLessThan(20_000);
    const out = r.outputs.last!.out!.rows;
    expect(out).toHaveLength(10);
    const total = out.reduce((a, row) => a + Number(row.n), 0);
    expect(total).toBe(2000);
  });
});

describe('filter literals with SQL-special text', () => {
  it('quotes, backslashes, $, ? and comment markers in config values are bound, not parsed', async () => {
    const specials = [
      "x' OR 1=1 --",
      '"; DROP TABLE t; --',
      '\\',
      "it's",
      '$1',
      '?',
      '/* c */',
      '%',
      '100%',
    ];
    const t = table([['s', 'string']], [...specials.map((s) => [s]), ['other']]);
    for (const s of specials) {
      const eq = await runNode(
        'transform.filter',
        { conditions: [{ column: 's', op: 'eq', value: s }] },
        { in: t },
      );
      expect(
        eq.out.out!.rows.map((r) => r.s),
        s,
      ).toEqual([s]);
      const inn = await runNode(
        'transform.filter',
        { conditions: [{ column: 's', op: 'in', values: [s, 'zzz'] }] },
        { in: t },
      );
      expect(
        inn.out.out!.rows.map((r) => r.s),
        s,
      ).toEqual([s]);
    }
  });
});

describe('normalizeKeys: SQL = normalizeKeyPart over every BMP code point and the Latin supplementary planes', () => {
  // Characters that DuckDB 1.32's Unicode tables predate (Unicode 16: U+1C89, U+A7CB, U+A7CC,
  // U+A7DA, U+A7DC, Garay U+10D50–U+10D65) lower-case differently from V8. Node builds whose ICU
  // ships Unicode 17 (as on CI) add U+A7CE, U+A7D2, U+A7D4 and Beria Erfe U+16EA0–U+16EDF. None is
  // used in Vietnamese/Latin business data; the test pins the mismatch set so a new one fails loudly.
  const KNOWN_NEWER_THAN_DUCKDB = (c: number) =>
    // U+0: RE2 in DuckDB stops at an embedded NUL (see KNOWN BUG below); Excel text cannot hold one.
    [0x0, 0x1c89, 0xa7cb, 0xa7cc, 0xa7ce, 0xa7d2, 0xa7d4, 0xa7da, 0xa7dc].includes(c) ||
    (c >= 0x10d50 && c <= 0x10d65) ||
    (c >= 0x16ea0 && c <= 0x16edf);

  it('no mismatch except the Unicode-16 letters', async () => {
    const db = await nodeDuckDb();
    const bad: number[] = [];
    const cps: number[] = [];
    for (let c = 0; c < 0x20000; c++) if (c < 0xd800 || c > 0xdfff) cps.push(c);
    for (let i = 0; i < cps.length; i += 4000) {
      const slice = cps.slice(i, i + 4000);
      const strs = slice.map(
        (c) => `A${String.fromCodePoint(c)}B ${String.fromCodePoint(c)}\u00a0\t`,
      );
      const scope = new SqlScope(db);
      try {
        const rel = scope.upload(
          asTable({
            columns: [{ key: 'k', type: 'string' }],
            rows: strs.map((k) => ({ k })),
          }),
        );
        const res = db.query(`SELECT hrflow_norm_key(k) AS n FROM "${rel.name}" ORDER BY "hr$ord"`);
        slice.forEach((c, j) => {
          if (String(res.getChild('n')?.get(j)) !== normalizeKeyPart(strs[j])) bad.push(c);
        });
      } finally {
        scope.dispose();
      }
    }
    expect(
      bad.filter((c) => !KNOWN_NEWER_THAN_DUCKDB(c)).map((c) => `U+${c.toString(16)}`),
    ).toEqual([]);
  });

  describe('KNOWN BUG', () => {
    // An embedded NUL cuts the string at the regexp_replace step of the macro (minor: XML cannot
    // carry U+0, so Excel cells never contain it).
    it.fails('a NUL inside the key does not truncate the normalized key', async () => {
      const db = await nodeDuckDb();
      const v = 'A\u0000B \u00a0';
      const got: unknown = db.query('SELECT hrflow_norm_key(?) AS n', [v]).getChild('n')?.get(0);
      expect(got).toBe(normalizeKeyPart(v));
    });
  });
});
