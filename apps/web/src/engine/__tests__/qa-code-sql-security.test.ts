import { CodeSqlConfigSchema, FlowDefinitionSchema } from '@hrflow/flow-schema';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Big } from '../core/decimal';
import type { ColumnDef } from '../core/types';
import type { DuckDb } from '../duckdb/db';
import { describeCodeSql } from '../nodes/code-sql';
import { nodeDuckDb } from './duckdb-node';
import { rowsOf, runNode, t, table } from './sql-helpers';

/**
 * QA: code.sql guard bypass attempts, parameter binding forms and injection, the second defence
 * layer (locked DuckDB configuration) and "nothing printed" on error paths.
 * Spec §9.2, §12.1.8, §13.1; AC-B3-06, AC-B3-20, AC-B3-21, AC-B3-22.
 */

const luong = table(
  [
    ['ma_nv', 'string'],
    ['cong', 'decimal'],
  ],
  [
    ['NV001', new Big('22')],
    ['NV002', new Big('20.5')],
    ["x' OR 1=1 --", new Big('1')],
  ],
);
const inputs = [{ port: 'luong' }];
const paramDefs = [
  { key: 'p', label: 'P', type: 'string' as const },
  { key: 'q', label: 'Q', type: 'string' as const },
];

async function run(sql: string, params: Record<string, string | null> = {}) {
  return runNode('code.sql', { inputs, sql }, { luong }, { paramDefs, params });
}
const key = (sql: string, params: Record<string, string | null> = {}) =>
  run(sql, params).then(
    () => 'ok',
    (e: unknown) => (e as { messageKey?: string }).messageKey ?? 'not an engine error',
  );

