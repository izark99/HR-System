import { describe, expect, it } from 'vitest';
import { Big, isDecimal } from '../core/decimal';
import type { Table } from '../core/types';
import { runNode, runWith, table } from './sql-helpers';

/** Plain rows; decimals via toFixed() because big.js toString() switches to "1e-10" notation. */
function rowsOf(tbl: Table | undefined, keys?: string[]) {
  const cols = keys ?? tbl!.columns.map((c) => c.key);
  return tbl!.rows.map((r) =>
    cols.map((k) => {
      const v = r[k];
      if (v === undefined || v === null) return null;
      return isDecimal(v) ? v.toFixed() : v;
    }),
  );
}

/**
 * QA edge cases for the DuckDB nodes: decimal precision/rounding, null/blank handling, join with
 * clashing names, union/dedupe/groupBy/filter corner cases, params across pushed-down chains.
 * Oracle: spec §9.4, §12.1.x and the AC list of §26.1. Fake data only.
 */

const d = (s: string) => new Big(s);
const keyOf = (e: unknown) => (e as { messageKey?: string }).messageKey ?? String(e);

describe('decimal precision across the TS ↔ DuckDB boundary (AC-B3-07, spec §9.4)', () => {
  const passThrough = async (values: (string | null)[]) => {
    const t = table(
      [['v', 'decimal']],
      values.map((v) => [v === null ? null : d(v)]),
    );
    const r = await runNode('transform.select', { columns: [{ from: 'v' }] }, { in: t });
    return rowsOf(r.out.out).map((x) => x[0]);
  };

  it('keeps up to 10 decimals and 28 integer digits exactly; trailing zeros are not kept', async () => {
    expect(
      await passThrough([
        '0.1',
        '0.2',
        '1234567890123.25',
        '0.0000000001',
        '9999999999999999999999999999.9999999999',
        '-9999999999999999999999999999.9999999999',
        '1.50',
        '100',
        '1e3',
        '-0.5',
        '0',
        '-0',
        null,
      ]),
    ).toEqual([
      '0.1',
      '0.2',
      '1234567890123.25',
      '0.0000000001',
      '9999999999999999999999999999.9999999999',
      '-9999999999999999999999999999.9999999999',
      '1.5',
      '100',
      '1000',
      '-0.5',
      '0',
      '0',
      null,
    ]);
  });

  it('rounds half-up (away from zero) at the 10th decimal; tiny values become 0', async () => {
    expect(
      await passThrough([
        '0.12345678905',
        '-0.12345678905',
        '0.12345678904999',
        '0.00000000005',
        '-0.00000000005',
        '0.00000000004',
        '-0.00000000004',
        '2.99999999995',
        '9999999999999999999999999999.99999999994',
      ]),
    ).toEqual(
      [
        '0.1234567891',
        '-0.1234567891',
        '0.1234567890',
        '0.0000000001',
        '-0.0000000001',
        '0',
        '0',
        '3',
        '9999999999999999999999999999.9999999999',
      ].map((s) => (s === '0.1234567890' ? '0.123456789' : s)),
    );
  });

  it('29 integer digits (also after rounding up) → duckdb.error.decimalOverflow, not a wrong number', async () => {
    for (const v of ['10000000000000000000000000000', '9999999999999999999999999999.99999999995']) {
      const e = await passThrough([v]).catch((x: unknown) => x);
      expect(keyOf(e), v).toBe('duckdb.error.decimalOverflow');
    }
  });

  it('sums of 100 000 × 0.1 and mixed magnitudes are exact (no DOUBLE anywhere)', async () => {
    const rows = Array.from({ length: 100_000 }, () => [d('0.1')]);
    rows.push([d('1234567890123.25')], [d('-1234567890123.25')], [d('0.0000000003')]);
    const r = await runNode(
      'transform.groupBy',
      {
        aggregations: [
          { key: 's', fn: 'sum', column: 'v' },
          { key: 'a', fn: 'avg', column: 'v' },
        ],
      },
      { in: table([['v', 'decimal']], rows) },
    );
    expect(rowsOf(r.out.out)).toEqual([['10000.0000000003', '0.0999970001']]);
  });

  it('sum overflowing DECIMAL(38,10) is a decimalOverflow, not a silent wrap', async () => {
    const big = d('9999999999999999999999999999');
    const e = await runNode(
      'transform.groupBy',
      { aggregations: [{ key: 's', fn: 'sum', column: 'v' }] },
      { in: table([['v', 'decimal']], [[big], [big]]) },
    ).catch((x: unknown) => x);
    expect(keyOf(e)).toBe('duckdb.error.decimalOverflow');
  });

  it('avg: SUM/COUNT in big.js, half-up at 10 places, negative and tiny cases', async () => {
    const avg = async (values: string[]) => {
      const r = await runNode(
        'transform.groupBy',
        { aggregations: [{ key: 'a', fn: 'avg', column: 'v' }] },
        {
          in: table(
            [['v', 'decimal']],
            values.map((v) => [d(v)]),
          ),
        },
      );
      return rowsOf(r.out.out)[0]![0];
    };
    expect(await avg(['1', '1', '2'])).toBe('1.3333333333');
    expect(await avg(['1', '2'])).toBe('1.5');
    expect(await avg(['2', '2', '3'])).toBe('2.3333333333');
    expect(await avg(['1', '1', '1', '2'])).toBe('1.25');
    expect(await avg(['0.0000000002', '0', '0', '0'])).toBe('0.0000000001'); // 0.00000000005 → up
    expect(await avg(['-0.0000000002', '0', '0', '0'])).toBe('-0.0000000001'); // away from zero
    expect(await avg(['0.0000000001', '0', '0', '0'])).toBe('0'); // 0.000000000025 → down
    expect(await avg(['22', '20.5', '21'])).toBe('21.1666666667');
    expect(await avg(['99999999999999999999', '99999999999999999998'])).toBe(
      '99999999999999999999'.slice(0, 19) + '8.5',
    );
  });

  it('integers: avg of integers exact; SUM beyond 2^53 comes back as decimal, exact', async () => {
    const t = table([['n', 'integer']], [[9007199254740991], [9007199254740991], [2]]);
    const r = await runNode(
      'transform.groupBy',
      {
        aggregations: [
          { key: 's', fn: 'sum', column: 'n' },
          { key: 'a', fn: 'avg', column: 'n' },
          { key: 'm', fn: 'max', column: 'n' },
        ],
      },
      { in: t },
    );
    expect(rowsOf(r.out.out)).toEqual([
      ['18014398509481984', '6004799503160661.3333333333', 9007199254740991],
    ]);
  });

  it('integer SUM beyond 2^53 without avg: the column is declared decimal', async () => {
    const t = table([['n', 'integer']], [[9007199254740991], [9007199254740991], [2]]);
    const r = await runNode(
      'transform.groupBy',
      { aggregations: [{ key: 's', fn: 'sum', column: 'n' }] },
      { in: t },
    );
    expect(rowsOf(r.out.out)).toEqual([['18014398509481984']]);
    expect(r.out.out!.columns.find((c) => c.key === 's')!.type).toBe('decimal');
  });

  describe('KNOWN BUG', () => {
    // With an avg in the same node the result bypasses SqlScope.fetch's type fix-up and keeps
    // the declared `integer` type although the cell holds a Big beyond the safe range.
    it.fails('integer SUM beyond 2^53 next to an avg is declared decimal as well', async () => {
      const t = table([['n', 'integer']], [[9007199254740991], [9007199254740991], [2]]);
      const r = await runNode(
        'transform.groupBy',
        {
          aggregations: [
            { key: 's', fn: 'sum', column: 'n' },
            { key: 'a', fn: 'avg', column: 'n' },
          ],
        },
        { in: t },
      );
      expect(r.out.out!.columns.find((c) => c.key === 's')!.type).toBe('decimal');
    });
  });
});

