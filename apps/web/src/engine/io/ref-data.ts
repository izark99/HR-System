import { decimalFrom } from '../core/decimal';
import { columnBuilder } from '../core/table';
import { EngineError, Table, type RefColumnDef, type RefTableDef, type Value } from '../core/types';

/**
 * Reference table data for a run or a Designer preview (spec §34 AC-RT-08, AC-RT-15): the rows
 * of the version effective on the as-of date, sent by the main thread (RAM only: never stored,
 * never logged, never sent anywhere), checked against the table's CURRENT columns.
 *
 * Stored cells (`ref_table_versions.rows`) are JSON: string / integer (number) / decimal (text
 * "12.5") / date ("yyyy-mm-dd") / boolean. A published version keeps the values it was published
 * with, so after the Admin changes a column type some cells may not fit any more (AC-RT-15 b):
 * they are converted when nothing is lost (integer → decimal, number / date written as standard
 * text → the target type); otherwise the table cannot be used and the run is blocked, naming the
 * table, version and column — never a cell value.
 */

/** One table as sent by the main thread. */
export interface RefTablePayload {
  code: string;
  name: string;
  versionId: string;
  versionNo: number;
  columns: RefColumnDef[];
  rows: readonly unknown[];
}

/** Outcome per table: usable, or the first column holding a value of another type. */
export type RefLoadStatus =
  | { code: string; ok: true; rowCount: number }
  | { code: string; ok: false; columnKey: string; column: string };

type Cast = { ok: true; value: Value } | { ok: false };
const BLANK: Cast = { ok: true, value: null };
const FAIL: Cast = { ok: false };

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 1 &&
    y <= 9999 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const DECIMAL_TEXT = /^[+-]?\d{1,28}(\.\d{1,10})?$/;
const INTEGER_TEXT = /^[+-]?\d{1,16}$/;

/** A stored cell as a value of `type`, or a failure when it cannot be converted losslessly. */
export function castRefValue(raw: unknown, type: RefColumnDef['type']): Cast {
  if (raw === null || raw === undefined) return BLANK;
  if (typeof raw === 'string' && raw.trim() === '') return BLANK;
  switch (type) {
    case 'string':
      if (typeof raw === 'string') return { ok: true, value: raw };
      if (typeof raw === 'number' && Number.isFinite(raw)) return { ok: true, value: String(raw) };
      if (typeof raw === 'boolean') return { ok: true, value: raw ? 'TRUE' : 'FALSE' };
      return FAIL;
    case 'integer': {
      if (typeof raw === 'number')
        return Number.isSafeInteger(raw) ? { ok: true, value: raw } : FAIL;
      if (typeof raw !== 'string') return FAIL;
      const t = raw.trim();
      // "12.0" holds an integer too; "12.5" does not.
      const m = /^([+-]?\d+)(?:\.0+)?$/.exec(t);
      if (!m || !INTEGER_TEXT.test(m[1]!)) return FAIL;
      const n = Number(m[1]);
      return Number.isSafeInteger(n) ? { ok: true, value: n === 0 ? 0 : n } : FAIL;
    }
    case 'decimal': {
      if (typeof raw === 'number') {
        return Number.isSafeInteger(raw) ? { ok: true, value: decimalFrom(String(raw)) } : FAIL;
      }
      if (typeof raw !== 'string') return FAIL;
      const t = raw.trim();
      return DECIMAL_TEXT.test(t) ? { ok: true, value: decimalFrom(t.replace(/^\+/, '')) } : FAIL;
    }
    case 'date': {
      if (typeof raw !== 'string') return FAIL;
      const t = raw.trim();
      let y: number, mo: number, d: number;
      let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
      if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)))
        [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else return FAIL;
      return validDate(y, mo, d) ? { ok: true, value: `${pad(y, 4)}-${pad(mo)}-${pad(d)}` } : FAIL;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (typeof raw !== 'string') return FAIL;
      const t = raw.trim().toLowerCase();
      return t === 'true'
        ? { ok: true, value: true }
        : t === 'false'
          ? { ok: true, value: false }
          : FAIL;
    }
  }
}

/** Columnar table of a version, or the first column (in definition order) that does not fit. */
export function buildRefTable(
  columns: readonly RefColumnDef[],
  rows: readonly unknown[],
): { ok: true; table: Table } | { ok: false; column: RefColumnDef } {
  const builders = columns.map((c) => columnBuilder(c.type, rows.length));
  for (const row of rows) {
    const obj = typeof row === 'object' && row !== null && !Array.isArray(row) ? row : {};
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i]!;
      const cast = castRefValue((obj as Record<string, unknown>)[c.key], c.type);
      if (!cast.ok) return { ok: false, column: c };
      builders[i]!.push(cast.value);
    }
  }
  return {
    ok: true,
    table: new Table(
      columns.map((c) => ({ key: c.key, type: c.type, title: c.title })),
      builders.map((b) => b.finish()),
      rows.length,
    ),
  };
}

/**
 * The reference tables of the current run / preview, inside the worker. `set` replaces them all
 * (one call per as-of date); tables whose cells do not fit are not kept (their nodes fail with
 * `refTable.error.notLoaded` if a run is attempted anyway).
 */
export class RefStore {
  private defs: Record<string, RefTableDef> = {};
  private readonly tables = new Map<string, Table>();

  set(payloads: readonly RefTablePayload[]): RefLoadStatus[] {
    this.defs = {};
    this.tables.clear();
    return payloads.map((p) => {
      this.defs[p.code] = { code: p.code, name: p.name, columns: p.columns, published: true };
      const built = buildRefTable(p.columns, p.rows);
      if (!built.ok) {
        return { code: p.code, ok: false, columnKey: built.column.key, column: built.column.title };
      }
      this.tables.set(p.code, built.table);
      return { code: p.code, ok: true, rowCount: built.table.rowCount };
    });
  }

  /** Definitions of the tables sent (for the executor context). */
  definitions(): Readonly<Record<string, RefTableDef>> {
    return this.defs;
  }

  read(code: string): Table {
    const table = this.tables.get(code);
    if (!table) {
      throw new EngineError('refTable.error.notLoaded', { table: this.defs[code]?.name ?? code });
    }
    return table;
  }
}

/** Executor options serving the reference tables of a run / preview. */
export function refRunOptions(refs: RefStore | undefined): {
  refTables?: Readonly<Record<string, RefTableDef>>;
  readRefTable?: (code: string) => Table;
} {
  if (!refs) return {};
  return { refTables: refs.definitions(), readRefTable: (code) => refs.read(code) };
}
