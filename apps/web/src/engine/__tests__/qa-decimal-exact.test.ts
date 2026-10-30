/**
 * QA: decimal exactness of the columnar store (spec §9.4 "never through DOUBLE"). Property/fuzz
 * tests on seeded random decimal strings (<= 28 integer digits, scale <= 10, negatives, -0,
 * trailing zeros, > 15 significant digits, values around 2^53) through
 * store -> read -> DuckDB upload -> fetch -> Excel -> reader, plus node arithmetic (sum, avg,
 * min/max, sort, join key, compare diff) against big.js references. Fake data only.
 */
import { CompareConfigSchema } from '@hrflow/flow-schema';
import { describe, expect, it } from 'vitest';
import { Big, type Decimal } from '../core/decimal';
import { createEngineTranslator } from '../core/i18n';
import { DecimalBuilder, Table, vectorFrom, type DecimalVector } from '../core/table';
import type { ColumnDef } from '../core/types';
import { SqlScope } from '../duckdb/scope';
import { ORD } from '../duckdb/sql';
import { readSlot, type SourceFile } from '../io/excel-reader';
import { writeWorkbook } from '../io/excel-writer';
import { controlComparePlugin } from '../nodes/control-compare';
import { sortTable } from '../nodes/transform-sort';
import { nodeDuckDb } from './duckdb-node';
import { acceptanceNodeConfig } from './qa-helpers';
import { slot } from './helpers';
import { runNode, runWith } from './sql-helpers';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const digits = (r: () => number, n: number) =>
  Array.from({ length: n }, () => Math.floor(r() * 10)).join('');

/** Random plain decimal text: <= maxInt integer digits, <= 13 fraction digits, sign, zeros. */
function genDecimal(r: () => number, maxInt = 27): string {
  const intLen = Math.floor(r() * (maxInt + 1));
  let int = intLen === 0 ? '0' : digits(r, intLen).replace(/^0+(?=\d)/, '');
  if (r() < 0.1) int = '0';
  const fracLen = r() < 0.35 ? 0 : Math.floor(r() * 14);
  let frac = digits(r, fracLen);
  if (r() < 0.2) frac = frac.replace(/\d$/, '0') + '0'.repeat(Math.floor(r() * 4));
  const sign = r() < 0.4 ? '-' : '';
  return `${sign}${int}${frac ? `.${frac}` : ''}`;
}

const SPECIAL = [
  '0',
  '-0',
  '0.0',
  '-0.0',
  '0.00',
  '100',
  '.5',
  '5.',
  '1E+2',
  '1e-7',
  '-1e-7',
  '0.1',
  '0.2',
  '0.30000000000000004',
  '0.1000000000000000055511151231257827',
  '4.35',
  '1.005',
  '2.675',
  '8.345',
  '0.015',
  '0.12345678905',
  '-0.12345678905',
  '9007199254740991',
  '9007199254740992',
  '9007199254740993',
  '-9007199254740993',
  '18014398509481985',
  '999999999999999',
  '1000000000000001',
  '123456789012345.6',
  '1234567890123456.7',
  '4611686018427387905',
  '9223372036854775807',
  '9223372036854775808',
  '1234567890123456789012345678',
  '9999999999999999999999999999',
  '0.0000000001',
  '0.00000000005',
  '0.00000000004999',
  '9999999999999999999999999.9999999999',
];

const round10 = (s: string): Decimal => new Big(s).round(10, Big.roundHalfUp);
/** Excel stores doubles; the reader shows 15 significant digits (spec §9.4). */
const excel15 = (s: string): Decimal => new Big(Number(Number(s).toPrecision(15)).toString());
const sigDigits = (s: string): number => new Big(s).c.length;

function table(values: (string | null)[]): Table {
  const cols: ColumnDef[] = [{ key: 'v', type: 'decimal', title: 'Số' }];
  return Table.fromRows(
    cols,
    values.map((v) => ({ v: v === null ? null : new Big(v) })),
  );
}
const cell = (t: Table, i: number): Decimal | null => t.value(i, 'v') as Decimal | null;
const same = (a: Decimal | null, b: Decimal | null) =>
  a === null ? b === null : b !== null && a.eq(b);

function batch(seed: number, n = 1500, maxInt = 27): string[] {
  const r = mulberry32(seed);
  return [
    ...(seed === 1 ? SPECIAL : []),
    ...Array.from({ length: n }, () => genDecimal(r, maxInt)),
  ];
}