describe('null / blank handling', () => {
  it('whitespace-only, NBSP-only and empty strings are blank for string columns', async () => {
    const t = table(
      [
        ['s', 'string'],
        ['n', 'decimal'],
      ],
      [
        ['x', d('1')],
        ['', d('2')],
        ['  ', d('3')],
        [' \t', d('4')],
        [null, d('5')],
      ],
    );
    const r = await runNode(
      'transform.groupBy',
      {
        by: ['s'],
        aggregations: [
          { key: 'n', fn: 'countRows' },
          { key: 'c', fn: 'count', column: 's' },
          { key: 'cd', fn: 'countDistinct', column: 's' },
        ],
      },
      { in: t },
    );
    // all four blank spellings are ONE blank group; count ignores them
    expect(rowsOf(r.out.out)).toEqual([
      ['x', 1, 1, 1],
      [null, 4, 0, 0],
    ]);
    const f = await runNode(
      'transform.filter',
      { conditions: [{ column: 's', op: 'isBlank' }] },
      { in: t },
    );
    expect(rowsOf(f.out.out, ['n']).map((x) => x[0])).toEqual(['2', '3', '4', '5']);
  });

  it('0 rows through every node', async () => {
    const e: Table = table(
      [
        ['k', 'string'],
        ['v', 'decimal'],
      ],
      [],
    );
    const other = table(
      [
        ['k', 'string'],
        ['w', 'decimal'],
      ],
      [['a', d('1')]],
    );
    for (const [type, config] of [
      ['transform.filter', { conditions: [{ column: 'k', op: 'eq', value: 'a' }] }],
      ['transform.sort', { by: [{ column: 'v' }] }],
      ['transform.dedupe', { keys: ['k'] }],
      ['transform.select', { columns: [{ from: 'k' }] }],
    ] as const) {
      const r = await runNode(type, config, { in: e });
      expect(r.out.out!.rows, type).toEqual([]);
    }
    const g = await runNode(
      'transform.groupBy',
      { by: ['k'], aggregations: [{ key: 's', fn: 'sum', column: 'v' }] },
      { in: e },
    );
    expect(g.out.out!.rows).toEqual([]);
    for (const how of ['inner', 'left', 'right', 'full', 'anti']) {
      const j = await runNode(
        'transform.join',
        { how, on: [{ left: 'k', right: 'k' }] },
        { left: e, right: other },
      );
      const k = await runNode(
        'transform.join',
        { how, on: [{ left: 'k', right: 'k' }] },
        { left: other, right: e },
      );
      expect(j.out.out!.rows.length, `${how} empty left`).toBe(
        how === 'right' || how === 'full' ? 1 : 0,
      );
      expect(k.out.out!.rows.length, `${how} empty right`).toBe(
        how === 'left' || how === 'full' || how === 'anti' ? 1 : 0,
      );
    }
    const u = await runNode('transform.union', { inputCount: 2 }, { in_1: e, in_2: e });
    expect(u.out.out!.rows).toEqual([]);
    expect(u.out.out!.columns.map((c) => c.key)).toEqual(['k', 'v']);
  });
});

