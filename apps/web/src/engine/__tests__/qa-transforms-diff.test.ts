import { describe, expect, it } from 'vitest';
import { Big, decimalFrom, type Decimal } from '../core/decimal';
import { normalizeKeyPart } from '../core/keys';
import type { ColumnDef, Row, Table, Value } from '../core/types';
import { rowsOf, runNode, runWith, table } from './sql-helpers';
import BigJs from 'big.js';

/**
 * QA differential tests: every DuckDB transform node is compared with a tiny, obviously-correct
 * TypeScript reference on seeded random fake data (blanks, NBSP/tab variants, NFD vs NFC
 * Vietnamese, duplicates, decimals with > 10 places). Spec §12.1 is the oracle.
 */

// ---------- seeded fake data ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

const KEYS: (string | null)[] = [
  'NV001',
  'nv001',
  ' NV001',
  'NV001 ',
  'NV 001',
  'NV\t001',
  'NV  001',
  'NV002',
  'nv002',
  'NV003',
  'NV004',
  'ĐẶNG',
  'đặng',
  'Đặng',
  'Đặng'.normalize('NFD'),
  'Dương',
  'İSTANBUL',
  '',
  '  ',
  ' ',
  null,
  null,
  'TỔNG CỘNG',
  "x' OR 1=1 --",
  '00123',
  '123',
];
const BRANCH: (string | null)[] = ['CN01', 'cn01', 'CN01 ', 'CN02', 'CN03', null, '', ' '];
const DECS: (string | null)[] = [
  '0',
  '0.1',
  '0.2',
  '1234567890123.25',
  '-5',
  '-0.5',
  '22',
  '20.5',
  '0.12345678905',
  '-0.12345678905',
  '0.00000000004',
  '0.00000000005',
  '3.3333333333333',
  '1e3'.replace('1e3', '1000'),
  '99999999999999999999999999.99',
  null,
  null,
];
const DATES: (string | null)[] = ['2026-01-01', '2026-02-28', '2024-02-29', '1999-12-31', null];

function dec(s: string | null): Decimal | null {
  return s === null ? null : new Big(s);
}

function randomTable(r: Rng, n: number, withIdx = false): Table {
  const rows = Array.from({ length: n }, (_, i) => [
    pick(r, KEYS),
    pick(r, KEYS),
    pick(r, BRANCH),
    dec(pick(r, DECS)),
    r() < 0.15 ? null : Math.floor(r() * 7) - 2,
    pick(r, DATES),
    r() < 0.15 ? null : r() < 0.5,
    ...(withIdx ? [i] : []),
  ]);
  return table(
    [
      ['k', 'string'],
      ['k2', 'string'],
      ['cn', 'string'],
      ['n', 'decimal'],
      ['i', 'integer'],
      ['d', 'date'],
      ['b', 'boolean'],
      ...(withIdx ? ([['ix', 'integer']] as [string, 'integer'][]) : []),
    ],
    rows,
  );
}

// ---------- reference semantics ----------
const isBlankStr = (v: Value | undefined) =>
  v === null || v === undefined || String(v).trim() === '';
const roundDec = (v: Decimal): Decimal => v.round(10, Big.roundHalfUp);

/** Value as the engine sees it after crossing into DuckDB (decimal rounded to 10 places). */
function crossed(v: Value | undefined, type: ColumnDef['type']): Value {
  if (v === null || v === undefined) return null;
  if (type === 'decimal') return roundDec(decimalFrom(v as Decimal));
  return v;
}

/** Key part: null when blank; strings normalized when asked. */
function keyPart(v: Value | undefined, type: ColumnDef['type'], normalize: boolean): string | null {
  if (type === 'string') {
    if (isBlankStr(v)) return null;
    return normalize ? normalizeKeyPart(v) : String(v);
  }
  if (v === null || v === undefined) return null;
  return String(crossed(v, type)!.toString());
}

const colType = (t: Table, key: string) => t.columns.find((c) => c.key === key)!.type;

function plain(v: Value | undefined): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  return v instanceof Big ? v.toString() : v;
}
/** Row of a table as plain values, decimals rounded like the DuckDB round trip. */
function plainRow(row: Row, t: Table, keys: string[]) {
  return keys.map((k) => {
    const v = crossed(row[k], colType(t, k));
    return plain(v);
  });
}

const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i);