let dir: string;
let db: DuckDb;
beforeAll(async () => {
  db = await nodeDuckDb();
  dir = mkdtempSync(join(tmpdir(), 'hrflow-qa-sql-'));
  writeFileSync(join(dir, 'secret.csv'), 'a,b\nFAKE-SECRET-VALUE,2\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('code.sql guard: statements that must be refused (AC-B3-20, AC-B3-06)', () => {
  const files = () => readdirSync(dir).sort();

  // Each statement must be refused with a sql.error.* key; none may create or read a file.
  const attempts = (d: string): [string, RegExp][] => [
    // multiple statements, however the separator is hidden
    ['SELECT 1 AS a; DROP TABLE luong', /^sql\.error\.multipleStatements$/],
    ["SELECT 1 AS a;/*x*/COPY (SELECT 1) TO '" + d + "/o.csv'", /multipleStatements/],
    ["SELECT 'a;' AS a; ATTACH '" + d + "/x.db'", /multipleStatements/],
    ["SELECT $$a$$ AS a; COPY (SELECT 1) TO '" + d + "/o.csv'", /multipleStatements/],
    ["SELECT 1 AS a -- ;\n; ATTACH '" + d + "/x.db'", /multipleStatements/],
    // write / config statements
    ["COPY (SELECT 1) TO '" + d + "/o.csv'", /forbidden/],
    ["copy luong to '" + d + "/o.csv'", /forbidden/],
    ["ATTACH '" + d + "/x.db'", /forbidden/],
    ["EXPORT DATABASE '" + d + "/exp'", /forbidden/],
    ['INSTALL httpfs', /forbidden/],
    ['LOAD httpfs', /forbidden/],
    ['FORCE INSTALL httpfs', /forbidden/],
    ['PRAGMA enable_external_access=true', /forbidden/],
    ['SET enable_external_access = true', /forbidden/],
    ['RESET enable_external_access', /forbidden/],
    ['CALL pragma_version()', /forbidden/],
    ['USE memory', /forbidden/],
    ['CHECKPOINT', /forbidden/],
    ['CREATE TABLE t AS SELECT 1', /notSelect/],
    ['CREATE OR REPLACE VIEW luong AS SELECT 1', /notSelect/],
    ['DROP VIEW luong', /notSelect/],
    ['DELETE FROM luong', /notSelect/],
    ['UPDATE luong SET cong = 0', /notSelect|forbidden/],
    ['INSERT INTO luong VALUES (1, 2)', /notSelect/],
    ['TRUNCATE luong', /notSelect/],
    ['ALTER TABLE luong ADD COLUMN x INT', /notSelect/],
    ['EXPLAIN SELECT 1', /notSelect/],
    ['DESCRIBE luong', /notSelect/],
    ['SHOW TABLES', /notSelect/],
    ['TABLE luong', /notSelect/],
    ['BEGIN', /notSelect/],
    ['   \n\t ', /notSelect/],
    ['/* nothing */', /notSelect/],
    // parenthesized / nested forms
    ["(COPY luong TO '" + d + "/o.csv')", /forbidden/],
    ['(CREATE TABLE t AS SELECT 1)', /notSelect/],
    ['SELECT * FROM (SET x = 1)', /forbidden|syntax/],
    // file / URL readers, in every spelling
    ["SELECT * FROM read_csv('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM READ_CSV_AUTO('" + d + "/secret.csv')", /forbidden/],
    ['SELECT * FROM "read_csv"(\'' + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM main.read_csv('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM system.main.read_text('" + d + "/secret.csv')", /forbidden/],
    ["SELECT content FROM read_text('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM read_blob('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM read_json('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM read_ndjson_auto('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM parquet_scan('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM parquet_metadata('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM sniff_csv('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM glob('" + d + "/*')", /forbidden/],
    ["SELECT * FROM read_csv('https://example.com/a.csv')", /forbidden/],
    ["SELECT * FROM read_parquet('s3://bucket/x.parquet')", /forbidden/],
    ["SELECT * FROM 'https://example.com/a.csv'", /forbidden/],
    ["SELECT * FROM '" + d + "/secret.csv'", /forbidden/],
    ['SELECT * FROM "' + d + '/secret.csv"', /forbidden/],
    ["SELECT * FROM luong, '" + d + "/secret.csv'", /forbidden/],
    ["SELECT * FROM luong JOIN '" + d + "/secret.csv' ON true", /forbidden/],
    ["SELECT * FROM luong CROSS JOIN '" + d + "/secret.csv'", /forbidden/],
    ["SELECT * FROM (SELECT * FROM '" + d + "/secret.csv')", /forbidden/],
    ["SELECT (SELECT a FROM '" + d + "/secret.csv' LIMIT 1) AS x", /forbidden/],
    ["WITH s AS (SELECT * FROM '" + d + "/secret.csv') SELECT * FROM s", /forbidden/],
    ["SELECT * FROM luong WHERE ma_nv IN (SELECT a FROM '" + d + "/secret.csv')", /forbidden/],
    // inline comment glued to a keyword / function name
    ["SELECT * FROM/**/'" + d + "/secret.csv'", /forbidden/],
    ["SELECT * FROM luong JOIN/**/'" + d + "/secret.csv' ON true", /forbidden/],
    ["SELECT * FROM read_csv/**/('" + d + "/secret.csv')", /forbidden/],
    ["SELECT * FROM glob/**/('" + d + "/*')", /forbidden/],
    ["SELECT getenv/**/('HOME') AS a", /forbidden|runtime/],
    // other extensions' scanners are not in the (locked) catalog
    ["SELECT * FROM sqlite_scan('x', 'y')", /forbidden|runtime/],
    ["SELECT * FROM postgres_scan('x', 'y', 'z')", /forbidden|runtime/],
  ];

  it('refuses every attempt with a sql.error.* key and leaves the file system untouched', async () => {
    const before = files();
    const failures: string[] = [];
    for (const [sql, expected] of attempts(dir)) {
      const k = await key(sql);
      if (!expected.test(k)) failures.push(`${sql.replaceAll(dir, '<dir>')} → ${k}`);
    }
    expect(failures).toEqual([]);
    expect(files()).toEqual(before);
    // the lockdown is still in place afterwards
    expect(db.scalar(`SELECT current_setting('enable_external_access')`)).toBe('false');
    expect(db.scalar(`SELECT current_setting('lock_configuration')`)).toBe('true');
  });

  it('never leaks file content into an error (UI) message either', async () => {
    const sqls = [
      `SELECT * FROM '${dir}/secret.csv'`,
      `SELECT * FROM luong, '${dir}/secret.csv'`,
      `SELECT * FROM read_csv('${dir}/secret.csv')`,
    ];
    for (const sql of sqls) {
      const err = await run(sql).catch((e: unknown) => e);
      expect(JSON.stringify(err, Object.getOwnPropertyNames(err as object))).not.toContain(
        'FAKE-SECRET-VALUE',
      );
    }
  });

  it('keywords inside strings, quoted identifiers, comments and dollar quotes are fine', async () => {
    const r = await run(`SELECT 'COPY; ATTACH x' AS "a" -- INSTALL x
, $$ SET x; read_csv('x') $$ AS b /* PRAGMA */, $tag$ DROP; $tag$ AS c`);
    expect(rowsOf(r.out.out)).toEqual([['COPY; ATTACH x', " SET x; read_csv('x') ", ' DROP; ']]);
  });

  it('accepts the SELECT forms the spec lists', async () => {
    for (const sql of [
      'SELECT 1 AS a',
      'WITH x AS (SELECT 1 AS a) SELECT a FROM x',
      'FROM luong SELECT ma_nv',
      'FROM luong',
      'VALUES (1), (2)',
      '(SELECT 1 AS a)',
      'SELECT 1 AS a;',
      'SELECT 1 AS a; -- trailing',
      'SELECT 1 AS a -- no newline at the end',
      'SELECT 1 AS a UNION ALL SELECT 2',
      'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 3) SELECT n FROM r',
    ]) {
      expect(await key(sql), sql).toBe('ok');
    }
  });

  it('keeps the order of an outer ORDER BY (row_number() OVER () wrapper)', async () => {
    const big = table(
      [['n', 'integer']],
      Array.from({ length: 6000 }, (_, i) => [(i * 7919) % 6000]),
    );
    const r = await runNode(
      'code.sql',
      { inputs: [{ port: 'luong' }], sql: 'SELECT n FROM luong ORDER BY n DESC' },
      { luong: big },
    );
    const values = rowsOf(r.out.out).map((x) => x[0] as number);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(values).toHaveLength(6000);
  });

  describe('KNOWN BUG', () => {
    // The guard reads the word under the cursor with a regex over the token's slice; a comment
    // glued to the name ("query/**/(") makes the exact-name blocklist miss it (prefix lists such
    // as "read_" still hit by accident).
    it.fails('query/**/(...) and query_table/**/(...) are refused like query(...)', async () => {
      expect(await key("SELECT * FROM query/**/('SELECT 1 AS a')")).toMatch(/forbidden/);
      expect(await key("SELECT * FROM query_table/**/('luong')")).toMatch(/forbidden/);
    });
  });
});

describe('code.sql parameters: binding forms and injection (AC-B3-21)', () => {
  const INJECTIONS = [
    "x' OR 1=1 --",
    "NV001'; DROP TABLE luong; --",
    "'; COPY (SELECT 1) TO '/tmp/hrflow-qa-pwned'; --",
    '" OR ""="',
    '$$ ; DROP TABLE luong; $$',
    '$q',
    '$1',
    '?',
    '\\',
    "\\'; --",
    '%',
    '_',
    'NV001\u0000',
    'Đặng Văn',
    '/* c */',
    '-- c',
  ];

  it('bound verbatim: nothing is spliced, nothing executes', async () => {
    for (const v of INJECTIONS) {
      const echo = await run('SELECT $p AS a', { p: v });
      expect(rowsOf(echo.out.out), JSON.stringify(v)).toEqual([[v]]);
      const filtered = await run('SELECT ma_nv FROM luong WHERE ma_nv = $p', { p: v });
      // only the row whose value *is* the injection string matches (it is stored verbatim)
      const expected = rowsOf(luong)
        .filter((r) => r[0] === v)
        .map((r) => [r[0]]);
      expect(rowsOf(filtered.out.out), JSON.stringify(v)).toEqual(expected);
    }
    // the table still exists and the injected COPY never ran
    expect(existsSync('/tmp/hrflow-qa-pwned')).toBe(false);
    expect(rowsOf((await run('SELECT count(*) AS n FROM luong')).out.out)).toEqual([[3]]);
  });

  it('accepts `x=$p` without spaces, `$p)`, `$p;`, `$p,`, operators around a param', async () => {
    const forms = [
      'SELECT ma_nv FROM luong WHERE ma_nv=$p',
      'SELECT ma_nv FROM luong WHERE ma_nv=$p;',
      'SELECT ma_nv FROM luong WHERE (ma_nv=$p)',
      'SELECT ma_nv FROM luong WHERE ma_nv IN ($p,$q)',
      'SELECT ma_nv FROM luong WHERE ma_nv=$p OR ma_nv=$q',
      'SELECT ma_nv FROM luong WHERE ma_nv=$p -- trailing comment',
      'SELECT ma_nv FROM luong WHERE ma_nv=$p\n-- trailing comment',
      'SELECT ma_nv FROM luong WHERE ma_nv=$p /* c */',
      'SELECT ma_nv FROM luong WHERE ma_nv=$p ORDER BY 1',
      'SELECT ma_nv FROM luong WHERE ma_nv=CAST($p AS VARCHAR)',
      'SELECT ma_nv FROM luong WHERE ma_nv=$p::VARCHAR',
      "SELECT ma_nv FROM luong WHERE ma_nv=$p||''",
      "SELECT ma_nv FROM luong WHERE ma_nv=concat($p,'')",
    ];
    for (const sql of forms) {
      const r = await run(sql, { p: 'NV001', q: 'NV002' });
      expect(rowsOf(r.out.out)[0], sql).toEqual(['NV001']);
    }
  });

  it('the same param many times, in a CTE and a sub-select; params in any order', async () => {
    const r = await run(
      `WITH a AS (SELECT $q AS x, $p AS y) SELECT x || y || $p AS z, (SELECT $q) AS w FROM a`,
      { p: 'P', q: 'Q' },
    );
    expect(rowsOf(r.out.out)).toEqual([['QPP', 'Q']]);
  });

  it('params are not expanded inside strings, comments, dollar quotes or quoted identifiers', async () => {
    const r = await run(
      `SELECT '$p' AS a, $$ $p $$ AS b /* $p */, 1 AS "$p" -- $p`.replace('"$p"', 'c'),
      {
        p: 'ZZ',
      },
    );
    expect(rowsOf(r.out.out)).toEqual([['$p', ' $p ', 1]]);
  });

  it('a blank / missing param is NULL, typed as VARCHAR', async () => {
    for (const p of [null, '']) {
      const r = await run('SELECT $p IS NULL AS a, typeof($p) AS ty', { p });
      expect(rowsOf(r.out.out)).toEqual([[true, 'VARCHAR']]);
    }
  });

  it('an undeclared param, `?` and `$1` are refused at run time and design time', async () => {
    for (const sql of ['SELECT $nope AS a', 'SELECT ? AS a', 'SELECT $1 AS a', 'SELECT $P AS a']) {
      expect(await key(sql), sql).toBe('sql.error.unknownParam');
    }
  });

  describe('KNOWN BUG', () => {
    // `$p` immediately followed by a comment is read as a param named "p/*c*/".
    it.fails('a param directly followed by a comment is still the param', async () => {
      expect(await key('SELECT ma_nv FROM luong WHERE ma_nv=$p--c', { p: 'NV001' })).toBe('ok');
      expect(await key('SELECT $p/*c*/ AS a', { p: 'NV001' })).toBe('ok');
    });
  });
});

describe('code.sql design-time schema (DESCRIBE) vs run (AC-B3-19)', () => {
  const flow = FlowDefinitionSchema.parse({
    schemaVersion: 1,
    params: paramDefs,
    nodes: [{ id: 'n', type: 'code.sql', config: { inputs, sql: 'SELECT 1 AS a' } }],
  });
  const schemas: Record<string, ColumnDef[]> = { luong: luong.columns };
  const design = (sql: string) =>
    describeCodeSql(CodeSqlConfigSchema.parse({ inputs, sql }), schemas, {
      t,
      flow,
      duck: nodeDuckDb,
    });

  it('types agree for the common statements', async () => {
    for (const sql of [
      'SELECT ma_nv, cong, cong * 2 AS gap_doi FROM luong ORDER BY ma_nv',
      'SELECT ma_nv, sum(cong) AS tong FROM luong GROUP BY ma_nv',
      'SELECT count(*) AS n FROM luong',
      'SELECT ma_nv FROM luong WHERE ma_nv = $p',
      'SELECT $p AS a',
      "SELECT CAST($p || '-01' AS DATE) AS d",
      'SELECT cong / 3 AS x FROM luong',
    ]) {
      const designed = await design(sql);
      const ran = await run(sql, { p: '2026-09' });
      expect(
        designed.columns.map((c) => [c.key, c.type]),
        sql,
      ).toEqual(ran.out.out!.columns.map((c) => [c.key, c.type]));
    }
  });

  describe('KNOWN BUG', () => {
    // Design time binds every param as an untyped NULL, DuckDB then types `$p || 'x'` as
    // INTEGER; at run time the bound VARCHAR makes it VARCHAR.
    it.fails('a param used in an expression keeps its VARCHAR type at design time', async () => {
      const sql = "SELECT $p || 'x' AS a";
      const designed = await design(sql);
      const ran = await run(sql, { p: 'v' });
      expect(designed.columns.map((c) => c.type)).toEqual(ran.out.out!.columns.map((c) => c.type));
    });
  });
});

describe('code.sql result types (spec §9.4)', () => {
  it('DOUBLE → decimal with 15 significant digits; HUGEINT/DECIMAL(p,s) → decimal', async () => {
    const r = await run(
      `SELECT 1.0/3 AS a, 0.1 + 0.2 AS b, 1e-20::DOUBLE AS c, 12345678901234567890::UBIGINT AS d,
              CAST(1.25 AS DECIMAL(4,2)) AS e, (2::HUGEINT * 5) AS f, 123456789012.123456789::DOUBLE AS g`,
    );
    expect(rowsOf(r.out.out)).toEqual([
      ['0.3333333333', '0.3', '0', '12345678901234567890', '1.25', '10', '123456789012.123'],
    ]);
  });

  it('SUM of integers is not truncated to a double', async () => {
    const big = table([['n', 'integer']], [[9007199254740991], [9007199254740991], [1]]);
    const r = await runNode(
      'code.sql',
      { inputs: [{ port: 'luong' }], sql: 'SELECT sum(n) AS s FROM luong' },
      { luong: big },
    );
    expect(rowsOf(r.out.out)).toEqual([['18014398509481983']]);
  });

  it('unsupported types and invalid column names carry the column', async () => {
    const e1 = await run('SELECT [1,2] AS l').catch((e: unknown) => e);
    expect(e1).toMatchObject({ messageKey: 'sql.error.unsupportedType', params: { column: 'l' } });
    for (const sql of [
      'SELECT 1 AS "Họ tên"',
      'SELECT 1 AS Total',
      'SELECT 1',
      'SELECT 1 AS "a b"',
    ]) {
      expect(await key(sql), sql).toBe('sql.error.invalidColumnName');
    }
  });

  describe('KNOWN BUG', () => {
    // Spec §9.4: beyond DECIMAL(38,10) → duckdb.error.decimalOverflow with node and column.
    it.fails(
      'a value that does not fit DECIMAL(38,10) is duckdb.error.decimalOverflow',
      async () => {
        expect(await key('SELECT 99999999999999999999999999999::HUGEINT AS a')).toBe(
          'duckdb.error.decimalOverflow',
        );
      },
    );
  });
});

describe('locked DuckDB below the guard (second layer, AC-B3-06)', () => {
  const attempts = (d: string) => [
    'SET enable_external_access = true',
    'SET GLOBAL enable_external_access = true',
    'SET lock_configuration = false',
    'SET autoinstall_known_extensions = true',
    'SET autoload_known_extensions = true',
    'RESET enable_external_access',
    'PRAGMA enable_external_access = true',
    "SET allowed_directories = ['/']",
    "SET file_search_path = '/'",
    'LOAD httpfs',
    'LOAD icu',
    "COPY (SELECT 1) TO '" + d + "/o.csv'",
    "COPY (SELECT 1) TO '" + d + "/o.parquet' (FORMAT PARQUET)",
    "ATTACH '" + d + "/x.db'",
    "ATTACH '" + d + "/x.db' (TYPE sqlite)",
    "EXPORT DATABASE '" + d + "/exp'",
    "SELECT * FROM read_csv('" + d + "/secret.csv')",
    "SELECT * FROM read_text('" + d + "/secret.csv')",
    "SELECT * FROM glob('" + d + "/*')",
    "SELECT * FROM '" + d + "/secret.csv'",
    "SELECT * FROM read_csv('https://example.com/a.csv')",
    "SELECT * FROM read_parquet('http://example.com/a.parquet')",
    "SELECT * FROM read_json('s3://bucket/a.json')",
    "CREATE SECRET s (TYPE s3, KEY_ID 'x', SECRET 'y')",
  ];

  it('every statement fails and nothing is written', () => {
    const before = readdirSync(dir).sort();
    const ok: string[] = [];
    for (const sql of attempts(dir)) {
      try {
        db.exec(sql);
        ok.push(sql.replaceAll(dir, '<dir>'));
      } catch {
        // expected
      }
    }
    expect(ok).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(db.scalar(`SELECT current_setting('enable_external_access')`)).toBe('false');
  });

  it('INSTALL is a silent no-op in DuckDB-WASM: nothing installed, no network', () => {
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((u) => {
      calls.push(typeof u === 'string' ? u : u instanceof URL ? u.href : u.url);
      return Promise.reject(new Error('blocked by test'));
    });
    try {
      for (const sql of [
        'INSTALL httpfs',
        "INSTALL httpfs FROM 'http://example.com'",
        'INSTALL json',
      ]) {
        try {
          db.exec(sql);
        } catch {
          // an error is fine as well
        }
      }
    } finally {
      fetchSpy.mockRestore();
    }
    expect(calls).toEqual([]);
    expect(
      db.scalar(
        `SELECT count(*) FROM duckdb_extensions() WHERE extension_name IN ('httpfs','json') AND (installed OR loaded)`,
      ),
    ).toBe('0');
    expect(() => db.exec('LOAD httpfs')).toThrow(/Permission Error/);
  });

  it('the engine macros and views of the run cannot be redefined from code.sql', async () => {
    expect(await key('CREATE OR REPLACE MACRO hrflow_norm_key(x) AS x')).toBe(
      'sql.error.notSelect',
    );
    // and the real macro still normalizes
    expect(db.scalar(`SELECT hrflow_norm_key('  A  ')`)).toBe('a');
  });
});

describe('nothing is printed on error paths (data-privacy.md)', () => {
  const SECRET = 'NV-SECRET-4242';
  const secretTable = table(
    [
      ['ma_nv', 'string'],
      ['gia_tri', 'string'],
      ['tien', 'decimal'],
    ],
    [
      [SECRET, `${SECRET}-text`, new Big('1')],
      ['NV002', 'abc', new Big('99999999999999999999999999999')],
    ],
  );
  const spies = () => {
    const out: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
    const restores = methods.map((m) =>
      vi
        .spyOn(console, m)
        .mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(' '))),
    );
    const w1 = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((c: unknown) => (out.push(String(c)), true));
    const w2 = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((c: unknown) => (out.push(String(c)), true));
    return { out, restore: () => [...restores, w1, w2].forEach((s) => s.mockRestore()) };
  };

  it('runtime, conversion, overflow and syntax errors never reach console/stdout/stderr', async () => {
    const s = spies();
    const errors: unknown[] = [];
    try {
      const attempts: [string, Record<string, unknown>, Record<string, unknown>][] = [
        [
          'code.sql',
          { inputs: [{ port: 'luong' }], sql: 'SELECT CAST(gia_tri AS INTEGER) AS x FROM luong' },
          {},
        ],
        [
          'code.sql',
          { inputs: [{ port: 'luong' }], sql: 'SELECT CAST(ma_nv AS DATE) AS x FROM luong' },
          {},
        ],
        ['code.sql', { inputs: [{ port: 'luong' }], sql: 'SELECT ma_nv, FROM luong' }, {}],
        ['code.sql', { inputs: [{ port: 'luong' }], sql: 'SELECT nope FROM luong' }, {}],
        [
          'transform.groupBy',
          { by: [], aggregations: [{ key: 's', fn: 'sum', column: 'tien' }] },
          {},
        ],
        ['transform.filter', { conditions: [{ column: 'tien', op: 'gt', value: 'abc' }] }, {}],
      ];
      for (const [type, config] of attempts) {
        const port = type === 'code.sql' ? 'luong' : 'in';
        errors.push(await runNode(type, config, { [port]: secretTable }).catch((e: unknown) => e));
      }
    } finally {
      s.restore();
    }
    expect(errors.every((e) => e instanceof Error)).toBe(true);
    expect(s.out.join('\n')).not.toContain(SECRET);
    expect(s.out.join('\n')).not.toMatch(/Conversion Error|Could not convert/);
  });

  it('built-in nodes never put DuckDB text (which can quote cells) into the error', async () => {
    const e = await runNode(
      'transform.groupBy',
      { by: [], aggregations: [{ key: 's', fn: 'sum', column: 'tien' }] },
      { in: secretTable },
    ).catch((x: unknown) => x);
    const json = JSON.stringify(e, Object.getOwnPropertyNames(e));
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('99999999999999999999999999999');
  });
});