describe('store → read is exact', () => {
  it('every decimal text (random, special, null-mixed) reads back equal, in canonical big.js text', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const values = batch(seed, 4000);
      const t = table(values);
      const vec = t.vector('v') as DecimalVector;
      values.forEach((s, i) => {
        const big = new Big(s);
        expect(same(cell(t, i), big), s).toBe(true);
        expect(vec.text(i), s).toBe(big.toString());
      });
    }
  });

  it('pushText / pushDouble / push(number) / pushFrom keep the value', () => {
    const b = new DecimalBuilder();
    const texts = batch(9, 1500);
    for (const s of texts) b.pushText(new Big(s).toString());
    const v = b.finish();
    const copy = new DecimalBuilder();
    for (let i = 0; i < v.length; i++) copy.pushFrom(v, i);
    const c = copy.finish();
    texts.forEach((s, i) => {
      expect(same(v.get(i), new Big(s)), s).toBe(true);
      expect(same(c.get(i), new Big(s)), s).toBe(true);
    });
    // a JS number in a decimal column means the decimal of its shortest representation
    for (const x of [0.1, 0.2, 0.1 + 0.2, 1e21, 5e-324, 2 ** 53 + 1, -0, 15000000]) {
      const one = vectorFrom('decimal', [x]) as DecimalVector;
      expect(one.get(0)!.eq(new Big(String(x))), String(x)).toBe(true);
    }
  });

  it('-0 and 0.00 are zero; sort/compare treat them as equal and equal to each other', () => {
    const t = table(['-0', '0', '0.00', '-0.0']);
    const vec = t.vector('v') as DecimalVector;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) expect(vec.compare(i, j)).toBe(0);
  });

  it('values 9007199254740992 / 93 / 94 are distinct and ordered exactly', () => {
    const t = table([
      '9007199254740994',
      '9007199254740993',
      '9007199254740992',
      '9007199254740993.5',
    ]);
    const vec = t.vector('v') as DecimalVector;
    const order = [0, 1, 2, 3].sort((a, b) => vec.compare(a, b));
    expect(order).toEqual([2, 1, 3, 0]);
  });
});

describe('DuckDB round trip is exact (DECIMAL(38,10), half-up away from zero)', () => {
  it('upload → CAST AS VARCHAR equals the rounded value; fetch gives the same', async () => {
    const db = await nodeDuckDb();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const values = batch(seed, 3000);
      const t = table(values);
      const scope = new SqlScope(db);
      try {
        const rel = scope.upload(t);
        const res = db.query(`SELECT CAST("v" AS VARCHAR) AS s FROM "${rel.name}" ORDER BY ${ORD}`);
        values.forEach((s, i) => {
          const got = new Big(String(res.getChild('s')!.get(i)));
          expect(got.eq(round10(s)), `${s} → ${String(res.getChild('s')!.get(i))}`).toBe(true);
        });
        const back = scope.fetch(rel);
        values.forEach((s, i) => expect(same(cell(back, i), round10(s)), s).toBe(true));
      } finally {
        scope.dispose();
      }
    }
  });

  it('a decimal that needs more than 28 integer digits (also after rounding) fails loudly, never wraps', async () => {
    for (const s of [
      '10000000000000000000000000000',
      '9999999999999999999999999999.99999999995',
      '-99999999999999999999999999999',
    ]) {
      const e = await runNode(
        'transform.select',
        { columns: [{ from: 'v' }] },
        { in: table([s]) },
      ).catch((x: unknown) => x);
      expect((e as { messageKey?: string }).messageKey, s).toBe('duckdb.error.decimalOverflow');
    }
  });

  it('through select → sort(DuckDB) → select: nulls, order and values survive', async () => {
    const values = batch(11, 1200, 20);
    const nulls = values.map((v, i) => (i % 7 === 0 ? null : v));
    const r = await runWith(
      { s: table(nulls) },
      [
        { id: 'a', type: 'transform.select', config: { columns: [{ from: 'v' }] } },
        { id: 'o', type: 'transform.sort', config: { by: [{ column: 'v', direction: 'desc' }] } },
      ],
      [
        { from: 's', to: 'a' },
        { from: 'a', to: 'o' },
      ],
    );
    const out = r.outputs.o!.out!;
    const expected = nulls
      .map((v, i) => ({ v, i }))
      .sort((x, y) => {
        if (x.v === null || y.v === null) return x.v === y.v ? x.i - y.i : x.v === null ? 1 : -1;
        const c = round10(y.v).cmp(round10(x.v));
        return c !== 0 ? c : x.i - y.i;
      });
    expect(out.rowCount).toBe(nulls.length);
    expected.forEach((e, k) =>
      expect(same(cell(out, k), e.v === null ? null : round10(e.v)), `${k}`).toBe(true),
    );
  });
});

