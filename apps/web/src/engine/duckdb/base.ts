import type { DuckDb } from './db';

/**
 * DuckDB runtime constants and types without the Arrow-based runtime itself, so engine code can
 * use them without pulling DuckDB/Arrow into the worker's entry chunk (they load lazily).
 */

/** Value bound to a prepared statement. Every runtime value is bound as VARCHAR (or NULL). */
export type SqlParam = string | null;

/** Error raised by DuckDB. `message` may quote data: only ever shown on the local UI. */
export class DuckDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuckDbError';
  }
}

/** DuckDB tokenizer token types (`TokenType` of duckdb-wasm, a runtime enum we avoid importing). */
export const TOKEN = {
  identifier: 0,
  numeric: 1,
  string: 2,
  operator: 3,
  keyword: 4,
  comment: 5,
} as const;

export interface SqlTokens {
  offsets: number[];
  types: number[];
}

/** Settings applied right after opening, then locked (spec §13.1, AC-B3-06). */
export const LOCKDOWN_STATEMENTS = [
  'SET enable_external_access = false',
  'SET autoinstall_known_extensions = false',
  'SET autoload_known_extensions = false',
  'SET lock_configuration = true',
] as const;

/**
 * Unicode whitespace exactly as matched by JavaScript's `\s` (ECMAScript WhiteSpace +
 * LineTerminator), written for RE2. DuckDB's `\s` only matches ASCII whitespace.
 */
export const JS_WHITESPACE_RE2 =
  '[\\t\\n\\x0B\\f\\r \\x{00A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]+';

/** SQL macro: same result as `normalizeKeyPart` (engine/core/keys.ts) for VARCHAR input. */
export const NORM_KEY_MACRO = 'hrflow_norm_key';
/** SQL macro: VARCHAR blank = NULL or only whitespace (spec §12.1 "Ô trống"). */
export const BLANK_MACRO = 'hrflow_blank';

/** Opener for the runtime; the browser and Node loaders each provide one. */
export type DuckDbProvider = (onProgress?: (p: DuckDbLoadProgress) => void) => Promise<DuckDb>;

export interface DuckDbLoadProgress {
  loadedBytes: number;
  totalBytes: number;
}