describe('transform.join corner cases', () => {
  it('clashing names on both sides: suffix, explicit rightColumns, key under left name, order', async () => {
    const left = table(
      [
        ['ma', 'string'],
        ['ten', 'string'],
        ['so', 'decimal'],
      ],
      [
        ['A', 'tl', d('1')],
        ['B', 'tl2', d('2')],
      ],
    );
    const right = table(
      [
        ['ma', 'string'],
        ['ten', 'string'],
        ['so', 'decimal'],
        ['ten_r', 'string'],
      ],
      [
        ['a ', 'tr', d('10'), 'x'],
        ['C', 'tr2', d('30'), 'y'],
      ],
    );
    // `ten` clashes → `ten_r`, which also exists on the right: `ten_r` clashes again with ... itself
    // right `ten` → `ten_r`; right `ten_r` then clashes with that and becomes `ten_r_r`
    const auto = await runNode(
      'transform.join',
      { how: 'left', on: [{ left: 'ma', right: 'ma' }] },
      { left, right },
    );
    expect(auto.out.out!.columns.map((c) => c.key)).toEqual([
      'ma',
      'ten',
      'so',
      'ten_r',
      'so_r',
      'ten_r_r',
    ]);
    const ok = await runNode(
      'transform.join',
      {
        how: 'full',
        on: [{ left: 'ma', right: 'ma' }],
        rightColumns: ['ten', 'so'],
        rightSuffix: '_phai',
      },
      { left, right },
    );
    expect(ok.out.out!.columns.map((c) => c.key)).toEqual([
      'ma',
      'ten',
      'so',
      'ten_phai',
      'so_phai',
    ]);
    expect(rowsOf(ok.out.out)).toEqual([
      ['A', 'tl', '1', 'tr', '10'],
      ['B', 'tl2', '2', null, null],
      ['C', null, null, 'tr2', '30'],
    ]);
  });

  it('different key names; the key keeps the left name and left value (right/full: right value if no left row)', async () => {
    const left = table(
      [
        ['ma_luong', 'string'],
        ['a', 'integer'],
      ],
      [['NV1', 1]],
    );
    const right = table(
      [
        ['ma_cc', 'string'],
        ['b', 'integer'],
      ],
      [
        ['nv1', 2],
        ['NV9', 3],
      ],
    );
    const r = await runNode(
      'transform.join',
      { how: 'full', on: [{ left: 'ma_luong', right: 'ma_cc' }] },
      { left, right },
    );
    expect(r.out.out!.columns.map((c) => c.key)).toEqual(['ma_luong', 'a', 'b']);
    expect(rowsOf(r.out.out)).toEqual([
      ['NV1', 1, 2],
      ['NV9', null, 3],
    ]);
  });

  it('NFD vs NFC Vietnamese keys, NBSP/tab/double-space and case match by default; not when off', async () => {
    const left = table(
      [
        ['k', 'string'],
        ['x', 'integer'],
      ],
      [
        ['Hồ Văn', 1],
        ['ĐẶNG VĂN', 2],
      ],
    );
    const right = table(
      [
        ['k', 'string'],
        ['y', 'integer'],
      ],
      [
        ['Hồ  Văn'.normalize('NFD'), 10],
        ['đặng\tvăn', 20],
        ['', 30],
      ],
    );
    const on = await runNode(
      'transform.join',
      { how: 'inner', on: [{ left: 'k', right: 'k' }] },
      { left, right },
    );
    expect(rowsOf(on.out.out, ['x', 'y'])).toEqual([
      [1, 10],
      [2, 20],
    ]);
    const off = await runNode(
      'transform.join',
      { how: 'inner', on: [{ left: 'k', right: 'k' }], normalizeKeys: false },
      { left, right },
    );
    expect(off.out.out!.rows).toEqual([]);
  });

  it('composite keys: a blank part never matches; integer/decimal/date parts compare by value', async () => {
    const left = table(
      [
        ['k', 'string'],
        ['n', 'decimal'],
        ['dt', 'date'],
        ['x', 'integer'],
      ],
      [
        ['a', d('1.0'), '2026-01-01', 1],
        ['a', d('2'), '2026-01-01', 2],
        ['a', null, '2026-01-01', 3],
        ['a', d('1'), null, 4],
      ],
    );
    const right = table(
      [
        ['k', 'string'],
        ['n', 'integer'],
        ['dt', 'date'],
        ['y', 'integer'],
      ],
      [
        ['A', 1, '2026-01-01', 10],
        ['a', null, '2026-01-01', 20],
        ['a', 1, null, 30],
      ],
    );
    const r = await runNode(
      'transform.join',
      {
        how: 'inner',
        on: [
          { left: 'k', right: 'k' },
          { left: 'n', right: 'n' },
          { left: 'dt', right: 'dt' },
        ],
      },
      { left, right },
    );
    expect(rowsOf(r.out.out, ['x', 'y'])).toEqual([[1, 10]]);
  });

  it('anti join keeps rows with blank keys and rows without a match; right side duplicates do not multiply', async () => {
    const left = table(
      [
        ['k', 'string'],
        ['i', 'integer'],
      ],
      [
        ['a', 1],
        ['b', 2],
        [null, 3],
        ['  ', 4],
        ['A', 5],
      ],
    );
    const right = table([['k', 'string']], [['a'], [' A '], [null], ['']]);
    const r = await runNode(
      'transform.join',
      { how: 'anti', on: [{ left: 'k', right: 'k' }] },
      { left, right },
    );
    expect(rowsOf(r.out.out, ['i']).map((x) => x[0])).toEqual([2, 3, 4]);
    expect(r.warnings).toEqual([]);
  });

  it('many-to-many multiplies and warns with a count only; one-to-one does not warn', async () => {
    const left = table([['k', 'string']], [['a'], ['a'], ['b']]);
    const right = table(
      [
        ['k', 'string'],
        ['v', 'integer'],
      ],
      [
        ['A', 1],
        ['a ', 2],
        ['b', 3],
        ['c', 4],
        ['c', 5],
      ],
    );
    const r = await runNode(
      'transform.join',
      { how: 'inner', on: [{ left: 'k', right: 'k' }] },
      { left, right },
    );
    expect(rowsOf(r.out.out)).toEqual([
      ['a', 1],
      ['a', 2],
      ['a', 1],
      ['a', 2],
      ['b', 3],
    ]);
    // 'c' is multiplied on the right but has no left row: not counted; 'a' is.
    expect(JSON.stringify(r.warnings)).not.toContain('"a"');
  });

  it('identical raw keys on the right: rowsMultiplied with a count', async () => {
    const left = table([['k', 'string']], [['a'], ['a'], ['b']]);
    const right = table(
      [
        ['k', 'string'],
        ['v', 'integer'],
      ],
      [
        ['a', 1],
        ['a', 2],
        ['b', 3],
        ['c', 4],
        ['c', 5],
      ],
    );
    const r = await runNode(
      'transform.join',
      { how: 'inner', on: [{ left: 'k', right: 'k' }] },
      { left, right },
    );
    expect(r.warnings).toEqual([
      { nodeId: 'n', messageKey: 'join.warning.rowsMultiplied', params: { count: 1 } },
    ]);
  });

  describe('KNOWN BUG', () => {
    // warnMultiplied: `SELECT NULLIF(hrflow_norm_key(r.k), '') AS k0 … GROUP BY ALL HAVING
    // count(*) > 1 AND k0 IS NOT NULL` returns no group when the duplicates only exist after
    // normalization ('A' and 'a ' → 'a'): DuckDB-WASM 1.32 evaluates the HAVING on the raw column.
    it.fails(
      'rowsMultiplied also fires when right keys only collide after normalization',
      async () => {
        const left = table([['k', 'string']], [['a'], ['b']]);
        const right = table([['k', 'string']], [['A'], ['a '], ['b']]);
        const r = await runNode(
          'transform.join',
          { how: 'inner', on: [{ left: 'k', right: 'k' }] },
          { left, right },
        );
        expect(r.out.out!.rows).toHaveLength(3); // the rows ARE multiplied...
        expect(r.warnings.map((w) => w.messageKey)).toEqual(['join.warning.rowsMultiplied']); // ...silently
      },
    );
  });

  it('SQL-looking keys and column values are just data', async () => {
    const left = table([['k', 'string']], [["x'; DROP TABLE t; --"], ['"quoted"'], ['$1']]);
    const right = table(
      [
        ['k', 'string'],
        ['v', 'string'],
      ],
      [
        ["x'; DROP TABLE t; --", "'; --"],
        ['"QUOTED"', '?'],
      ],
    );
    const r = await runNode(
      'transform.join',
      { how: 'left', on: [{ left: 'k', right: 'k' }] },
      { left, right },
    );
    expect(rowsOf(r.out.out)).toEqual([
      ["x'; DROP TABLE t; --", "'; --"],
      ['"quoted"', '?'],
      ['$1', null],
    ]);
  });
});