describe('node arithmetic never goes through DOUBLE', () => {
  it('sum / avg / min / max over random decimals equal big.js (rounded inputs, half-up avg)', async () => {
    for (const seed of [21, 22, 23, 24, 25]) {
      const values = batch(seed, 2500, 17);
      const nums = values.map((s) => round10(s));
      const t = table(values);
      const r = await runNode(
        'transform.groupBy',
        {
          aggregations: [
            { key: 's', fn: 'sum', column: 'v' },
            { key: 'a', fn: 'avg', column: 'v' },
            { key: 'lo', fn: 'min', column: 'v' },
            { key: 'hi', fn: 'max', column: 'v' },
          ],
        },
        { in: t },
      );
      const sum = nums.reduce((a, b) => a.plus(b), new Big(0));
      const out = r.out.out!;
      expect(out.value(0, 's')!.toString(), `sum seed ${seed}`).toBe(sum.toString());
      const avg = sum.div(nums.length).round(10, Big.roundHalfUp);
      expect(new Big(String(out.value(0, 'a'))).eq(avg), `avg seed ${seed}`).toBe(true);
      const sorted = [...nums].sort((x, y) => x.cmp(y));
      expect(new Big(String(out.value(0, 'lo'))).eq(sorted[0]!)).toBe(true);
      expect(new Big(String(out.value(0, 'hi'))).eq(sorted[sorted.length - 1]!)).toBe(true);
    }
  });

  it('the classic float traps: 0.1 × 10 000 summed, 2^53+1 + 1, 0.1 + 0.2', async () => {
    const t = table([
      ...Array.from({ length: 10_000 }, () => '0.1'),
      '9007199254740993',
      '1',
      '0.2',
    ]);
    const r = await runNode(
      'transform.groupBy',
      { aggregations: [{ key: 's', fn: 'sum', column: 'v' }] },
      { in: t },
    );
    expect(r.out.out!.value(0, 's')!.toString()).toBe('9007199254741994.2');
  });

  it('TS sort of random decimals (exact and text-fallback values mixed) is exact and stable', () => {
    for (const seed of [31, 32, 33]) {
      const values = batch(seed, 2000);
      const t = table(values);
      const sorted = sortTable(
        { by: [{ column: 'v', direction: 'asc', blanks: 'last' }] } as never,
        t,
      );
      const expected = values
        .map((s, i) => ({ s, i }))
        .sort((x, y) => new Big(x.s).cmp(new Big(y.s)) || x.i - y.i);
      expected.forEach((e, k) => expect(same(cell(sorted, k), new Big(e.s)), `${k}`).toBe(true));
    }
  });

  it('join on a decimal key matches exactly the pairs equal after rounding to 10 places', async () => {
    const left = batch(41, 600, 12);
    const right = [
      ...left.slice(0, 300).map((s) => new Big(s).times(1).toFixed()),
      ...batch(42, 300, 12),
      '9007199254740992',
      '9007199254740993',
    ];
    const l = Table.fromRows(
      [
        { key: 'k', type: 'decimal' },
        { key: 'i', type: 'integer' },
      ],
      [...left, '9007199254740993'].map((s, i) => ({ k: new Big(s), i })),
    );
    const rt = Table.fromRows(
      [
        { key: 'k', type: 'decimal' },
        { key: 'j', type: 'integer' },
      ],
      right.map((s, j) => ({ k: new Big(s), j })),
    );
    const r = await runNode(
      'transform.join',
      { how: 'inner', on: [{ left: 'k', right: 'k' }] },
      { left: l, right: rt },
    );
    const out = r.out.out!;
    const pairs = new Set<string>();
    for (let n = 0; n < out.rowCount; n++)
      pairs.add(`${String(out.value(n, 'i'))}:${String(out.value(n, 'j'))}`);
    const expected = new Set<string>();
    [...left, '9007199254740993'].forEach((a, i) =>
      right.forEach((b, j) => {
        if (round10(a).eq(round10(b))) expected.add(`${i}:${j}`);
      }),
    );
    expect(pairs).toEqual(expected);
    // 2^53+1 must not match 2^53 (it would, after a DOUBLE conversion)
    expect(pairs.has(`${left.length}:${right.length - 1}`)).toBe(true);
    expect(pairs.has(`${left.length}:${right.length - 2}`)).toBe(false);
  });

  it('control.compare: diff is the exact big.js difference; tolerance 0 flags a 1e-10 gap at 1e15', () => {
    const t = createEngineTranslator('vi');
    const cfg = CompareConfigSchema.parse({
      ...acceptanceNodeConfig('cmp'),
      carryColumns: [],
      metrics: [{ left: 'cong', right: 'cong', label: 'Công', tolerance: '0' }],
    });
    const r = mulberry32(51);
    const pairs: [string, string][] = [
      ['9007199254740993', '9007199254740992'],
      ['1000000000000000.0000000001', '1000000000000000'],
      ['0.1', '0.1'],
      ['0.30000000000000004', '0.3'],
      ...Array.from({ length: 300 }, (): [string, string] => {
        const a = genDecimal(r, 14);
        return [a, r() < 0.3 ? a : genDecimal(r, 14)];
      }),
    ];
    const cols = (extra: ColumnDef[]): ColumnDef[] => [
      { key: 'ma_nv', type: 'string' },
      { key: 'cong', type: 'decimal' },
      ...extra,
    ];
    const mk = (side: 0 | 1) =>
      Table.fromRows(
        cols([]),
        pairs.map((p, i) => ({ ma_nv: `NV${i}`, cong: new Big(p[side]) })),
      );
    const out = controlComparePlugin.execute(cfg, { left: mk(0), right: mk(1) }, { t }) as Record<
      string,
      Table
    >;
    const mism = out.mismatched!;
    const got = new Map<string, Decimal>();
    for (let i = 0; i < mism.rowCount; i++)
      got.set(String(mism.value(i, 'ma_nv')), mism.value(i, 'cong__diff') as Decimal);
    pairs.forEach(([a, b], i) => {
      const diff = new Big(b).minus(new Big(a)); // compare: diff = right − left
      if (diff.eq(0)) expect(got.has(`NV${i}`), `${a} vs ${b}`).toBe(false);
      else {
        expect(got.has(`NV${i}`), `${a} vs ${b}`).toBe(true);
        expect(got.get(`NV${i}`)!.eq(diff), `${b} - ${a}`).toBe(true);
      }
    });
  });
});

