import { beforeAll, describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import { normalizeKeyPart } from '../core/keys';
import type { DuckDb } from '../duckdb/db';
import { SqlScope } from '../duckdb/scope';
import { decimalToSql } from '../duckdb/sql';
import { nodeDuckDb } from './duckdb-node';
import { rowsOf, runWith, table } from './sql-helpers';

let db: DuckDb;
beforeAll(async () => {
  db = await nodeDuckDb();
});

describe('DuckDB runtime: locked-down configuration (spec §13.1, AC-B3-06)', () => {
  it('disables external access and extension loading, and locks the configuration', () => {
    expect(db.scalar(`SELECT current_setting('enable_external_access')`)).toBe('false');
    expect(db.scalar(`SELECT current_setting('autoinstall_known_extensions')`)).toBe('false');
    expect(db.scalar(`SELECT current_setting('autoload_known_extensions')`)).toBe('false');
    expect(db.scalar(`SELECT current_setting('lock_configuration')`)).toBe('true');
    expect(() => db.exec('SET enable_external_access = true')).toThrow(/locked/);
  });

  it('cannot read files or URLs even below the code.sql guard', () => {
    expect(() => db.exec(`SELECT * FROM read_csv('https://example.com/a.csv')`)).toThrow(
      /Permission Error/,
    );
    expect(() => db.exec(`COPY (SELECT 1) TO 'x.csv'`)).toThrow(/Permission Error/);
    expect(() => db.exec('LOAD httpfs')).toThrow();
  });

  it('binds prepared values as values', () => {
    const t = db.query('SELECT ?::VARCHAR AS v', ["x' OR 1=1 --"]);
    expect(t.getChild('v')?.get(0)).toBe("x' OR 1=1 --");
  });
});

describe('normalizeKeys: SQL equals normalizeKeyPart (golden, spec §12.1)', () => {
  const golden = [
    'NV001',
    ' nv001',
    'NV001 ',
    '\tNV\t001 ',
    'NV　001',
    'NV 001﻿',
    'NV  001',
    'ĐẶNG VĂN ÂN',
    'Đặng  Văn  Ân',
    'NGUYỄN THỊ HỒNG NHUNG',
    'TRẦN ỨNG Ỷ',
    // Decomposed (NFD) "Hồ" vs precomposed.
    'Hồ',
    'Hồ',
    'İSTANBUL',
    'ẞ',
    '',
    '   ',
    '  ',
    'ABC-123/x',
  ];

  it('matches on every golden case', () => {
    const scope = new SqlScope(db);
    try {
      const rel = scope.upload(
        table(
          [['k', 'string']],
          golden.map((g) => [g]),
        ),
      );
      const out = db.query(`SELECT hrflow_norm_key(k) AS n FROM "${rel.name}" ORDER BY __ord`);
      const sql = Array.from({ length: out.numRows }, (_, i) => String(out.getChild('n')?.get(i)));
      expect(sql).toEqual(golden.map((g) => normalizeKeyPart(g)));
    } finally {
      scope.dispose();
    }
  });

  it('NULL normalizes to the empty string, like normalizeKeyPart(null)', () => {
    expect(db.scalar(`SELECT hrflow_norm_key(NULL::VARCHAR)`)).toBe(normalizeKeyPart(null));
  });

  describe('KNOWN BUG', () => {
    // DuckDB lower() has no context-sensitive Greek final sigma (JS: "ΣΑΣ" → "σας").
    it.fails('Greek final sigma', () => {
      const v = 'ΟΔΟΣ';
      const sql: unknown = db.query('SELECT hrflow_norm_key(?) AS n', [v]).getChild('n')?.get(0);
      expect(sql).toBe(normalizeKeyPart(v));
    });
  });
});

describe('TS ↔ DuckDB value mapping (spec §9.4)', () => {
  it('AC-B3-07: decimals stay exact through select → groupBy sum', async () => {
    const input = table(
      [
        ['nhom', 'string'],
        ['tien', 'decimal'],
      ],
      [
        ['a', new Big('0.1')],
        ['a', new Big('0.2')],
        ['a', new Big('1234567890123.25')],
      ],
    );
    const r = await runWith(
      { src: input },
      [
        {
          id: 'sel',
          type: 'transform.select',
          config: { columns: [{ from: 'nhom' }, { from: 'tien' }] },
        },
        {
          id: 'g',
          type: 'transform.groupBy',
          config: { by: ['nhom'], aggregations: [{ key: 'tong', fn: 'sum', column: 'tien' }] },
        },
      ],
      [
        { from: 'src', to: 'sel' },
        { from: 'sel', to: 'g' },
      ],
    );
    expect(rowsOf(r.outputs.g!.out)).toEqual([['a', '1234567890123.55']]);
    expect(r.outputs.g!.out!.columns.find((c) => c.key === 'tong')?.type).toBe('decimal');
  });

  it('AC-B3-08: "00123" and dates survive a DuckDB chain unchanged', async () => {
    const input = table(
      [
        ['ma', 'string'],
        ['ngay', 'date'],
        ['luc', 'datetime'],
        ['ok', 'boolean'],
        ['so', 'integer'],
      ],
      [
        ['00123', '2026-09-01', '2026-09-01T08:30:15', true, 7],
        [null, null, null, null, null],
      ],
    );
    const r = await runWith(
      { src: input },
      [
        {
          id: 'sel',
          type: 'transform.select',
          config: {
            columns: [
              { from: 'ma' },
              { from: 'ngay' },
              { from: 'luc' },
              { from: 'ok' },
              { from: 'so' },
            ],
          },
        },
        {
          id: 'f',
          type: 'transform.filter',
          config: { conditions: [{ column: 'ma', op: 'notBlank' }] },
        },
      ],
      [
        { from: 'src', to: 'sel' },
        { from: 'sel', to: 'f' },
      ],
    );
    expect(rowsOf(r.outputs.f!.out)).toEqual([
      ['00123', '2026-09-01', '2026-09-01T08:30:15', true, 7],
    ]);
    expect(rowsOf(r.outputs.sel!.out)[1]).toEqual([null, null, null, null, null]);
  });

  it('decimals cross as Decimal128 losslessly (sign, scale, 28 integer digits)', async () => {
    const values = [
      '-0.0000000001',
      '-1234.5',
      '0',
      '0.30000000004',
      '9999999999999999999999999999.9999999999',
      '-9999999999999999999999999999.9999999999',
    ];
    const r = await runWith(
      { src: table([['x', 'decimal']], [...values.map((v) => [new Big(v)]), [null]]) },
      [{ id: 'sel', type: 'transform.select', config: { columns: [{ from: 'x' }] } }],
      [{ from: 'src', to: 'sel' }],
    );
    expect(rowsOf(r.outputs.sel!.out).map((x) => x[0])).toEqual([
      '-1e-10',
      '-1234.5',
      '0',
      '0.3',
      new Big('9999999999999999999999999999.9999999999').toString(),
      new Big('-9999999999999999999999999999.9999999999').toString(),
      null,
    ]);
  });

  it('rounds decimals half-up to 10 places and refuses more than 28 integer digits', () => {
    expect(decimalToSql(new Big('1.000000000050'))).toBe('1.0000000001');
    expect(decimalToSql(new Big('-2.5'))).toBe('-2.5');
    expect(decimalToSql(new Big('1e27'))).toBe('1000000000000000000000000000');
    expect(() => decimalToSql(new Big('1e28'))).toThrow(
      expect.objectContaining({ messageKey: 'duckdb.error.decimalOverflow' }),
    );
  });

  it('a decimal above DECIMAL(38,10) fails with duckdb.error.decimalOverflow on the node', async () => {
    const input = table([['x', 'decimal']], [[new Big('1e30')]]);
    await expect(
      runWith(
        { src: input },
        [{ id: 'sel', type: 'transform.select', config: { columns: [{ from: 'x' }] } }],
        [{ from: 'src', to: 'sel' }],
      ),
    ).rejects.toMatchObject({
      messageKey: 'duckdb.error.decimalOverflow',
      nodeId: 'sel',
      params: { column: 'x' },
    });
  });

  it('an integer SUM outside the safe range comes back as decimal', async () => {
    const input = table([['x', 'integer']], [[Number.MAX_SAFE_INTEGER], [10]]);
    const r = await runWith(
      { src: input },
      [
        {
          id: 'g',
          type: 'transform.groupBy',
          config: { aggregations: [{ key: 's', fn: 'sum', column: 'x' }] },
        },
      ],
      [{ from: 'src', to: 'g' }],
    );
    const out = r.outputs.g!.out!;
    expect(out.columns[0]?.type).toBe('decimal');
    expect(rowsOf(out)).toEqual([['9007199254741001']]);
  });

  it('drops every DuckDB object of the run afterwards', async () => {
    const before = Number(db.scalar('SELECT count(*) FROM duckdb_tables()'));
    await runWith(
      { src: table([['a', 'string']], [['x']]) },
      [{ id: 'sel', type: 'transform.select', config: { columns: [{ from: 'a' }] } }],
      [{ from: 'src', to: 'sel' }],
    );
    expect(Number(db.scalar('SELECT count(*) FROM duckdb_tables()'))).toBe(before);
    expect(Number(db.scalar('SELECT count(*) FROM duckdb_views() WHERE NOT internal'))).toBe(0);
  });
});