// ---------- join ----------
describe('QA diff: transform.join vs reference', () => {
  const HOWS = ['inner', 'left', 'right', 'full', 'anti'] as const;
  for (const how of HOWS) {
    for (const normalizeKeys of [true, false]) {
      it(`${how}, normalizeKeys=${normalizeKeys}: 40 seeds, single and composite keys`, async () => {
        let nonEmpty = 0;
        for (const seed of SEEDS) {
          const r = mulberry32(seed);
          const left = randomTable(r, 1 + Math.floor(r() * 25));
          const right = randomTable(r, Math.floor(r() * 25));
          const composite = seed % 2 === 0;
          const on = composite
            ? [
                { left: 'k', right: 'k' },
                { left: 'i', right: 'i' },
              ]
            : [{ left: 'k', right: 'k2' }];
          // right non-key columns get renamed with `_r` when they clash with the left ones
          const res = await runNode('transform.join', { how, on, normalizeKeys }, { left, right });
          const out = res.out.out!;

          const lk = (row: Row) =>
            on.map((p) => keyPart(row[p.left], colType(left, p.left), normalizeKeys));
          const rk = (row: Row) =>
            on.map((p) => keyPart(row[p.right], colType(right, p.right), normalizeKeys));
          const match = (a: (string | null)[], b: (string | null)[]) =>
            a.every((x, i) => x !== null && x === b[i]);

          const rightKeyNames = new Set(on.map((p) => p.right));
          const rightCols = right.columns.map((c) => c.key).filter((k) => !rightKeyNames.has(k));
          const leftCols = left.columns.map((c) => c.key);
          const expected: (string | number | boolean | null)[][] = [];
          const rightSeen = new Set<number>();
          const keyIdx = new Map(on.map((p, i) => [p.left, i]));
          left.rows.forEach((l) => {
            const ms = right.rows
              .map((rr, ri) => ({ rr, ri }))
              .filter(({ rr }) => match(lk(l), rk(rr)));
            ms.forEach(({ ri }) => rightSeen.add(ri));
            if (how === 'anti') {
              if (ms.length === 0) expected.push(plainRow(l, left, leftCols));
              return;
            }
            const emit = (rr: Row | null) => {
              const lp = leftCols.map((k, ci) => {
                const base = plain(crossed(l[k], colType(left, k)));
                const ki = keyIdx.get(k);
                if (
                  ki !== undefined &&
                  (how === 'right' || how === 'full') &&
                  base === null &&
                  rr
                ) {
                  return plain(crossed(rr[on[ki]!.right], colType(right, on[ki]!.right)));
                }
                void ci;
                return base;
              });
              const rp = rightCols.map((k) =>
                rr ? plain(crossed(rr[k], colType(right, k))) : null,
              );
              expected.push([...lp, ...rp]);
            };
            if (ms.length > 0) {
              ms.forEach(({ rr }) => emit(rr));
            } else if (how === 'left' || how === 'full') emit(null);
          });
          if (how === 'right' || how === 'full') {
            right.rows.forEach((rr, ri) => {
              if (rightSeen.has(ri)) return;
              const lp = leftCols.map((k) => {
                const ki = keyIdx.get(k);
                return ki === undefined
                  ? null
                  : plain(crossed(rr[on[ki]!.right], colType(right, on[ki]!.right)));
              });
              expected.push([
                ...lp,
                ...rightCols.map((k) => plain(crossed(rr[k], colType(right, k)))),
              ]);
            });
          }
          const keys = out.columns.map((c) => c.key);
          expect(rowsOf(out, keys), `seed ${seed}`).toEqual(expected);
          nonEmpty += expected.length;
        }
        // The fake data must actually produce matches, otherwise this test proves nothing.
        expect(nonEmpty).toBeGreaterThan(20);
      });
    }
  }
});

