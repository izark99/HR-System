import { EngineError } from '../core/types';
import { DuckDbError, TOKEN } from './base';
import type { DuckDb } from './db';

/**
 * Static check of an Admin `code.sql` statement (spec §9.2, §12.1.8) using DuckDB's own
 * tokenizer (not regexes over the raw text: strings, quoted identifiers and comments are already
 * told apart). The second layer is DuckDB's locked configuration (`enable_external_access =
 * false`, no extension loading, §13.1).
 *
 * - exactly one statement, which must be a SELECT (`SELECT`, `WITH … SELECT`, `FROM …`,
 *   `VALUES`, or a parenthesized query);
 * - `COPY`, `ATTACH`, `INSTALL`, `LOAD`, `EXPORT`, `PRAGMA`, `SET`, … anywhere → forbidden;
 *   DDL/DML keywords anywhere → not a SELECT;
 * - file/URL readers (`read_csv`, `read_parquet`, `read_json`, `glob`, …), dynamic SQL
 *   (`query`, `query_table`) and `FROM 'file'` → forbidden;
 * - `$name` must be a declared flow param; positional `?` / `$1` are not allowed. `$name` is
 *   rewritten to `$1…$n` so the values can be bound positionally (values are never inlined).
 *
 * Limitation: an unquoted column named like one of those keywords (e.g. `load`) must be quoted.
 */

const FORBIDDEN_KEYWORDS = new Set([
  'COPY',
  'ATTACH',
  'DETACH',
  'INSTALL',
  'LOAD',
  'EXPORT',
  'IMPORT',
  'PRAGMA',
  'SET',
  'RESET',
  'CALL',
  'USE',
  'CHECKPOINT',
  'VACUUM',
  'FORCE',
]);
const DML_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'MERGE',
]);
const SELECT_STARTS = new Set(['SELECT', 'WITH', 'FROM', 'VALUES']);
/** Clause keywords that end (or start) a FROM list. */
const CLAUSES = new Set([
  'SELECT',
  'FROM',
  'JOIN',
  'WHERE',
  'GROUP',
  'HAVING',
  'QUALIFY',
  'WINDOW',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'UNION',
  'EXCEPT',
  'INTERSECT',
  'ON',
  'USING',
]);
const FORBIDDEN_FUNCTIONS = new Set(['glob', 'query', 'query_table', 'getenv']);
const FORBIDDEN_FUNCTION_PREFIXES = ['read_', 'parquet_', 'iceberg_', 'delta_', 'sniff_'];

export const MAX_SQL_MESSAGE = 500;

export interface GuardedSql {
  /** The statement with `$name` → `$k` and without a trailing `;`. */
  sql: string;
  /** Param key of `$1`, `$2`, … */
  params: string[];
  /** ORDER BY at the outermost level (otherwise the Designer reminds the Admin). */
  hasOrderBy: boolean;
}

interface Token {
  type: number;
  start: number;
  /** Token text (comments/whitespace before the next token removed). */
  text: string;
}

function tokens(db: DuckDb, sql: string): Token[] {
  let raw;
  try {
    raw = db.tokenize(sql);
  } catch (err) {
    throw sqlError(err);
  }
  return raw.offsets.map((start, i) => {
    const end = raw.offsets[i + 1] ?? sql.length;
    const slice = sql.slice(start, end);
    const type = raw.types[i] ?? TOKEN.operator;
    // The slice runs to the next token, so it may end with whitespace or a comment glued to the
    // token ("query/**/(", "$p--c"): only identifier characters belong to a name.
    let text: string;
    if (type === TOKEN.identifier || type === TOKEN.keyword) {
      text = /^"(?:[^"]|"")*"/.exec(slice)?.[0] ?? /^[\p{L}\p{N}_$]+/u.exec(slice)?.[0] ?? slice;
    } else if (type === TOKEN.operator) {
      text = /^\$\d+/.exec(slice)?.[0] ?? slice.split(/\s|--|\/\*/)[0] ?? slice;
    } else {
      text = slice.trimEnd();
    }
    return { type, start, text };
  });
}

function word(t: Token): string {
  return t.text.startsWith('"') ? t.text.slice(1, -1).replace(/""/g, '"') : t.text;
}

function fail(key: string, params: Record<string, unknown> = {}): never {
  throw new EngineError(key, params);
}

/** DuckDB error of a `code.sql` statement → `sql.error.*` (message shortened, UI only). */
export function sqlError(err: unknown): EngineError {
  if (err instanceof EngineError) return err;
  const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_SQL_MESSAGE);
  if (err instanceof DuckDbError) {
    if (/^Parser Error/i.test(message)) return new EngineError('sql.error.syntax', { message });
    if (/multiple statements/i.test(message))
      return new EngineError('sql.error.multipleStatements');
    if (/^Permission Error/i.test(message)) return new EngineError('sql.error.forbidden', {});
  }
  return new EngineError('sql.error.runtime', { message });
}

