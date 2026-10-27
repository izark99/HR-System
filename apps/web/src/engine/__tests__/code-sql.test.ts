import { CodeSqlConfigSchema, FlowDefinitionSchema } from '@hrflow/flow-schema';
import { describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import type { ColumnDef } from '../core/types';
import { codeSqlPlugin, describeCodeSql } from '../nodes/code-sql';
import { nodeDuckDb } from './duckdb-node';
import { rowsOf, runNode, runWith, t, table } from './sql-helpers';

/** code.sql (spec §9.2, §12.1.8; AC-B3-19..23, AC-B3-26). */

const luong = table(
  [
    ['ma_nv', 'string'],
    ['chi_nhanh', 'string'],
    ['cong', 'decimal'],
    ['_source_file', 'string'],
  ],
  [
    ['NV001', 'CN01', new Big('22'), 'a.xlsx'],
    ['NV002', 'CN02', new Big('20.5'), 'a.xlsx'],
    ['NV003', 'CN01', new Big('21'), 'b.xlsx'],
  ],
);
const chamCong = table(
  [
    ['ma_nv', 'string'],
    ['cong_tt', 'decimal'],
  ],
  [
    ['NV001', new Big('21.5')],
    ['NV003', new Big('21')],
  ],
);
const inputs = [{ port: 'luong' }, { port: 'cham_cong' }];
const paramDefs = [{ key: 'chi_nhanh', label: 'Chi nhánh', type: 'string' as const }];

function run(sql: string, params: Record<string, string | null> = {}) {
  return runNode(
    'code.sql',
    { inputs, sql },
    { luong, cham_cong: chamCong },
    { paramDefs, params },
  );
}

const flow = FlowDefinitionSchema.parse({
  schemaVersion: 1,
  params: paramDefs,
  nodes: [{ id: 'n', type: 'code.sql', config: { inputs, sql: 'SELECT 1 AS a' } }],
});
const schemas: Record<string, ColumnDef[]> = { luong: luong.columns, cham_cong: chamCong.columns };
const design = (sql: string) =>
  describeCodeSql(CodeSqlConfigSchema.parse({ inputs, sql }), schemas, {
    t,
    flow,
    duck: nodeDuckDb,
  });

describe('code.sql: running', () => {
  const joinSql = `SELECT l.ma_nv, l.cong, c.cong_tt, l.cong - c.cong_tt AS lech
FROM luong l JOIN cham_cong c ON l.ma_nv = c.ma_nv
ORDER BY l.ma_nv -- trailing comment`;

  it('AC-B3-19: one view per port; DESCRIBE schema equals the run result', async () => {
    const r = await run(joinSql);
    const out = r.out.out!;
    expect(rowsOf(out)).toEqual([
      ['NV001', '22', '21.5', '0.5'],
      ['NV003', '21', '21', '0'],
    ]);
    const designed = await design(joinSql);
    expect(designed.columns).toEqual(out.columns);
    expect(out.columns.map((c) => [c.key, c.type, c.title])).toEqual([
      ['ma_nv', 'string', 'MA_NV'],
      ['cong', 'decimal', 'CONG'],
      ['cong_tt', 'decimal', 'CONG_TT'],
      ['lech', 'decimal', 'lech'],
    ]);
    expect(designed.warnings).toEqual([]);
  });

  it('views have no __ord; system columns of the inputs may be kept', async () => {
    await expect(run('SELECT __ord FROM luong')).rejects.toMatchObject({
      messageKey: 'sql.error.runtime',
    });
    const r = await run('SELECT _source_file, count(*) AS n FROM luong GROUP BY ALL ORDER BY 1');
    expect(rowsOf(r.out.out)).toEqual([
      ['a.xlsx', 2],
      ['b.xlsx', 1],
    ]);
  });

  it('AC-B3-21: params are bound as values ($chi_nhanh), never spliced into the SQL', async () => {
    const sql = 'SELECT ma_nv FROM luong WHERE chi_nhanh = $chi_nhanh ORDER BY ma_nv';
    expect(rowsOf((await run(sql, { chi_nhanh: 'CN01' })).out.out)).toEqual([['NV001'], ['NV003']]);
    expect((await run(sql, { chi_nhanh: "x' OR 1=1 --" })).out.out!.rows).toHaveLength(0);
    expect((await run(sql, { chi_nhanh: null })).out.out!.rows).toHaveLength(0);
    const twice = 'SELECT $chi_nhanh AS a, $chi_nhanh || $chi_nhanh AS b';
    expect(rowsOf((await run(twice, { chi_nhanh: 'x' })).out.out)).toEqual([['x', 'xx']]);
  });

  it('AC-B3-23: DOUBLE results become decimals (15 significant digits) + a design warning', async () => {
    const sql = 'SELECT cong / 3 AS a, 1.0::DOUBLE / 3 AS b FROM luong WHERE ma_nv = $chi_nhanh';
    const r = await run(sql, { chi_nhanh: 'NV001' });
    expect(r.out.out!.columns.map((c) => c.type)).toEqual(['decimal', 'decimal']);
    expect(rowsOf(r.out.out)).toEqual([['7.3333333333', '0.3333333333']]);
    const d = await design(sql);
    expect(d.warnings).toContainEqual({
      messageKey: 'sql.warning.doubleColumn',
      params: { column: 'b' },
    });
    expect(d.warnings).toContainEqual({ messageKey: 'sql.warning.noOrderBy', params: {} });
  });

  it('integers, dates, timestamps and booleans map to the engine types', async () => {
    const r = await run(
      `SELECT 1::TINYINT AS a, 2::HUGEINT AS b, DATE '2026-09-01' AS c, TIMESTAMP_MS '2026-09-01 10:20:30.5' AS d, true AS e, 'x' AS f`,
    );
    expect(r.out.out!.columns.map((c) => c.type)).toEqual([
      'integer',
      'decimal',
      'date',
      'datetime',
      'boolean',
      'string',
    ]);
    expect(rowsOf(r.out.out)).toEqual([[1, '2', '2026-09-01', '2026-09-01T10:20:30', true, 'x']]);
  });

  it('a downstream node reads the code.sql result', async () => {
    const r = await runWith(
      { luong, cham_cong: chamCong },
      [
        {
          id: 'q',
          type: 'code.sql',
          config: { inputs, sql: 'SELECT ma_nv, chi_nhanh FROM luong' },
        },
        {
          id: 'g',
          type: 'transform.groupBy',
          config: { by: ['chi_nhanh'], aggregations: [{ key: 'n', fn: 'countRows' }] },
        },
      ],
      [
        { from: 'luong', to: 'q', toPort: 'luong' },
        { from: 'cham_cong', to: 'q', toPort: 'cham_cong' },
        { from: 'q', to: 'g' },
      ],
    );
    expect(rowsOf(r.outputs.g!.out)).toEqual([
      ['CN01', 2],
      ['CN02', 1],
    ]);
  });

  it('an input chain with bound params is materialized before becoming a view', async () => {
    const r = await runWith(
      { luong, cham_cong: chamCong },
      [
        {
          id: 'f',
          type: 'transform.filter',
          config: { conditions: [{ column: 'chi_nhanh', op: 'eq', value: 'cn01' }] },
        },
        {
          id: 'q',
          type: 'code.sql',
          config: { inputs: [{ port: 'x' }], sql: 'SELECT count(*) AS n FROM x' },
        },
      ],
      [
        { from: 'luong', to: 'f' },
        { from: 'f', to: 'q', toPort: 'x' },
      ],
    );
    expect(rowsOf(r.outputs.q!.out)).toEqual([[2]]);
  });
});

describe('code.sql: refused statements (AC-B3-20, AC-B3-06)', () => {
  const cases: [string, string][] = [
    ['SELECT 1 AS a; SELECT 2 AS b', 'sql.error.multipleStatements'],
    ['CREATE TABLE t (a INT)', 'sql.error.notSelect'],
    ['INSERT INTO t VALUES (1)', 'sql.error.notSelect'],
    ['WITH x AS (SELECT 1) DELETE FROM t', 'sql.error.notSelect'],
    ["COPY luong TO 'x.csv'", 'sql.error.forbidden'],
    ["ATTACH 'x.db'", 'sql.error.forbidden'],
    ['PRAGMA version', 'sql.error.forbidden'],
    ['SET threads = 4', 'sql.error.forbidden'],
    ['INSTALL httpfs', 'sql.error.forbidden'],
    ['LOAD httpfs', 'sql.error.forbidden'],
    ["SELECT * FROM read_csv('https://example.com/a.csv')", 'sql.error.forbidden'],
    ["SELECT * FROM main.read_parquet('x')", 'sql.error.forbidden'],
    ["SELECT * FROM 'data.csv'", 'sql.error.forbidden'],
    ["SELECT * FROM query('SELECT 1')", 'sql.error.forbidden'],
    ["SELECT * FROM glob('*')", 'sql.error.forbidden'],
    ['SELECT $khong_co AS a', 'sql.error.unknownParam'],
    ['SELECT ? AS a', 'sql.error.unknownParam'],
    ['SELECT $1 AS a', 'sql.error.unknownParam'],
    ['SELECT ma_nv AS "Họ tên" FROM luong', 'sql.error.invalidColumnName'],
    ['SELECT 1 AS _x', 'sql.error.invalidColumnName'],
    ['SELECT 1 AS a, 2 AS a', 'sql.error.duplicateColumn'],
    ['SELECT [1, 2] AS a', 'sql.error.unsupportedType'],
    ["SELECT {'a': 1} AS a", 'sql.error.unsupportedType'],
    ['SELECT now() AS a', 'sql.error.unsupportedType'],
    ['SELECT (1 AS a', 'sql.error.syntax'],
    ['SELEC 1', 'sql.error.notSelect'],
    ['-- only a comment', 'sql.error.notSelect'],
  ];

  it.each(cases)('%s → %s', async (sql, key) => {
    await expect(run(sql)).rejects.toMatchObject({ messageKey: key, nodeId: 'n' });
  });

  it('strings and comments mentioning forbidden words are fine', async () => {
    const r = await run(`SELECT 'COPY; read_csv(x) $p' AS a -- INSTALL httpfs; SET x
/* ATTACH */`);
    expect(rowsOf(r.out.out)).toEqual([['COPY; read_csv(x) $p']]);
  });

  it('AC-B3-22: runtime error → sql.error.runtime with a message ≤ 500 chars (UI only)', async () => {
    const err = await run(`SELECT CAST('abc' AS INTEGER) AS a`).catch((e: unknown) => e);
    expect(err).toMatchObject({ messageKey: 'sql.error.runtime', nodeId: 'n' });
    const message = (err as { params: { message: string } }).params.message;
    expect(message.length).toBeLessThanOrEqual(500);
    expect(message).toContain('Conversion Error');
    expect(t('sql.error.runtime', (err as { params: Record<string, unknown> }).params)).toContain(
      'Conversion Error',
    );
  });

  it('design-time check works without data (DESCRIBE on empty views)', async () => {
    await expect(design('SELECT nope FROM luong')).rejects.toMatchObject({
      messageKey: 'sql.error.runtime',
    });
    const schemasOut = await codeSqlPlugin.inferSchema(
      CodeSqlConfigSchema.parse({ inputs, sql: 'SELECT ma_nv FROM luong ORDER BY 1' }),
      schemas,
      { t, flow, duck: nodeDuckDb },
    );
    expect(schemasOut.out).toEqual([{ key: 'ma_nv', type: 'string', title: 'MA_NV' }]);
  });
});

describe("code.sql with extraColumns 'keep' (AC-B3-26)", () => {
  it('a column only present at run time works when the file has it, else sql.error.runtime', async () => {
    const withExtra = table(
      [
        ['ma_nv', 'string'],
        ['ghi_chu', 'string'],
      ],
      [['NV001', 'x']],
    );
    const sql = 'SELECT ma_nv, ghi_chu FROM t';
    const ok = await runNode('code.sql', { inputs: [{ port: 't' }], sql }, { t: withExtra });
    expect(rowsOf(ok.out.out)).toEqual([['NV001', 'x']]);
    const without = table([['ma_nv', 'string']], [['NV001']]);
    await expect(
      runNode('code.sql', { inputs: [{ port: 't' }], sql }, { t: without }),
    ).rejects.toMatchObject({ messageKey: 'sql.error.runtime', nodeId: 'n' });
  });
});