// ---------- dedupe ----------
describe('QA diff: transform.dedupe vs reference', () => {
  for (const keep of ['first', 'last'] as const) {
    for (const normalizeKeys of [true, false]) {
      it(`keep=${keep}, normalizeKeys=${normalizeKeys}: single and composite keys`, async () => {
        let dropped = 0;
        for (const seed of SEEDS) {
          const r = mulberry32(seed);
          const t = randomTable(r, Math.floor(r() * 40), true);
          const keys = seed % 2 === 0 ? ['k'] : ['k', 'cn'];
          const res = await runNode('transform.dedupe', { keys, keep, normalizeKeys }, { in: t });
          const parts = t.rows.map((row) =>
            keys.map((k) => keyPart(row[k], colType(t, k), normalizeKeys)),
          );
          const allBlank = parts.map((p) => p.every((x) => x === null));
          const groupKey = (i: number) => JSON.stringify(parts[i]);
          const winner = new Map<string, number>();
          t.rows.forEach((_, i) => {
            if (allBlank[i]) return;
            const g = groupKey(i);
            if (keep === 'first') {
              if (!winner.has(g)) winner.set(g, i);
            } else winner.set(g, i);
          });
          const kept: number[] = [];
          const removed: number[] = [];
          t.rows.forEach((_, i) => {
            if (allBlank[i] || winner.get(groupKey(i)) === i) kept.push(i);
            else removed.push(i);
          });
          const ix = (tbl: Table | undefined) => rowsOf(tbl, ['ix']).map((x) => x[0]);
          expect(ix(res.out.out), `seed ${seed} out`).toEqual(kept);
          expect(ix(res.out.removed), `seed ${seed} removed`).toEqual(removed);
          dropped += removed.length;
        }
        expect(dropped).toBeGreaterThan(10);
      });
    }
  }
});

// ---------- groupBy ----------
const AvgBig = BigJs();
AvgBig.DP = 10;
AvgBig.RM = AvgBig.roundHalfUp;

/** Code point order = UTF-8 byte order, which is what DuckDB uses for VARCHAR min/max. */
const cpCompare = (a: string, b: string) => {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
};

describe('QA diff: transform.groupBy vs reference (big.js sum/avg)', () => {
  for (const by of [['cn'], ['d'], ['b'], ['n'], ['cn', 'b'], []]) {
    it(`by [${by.join(',')}]: sum/avg/min/max/count/countDistinct/countRows`, async () => {
      for (const seed of SEEDS) {
        const r = mulberry32(seed);
        const t = randomTable(r, Math.floor(r() * 40) + (by.length === 0 ? 0 : 1));
        // Keep sums inside DECIMAL(38,10): drop the 26-digit value for this node.
        for (const row of t.rows) {
          if (row.n && (row.n as Decimal).gte('1e20')) row.n = new Big('7.25');
        }
        const aggregations = [
          { key: 's', fn: 'sum', column: 'n' },
          { key: 'a', fn: 'avg', column: 'n' },
          { key: 'si', fn: 'sum', column: 'i' },
          { key: 'ai', fn: 'avg', column: 'i' },
          { key: 'mn', fn: 'min', column: 'n' },
          { key: 'mx', fn: 'max', column: 'd' },
          { key: 'ms', fn: 'min', column: 'k' },
          { key: 'xs', fn: 'max', column: 'k' },
          { key: 'c', fn: 'count', column: 'k' },
          { key: 'cd', fn: 'countDistinct', column: 'k' },
          { key: 'cr', fn: 'countRows' },
        ];
        const res = await runNode('transform.groupBy', { by, aggregations }, { in: t });
        const g = (row: Row) =>
          JSON.stringify(
            by.map((k) => {
              const ty = colType(t, k);
              if (ty === 'string') return isBlankStr(row[k]) ? null : row[k];
              return plain(crossed(row[k], ty));
            }),
          );
        const groups = new Map<string, Row[]>();
        for (const row of t.rows) {
          const key = g(row);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(row);
        }
        if (by.length === 0 && groups.size === 0) groups.set('[]', []);
        const expected = [...groups.values()].map((rows) => {
          const first = rows[0];
          const lead = by.map((k) => {
            if (!first) return null;
            const ty = colType(t, k);
            if (ty === 'string') return isBlankStr(first[k]) ? null : (first[k] as string);
            return plain(crossed(first[k], ty));
          });
          const nums = rows
            .map((x) => crossed(x.n, 'decimal') as Decimal | null)
            .filter((x) => x !== null);
          const ints = rows.map((x) => x.i as number | null).filter((x) => x !== null);
          const sum = nums.reduce((a, b) => a.plus(b), new Big(0));
          const strs = rows.map((x) => x.k).filter((x) => !isBlankStr(x)) as string[];
          const dates = rows
            .map((x) => x.d as string | null)
            .filter((x): x is string => x !== null);
          const cmp = (a: Decimal, b: Decimal) => a.cmp(b);
          const sortedN = [...nums].sort(cmp);
          const sortedS = [...strs].sort(cpCompare);
          const isum = ints.reduce((a, b) => a + b, 0);
          return [
            ...lead,
            sum.toString(),
            nums.length ? new Big(new AvgBig(sum).div(nums.length).toFixed()).toString() : null,
            isum,
            ints.length ? new Big(new AvgBig(isum).div(ints.length).toFixed()).toString() : null,
            sortedN.length ? sortedN[0]!.toString() : null,
            dates.length ? [...dates].sort()[dates.length - 1]! : null,
            sortedS.length ? sortedS[0]! : null,
            sortedS.length ? sortedS[sortedS.length - 1]! : null,
            strs.length,
            new Set(strs).size,
            rows.length,
          ];
        });
        expect(rowsOf(res.out.out), `seed ${seed}`).toEqual(expected);
      }
    });
  }
});

