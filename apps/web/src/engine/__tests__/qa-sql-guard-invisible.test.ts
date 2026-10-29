import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardSql } from '../duckdb/sql-guard';
import { nodeDuckDb } from './duckdb-node';
import { runNode, table } from './sql-helpers';

/**
 * QA (R3): invisible / format characters between a forbidden function name and `(`. The guard
 * refuses Unicode spaces (UNICODE_SPACE in sql-guard.ts); format characters that DuckDB's parser
 * ignores must not slip through either. Spec §9.2, AC-B3-20. Characters are built with
 * String.fromCodePoint so the invisible ones are visible in this file.
 */
const luong = table([['ma_nv', 'string']], [['NV001'], ['NV002']]);
const run = (sql: string) => runNode('code.sql', { inputs: [{ port: 'luong' }], sql }, { luong });
const key = (sql: string) =>
  run(sql).then(
    () => 'ok',
    (e: unknown) => (e as { messageKey?: string }).messageKey ?? 'not an engine error',
  );
const ch = (cp: number) => String.fromCodePoint(cp);
const hex = (cp: number) => `U+${cp.toString(16).toUpperCase()}`;

let dir: string;
beforeAll(async () => {
  await nodeDuckDb();
  dir = mkdtempSync(join(tmpdir(), 'hrflow-qa-inv-'));
  writeFileSync(join(dir, 'secret.csv'), 'a\nFAKE-SECRET\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Not executed: refused by the guard, or failed in DuckDB (an unknown function name). */
const notExecuted = (k: string) => k !== 'ok';
const refused = (k: string) => /syntax|forbidden/.test(k);

describe('code.sql guard: format characters before `(`', () => {
  it('not executed: ZWSP, ZWNJ, ZWJ, soft hyphen, LRM, RLM', async () => {
    for (const cp of [0x200b, 0x200c, 0x200d, 0xad, 0x200e, 0x200f]) {
      const k = await key(`SELECT * FROM query${ch(cp)}('SELECT 1 AS a')`);
      expect(notExecuted(k), `${hex(cp)} -> ${k}`).toBe(true);
    }
  });

  it('U+2061..U+2064, U+206A..U+206F, U+FFF9..U+FFFB are not executed as query()', async () => {
    const leaked: string[] = [];
    for (const cp of [0x2061, 0x2062, 0x2063, 0x2064, 0x206a, 0x206f, 0xfff9, 0xfffb]) {
      const k = await key(`SELECT * FROM query${ch(cp)}('SELECT 1 AS a')`);
      if (!notExecuted(k)) leaked.push(`${hex(cp)} -> ${k}`);
    }
    expect(leaked).toEqual([]);
  });

  it('U+2060 between `read_csv` / `glob` and `(` is refused and reads no file', async () => {
    const a = await key(`SELECT * FROM read_csv${ch(0x2060)}('${dir}/secret.csv')`);
    const b = await key(`SELECT * FROM glob${ch(0x2060)}('${dir}/*')`);
    expect([refused(a), refused(b)]).toEqual([true, true]);
    expect(readdirSync(dir)).toEqual(['secret.csv']);
  });

  describe('fixed (was KNOWN BUG)', () => {
    // U+2060 WORD JOINER: DuckDB's parser ignores it, so `query<U+2060>(...)` was the dynamic-SQL
    // function `query`. The guard now refuses every non-letter/mark/digit outside strings.
    it('U+2060 WORD JOINER between `query` and `(` is not executed', async () => {
      const k = await key(`SELECT * FROM query${ch(0x2060)}('SELECT 1 AS a')`);
      expect(notExecuted(k), k).toBe(true);
    });
  });

  it('brute force: no BMP or tag character outside L/M/N passes the guard (call and FROM)', async () => {
    const db = await nodeDuckDb();
    const LMN = /^[\p{L}\p{M}\p{N}]$/u;
    const leaked: string[] = [];
    const points: number[] = [];
    for (let cp = 0x80; cp <= 0xffff; cp++) if (cp < 0xd800 || cp > 0xdfff) points.push(cp);
    for (let cp = 0xe0000; cp <= 0xe007f; cp++) points.push(cp);
    for (const cp of points) {
      const c = ch(cp);
      if (LMN.test(c)) continue; // part of the identifier (`queryé` is not `query`)
      for (const sql of [`SELECT * FROM query${c}('SELECT 1 AS a')`, `SELECT * FROM${c}'a.csv'`]) {
        try {
          guardSql(db, sql, new Set());
          leaked.push(`${hex(cp)}: ${sql.slice(0, 20)}`);
        } catch {
          // refused: expected
        }
      }
    }
    expect(leaked).toEqual([]);
  }, 120_000);
});
