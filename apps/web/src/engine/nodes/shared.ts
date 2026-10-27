import type { DataType, Literal } from '@hrflow/flow-schema';
import { Big, decimalFromNumber } from '../core/decimal';
import { EngineError, type ColumnDef, type ParamValue } from '../core/types';
import { decimalToSql } from '../duckdb/sql';

/** Shared helpers of the step-3 node plugins (spec §12.1). */

export const IN_PORT = 'in';
export const OUT_PORT = 'out';

/** Error at a config field: `params.path` lets the Designer highlight the field (spec §12.1). */
export function configError(
  key: string,
  path: string,
  params: Record<string, unknown> = {},
): EngineError {
  return new EngineError(key, { ...params, path });
}

export function findColumn(
  columns: readonly ColumnDef[],
  key: string,
  errorKey: string,
  path: string,
): ColumnDef {
  const col = columns.find((c) => c.key === key);
  if (!col) throw configError(errorKey, path, { column: key });
  return col;
}

/** Copy of a column definition keeping title/format. */
export function passColumn(c: ColumnDef): ColumnDef {
  return {
    key: c.key,
    type: c.type,
    ...(c.title !== undefined ? { title: c.title } : {}),
    ...(c.numFmt !== undefined ? { numFmt: c.numFmt } : {}),
  };
}

export function isBlankParam(v: ParamValue | undefined): v is null | undefined {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * Runtime param → the VARCHAR value bound to SQL (spec §9.2): month "2026-09", date
 * "2026-09-15", number "1.5", boolean "true"/"false", string/select as entered; blank → NULL.
 */
export function paramToSql(v: ParamValue | undefined): string | null {
  if (isBlankParam(v)) return null;
  return typeof v === 'string' ? v : String(v);
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Read a config literal (or param value) as a value of `type`, returned as the canonical SQL
 * text bound to a `CAST(? AS …)`. `null` = not readable for that type.
 */
export function literalForType(v: Literal, type: DataType): string | null {
  switch (type) {
    case 'string':
      return String(v);
    case 'integer':
      if (typeof v === 'number') return Number.isSafeInteger(v) ? String(v) : null;
      if (typeof v === 'string' && /^-?\d{1,18}$/.test(v.trim())) return v.trim();
      return null;
    case 'decimal': {
      if (typeof v === 'boolean') return null;
      const s = typeof v === 'string' ? v.trim() : '';
      if (typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(s)) return null;
      try {
        return decimalToSql(typeof v === 'number' ? decimalFromNumber(v) : new Big(s));
      } catch {
        return null;
      }
    }
    case 'boolean':
      if (typeof v === 'boolean') return String(v);
      return v === 'true' || v === 'false' ? v : null;
    case 'date': {
      const m = typeof v === 'string' ? DATE.exec(v.trim()) : null;
      if (!m || !validDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
      return m[0];
    }
    case 'datetime': {
      const m = typeof v === 'string' ? DATETIME.exec(v.trim()) : null;
      if (!m || !validDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
      const [h, mi, se] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
      if (h > 23 || mi > 59 || se > 59) return null;
      return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
    }
  }
}