describe('transform.union corner cases', () => {
  it('10 inputs, missing columns, labels with SQL-ish text, int + decimal → decimal', async () => {
    const mk = (i: number) =>
      table(
        i % 2 === 0
          ? [['a', 'integer']]
          : [
              ['a', 'decimal'],
              ['b', 'string'],
            ],
        [i % 2 === 0 ? [i] : [d(`${i}.5`), `b${i}`]],
      );
    const sources: Record<string, Table> = {};
    const edges: { from: string; to: string; toPort: string }[] = [];
    for (let i = 1; i <= 10; i++) {
      sources[`s${i}`] = mk(i);
      edges.push({ from: `s${i}`, to: 'u', toPort: `in_${i}` });
    }
    const labels = Array.from({ length: 10 }, (_, i) => (i === 0 ? "L1'); DROP --" : `L${i + 1}`));
    const r = await runWith(
      sources,
      [
        {
          id: 'u',
          type: 'transform.union',
          config: { inputCount: 10, sourceColumn: { key: 'nguon', labels } },
        },
      ],
      edges,
    );
    const out = r.outputs.u!.out!;
    expect(out.columns.map((c) => [c.key, c.type])).toEqual([
      ['a', 'decimal'],
      ['b', 'string'],
      ['nguon', 'string'],
    ]);
    expect(rowsOf(out).map((x) => x.map((v) => (v === null ? 'null' : v)).join('|'))).toEqual([
      "1.5|b1|L1'); DROP --",
      '2|null|L2',
      '3.5|b3|L3',
      '4|null|L4',
      '5.5|b5|L5',
      '6|null|L6',
      '7.5|b7|L7',
      '8|null|L8',
      '9.5|b9|L9',
      '10|null|L10',
    ]);
  });

  it('refuses duplicate sourceColumn key, boolean + string, date + datetime', async () => {
    const a = table([['x', 'boolean']], [[true]]);
    const b = table([['x', 'string']], [['t']]);
    expect(
      keyOf(
        await runNode('transform.union', { inputCount: 2 }, { in_1: a, in_2: b }).catch(
          (e: unknown) => e,
        ),
      ),
    ).toBe('union.error.typeMismatch');
    const c = table([['x', 'date']], [['2026-01-01']]);
    const e = table([['x', 'datetime']], [['2026-01-01T10:00:00']]);
    expect(
      keyOf(
        await runNode('transform.union', { inputCount: 2 }, { in_1: c, in_2: e }).catch(
          (x: unknown) => x,
        ),
      ),
    ).toBe('union.error.typeMismatch');
    expect(
      keyOf(
        await runNode(
          'transform.union',
          { inputCount: 2, sourceColumn: { key: 'x', labels: ['a', 'b'] } },
          { in_1: a, in_2: a },
        ).catch((x: unknown) => x),
      ),
    ).toBe('union.error.duplicateKey');
  });
});

