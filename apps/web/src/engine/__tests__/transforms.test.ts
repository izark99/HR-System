import { describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import type { Table } from '../core/types';
import { rowsOf, runNode, runWith, table } from './sql-helpers';
import { asTable } from './helpers';

/** Step-3 transform nodes on DuckDB (spec §12.1, AC-B3-09..18). Fake data only. */

const staff = table(
  [
    ['ma_nv', 'string'],
    ['chi_nhanh', 'string'],
    ['cong', 'decimal'],
    ['ngay_vao', 'date'],
  ],
  [
    ['NV001', 'CN01', new Big('22'), '2020-01-15'],
    ['NV002', 'CN01 ', new Big('20.5'), '2021-06-01'],
    ['NV003', 'cn02', null, '2019-03-10'],
    ['NV004', '  ', new Big('18'), null],
    ['NV005', 'CN02', new Big('22'), '2022-11-30'],
  ],
);

const ids = (tbl: Table | undefined, key = 'ma_nv') => rowsOf(tbl, [key]).map((x) => x[0]);

describe('transform.select (AC-B3-09)', () => {
  it('picks, renames and reorders columns; titles follow the source', async () => {
    const r = await runNode(
      'transform.select',
      {
        columns: [
          { from: 'cong', key: 'ngay_cong', title: 'Ngày công' },
          { from: 'ma_nv' },
          { from: 'ma_nv', key: 'ma_2' },
        ],
      },
      { in: staff },
    );
    const out = r.out.out!;
    expect(out.columns).toEqual([
      { key: 'ngay_cong', type: 'decimal', title: 'Ngày công' },
      { key: 'ma_nv', type: 'string', title: 'MA_NV' },
      { key: 'ma_2', type: 'string', title: 'MA_NV' },
    ]);
    expect(rowsOf(out)[1]).toEqual(['20.5', 'NV002', 'NV002']);
  });

  it('unknown source column → select.error.unknownColumn on the node, with the field path', async () => {
    await expect(
      runNode('transform.select', { columns: [{ from: 'nope' }] }, { in: staff }),
    ).rejects.toMatchObject({
      messageKey: 'select.error.unknownColumn',
      nodeId: 'n',
      params: { column: 'nope', path: 'columns.0.from' },
    });
  });

  it('duplicate output key → duplicateKey; a new key starting with "_" → reservedKey', async () => {
    await expect(
      runNode(
        'transform.select',
        { columns: [{ from: 'ma_nv' }, { from: 'cong', key: 'ma_nv' }] },
        { in: staff },
      ),
    ).rejects.toMatchObject({ messageKey: 'select.error.duplicateKey', nodeId: 'n' });
    await expect(
      runNode('transform.select', { columns: [{ from: 'ma_nv', key: '_ma' }] }, { in: staff }),
    ).rejects.toMatchObject({ messageKey: 'select.error.reservedKey' });
  });
});

describe('transform.filter (AC-B3-10, AC-B3-11, AC-B3-21 style binding)', () => {
  const paramDefs = [{ key: 'cn', label: 'Chi nhánh', type: 'string' as const }];

  async function filter(
    config: Record<string, unknown>,
    params: Record<string, string | null> = {},
  ) {
    const r = await runNode('transform.filter', config, { in: staff }, { paramDefs, params });
    return ids(r.out.out);
  }

  it('all = intersection, any = union', async () => {
    const conditions = [
      { column: 'cong', op: 'gte', value: '20' },
      { column: 'ngay_vao', op: 'lt', value: '2021-01-01' },
    ];
    expect(await filter({ match: 'all', conditions })).toEqual(['NV001']);
    expect(await filter({ match: 'any', conditions })).toEqual([
      'NV001',
      'NV002',
      'NV003',
      'NV005',
    ]);
  });

  it('blank cells only satisfy isBlank, neq, notIn, notContains', async () => {
    const c = (op: string, extra: Record<string, unknown> = {}) =>
      filter({ conditions: [{ column: 'chi_nhanh', op, ...extra }] });
    expect(await c('isBlank')).toEqual(['NV004']);
    expect(await c('notBlank')).toEqual(['NV001', 'NV002', 'NV003', 'NV005']);
    expect(await c('neq', { value: 'cn01' })).toEqual(['NV003', 'NV004', 'NV005']);
    expect(await c('notIn', { values: ['cn01'] })).toEqual(['NV003', 'NV004', 'NV005']);
    expect(await c('notContains', { value: '01' })).toEqual(['NV003', 'NV004', 'NV005']);
    expect(await c('contains', { value: 'cn' })).toEqual(['NV001', 'NV002', 'NV003', 'NV005']);
    expect(await c('startsWith', { value: 'CN0' })).toEqual(['NV001', 'NV002', 'NV003', 'NV005']);
    expect(await c('endsWith', { value: '2' })).toEqual(['NV003', 'NV005']);
    expect(await c('in', { values: ['CN02', 'x'] })).toEqual(['NV003', 'NV005']);
    expect(await c('eq', { value: '' })).toEqual([]);
    // Blank decimal: never equal / less than anything, but satisfies neq.
    expect(await filter({ conditions: [{ column: 'cong', op: 'neq', value: 22 }] })).toEqual([
      'NV002',
      'NV003',
      'NV004',
    ]);
    expect(await filter({ conditions: [{ column: 'cong', op: 'lt', value: 100 }] })).toEqual([
      'NV001',
      'NV002',
      'NV004',
      'NV005',
    ]);
    expect(await filter({ conditions: [{ column: 'ngay_vao', op: 'isBlank' }] })).toEqual([
      'NV004',
    ]);
  });

  it('AC-B3-11: normalizeText defaults to true; turned off → exact match only', async () => {
    const conditions = [{ column: 'chi_nhanh', op: 'eq', value: 'cn01' }];
    expect(await filter({ conditions })).toEqual(['NV001', 'NV002']);
    expect(await filter({ conditions, normalizeText: false })).toEqual([]);
    expect(
      await filter({
        conditions: [{ column: 'chi_nhanh', op: 'eq', value: 'cn02' }],
        normalizeText: false,
      }),
    ).toEqual(['NV003']);
  });

  it('a condition on a blank param is skipped; a filled param is bound as a value', async () => {
    const config = {
      conditions: [
        { column: 'chi_nhanh', op: 'eq', value: { param: 'cn' } },
        { column: 'cong', op: 'gt', value: 19 },
      ],
    };
    expect(await filter(config, { cn: null })).toEqual(['NV001', 'NV002', 'NV005']);
    expect(await filter(config, { cn: '   ' })).toEqual(['NV001', 'NV002', 'NV005']);
    expect(await filter(config, { cn: 'cn02' })).toEqual(['NV005']);
    expect(await filter(config, { cn: "x' OR 1=1 --" })).toEqual([]);
  });

  it('wrong op for the type → opNotForType; unreadable value → invalidValue; unknown param', async () => {
    await expect(
      filter({ conditions: [{ column: 'cong', op: 'contains', value: '1' }] }),
    ).rejects.toMatchObject({
      messageKey: 'filter.error.opNotForType',
      params: { path: 'conditions.0.op' },
    });
    await expect(
      filter({ conditions: [{ column: 'ngay_vao', op: 'eq', value: 'abc' }] }),
    ).rejects.toMatchObject({
      messageKey: 'filter.error.invalidValue',
      params: { path: 'conditions.0.value' },
    });
    await expect(
      filter({ conditions: [{ column: 'ma_nv', op: 'eq', value: { param: 'khong_co' } }] }),
    ).rejects.toMatchObject({ messageKey: 'filter.error.unknownParam' });
    await expect(filter({ conditions: [{ column: 'nope', op: 'isBlank' }] })).rejects.toMatchObject(
      { messageKey: 'filter.error.unknownColumn' },
    );
  });
});

describe('transform.sort (AC-B3-12)', () => {
  const people = table(
    [
      ['ten', 'string'],
      ['so', 'integer'],
      ['tien', 'decimal'],
    ],
    [
      ['Em', 1, new Big('5')],
      ['Đặng', 2, null],
      ['an', 3, new Big('10.5')],
      ['Dương', null, new Big('2')],
      ['An', 2, new Big('10.5')],
      [null, 4, new Big('-1')],
      ['Bình', 1, new Big('3')],
    ],
  );

  it('strings in Vietnamese order (TS), case-insensitive and stable, blanks last', async () => {
    const r = await runNode('transform.sort', { by: [{ column: 'ten' }] }, { in: people });
    expect(ids(r.out.out, 'ten')).toEqual(['an', 'An', 'Bình', 'Dương', 'Đặng', 'Em', null]);
  });

  it('several columns, asc/desc, blanks first/last', async () => {
    const r = await runNode(
      'transform.sort',
      {
        by: [
          { column: 'so', direction: 'desc', blanks: 'first' },
          { column: 'ten', direction: 'asc' },
        ],
      },
      { in: people },
    );
    expect(ids(r.out.out, 'ten')).toEqual(['Dương', null, 'an', 'An', 'Đặng', 'Bình', 'Em']);
  });

  it('non-string columns of data inside DuckDB sort in DuckDB, stable', async () => {
    const r = await runWith(
      { src: people },
      [
        {
          id: 'sel',
          type: 'transform.select',
          config: { columns: [{ from: 'ten' }, { from: 'so' }, { from: 'tien' }] },
        },
        {
          id: 's',
          type: 'transform.sort',
          config: { by: [{ column: 'tien', direction: 'desc' }] },
        },
      ],
      [
        { from: 'src', to: 'sel' },
        { from: 'sel', to: 's' },
      ],
    );
    expect(ids(r.outputs.s!.out, 'ten')).toEqual(['an', 'An', 'Em', 'Bình', 'Dương', null, 'Đặng']);
  });

  it('unknown column → sort.error.unknownColumn', async () => {
    await expect(
      runNode('transform.sort', { by: [{ column: 'x' }] }, { in: people }),
    ).rejects.toMatchObject({ messageKey: 'sort.error.unknownColumn', nodeId: 'n' });
  });
});

describe('transform.join (AC-B3-13..15)', () => {
  const left = table(
    [
      ['ma', 'string'],
      ['ten', 'string'],
    ],
    [
      ['NV001', 'A'],
      ['NV002', 'B'],
      ['NV003', 'C'],
      [null, 'D'],
      ['NV005', 'E'],
    ],
  );
  const right = table(
    [
      ['ma', 'string'],
      ['ten', 'string'],
      ['luong', 'decimal'],
    ],
    [
      [' nv001', 'a1', new Big('1')],
      ['NV002', 'b1', new Big('2')],
      ['NV002', 'b2', new Big('3')],
      ['NV002', 'b3', new Big('4')],
      ['NV009', 'z', new Big('9')],
      [null, 'blank', new Big('0')],
      ['NV005 ', 'e1', new Big('5')],
    ],
  );
  const join = (how: string, extra: Record<string, unknown> = {}) =>
    runNode(
      'transform.join',
      { how, on: [{ left: 'ma', right: 'ma' }], ...extra },
      { left, right },
    );

  it('inner / left / right / full / anti row counts and order', async () => {
    const inner = await join('inner');
    expect(rowsOf(inner.out.out)).toEqual([
      ['NV001', 'A', 'a1', '1'],
      ['NV002', 'B', 'b1', '2'],
      ['NV002', 'B', 'b2', '3'],
      ['NV002', 'B', 'b3', '4'],
      ['NV005', 'E', 'e1', '5'],
    ]);
    expect(inner.out.out!.columns.map((c) => c.key)).toEqual(['ma', 'ten', 'ten_r', 'luong']);
    expect((await join('left')).out.out!.rows).toHaveLength(7);
    expect(ids((await join('left')).out.out, 'ten')).toEqual(['A', 'B', 'B', 'B', 'C', 'D', 'E']);
    const r = await join('right');
    expect(r.out.out!.rows).toHaveLength(7);
    // Right-only rows come last in right order; their key comes from the right side.
    expect(rowsOf(r.out.out).slice(-2)).toEqual([
      ['NV009', null, 'z', '9'],
      [null, null, 'blank', '0'],
    ]);
    const full = await join('full');
    expect(full.out.out!.rows).toHaveLength(9);
    expect(ids(full.out.out, 'ten')).toEqual(['A', 'B', 'B', 'B', 'C', 'D', 'E', null, null]);
    const anti = await join('anti');
    expect(rowsOf(anti.out.out)).toEqual([
      ['NV003', 'C'],
      [null, 'D'],
    ]);
  });

  it('AC-B3-14: keys normalized by default (" nv001", NBSP); blank keys never match; off → exact', async () => {
    const strict = await join('inner', { normalizeKeys: false });
    expect(ids(strict.out.out, 'ten_r')).toEqual(['b1', 'b2', 'b3']);
  });

  it('AC-B3-15: rows multiplied → warning with a count only; column clash → _r suffix', async () => {
    const r = await join('left');
    expect(r.warnings).toEqual([
      { nodeId: 'n', messageKey: 'join.warning.rowsMultiplied', params: { count: 1 } },
    ]);
    expect(JSON.stringify(r.warnings)).not.toContain('NV002');
  });

  it('rightColumns picks right columns; a clash after the suffix is columnConflict', async () => {
    const r = await join('inner', { rightColumns: ['luong'] });
    expect(r.out.out!.columns.map((c) => c.key)).toEqual(['ma', 'ten', 'luong']);
    const l2 = table(
      [
        ['ma', 'string'],
        ['ten', 'string'],
        ['ten_r', 'string'],
      ],
      [],
    );
    await expect(
      runNode(
        'transform.join',
        { how: 'inner', on: [{ left: 'ma', right: 'ma' }] },
        { left: l2, right },
      ),
    ).rejects.toMatchObject({ messageKey: 'join.error.columnConflict' });
  });

  it('string key vs decimal key → keyTypeMismatch; integer vs decimal is compatible', async () => {
    await expect(
      runNode(
        'transform.join',
        { how: 'inner', on: [{ left: 'ma', right: 'luong' }] },
        { left, right },
      ),
    ).rejects.toMatchObject({ messageKey: 'join.error.keyTypeMismatch', params: { path: 'on.0' } });
    const a = table([['k', 'integer']], [[1], [2]]);
    const b = table(
      [
        ['k', 'decimal'],
        ['v', 'string'],
      ],
      [
        [new Big('2'), 'x'],
        [new Big('3'), 'y'],
      ],
    );
    const r = await runNode(
      'transform.join',
      { how: 'full', on: [{ left: 'k', right: 'k' }] },
      { left: a, right: b },
    );
    expect(rowsOf(r.out.out)).toEqual([
      ['1', null],
      ['2', 'x'],
      ['3', 'y'],
    ]);
    expect(r.out.out!.columns[0]!.type).toBe('decimal');
  });

  it('unknown key column → join.error.unknownColumn', async () => {
    await expect(
      runNode(
        'transform.join',
        { how: 'inner', on: [{ left: 'x', right: 'ma' }] },
        { left, right },
      ),
    ).rejects.toMatchObject({
      messageKey: 'join.error.unknownColumn',
      params: { path: 'on.0.left' },
    });
  });
});

describe('transform.union (AC-B3-16)', () => {
  const a = table(
    [
      ['ma', 'string'],
      ['so', 'integer'],
    ],
    [
      ['a1', 1],
      ['a2', 2],
    ],
  );
  const b = table(
    [
      ['so', 'decimal'],
      ['ma', 'string'],
      ['ghi_chu', 'string'],
    ],
    [[new Big('2.5'), 'b1', 'x']],
  );
  const c = table([['ma', 'string']], [['c1']]);

  it('3 inputs: columns of in_1 then new ones; missing → blank; integer + decimal → decimal; labels', async () => {
    const r = await runNode(
      'transform.union',
      { inputCount: 3, sourceColumn: { key: 'nguon', labels: ['A', 'B', 'C'] } },
      { in_1: a, in_2: b, in_3: c },
    );
    const out = r.out.out!;
    expect(out.columns.map((x) => [x.key, x.type])).toEqual([
      ['ma', 'string'],
      ['so', 'decimal'],
      ['ghi_chu', 'string'],
      ['nguon', 'string'],
    ]);
    expect(rowsOf(out)).toEqual([
      ['a1', '1', null, 'A'],
      ['a2', '2', null, 'A'],
      ['b1', '2.5', 'x', 'B'],
      ['c1', null, null, 'C'],
    ]);
  });

  it("missingColumns 'error' → union.error.missingColumn; string + date → typeMismatch", async () => {
    await expect(
      runNode('transform.union', { inputCount: 2, missingColumns: 'error' }, { in_1: a, in_2: c }),
    ).rejects.toMatchObject({
      messageKey: 'union.error.missingColumn',
      params: { column: 'so', port: 'in_2' },
    });
    const d = table([['ma', 'date']], [['2026-01-01']]);
    await expect(
      runNode('transform.union', { inputCount: 2 }, { in_1: a, in_2: d }),
    ).rejects.toMatchObject({ messageKey: 'union.error.typeMismatch' });
    await expect(
      runNode(
        'transform.union',
        { inputCount: 2, sourceColumn: { key: 'ma', labels: ['x', 'y'] } },
        { in_1: a, in_2: c },
      ),
    ).rejects.toMatchObject({ messageKey: 'union.error.duplicateKey' });
  });

  it('nested unions keep the row order', async () => {
    const r = await runWith(
      { a, b, c },
      [
        { id: 'u1', type: 'transform.union', config: {} },
        { id: 'u2', type: 'transform.union', config: {} },
      ],
      [
        { from: 'c', to: 'u1', toPort: 'in_1' },
        { from: 'a', to: 'u1', toPort: 'in_2' },
        { from: 'u1', to: 'u2', toPort: 'in_1' },
        { from: 'b', to: 'u2', toPort: 'in_2' },
      ],
    );
    expect(ids(r.outputs.u2!.out, 'ma')).toEqual(['c1', 'a1', 'a2', 'b1']);
  });
});

describe('transform.groupBy (AC-B3-17)', () => {
  const data = table(
    [
      ['chi_nhanh', 'string'],
      ['cong', 'decimal'],
      ['so', 'integer'],
      ['ngay', 'date'],
      ['ten', 'string'],
    ],
    [
      ['CN02', new Big('1'), 3, '2026-01-02', 'b'],
      ['CN01', new Big('10'), 1, '2026-01-05', 'a'],
      ['CN01', new Big('1'), null, null, 'a'],
      ['CN01', new Big('0.3333333333'), 2, '2026-01-01', null],
      [null, null, null, null, 'x'],
      ['CN03', null, null, null, '  '],
    ],
  );
  const aggregations = [
    { key: 's', fn: 'sum', column: 'cong' },
    { key: 'tb', fn: 'avg', column: 'cong', title: 'Trung bình' },
    { key: 'nho', fn: 'min', column: 'ngay' },
    { key: 'lon', fn: 'max', column: 'so' },
    { key: 'dem', fn: 'count', column: 'so' },
    { key: 'kd', fn: 'countDistinct', column: 'ten' },
    { key: 'dong', fn: 'countRows' },
  ];

  it('by chi_nhanh: all functions, groups in order of first appearance, blank group', async () => {
    const r = await runNode('transform.groupBy', { by: ['chi_nhanh'], aggregations }, { in: data });
    const out = r.out.out!;
    expect(out.columns.map((c) => [c.key, c.type])).toEqual([
      ['chi_nhanh', 'string'],
      ['s', 'decimal'],
      ['tb', 'decimal'],
      ['nho', 'date'],
      ['lon', 'integer'],
      ['dem', 'integer'],
      ['kd', 'integer'],
      ['dong', 'integer'],
    ]);
    expect(rowsOf(out)).toEqual([
      ['CN02', '1', '1', '2026-01-02', 3, 1, 1, 1],
      // avg = 11.3333333333 / 3 = 3.77777777776666… → half-up 10 places.
      ['CN01', '11.3333333333', '3.7777777778', '2026-01-01', 2, 2, 1, 3],
      [null, '0', null, null, null, 0, 1, 1],
      ['CN03', '0', null, null, null, 0, 0, 1],
    ]);
  });

  it('by empty with 0 input rows → exactly 1 row (sum 0, count 0)', async () => {
    const empty: Table = asTable({ columns: data.columns, rows: [] });
    const r = await runNode(
      'transform.groupBy',
      {
        aggregations: [
          { key: 's', fn: 'sum', column: 'so' },
          { key: 'n', fn: 'countRows' },
          { key: 'tb', fn: 'avg', column: 'cong' },
        ],
      },
      { in: empty },
    );
    expect(rowsOf(r.out.out)).toEqual([[0, 0, null]]);
  });

  it('sum on a string column → fnNotForType; duplicate output key; unknown column', async () => {
    const run = (cfg: Record<string, unknown>) => runNode('transform.groupBy', cfg, { in: data });
    await expect(
      run({ aggregations: [{ key: 's', fn: 'sum', column: 'ten' }] }),
    ).rejects.toMatchObject({
      messageKey: 'groupBy.error.fnNotForType',
      params: { path: 'aggregations.0.fn' },
    });
    await expect(
      run({ by: ['ten'], aggregations: [{ key: 'ten', fn: 'countRows' }] }),
    ).rejects.toMatchObject({ messageKey: 'groupBy.error.duplicateKey' });
    await expect(
      run({ by: ['x'], aggregations: [{ key: 'n', fn: 'countRows' }] }),
    ).rejects.toMatchObject({
      messageKey: 'groupBy.error.unknownColumn',
    });
  });
});

describe('transform.dedupe (AC-B3-18)', () => {
  const data = table(
    [
      ['ma', 'string'],
      ['ky', 'string'],
      ['v', 'integer'],
    ],
    [
      ['NV001', 'T1', 1],
      ['nv001 ', 'T1', 2],
      [null, null, 3],
      [null, null, 4],
      ['NV002', null, 5],
      ['NV002', '  ', 6],
      ['NV001', 'T2', 7],
    ],
  );
  const run = (config: Record<string, unknown>) =>
    runWith(
      { src: data },
      [{ id: 'd', type: 'transform.dedupe', config }],
      [{ from: 'src', to: 'd' }],
    );

  it('keep first; removed holds the dropped rows; all-blank keys are never duplicates', async () => {
    const r = await run({ keys: ['ma', 'ky'] });
    expect(ids(r.outputs.d!.out, 'v')).toEqual([1, 3, 4, 5, 7]);
    expect(ids(r.outputs.d!.removed, 'v')).toEqual([2, 6]);
  });

  it('keep last', async () => {
    const r = await run({ keys: ['ma', 'ky'], keep: 'last' });
    expect(ids(r.outputs.d!.out, 'v')).toEqual([2, 3, 4, 6, 7]);
    expect(ids(r.outputs.d!.removed, 'v')).toEqual([1, 5]);
  });

  it('normalizeKeys off → "NV001" and "nv001 " differ', async () => {
    const r = await run({ keys: ['ma', 'ky'], normalizeKeys: false });
    expect(ids(r.outputs.d!.out, 'v')).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it('unknown key → dedupe.error.unknownColumn', async () => {
    await expect(run({ keys: ['x'] })).rejects.toMatchObject({
      messageKey: 'dedupe.error.unknownColumn',
      nodeId: 'd',
    });
  });
});
