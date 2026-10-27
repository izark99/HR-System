import type { DuckDBBindings } from '@duckdb/duckdb-wasm/blocking';
import { tableFromIPC, type Table as ArrowTable } from 'apache-arrow';
import {
  BLANK_MACRO,
  DuckDbError,
  JS_WHITESPACE_RE2,
  LOCKDOWN_STATEMENTS,
  NORM_KEY_MACRO,
  type SqlParam,
  type SqlTokens,
} from './base';

/**
 * Thin synchronous wrapper around DuckDB-WASM's *blocking* bindings (spec §13.1). The same class
 * runs inside the engine worker (browser bindings) and in Vitest (Node bindings), over the same
 * `duckdb-eh.wasm`.
 *
 * Results cross the boundary as Arrow IPC bytes and are decoded with the app's own apache-arrow
 * instance, so the engine never depends on DuckDB's internal Arrow objects.
 *
 * Nothing here logs: DuckDB error messages can quote cell values (spec §12.1.8).
 */

const MACROS = [
  // NFC → collapse whitespace → trim → lowercase, like normalizeKeyPart. DuckDB's lower() uses
  // simple case mapping; the only unconditional multi-character lowercase mapping of JavaScript is
  // U+0130 (İ → i + U+0307), so it is replaced first. NULL → '' as in TS.
  // Known, accepted differences from normalizeKeyPart (pinned by tests, none occur in
  // Vietnamese/Latin business data or in Excel text): Greek final sigma (JS lowercases a
  // word-final Σ to ς), an embedded NUL (RE2 stops there), and the few Unicode 16 letters newer
  // than DuckDB's tables (U+1C89, U+A7CB, U+A7CC, U+A7DA, U+A7DC, U+10D50–U+10D65).
  `CREATE MACRO ${NORM_KEY_MACRO}(x) AS coalesce(lower(trim(regexp_replace(replace(nfc_normalize(x), 'İ', 'i' || chr(775)), '${JS_WHITESPACE_RE2}', ' ', 'g'))), '')`,
  `CREATE MACRO ${BLANK_MACRO}(x) AS (x IS NULL OR trim(regexp_replace(x, '${JS_WHITESPACE_RE2}', ' ', 'g')) = '')`,
];

type Connection = ReturnType<DuckDBBindings['connect']>;

export class DuckDb {
  private readonly conn: Connection;

  /** Opens an in-memory database, applies the lockdown settings and creates the engine macros. */
  constructor(private readonly bindings: DuckDBBindings) {
    bindings.open({
      path: ':memory:',
      query: { castBigIntToDouble: false, castDecimalToDouble: false },
    });
    this.conn = bindings.connect();
    for (const sql of MACROS) this.exec(sql);
    for (const sql of LOCKDOWN_STATEMENTS) this.exec(sql);
  }

  private wrap<T>(work: (b: DuckDBBindings, conn: number) => T): T {
    try {
      return this.conn.useUnsafe(work);
    } catch (err) {
      throw new DuckDbError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Run a statement; with `params` it is prepared and the values are bound (never inlined). */
  query(sql: string, params: readonly SqlParam[] = []): ArrowTable {
    const bytes = this.wrap((b, conn) => {
      if (params.length === 0) return b.runQuery(conn, sql);
      const stmt = b.createPrepared(conn, sql);
      try {
        return b.runPrepared(conn, stmt, [...params]);
      } finally {
        b.closePrepared(conn, stmt);
      }
    });
    return tableFromIPC(bytes);
  }

  exec(sql: string, params: readonly SqlParam[] = []): void {
    this.query(sql, params);
  }

  /** Parse + bind without executing (syntax and catalog errors surface here). */
  prepareOnly(sql: string): void {
    this.wrap((b, conn) => {
      const stmt = b.createPrepared(conn, sql);
      b.closePrepared(conn, stmt);
    });
  }

  /** Arrow IPC stream → table `name` (created when `create`, else appended). */
  insertArrow(ipc: Uint8Array, name: string, create: boolean): void {
    this.wrap((b, conn) => b.insertArrowFromIPCStream(conn, ipc, { name, create }));
  }

  tokenize(sql: string): SqlTokens {
    return this.wrap((b) => b.tokenize(sql));
  }

  /** First column of the first row, as a string (settings, counts). */
  scalar(sql: string, params: readonly SqlParam[] = []): string | null {
    const t = this.query(sql, params);
    const v = t.getChildAt(0)?.get(0) as string | number | bigint | boolean | null | undefined;
    return v === null || v === undefined ? null : String(v);
  }
}

export * from './base';