describe('transform.dedupe corner cases', () => {
  it('composite keys with partly blank parts; all-blank rows always kept; non-string keys by value', async () => {
    const t = table(
      [
        ['a', 'string'],
        ['b', 'decimal'],
        ['i', 'integer'],
      ],
      [
        [null, null, 1],
        ['', null, 2],
        ['  ', null, 3],
        ['x', null, 4],
        ['X ', null, 5],
        [null, d('1.0'), 6],
        [null, d('1.00'), 7],
        ['x', d('1'), 8],
      ],
    );
    const r = await runNode('transform.dedupe', { keys: ['a', 'b'] }, { in: t });
    // rows 1-3 all-blank: kept; 4 & 5 duplicate (keep first); 6 & 7 duplicate; 8 unique
    expect(rowsOf(r.out.out, ['i']).map((x) => x[0])).toEqual([1, 2, 3, 4, 6, 8]);
    expect(rowsOf(r.out.removed, ['i']).map((x) => x[0])).toEqual([5, 7]);
    const last = await runNode('transform.dedupe', { keys: ['a', 'b'], keep: 'last' }, { in: t });
    expect(rowsOf(last.out.out, ['i']).map((x) => x[0])).toEqual([1, 2, 3, 5, 7, 8]);
  });

  it('removed port feeds a downstream node; unused removed port costs nothing', async () => {
    const t = table(
      [
        ['k', 'string'],
        ['i', 'integer'],
      ],
      [
        ['a', 1],
        ['a', 2],
        ['b', 3],
      ],
    );
    const r = await runWith(
      { s: t },
      [
        { id: 'dd', type: 'transform.dedupe', config: { keys: ['k'] } },
        {
          id: 'n',
          type: 'transform.groupBy',
          config: { aggregations: [{ key: 'n', fn: 'countRows' }] },
        },
      ],
      [
        { from: 's', to: 'dd' },
        { from: 'dd', fromPort: 'removed', to: 'n' },
      ],
    );
    expect(rowsOf(r.outputs.n!.out)).toEqual([[1]]);
  });
});

describe('transform.groupBy corner cases', () => {
  it('group keys compare exactly (no normalization), blank group is one group, decimal/date/boolean groups', async () => {
    const t = table(
      [
        ['s', 'string'],
        ['n', 'decimal'],
        ['dt', 'date'],
        ['b', 'boolean'],
        ['v', 'integer'],
      ],
      [
        ['A', d('1.0'), '2026-01-01', true, 1],
        ['a', d('1.00'), '2026-01-01', false, 2],
        ['A ', d('1.5'), null, null, 3],
        [null, null, null, true, 4],
        ['', null, '2026-01-01', null, 5],
      ],
    );
    const by = async (col: string) =>
      rowsOf(
        (
          await runNode(
            'transform.groupBy',
            { by: [col], aggregations: [{ key: 'v', fn: 'sum', column: 'v' }] },
            { in: t },
          )
        ).out.out,
      );
    expect(await by('s')).toEqual([
      ['A', 1],
      ['a', 2],
      ['A ', 3],
      [null, 9],
    ]);
    expect(await by('n')).toEqual([
      ['1', 3],
      ['1.5', 3],
      [null, 9],
    ]);
    expect(await by('dt')).toEqual([
      ['2026-01-01', 8],
      [null, 7],
    ]);
    expect(await by('b')).toEqual([
      [true, 5],
      [false, 2],
      [null, 8],
    ]);
  });

  it('min/max on strings and dates; fn not allowed for a type', async () => {
    const t = table(
      [
        ['s', 'string'],
        ['b', 'boolean'],
      ],
      [
        ['b', true],
        ['a', false],
        [' ', null],
      ],
    );
    const r = await runNode(
      'transform.groupBy',
      {
        aggregations: [
          { key: 'lo', fn: 'min', column: 's' },
          { key: 'hi', fn: 'max', column: 's' },
        ],
      },
      { in: t },
    );
    expect(rowsOf(r.out.out)).toEqual([['a', 'b']]);
    for (const [fn, col] of [
      ['sum', 'b'],
      ['avg', 's'],
      ['min', 'b'],
    ] as const) {
      const e = await runNode(
        'transform.groupBy',
        { aggregations: [{ key: 'x', fn, column: col }] },
        { in: t },
      ).catch((x: unknown) => x);
      expect(keyOf(e), `${fn} ${col}`).toBe('groupBy.error.fnNotForType');
    }
  });

  it('avg feeds a following DuckDB node (re-upload of the TS result) and keeps title/order', async () => {
    const t = table(
      [
        ['k', 'string'],
        ['v', 'decimal'],
      ],
      [
        ['a', d('1')],
        ['a', d('2')],
        ['b', d('10')],
      ],
    );
    const r = await runWith(
      { s: t },
      [
        {
          id: 'g',
          type: 'transform.groupBy',
          config: {
            by: ['k'],
            aggregations: [{ key: 'tb', fn: 'avg', column: 'v', title: 'Trung bình' }],
          },
        },
        {
          id: 'f',
          type: 'transform.filter',
          config: { conditions: [{ column: 'tb', op: 'gt', value: '1.5' }] },
        },
      ],
      [
        { from: 's', to: 'g' },
        { from: 'g', to: 'f' },
      ],
    );
    expect(rowsOf(r.outputs.f!.out)).toEqual([['b', '10']]);
    expect(r.outputs.g!.out!.columns.map((c) => c.title)).toEqual(['K', 'Trung bình']);
  });
});