describe('Excel write → read', () => {
  const read = (bytes: Uint8Array, n: number): Table => {
    const file: SourceFile = { name: 'out.xlsx', data: bytes };
    const res = readSlot(slot({ columns: [{ key: 'v', aliases: ['Số'], type: 'decimal' }] }), [
      file,
    ]);
    expect(res.report.errorCount).toBe(0);
    expect(res.table.rowCount).toBe(n);
    return res.table;
  };

  for (const streaming of [false, true]) {
    it(`${streaming ? 'streaming' : 'ExcelJS'} writer: <= 15 significant digits come back exactly; more become the 15-digit Excel value`, async () => {
      const values = batch(61, 2500, 14).filter((s) => !/e/i.test(s));
      const bytes = await writeWorkbook([{ name: 'S', table: table(values) }], { streaming });
      const back = read(bytes, values.length);
      values.forEach((s, i) => {
        const x = Number(s);
        if (!Number.isFinite(x)) return;
        const want = sigDigits(s) <= 15 && new Big(s).abs().lt('1e15') ? new Big(s) : excel15(s);
        expect(same(cell(back, i), want), `${s} → ${String(cell(back, i))}`).toBe(true);
      });
    });
  }

  it('both writers put the same number in the cell, equal to Number(canonical text)', async () => {
    const values = batch(62, 800, 20);
    const t = table(values);
    const [a, b] = [
      await writeWorkbook([{ name: 'S', table: t }], { streaming: false }),
      await writeWorkbook([{ name: 'S', table: t }], { streaming: true }),
    ];
    const ra = read(a, values.length);
    const rb = read(b, values.length);
    values.forEach((s, i) => expect(same(cell(ra, i), cell(rb, i)), s).toBe(true));
  });
});

describe('reader fast path: round15 = Number(n.toPrecision(15))', () => {
  it('300 000 random doubles (decimals of 1-12 places, integers, tiny, huge, negative, float noise)', async () => {
    const { round15 } = await import('../io/excel-reader');
    const r = mulberry32(77);
    const bad: number[] = [];
    for (let k = 0; k < 300_000; k++) {
      const kind = k % 6;
      let x: number;
      if (kind === 0) x = Number(genDecimal(r, 12));
      else if (kind === 1) x = Math.round(r() * 1e9) / 10 ** Math.floor(r() * 10);
      else if (kind === 2) x = (r() - 0.5) * 10 ** Math.floor(r() * 30 - 10);
      else if (kind === 3) x = Math.floor(r() * 2 ** 53) * (r() < 0.5 ? -1 : 1);
      else if (kind === 4) x = Math.round(r() * 1e6) / 100 + (r() < 0.5 ? 1e-15 : 0.1 + 0.2 - 0.3);
      else x = r() * 1e-8;
      const want = x === 0 ? 0 : Number(x.toPrecision(15));
      if (!Object.is(round15(x) === 0 ? 0 : round15(x), want)) bad.push(x);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
