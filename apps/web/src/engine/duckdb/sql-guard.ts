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
  /** What follows the token up to the next token, comments removed (whitespace kept). */
  rest: string;
}

/**
 * Allowlist outside strings, quoted identifiers and comments: ASCII, letters, combining marks and
 * digits only. DuckDB's tokenizer keeps other characters (NBSP, U+3000, the invisible U+2060
 * WORD JOINER, tag characters…) inside an identifier while its parser ignores or skips them, so
 * `query\u2060(…)` would not be seen as a call by the checks below. Refusing everything else is
 * robust against characters added to that list in future versions.
 */
// eslint-disable-next-line no-control-regex -- the ASCII range is allowed as a whole
const NOT_ALLOWED = /[^\x00-\x7F\p{L}\p{M}\p{N}]/u;
const COMMENTS = /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;

/** End (exclusive, within `slice`) of the string literal a string token starts with. */
function stringEnd(slice: string): number {
  const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(slice);
  if (dollar) {
    const close = slice.indexOf(dollar[0], dollar[0].length);
    return close < 0 ? slice.length : close + dollar[0].length;
  }
  const quote = slice.indexOf("'");
  if (quote < 0) return slice.length;
  const escapes = /^[eE]/.test(slice);
  for (let i = quote + 1; i < slice.length; i++) {
    const ch = slice[i];
    if (escapes && ch === '\\') i++;
    else if (ch === "'") {
      if (slice[i + 1] === "'") i++;
      else return i + 1;
    }
  }
  return slice.length;
}

/** Length of the comment a comment token starts with. */
function commentEnd(slice: string): number {
  if (slice.startsWith('--')) {
    const nl = slice.indexOf('\n');
    return nl < 0 ? slice.length : nl + 1;
  }
  const close = slice.indexOf('*/', 2);
  return close < 0 ? slice.length : close + 2;
}

function tokens(db: DuckDb, sql: string): Token[] {
  let raw;
  try {
    raw = db.tokenize(sql);
  } catch (err) {
    throw sqlError(err);
  }
  // DuckDB reports UTF-8 byte offsets; any non-ASCII character before a token (Vietnamese text
  // in a string, NBSP) would shift every later slice if used as string indices.
  const index = byteToIndex(sql);
  const starts = raw.offsets.map((b) => index(b));
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? sql.length;
    const slice = sql.slice(start, end);
    const type = raw.types[i] ?? TOKEN.operator;
    // The slice runs to the next token, so it may end with whitespace or a comment glued to the
    // token ("query/**/(", "$p--c"): only identifier characters belong to a name.
    let text: string;
    /** Length of the token itself in `slice` (strings, quoted names and comments are skipped). */
    let body: number;
    if (type === TOKEN.identifier || type === TOKEN.keyword) {
      const quoted = /^"(?:[^"]|"")*"/.exec(slice)?.[0];
      text = quoted ?? /^[\p{L}\p{N}_$]+/u.exec(slice)?.[0] ?? slice;
      body = quoted ? quoted.length : 0;
    } else if (type === TOKEN.operator) {
      text = /^\$\d+/.exec(slice)?.[0] ?? slice.split(/\s|--|\/\*/)[0] ?? slice;
      body = 0;
    } else if (type === TOKEN.string) {
      body = stringEnd(slice);
      text = slice.slice(0, body);
    } else if (type === TOKEN.comment) {
      body = commentEnd(slice);
      text = slice.slice(0, body);
    } else {
      text = slice.trimEnd();
      body = 0;
    }
    const code = slice.slice(body).replace(COMMENTS, ' ');
    const space = NOT_ALLOWED.exec(code);
    if (space) {
      const point = space[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
      fail('sql.error.syntax', { message: `U+${point}` });
    }
    const rest = slice.slice(Math.max(body, text.length)).replace(COMMENTS, ' ');
    return { type, start, text, rest };
  });
}

/** UTF-8 byte offset → index in the JS (UTF-16) string. */
function byteToIndex(sql: string): (byte: number) => number {
  const bytes: number[] = [];
  const indices: number[] = [];
  let b = 0;
  for (let i = 0; i < sql.length;) {
    const cp = sql.codePointAt(i)!;
    bytes.push(b);
    indices.push(i);
    b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return (byte) => {
    if (byte >= b) return sql.length;
    let lo = 0;
    let hi = bytes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bytes[mid]! <= byte) lo = mid;
      else hi = mid - 1;
    }
    return indices[lo]!;
  };
}

/** A name directly followed by `(` (possibly across whitespace or comments): a function call. */
function isCall(t: Token, next: Token | undefined): boolean {
  if (/^\s*\(/.test(t.rest)) return true;
  return next?.type === TOKEN.operator && next.text.startsWith('(') && t.rest.trim() === '';
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
    // Same for a quoted name that looks like a path or URL (`FROM "a.csv"`, `JOIN "s3://x"`).
    if (t.type === TOKEN.identifier && t.text.startsWith('"') && prev && /[./:]/.test(word(t))) {
      const afterFrom =
        prev.type === TOKEN.keyword && ['FROM', 'JOIN'].includes(prev.text.toUpperCase());
      const inFromList =
        prev.type === TOKEN.operator && prev.text === ',' && clause[depth] === 'FROM';
      if (afterFrom || inFromList) fail('sql.error.forbidden', {});
    }
    if (t.type === TOKEN.identifier || t.type === TOKEN.keyword) {
      const name = word(t).toLowerCase();
      if (isCall(t, next)) {
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