describe('transform.filter corner cases', () => {
  const t = table(
    [
      ['s', 'string'],
      ['n', 'decimal'],
      ['i', 'integer'],
      ['dt', 'date'],
      ['b', 'boolean'],
    ],
    [
      ['CN01', d('1.5'), 1, '2026-01-01', true],
      ['cn01 ', d('0'), 0, '2026-06-15', false],
      ['100% _x', d('-2'), -1, null, null],
      [null, null, null, '2025-12-31', true],
    ],
  );
  const ids = (r: { out: Record<string, Table> }) => rowsOf(r.out.out, ['i']).map((x) => x[0]);
  const paramDefs = [
    { key: 'p', label: 'P', type: 'string' as const },
    { key: 'num', label: 'N', type: 'number' as const },
    { key: 'flag', label: 'F', type: 'boolean' as const },
    { key: 'day', label: 'D', type: 'date' as const },
    { key: 'text', label: 'T', type: 'string' as const },
  ];

  it('every op skips its condition when the param is blank (null, "", whitespace)', async () => {
    for (const op of [
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
    ]) {
      for (const p of [null, '', '   ']) {
        const r = await runNode(
          'transform.filter',
          { conditions: [{ column: 's', op, value: { param: 'p' } }] },
          { in: t },
          { paramDefs, params: { p } },
        );
        expect(r.out.out!.rows, `${op} ${JSON.stringify(p)}`).toHaveLength(4);
      }
    }
    // a skipped condition does not skip the others (match any / all)
    for (const match of ['all', 'any']) {
      const r = await runNode(
        'transform.filter',
        {
          match,
          conditions: [
            { column: 's', op: 'eq', value: { param: 'p' } },
            { column: 'i', op: 'gte', value: 1 },
          ],
        },
        { in: t },
        { paramDefs, params: { p: null } },
      );
      expect(ids(r), match).toEqual([1]);
    }
  });

  it('number 0 and boolean false are values, not blanks', async () => {
    const r0 = await runNode(
      'transform.filter',
      { conditions: [{ column: 'n', op: 'eq', value: { param: 'num' } }] },
      { in: t },
      { paramDefs, params: { num: 0 } },
    );
    expect(ids(r0)).toEqual([0]);
    const rf = await runNode(
      'transform.filter',
      { conditions: [{ column: 'b', op: 'eq', value: { param: 'flag' } }] },
      { in: t },
      { paramDefs, params: { flag: false } },
    );
    expect(ids(rf)).toEqual([0]);
  });

  it('date param against a date column; a bad date at run time is filter.error.invalidValue on the node', async () => {
    const ok = await runNode(
      'transform.filter',
      { conditions: [{ column: 'dt', op: 'gte', value: { param: 'day' } }] },
      { in: t },
      { paramDefs, params: { day: '2026-01-01' } },
    );
    expect(ids(ok)).toEqual([1, 0]);
    // a free-text param pointed at a date column is checked by the node itself
    for (const text of ['abc', '2026-02-30', '2026-13-01', "2026-01-01'; DROP TABLE x; --"]) {
      const e = await runNode(
        'transform.filter',
        { conditions: [{ column: 'dt', op: 'gte', value: { param: 'text' } }] },
        { in: t },
        { paramDefs, params: { text } },
      ).catch((x: unknown) => x);
      expect(e, text).toMatchObject({ messageKey: 'filter.error.invalidValue', nodeId: 'n' });
    }
    // and a malformed date param never reaches SQL at all
    const early = await runNode(
      'transform.filter',
      { conditions: [{ column: 'dt', op: 'gte', value: { param: 'day' } }] },
      { in: t },
      { paramDefs, params: { day: 'abc' } },
    ).catch((x: unknown) => x);
    expect(keyOf(early)).toBe('executor.error.paramInvalid');
  });

  it('contains/startsWith/endsWith are literal: % and _ are not wildcards', async () => {
    const run = (op: string, value: string) =>
      runNode('transform.filter', { conditions: [{ column: 's', op, value }] }, { in: t });
    expect(ids(await run('contains', '%'))).toEqual([-1]);
    expect(ids(await run('contains', '_'))).toEqual([-1]);
    expect(ids(await run('startsWith', '100%'))).toEqual([-1]);
    expect(ids(await run('endsWith', '_x'))).toEqual([-1]);
    expect(ids(await run('contains', 'zz%'))).toEqual([]);
  });

  it('in/notIn with blanks, 500 values; integer column with a decimal literal is invalid', async () => {
    const inn = await runNode(
      'transform.filter',
      { conditions: [{ column: 's', op: 'in', values: ['cn01', ''] }] },
      { in: t },
    );
    expect(ids(inn)).toEqual([1, 0]);
    const notIn = await runNode(
      'transform.filter',
      { conditions: [{ column: 's', op: 'notIn', values: ['cn01'] }] },
      { in: t },
    );
    expect(ids(notIn)).toEqual([-1, null]);
    const many = Array.from({ length: 500 }, (_, i) => `v${i}`);
    many[499] = 'CN01';
    const big = await runNode(
      'transform.filter',
      { conditions: [{ column: 's', op: 'in', values: many }] },
      { in: t },
    );
    expect(ids(big)).toEqual([1, 0]);
    const e = await runNode(
      'transform.filter',
      { conditions: [{ column: 'i', op: 'eq', value: 1.5 }] },
      { in: t },
    ).catch((x: unknown) => x);
    expect(keyOf(e)).toBe('filter.error.invalidValue');
  });

  it('normalizeText folds NFD/NFC, NBSP and case for eq, in and contains', async () => {
    const v = table([['s', 'string']], [['Hồ Văn Ân'.normalize('NFD')], ['HỒ VĂN  ÂN'], ['Hồ']]);
    for (const [op, value] of [
      ['eq', 'hồ văn ân'],
      ['contains', 'VĂN'],
      ['startsWith', 'hồ'],
      ['endsWith', 'ân'],
    ] as const) {
      const r = await runNode(
        'transform.filter',
        { conditions: [{ column: 's', op, value }] },
        { in: v },
      );
      expect(r.out.out!.rows.length, op).toBe(op === 'startsWith' ? 3 : 2);
    }
  });
});

