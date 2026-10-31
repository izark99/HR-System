/**
 * QA (verifier) — R1-fix5 of `transform.formula`: the new exact division (`hrflow_fx_sdiv` /
 * `hrflow_fx_qdiv`) and ROUND with a constant 10^n against big.js, and long column chains run in
 * materialized groups (row order, warnings / onError across groups, params bound per group, two
 * formula nodes in a row). Fake data only; seeded.
 */
import { describe, expect, it } from 'vitest';
import { Big, isDecimal } from '../core/decimal';
import type { Value } from '../core/types';
import { compileFormula } from '../formula/compile';
import { nodeDuckDb } from './duckdb-node';
import { runNode, runWith, table } from './sql-helpers';

const plain = (v: Value | undefined) =>
  v === null || v === undefined ? null : isDecimal(v) ? v.toFixed() : v;

let seed = 4242;
const rnd = (n: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
function decimal(): string {
  const intDigits = [0, 1, 2, 5, 9, 12, 17, 18, 20, 27][rnd(10)]!;
  const fracDigits = rnd(11);
  let s = intDigits === 0 ? '0' : String(1 + rnd(9));
  for (let i = 1; i < intDigits; i++) s += String(rnd(10));
  if (fracDigits > 0) {
    s += '.';
    for (let i = 0; i < fracDigits; i++) s += String(rnd(10));
  }
  if (rnd(2)) s = `-${s}`;
  return new Big(s).toFixed();
}
// Excel ROUND: half away from zero (big.js RM 1 = ROUND_HALF_UP, away from zero on magnitude).
const MAX = new Big('1e28');
const fits = (x: Big) => x.abs().lt(MAX);

describe('QA exact division and ROUND vs big.js (R1-fix5)', () => {
  const rows: Value[][] = [];
  for (let i = 0; i < 400; i++) rows.push([new Big(decimal()), new Big(decimal())]);
  // Halves and edge divisors.
  for (const [a, b] of [
    ['1', '-8'],
    ['-1', '3'],
    ['0.0000000001', '2'],
    ['-0.0000000001', '2'],
    ['0.0000000003', '-2'],
    ['99999999999999999999999999.9999999999', '0.0000000001'],
    ['1', '100000000000000000'],
    ['123456789012345678', '100000000000000000'],
    ['-5', '99999999999999999999999999'],
    ['7', '0'],
  ]) {
    rows.push([new Big(a!), new Big(b!)]);
  }
  const tb = table(
    [
      ['a', 'decimal'],
      ['b', 'decimal'],
    ],
    rows,
  );

  it('a/b: exact to 10 places (half away from zero); out of range → blank + #NUM!', async () => {
    const r = await runNode(
      'transform.formula',
      { columns: [{ key: 'q', formula: '=[a]/[b]' }] },
      { in: tb },
    );
    const got = r.out.out!.rows.map((x) => plain(x.q));
    let checked = 0;
    rows.forEach((row, i) => {
      const a = row[0] as Big;
      const b = row[1] as Big;
      if (b.eq(0)) return expect(got[i], `row ${i}`).toBeNull();
      const want = a.div(b).round(10, 1);
      // |b| ≥ 10^18 divides by the integer part of b (documented relative error < 10^-18).
      if (b.abs().gte('1e18')) {
        if (got[i] !== null) {
          const diff = new Big(got[i] as string).minus(want).abs();
          expect(diff.lte(want.abs().times('1e-17').plus('1e-10')), `row ${i}`).toBe(true);
        }
        return;
      }
      if (!fits(want)) return expect(got[i], `row ${i} ${a.toFixed()}/${b.toFixed()}`).toBeNull();
      expect(got[i], `row ${i} ${a.toFixed()}/${b.toFixed()}`).toBe(want.toFixed());
      checked++;
    });
    expect(checked).toBeGreaterThan(200);
  });

  it('ROUND/ROUNDUP/ROUNDDOWN with constant digits -3…12 and digits from a column', async () => {
    const digits = [-3, -1, 0, 1, 2, 5, 9, 10, 12];
    const columns = digits.flatMap((n) => [
      { key: `r${n + 3}`, formula: `=ROUND([a],${n})` },
      { key: `u${n + 3}`, formula: `=ROUNDUP([a],${n})` },
      { key: `d${n + 3}`, formula: `=ROUNDDOWN([a],${n})` },
    ]);
    columns.push({ key: 'rc', formula: '=ROUND([a],MOD(ABS(INT([b])),12)-2)' });
    const r = await runNode('transform.formula', { columns }, { in: tb });
    r.out.out!.rows.forEach((x, i) => {
      const a = rows[i]![0] as Big;
      for (const n of digits) {
        const dp = Math.min(n, 10);
        expect(plain(x[`r${n + 3}`]), `ROUND ${a.toFixed()} ${n}`).toBe(a.round(dp, 1).toFixed());
        expect(plain(x[`u${n + 3}`]), `ROUNDUP ${a.toFixed()} ${n}`).toBe(a.round(dp, 3).toFixed());
        expect(plain(x[`d${n + 3}`]), `ROUNDDOWN ${a.toFixed()} ${n}`).toBe(
          a.round(dp, 0).toFixed(),
        );
      }
      const b = rows[i]![1] as Big;
      // INT = floor (toward −∞), then ABS, MOD 12, − 2.
      const n =
        Number(
          b
            .round(0, 0)
            .minus(b.lt(b.round(0, 0)) ? 1 : 0)
            .abs()
            .mod(12)
            .toFixed(),
        ) - 2;
      expect(plain(x.rc), `ROUND ${a.toFixed()} col ${n}`).toBe(
        a.round(Math.min(n, 10), 1).toFixed(),
      );
    });
  });

  it('no DOUBLE in division / ROUND SQL', () => {
    const sql = compileFormula(
      [{ key: 'r', formula: '=ROUND([a]/[b],2)+ROUNDUP([a]/3,[b])' }],
      [
        { key: 'a', type: 'decimal' },
        { key: 'b', type: 'decimal' },
      ],
      { params: [] },
    ).sql('"x"', '"o"', true);
    expect(sql).not.toMatch(/DOUBLE|FLOAT|REAL|printf/i);
  });
});

// ---------------------------------------------------------------------------------------------

describe('QA long column chains in materialized groups (R1-fix5)', () => {
  const N = 300;
  const tb = table(
    [
      ['id', 'string'],
      ['a', 'decimal'],
      ['b', 'decimal'],
    ],
    Array.from({ length: N }, (_, i) => [
      `NV${String(i).padStart(4, '0')}`,
      new Big(1 + (i % 17)),
      new Big(i % 7 === 3 ? 0 : (i % 5) + 1),
    ]),
  );
  /** Moderately heavy chained column (≈ 10 projection levels each). */
  const heavy = (p: string) =>
    `=IF([${p}]>100,ROUND([${p}]*0.105/[b],0),IFERROR(ROUND([${p}]/[b]*1.5,2),0))+MAX([a],[${p}]/3)`;
  const chain = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      key: `c${i}`,
      formula: heavy(i === 0 ? 'a' : `c${i - 1}`),
    }));

  /** Same chain evaluated in TS with big.js (expected values). */
  function expected(n: number): string[] {
    return Array.from({ length: N }, (_, i) => {
      const a = new Big(1 + (i % 17));
      const b = new Big(i % 7 === 3 ? 0 : (i % 5) + 1);
      let p = a;
      for (let k = 0; k < n; k++) {
        // Every product / quotient is rounded to 10 places (DECIMAL(38,10)) like the engine.
        const r10 = (x: Big) => x.round(10, 1);
        let v: Big;
        if (p.gt(100)) v = r10(r10(p.times('0.105')).div(b)).round(0, 1);
        else v = b.eq(0) ? new Big(0) : r10(r10(p.div(b)).times('1.5')).round(2, 1);
        const third = p.div(3).round(10, 1);
        p = v.plus(a.gt(third) ? a : third);
      }
      return p.toFixed();
    });
  }

  it('50 chained heavy columns run (several groups), in row order, right values', async () => {
    const t0 = performance.now();
    const r = await runNode('transform.formula', { columns: chain(50) }, { in: tb });
    const ms = performance.now() - t0;
    const out = r.out.out!;
    expect(out.rows.map((x) => x.id)).toEqual(tb.rows.map((x) => x.id));
    // Rows with b = 0 are checked by the warning test; the others against big.js.
    const want = expected(50);
    out.rows.forEach((x, i) => {
      if (i % 7 === 3) return;
      expect(plain(x.c49), `row ${i}`).toBe(want[i]);
    });
    expect(ms).toBeLessThan(60_000);
  }, 120_000);

  it('warnings and onError fail name the right column and input row across groups', async () => {
    // c45 (in a later group) divides by b: rows where b = 0 fail.
    const cols = [
      ...chain(45),
      { key: 'c45', title: 'Cột cuối', formula: '=[c44]/[b]', onError: 'blank' },
    ];
    const r = await runNode('transform.formula', { columns: cols }, { in: tb });
    const w = r.warnings.find((x) => x.params.column === 'Cột cuối');
    expect(w).toMatchObject({
      messageKey: 'formula.warning.rowErrors',
      params: { error: '#DIV/0!', count: Math.ceil((N - 3) / 7), rows: '4, 11, 18, 25, 32' },
    });
    cols[45] = { ...cols[45]!, onError: 'fail' };
    await expect(runNode('transform.formula', { columns: cols }, { in: tb })).rejects.toMatchObject(
      {
        messageKey: 'formula.error.rowError',
        params: { column: 'Cột cuối', error: '#DIV/0!', row: 4 },
      },
    );
    // The intermediate group tables of the failed run are dropped with the run.
    const db = await nodeDuckDb();
    const left = db.scalar(
      "SELECT count(*) FROM (SELECT table_name AS n FROM duckdb_tables() UNION ALL SELECT view_name FROM duckdb_views() WHERE NOT internal) WHERE n LIKE 'hr$%'",
    );
    expect(left).toBe('0');
  }, 120_000);

  it('PARAM and constants bound in a later group; two long formula nodes in a row', async () => {
    const first = [...chain(30), { key: 'p1', formula: '=[c29]*PARAM("he_so")+0.5' }];
    const second = [
      ...Array.from({ length: 30 }, (_, i) => ({
        key: `d${i}`,
        formula: heavy(i === 0 ? 'p1' : `d${i - 1}`),
      })),
      { key: 'p2', formula: '="x"&PARAM("he_so")&[id]' },
    ];
    const r = await runWith(
      { src: tb },
      [
        { id: 'f1', type: 'transform.formula', config: { columns: first } },
        { id: 'f2', type: 'transform.formula', config: { columns: second } },
      ],
      [
        { from: 'src', to: 'f1' },
        { from: 'f1', to: 'f2' },
      ],
      { paramDefs: [{ key: 'he_so', label: 'Hệ số', type: 'number' }], params: { he_so: '2' } },
    );
    const one = r.outputs.f1!.out!;
    const two = r.outputs.f2!.out!;
    expect(two.rows.map((x) => x.id)).toEqual(tb.rows.map((x) => x.id));
    expect(plain(one.rows[0]!.p1)).toBe(
      new Big(plain(one.rows[0]!.c29) as string).times(2).plus('0.5').toFixed(),
    );
    expect(two.rows[0]!.p2).toBe('x2NV0000');
    expect(two.columns.map((c) => c.key).slice(-2)).toEqual(['d29', 'p2']);
  }, 120_000);
});