// ---------- filter ----------
describe('QA diff: transform.filter vs reference', () => {
  const STR_OPS = [
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
  ];
  for (const normalizeText of [true, false]) {
    it(`string ops, normalizeText=${normalizeText}`, async () => {
      for (const seed of SEEDS) {
        const r = mulberry32(seed);
        const t = randomTable(r, 30, true);
        const op = STR_OPS[seed % STR_OPS.length]!;
        const value = pick(r, [
          'nv001',
          'NV001',
          'nv',
          '001',
          'đặng',
          'ĐẶNG',
          'CN01',
          'cn',
          '%',
          '_',
          'dương',
          'x',
        ]);
        const res = await runNode(
          'transform.filter',
          { conditions: [{ column: 'k', op, value }], normalizeText },
          { in: t },
        );
        const v = normalizeText ? normalizeKeyPart(value) : value;
        const keep = t.rows
          .map((row, i) => ({ row, i }))
          .filter(({ row }) => {
            const blank = isBlankStr(row.k);
            const x = blank ? '' : normalizeText ? normalizeKeyPart(row.k) : String(row.k);
            // DuckDB compares VARCHAR bytewise; with the ASCII/BMP fake values code point order is used.
            const c = cpCompare(x, v);
            switch (op) {
              case 'eq':
                return !blank && x === v;
              case 'neq':
                return blank || x !== v;
              case 'gt':
                return !blank && c > 0;
              case 'gte':
                return !blank && c >= 0;
              case 'lt':
                return !blank && c < 0;
              case 'lte':
                return !blank && c <= 0;
              case 'contains':
                return !blank && x.includes(v);
              case 'notContains':
                return blank || !x.includes(v);
              case 'startsWith':
                return !blank && x.startsWith(v);
              default:
                return !blank && x.endsWith(v);
            }
          })
          .map(({ i }) => i);
        expect(
          rowsOf(res.out.out, ['ix']).map((x) => x[0]),
          `seed ${seed} ${op} ${value}`,
        ).toEqual(keep);
      }
    });
  }

  it('numeric, date and boolean ops incl. in/notIn/isBlank with match all/any', async () => {
    for (const seed of SEEDS) {
      const r = mulberry32(seed);
      const t = randomTable(r, 30, true);
      const conds = [
        {
          column: 'n',
          op: pick(r, ['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
          value: pick(r, ['0', '0.1', '22', '-0.5', '0.1234567891']),
        },
        { column: 'i', op: pick(r, ['in', 'notIn']), values: [0, 1, 3] },
        {
          column: 'd',
          op: pick(r, ['gte', 'lt', 'eq', 'isBlank', 'notBlank']),
          value: '2026-01-01',
        },
        { column: 'b', op: pick(r, ['eq', 'neq', 'isBlank']), value: true },
      ] as { column: string; op: string; value?: string | boolean; values?: number[] }[];
      for (const c of conds) {
        if (['isBlank', 'notBlank'].includes(c.op)) delete c.value;
        if (c.op === 'in' || c.op === 'notIn') delete c.value;
      }
      for (const match of ['all', 'any'] as const) {
        const res = await runNode('transform.filter', { match, conditions: conds }, { in: t });
        const test = (row: Row, c: (typeof conds)[number]): boolean => {
          const ty = colType(t, c.column);
          const raw = row[c.column];
          const blank = raw === null || raw === undefined;
          if (c.op === 'isBlank') return blank;
          if (c.op === 'notBlank') return !blank;
          let cmp = 0;
          if (c.op === 'in' || c.op === 'notIn') {
            const inSet = !blank && (c.values as number[]).includes(raw as number);
            return c.op === 'in' ? inSet : blank || !inSet;
          }
          if (ty === 'decimal') {
            if (!blank) cmp = (crossed(raw, 'decimal') as Decimal).cmp(new Big(c.value as string));
          } else if (ty === 'date') {
            if (!blank) cmp = (raw as string) < (c.value as string) ? -1 : raw === c.value ? 0 : 1;
          } else if (ty === 'boolean') {
            if (!blank) cmp = raw === c.value ? 0 : 1;
          }
          const eq = cmp === 0;
          switch (c.op) {
            case 'eq':
              return !blank && eq;
            case 'neq':
              return blank || !eq;
            case 'gt':
              return !blank && cmp > 0;
            case 'gte':
              return !blank && cmp >= 0;
            case 'lt':
              return !blank && cmp < 0;
            default:
              return !blank && cmp <= 0;
          }
        };
        const keep = t.rows
          .map((row, i) => ({ row, i }))
          .filter(({ row }) =>
            match === 'all' ? conds.every((c) => test(row, c)) : conds.some((c) => test(row, c)),
          )
          .map(({ i }) => i);
        expect(
          rowsOf(res.out.out, ['ix']).map((x) => x[0]),
          `seed ${seed} ${match} ${JSON.stringify(conds)}`,
        ).toEqual(keep);
      }
    }
  });
});

// ---------- sort ----------
describe('QA diff: transform.sort vs reference', () => {
  const collator = new Intl.Collator('vi', { sensitivity: 'accent' });
  const NAMES = [
    'Đặng',
    'Dương',
    'Em',
    'Đào',
    'đạt',
    'Ân',
    'An',
    'an',
    'Ăn',
    'Ba',
    'Bà',
    'Bá',
    'ba',
    'Zoe',
    'Á',
    'A',
    'a',
    null,
    '',
    '  ',
    'Hồ',
    'Hô',
    'Hơ',
    'Ơn',
    'On',
    'Ôn',
    'Nguyễn',
    'Nguyen',
  ];
  it('Vietnamese order, case-insensitive, stable, blanks first/last, asc/desc (TS path)', async () => {
    for (const seed of SEEDS) {
      const r = mulberry32(seed);
      const rows = Array.from({ length: 40 }, (_, ix) => [pick(r, NAMES), Math.floor(r() * 3), ix]);
      const t = table(
        [
          ['s', 'string'],
          ['g', 'integer'],
          ['ix', 'integer'],
        ],
        rows,
      );
      const dir = seed % 2 === 0 ? 'asc' : 'desc';
      const blanks = seed % 3 === 0 ? 'first' : 'last';
      const res = await runNode(
        'transform.sort',
        {
          by: [
            { column: 's', direction: dir, blanks },
            { column: 'g', direction: 'desc' },
          ],
        },
        { in: t },
      );
      const idx = rows.map((_, i) => i);
      const isB = (v: string | null) => v === null || v.trim() === '';
      idx.sort((a, b) => {
        const x = rows[a]![0] as string | null;
        const y = rows[b]![0] as string | null;
        if (isB(x) !== isB(y)) return isB(x) === (blanks === 'first') ? -1 : 1;
        if (!isB(x)) {
          const c = collator.compare(x!, y!);
          if (c !== 0) return dir === 'desc' ? -c : c;
        }
        const gd = (rows[b]![1] as number) - (rows[a]![1] as number);
        return gd !== 0 ? gd : a - b;
      });
      expect(
        rowsOf(res.out.out, ['ix']).map((x) => x[0]),
        `seed ${seed}`,
      ).toEqual(idx);
    }
  });

  it('AC-B3-12 examples: "Đặng" after "Dương" and before "Em"; "an" and "An" keep their order', async () => {
    const t = table(
      [['s', 'string']],
      [['Em'], ['Đặng'], ['Dương'], ['an'], ['An'], ['Ân'], ['Ab'], ['Đ'], ['D'], ['E']],
    );
    const res = await runNode('transform.sort', { by: [{ column: 's' }] }, { in: t });
    expect(rowsOf(res.out.out).map((x) => x[0])).toEqual([
      'Ab',
      'an',
      'An',
      'Ân',
      'D',
      'Dương',
      'Đ',
      'Đặng',
      'E',
      'Em',
    ]);
    const r2 = await runNode(
      'transform.sort',
      { by: [{ column: 's' }] },
      { in: table([['s', 'string']], [['An'], ['an'], ['AN']]) },
    );
    expect(rowsOf(r2.out.out).map((x) => x[0])).toEqual(['An', 'an', 'AN']);
  });

  it('DuckDB path (non-string columns after a select): nulls, desc, stable', async () => {
    for (const seed of SEEDS) {
      const r = mulberry32(seed);
      const t = randomTable(r, 40, true);
      const specs = [
        { column: 'n', direction: pick(r, ['asc', 'desc']), blanks: pick(r, ['first', 'last']) },
        { column: 'd', direction: pick(r, ['asc', 'desc']), blanks: pick(r, ['first', 'last']) },
        { column: 'b', direction: pick(r, ['asc', 'desc']), blanks: pick(r, ['first', 'last']) },
      ];
      const res = await runWith(
        { src: t },
        [
          {
            id: 'sel',
            type: 'transform.select',
            config: { columns: ['n', 'd', 'b', 'ix'].map((from) => ({ from })) },
          },
          { id: 'n', type: 'transform.sort', config: { by: specs } },
        ],
        [
          { from: 'src', to: 'sel' },
          { from: 'sel', to: 'n' },
        ],
      );
      const idx = t.rows.map((_, i) => i);
      idx.sort((a, b) => {
        for (const s of specs) {
          const x = t.rows[a]![s.column];
          const y = t.rows[b]![s.column];
          const bx = x === null || x === undefined;
          const by = y === null || y === undefined;
          if (bx || by) {
            if (bx && by) continue;
            return bx === (s.blanks === 'first') ? -1 : 1;
          }
          let c: number;
          if (s.column === 'n')
            c = (crossed(x, 'decimal') as Decimal).cmp(crossed(y, 'decimal') as Decimal);
          else if (s.column === 'b') c = Number(x) - Number(y);
          else c = (x as string) < (y as string) ? -1 : x === y ? 0 : 1;
          if (c !== 0) return s.direction === 'desc' ? -c : c;
        }
        return a - b;
      });
      expect(
        rowsOf(res.outputs.n!.out, ['ix']).map((x) => x[0]),
        `seed ${seed}`,
      ).toEqual(idx);
    }
  });
});

// ---------- union ----------
describe('QA diff: transform.union', () => {
  it('3 inputs with different/mismatched columns, integer+decimal, label column, nested', async () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const r = mulberry32(seed);
      const a = randomTable(r, Math.floor(r() * 6));
      const bFull = randomTable(r, Math.floor(r() * 6));
      // b: reordered subset where `i` is decimal, `d` missing
      const b: Table = {
        columns: [
          { key: 'i', type: 'decimal' },
          { key: 'k', type: 'string' },
          { key: 'extra', type: 'string' },
        ],
        rows: bFull.rows.map((row, ix) => ({
          i: dec(row.i === null ? null : String(Number(row.i) + 0.5)),
          k: row.k ?? null,
          extra: `e${ix}`,
        })),
      };
      const c: Table = { columns: [{ key: 'z', type: 'integer' }], rows: [{ z: 1 }, { z: null }] };
      const res = await runWith(
        { a, b, c },
        [
          {
            id: 'u1',
            type: 'transform.union',
            config: { inputCount: 2, sourceColumn: { key: 'nguon', labels: ["A'; --", 'B'] } },
          },
          { id: 'n', type: 'transform.union', config: { inputCount: 2 } },
        ],
        [
          { from: 'a', to: 'u1', toPort: 'in_1' },
          { from: 'b', to: 'u1', toPort: 'in_2' },
          { from: 'u1', to: 'n', toPort: 'in_1' },
          { from: 'c', to: 'n', toPort: 'in_2' },
        ],
      );
      const out = res.outputs.n!.out!;
      expect(out.columns.map((x) => [x.key, x.type])).toEqual([
        ['k', 'string'],
        ['k2', 'string'],
        ['cn', 'string'],
        ['n', 'decimal'],
        ['i', 'decimal'],
        ['d', 'date'],
        ['b', 'boolean'],
        ['extra', 'string'],
        ['nguon', 'string'],
        ['z', 'integer'],
      ]);
      const expected = [
        ...a.rows.map((row) => [
          row.k,
          row.k2,
          row.cn,
          plain(crossed(row.n, 'decimal')),
          row.i === null ? null : new Big(row.i as number).toString(),
          row.d,
          row.b,
          null,
          "A'; --",
          null,
        ]),
        ...b.rows.map((row) => [
          row.k,
          null,
          null,
          null,
          plain(crossed(row.i, 'decimal')),
          null,
          null,
          row.extra,
          'B',
          null,
        ]),
        ...c.rows.map((row) => [null, null, null, null, null, null, null, null, null, row.z]),
      ];
      expect(rowsOf(out), `seed ${seed}`).toEqual(
        expected.map((row) => row.map((v) => (v === undefined ? null : v))),
      );
    }
  });
});