describe('params across pushed-down chains', () => {
  const data = table(
    [
      ['k', 'string'],
      ['cn', 'string'],
      ['v', 'decimal'],
    ],
    [
      ['a', 'CN01', d('1')],
      ['b', 'CN02', d('2')],
      ['c', 'CN01', d('3')],
      ['d', 'CN03', d('4')],
    ],
  );
  const paramDefs = [
    { key: 'x', label: 'X', type: 'string' as const },
    { key: 'y', label: 'Y', type: 'string' as const },
  ];

  it('two parameterized filters on different branches joined, then grouped (param order is stable)', async () => {
    const r = await runWith(
      { l: data, r: data },
      [
        {
          id: 'fl',
          type: 'transform.filter',
          config: { conditions: [{ column: 'cn', op: 'eq', value: { param: 'x' } }] },
        },
        {
          id: 'fr',
          type: 'transform.filter',
          config: { conditions: [{ column: 'cn', op: 'neq', value: { param: 'y' } }] },
        },
        {
          id: 'j',
          type: 'transform.join',
          config: { how: 'inner', on: [{ left: 'k', right: 'k' }], rightColumns: ['v'] },
        },
        {
          id: 'g',
          type: 'transform.groupBy',
          config: {
            aggregations: [
              { key: 's', fn: 'sum', column: 'v_r' },
              { key: 'n', fn: 'countRows' },
            ],
          },
        },
      ],
      [
        { from: 'l', to: 'fl' },
        { from: 'r', to: 'fr' },
        { from: 'fl', to: 'j', toPort: 'left' },
        { from: 'fr', to: 'j', toPort: 'right' },
        { from: 'j', to: 'g' },
      ],
      { paramDefs, params: { x: 'cn01', y: 'CN02' } },
    );
    // left: a, c (CN01); right: all but CN02 → a, c, d; joined on k → a, c; v_r = 1 + 3
    expect(rowsOf(r.outputs.g!.out)).toEqual([['4', 2]]);
  });

  it('a shared parameterized upstream used twice (union of two filters of the same filtered relation)', async () => {
    const r = await runWith(
      { s: data },
      [
        {
          id: 'f0',
          type: 'transform.filter',
          config: { conditions: [{ column: 'cn', op: 'eq', value: { param: 'x' } }] },
        },
        {
          id: 'fa',
          type: 'transform.filter',
          config: { conditions: [{ column: 'v', op: 'lt', value: 3 }] },
        },
        {
          id: 'fb',
          type: 'transform.filter',
          config: { conditions: [{ column: 'v', op: 'gte', value: 3 }] },
        },
        {
          id: 'u',
          type: 'transform.union',
          config: { inputCount: 2, sourceColumn: { key: 'nguon', labels: ['thap', 'cao'] } },
        },
      ],
      [
        { from: 's', to: 'f0' },
        { from: 'f0', to: 'fa' },
        { from: 'f0', to: 'fb' },
        { from: 'fa', to: 'u', toPort: 'in_1' },
        { from: 'fb', to: 'u', toPort: 'in_2' },
      ],
      { paramDefs, params: { x: 'CN01' } },
    );
    expect(rowsOf(r.outputs.u!.out, ['k', 'nguon'])).toEqual([
      ['a', 'thap'],
      ['c', 'cao'],
    ]);
  });

  it('parameterized chain feeding code.sql, which has its own params', async () => {
    const r = await runWith(
      { s: data },
      [
        {
          id: 'f',
          type: 'transform.filter',
          config: { conditions: [{ column: 'cn', op: 'eq', value: { param: 'x' } }] },
        },
        {
          id: 'q',
          type: 'code.sql',
          config: { inputs: [{ port: 'src' }], sql: 'SELECT k FROM src WHERE k <> $y ORDER BY k' },
        },
      ],
      [
        { from: 's', to: 'f' },
        { from: 'f', to: 'q', toPort: 'src' },
      ],
      { paramDefs, params: { x: 'CN01', y: 'a' } },
    );
    expect(rowsOf(r.outputs.q!.out)).toEqual([['c']]);
  });
});