export function guardSql(db: DuckDb, sql: string, paramKeys: ReadonlySet<string>): GuardedSql {
  const all = tokens(db, sql);
  const statements: Token[][] = [[]];
  for (const t of all) {
    if (t.type === TOKEN.operator && t.text === ';') statements.push([]);
    else if (t.type !== TOKEN.comment) statements[statements.length - 1]!.push(t);
  }
  const nonEmpty = statements.filter((s) => s.length > 0);
  if (nonEmpty.length > 1) fail('sql.error.multipleStatements');
  const stmt = nonEmpty[0];
  if (!stmt) fail('sql.error.notSelect');

  // Text of the statement: up to the first `;` that follows it (the rest is comments).
  const lastToken = stmt[stmt.length - 1]!;
  const after = all.find((t) => t.start > lastToken.start && t.text === ';');
  let text = sql.slice(0, after ? after.start : sql.length);

  for (const t of stmt) {
    if (t.type !== TOKEN.keyword) continue;
    const k = t.text.toUpperCase();
    if (FORBIDDEN_KEYWORDS.has(k)) fail('sql.error.forbidden', { keyword: k });
  }
  const first = stmt[0]!;
  const startsSelect =
    (first.type === TOKEN.keyword && SELECT_STARTS.has(first.text.toUpperCase())) ||
    (first.type === TOKEN.operator && first.text.startsWith('('));
  if (!startsSelect) fail('sql.error.notSelect');
  for (const t of stmt) {
    if (t.type === TOKEN.keyword && DML_KEYWORDS.has(t.text.toUpperCase())) {
      fail('sql.error.notSelect');
    }
  }

  const replacements: { start: number; end: number; key: string }[] = [];
  let depth = 0;
  let hasOrderBy = false;
  /** Last clause keyword per parenthesis depth (to know when we are in a FROM list). */
  const clause: (string | undefined)[] = [undefined];
  stmt.forEach((t, i) => {
    const next = stmt[i + 1];
    const prev = stmt[i - 1];
    // A string where a table is expected is a file/URL replacement scan (`FROM 'a.csv'`,
    // `FROM x, 'a.csv'`, `JOIN 'a.parquet'`).
    if (t.type === TOKEN.string && prev) {
      const afterFrom =
        prev.type === TOKEN.keyword && ['FROM', 'JOIN'].includes(prev.text.toUpperCase());
      const inFromList =
        prev.type === TOKEN.operator && prev.text === ',' && clause[depth] === 'FROM';
      if (afterFrom || inFromList) fail('sql.error.forbidden', {});
    }
    if (t.type === TOKEN.identifier || t.type === TOKEN.keyword) {
      const name = word(t).toLowerCase();
      if (next?.type === TOKEN.operator && next.text.startsWith('(')) {
        if (
          FORBIDDEN_FUNCTIONS.has(name) ||
          FORBIDDEN_FUNCTION_PREFIXES.some((p) => name.startsWith(p))
        ) {
          fail('sql.error.forbidden', { function: name });
        }
      }
      if (t.type === TOKEN.keyword) {
        const k = t.text.toUpperCase();
        if (CLAUSES.has(k)) clause[depth] = k === 'JOIN' ? 'FROM' : k;
        if (k === 'ORDER' && depth === 0) hasOrderBy = true;
      }
    }
    if (t.type === TOKEN.operator) {
      for (const ch of t.text) {
        if (ch === '(') clause[++depth] = undefined;
        else if (ch === ')') depth = Math.max(0, depth - 1);
      }
      if (t.text === '?' || /^\$\d+$/.test(t.text))
        fail('sql.error.unknownParam', { param: t.text });
      if (t.text === '$') {
        const ident = next && next.start === t.start + 1 ? word(next) : '';
        if (!paramKeys.has(ident)) fail('sql.error.unknownParam', { param: `$${ident}` });
        replacements.push({ start: t.start, end: next!.start + next!.text.length, key: ident });
      }
    }
  });

  const params: string[] = [];
  for (const r of replacements) if (!params.includes(r.key)) params.push(r.key);
  for (const r of [...replacements].reverse()) {
    // Typed as VARCHAR everywhere (spec §9.2), so DESCRIBE at design time (values NULL) and the
    // run (real values) infer the same result types.
    text = `${text.slice(0, r.start)}CAST($${params.indexOf(r.key) + 1} AS VARCHAR)${text.slice(r.end)}`;
  }
  return { sql: text, params, hasOrderBy };
}