describe('shared upstream (self-join, diamond) and dedupe invariants', () => {
  const data = table(
    [
      ['k', 'string'],
      ['v', 'integer'],
    ],
    [
      ['a', 1],
      ['b', 2],
      ['A ', 3],
      ['c', 4],
      [null, 5],
      ['', 6],
    ],
  );

  it('self-join of one relation and of a filtered relation on both ports', async () => {
    const r = await runWith(
      { s: data },
      [
        {
          id: 'f',
          type: 'transform.filter',
          config: { conditions: [{ column: 'v', op: 'lte', value: 4 }] },
        },
        {
          id: 'j',
          type: 'transform.join',
          config: { how: 'inner', on: [{ left: 'k', right: 'k' }], rightColumns: ['v'] },
        },
      ],
      [
        { from: 's', to: 'f' },
        { from: 'f', to: 'j', toPort: 'left' },
        { from: 'f', to: 'j', toPort: 'right' },
      ],
    );
    // a/'A ' match each other (normalized): (1,1) (1,3) (2,2) (3,1) (3,3) (4,4); blank keys never match
    expect(rowsOf(r.outputs.j!.out, ['v', 'v_r'])).toEqual([
      [1, 1],
      [1, 3],
      [2, 2],
      [3, 1],
      [3, 3],
      [4, 4],
    ]);
  });

  it('dedupe out ∪ removed is exactly the input (no row lost or duplicated), on a shared ranked CTE', async () => {
    const r = await runWith(
      { s: data },
      [
        { id: 'dd', type: 'transform.dedupe', config: { keys: ['k'], keep: 'last' } },
        { id: 'u', type: 'transform.union', config: { inputCount: 2 } },
        {
          id: 'g',
          type: 'transform.groupBy',
          config: {
            aggregations: [
              { key: 'n', fn: 'countRows' },
              { key: 's', fn: 'sum', column: 'v' },
            ],
          },
        },
      ],
      [
        { from: 's', to: 'dd' },
        { from: 'dd', fromPort: 'out', to: 'u', toPort: 'in_1' },
        { from: 'dd', fromPort: 'removed', to: 'u', toPort: 'in_2' },
        { from: 'u', to: 'g' },
      ],
    );
    expect(rowsOf(r.outputs.g!.out)).toEqual([[6, 21]]);
  });
});

describe('KNOWN BUG: engine-internal column names are legal column keys', () => {
  // `IdentifierSchema` allows `__ord`, `__rn`, `__all_blank`, `__input`, `__avg_sum_<i>`; the nodes
  // use them as hidden columns, so a slot column with such a key silently corrupts results
  // (select returns rows in the order of the user's data, filter/dedupe emit an all-null row…).
  // Expected: rejected at design time, or at least handled.
  it.fails('a column named __ord does not change row order or add rows', async () => {
    const t = table(
      [
        ['__ord', 'integer'],
        ['k', 'string'],
      ],
      [
        [3, 'a'],
        [1, 'a'],
        [2, 'b'],
      ],
    );
    const sel = await runNode(
      'transform.select',
      { columns: [{ from: '__ord' }, { from: 'k' }] },
      { in: t },
    );
    expect(rowsOf(sel.out.out)).toEqual([
      [3, 'a'],
      [1, 'a'],
      [2, 'b'],
    ]);
    const fil = await runNode(
      'transform.filter',
      { conditions: [{ column: '__ord', op: 'gte', value: 2 }] },
      { in: t },
    );
    expect(rowsOf(fil.out.out)).toEqual([
      [3, 'a'],
      [2, 'b'],
    ]);
  });

  it.fails('a column named __rn or __all_blank does not break dedupe', async () => {
    for (const name of ['__rn', '__all_blank']) {
      const t = table(
        [
          [name, 'integer'],
          ['k', 'string'],
        ],
        [
          [3, 'a'],
          [1, 'a'],
          [2, 'b'],
        ],
      );
      const r = await runNode('transform.dedupe', { keys: ['k'] }, { in: t });
      expect(rowsOf(r.out.out), name).toEqual([
        [3, 'a'],
        [2, 'b'],
      ]);
    }
  });
});
