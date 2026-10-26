import type { DataType } from '@hrflow/flow-schema';
import { Big, decimalFromNumber } from '../core/decimal';
import type { Value } from '../core/types';
import { normalizeHeader } from './normalize';

/** Raw cell value as produced by the sheet parser (dates arrive as Excel serial numbers). */
export type RawValue = string | number | boolean | null;

export type CoerceResult = { ok: true; value: Value } | { ok: false };

export interface CoerceOptions {
  dateFormats?: readonly string[];
  decimalSeparator?: '.' | ',';
  /** Workbook uses the 1904 date system (old Mac Excel). */
  date1904?: boolean;
}

export const DEFAULT_DATE_FORMATS = ['dd/MM/yyyy', 'yyyy-MM-dd', 'excelSerial'] as const;

const TRUE_WORDS = new Set(['true', '1', 'yes', 'y', 'x', 'co', 'dung']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'n', 'khong', 'sai']);

export function isBlank(v: RawValue | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Coerce a non-blank raw value; blank values must be handled by the caller (→ null). */
export function coerceValue(raw: RawValue, type: DataType, opts: CoerceOptions = {}): CoerceResult {
  if (raw === null || isBlank(raw)) return { ok: true, value: null };
  const sep = opts.decimalSeparator ?? '.';
  switch (type) {
    case 'string':
      if (typeof raw === 'number') return ok(Number(raw.toPrecision(15)).toString());
      if (typeof raw === 'boolean') return ok(raw ? 'TRUE' : 'FALSE');
      return ok(String(raw).trim());

    case 'decimal': {
      if (typeof raw === 'number')
        return Number.isFinite(raw) ? ok(decimalFromNumber(raw)) : fail();
      if (typeof raw !== 'string') return fail();
      const text = normalizeNumberText(raw, sep);
      return text === null ? fail() : ok(new Big(text));
    }

    case 'integer': {
      let n: number;
      if (typeof raw === 'number') n = Number(raw.toPrecision(15));
      else if (typeof raw === 'string') {
        const text = normalizeNumberText(raw, sep);
        if (text === null) return fail();
        n = Number(text);
      } else return fail();
      return Number.isSafeInteger(n) ? ok(n) : fail();
    }

    case 'boolean': {
      if (typeof raw === 'boolean') return ok(raw);
      if (typeof raw === 'number') return raw === 1 ? ok(true) : raw === 0 ? ok(false) : fail();
      const w = normalizeHeader(raw);
      if (TRUE_WORDS.has(w)) return ok(true);
      if (FALSE_WORDS.has(w)) return ok(false);
      return fail();
    }

    case 'date':
    case 'datetime': {
      const parts = parseDateValue(raw, opts.dateFormats ?? DEFAULT_DATE_FORMATS, opts.date1904);
      if (!parts) return fail();
      return ok(type === 'date' ? formatDate(parts) : formatDateTime(parts));
    }
  }
}

const ok = (value: Value): CoerceResult => ({ ok: true, value });
const fail = (): CoerceResult => ({ ok: false });

/**
 * Normalize a number typed as text to a plain "123.45" string, or null when invalid.
 * With decimalSeparator "." the thousands separator is "," (and vice versa); a thousands
 * separator is only accepted in groups of 3 digits, so "1,5" is invalid with ".".
 */
export function normalizeNumberText(text: string, decimalSeparator: '.' | ','): string | null {
  const s = text.replace(/[\s\u00a0]/g, '');
  const thousands = decimalSeparator === '.' ? ',' : '.';
  const d = escapeRegex(decimalSeparator);
  const th = escapeRegex(thousands);
  const plain = new RegExp(`^[+-]?(\\d+(${d}\\d*)?|${d}\\d+)([eE][+-]?\\d+)?$`);
  const grouped = new RegExp(`^[+-]?\\d{1,3}(${th}\\d{3})+(${d}\\d*)?$`);
  let out: string;
  if (plain.test(s)) out = s;
  else if (grouped.test(s)) out = s.split(thousands).join('');
  else return null;
  out = out.replace(decimalSeparator, '.').replace(/^\+/, '');
  if (out.endsWith('.')) out = out.slice(0, -1);
  if (out.startsWith('.')) out = `0${out}`;
  if (out.startsWith('-.')) out = `-0${out.slice(1)}`;
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

export interface DateParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mi: number;
  ss: number;
}

const MS_PER_DAY = 86_400_000;
/** Largest valid Excel serial (9999-12-31). */
const MAX_SERIAL = 2_958_465;

/**
 * Excel serial → calendar parts. Handles Excel's 1900 leap-year bug: serial 60 is the
 * non-existent 1900-02-29 (rejected); serials below 60 are shifted by one day.
 */
export function excelSerialToParts(serial: number, date1904 = false): DateParts | null {
  if (!Number.isFinite(serial)) return null;
  const totalSeconds = Math.round(serial * 86_400);
  let days = Math.floor(totalSeconds / 86_400);
  const secs = totalSeconds - days * 86_400;
  if (date1904) days += 1462;
  if (days < 1 || days > MAX_SERIAL) return null;
  if (days === 60) return null;
  if (days < 60) days += 1;
  const date = new Date(Date.UTC(1899, 11, 30) + days * MS_PER_DAY);
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    hh: Math.floor(secs / 3600),
    mi: Math.floor((secs % 3600) / 60),
    ss: secs % 60,
  };
}

const TOKEN_RE = /yyyy|MM|dd|HH|mm|ss|M|d|H/g;
const formatCache = new Map<string, { re: RegExp; fields: string[] }>();

function compileFormat(format: string): { re: RegExp; fields: string[] } {
  const cached = formatCache.get(format);
  if (cached) return cached;
  const fields: string[] = [];
  let pattern = '';
  let last = 0;
  for (const m of format.matchAll(TOKEN_RE)) {
    pattern += escapeRegex(format.slice(last, m.index));
    const tok = m[0];
    fields.push(tok[0]!);
    pattern += tok === 'yyyy' ? '(\\d{4})' : '(\\d{1,2})';
    last = m.index + tok.length;
  }
  pattern += escapeRegex(format.slice(last));
  const compiled = { re: new RegExp(`^${pattern}$`), fields };
  formatCache.set(format, compiled);
  return compiled;
}

/** Parse a date string against one format ("dd/MM/yyyy", "yyyy-MM-dd HH:mm:ss", …). */
export function parseDateString(text: string, format: string): DateParts | null {
  const { re, fields } = compileFormat(format);
  const match = re.exec(text.trim());
  if (!match) return null;
  const p: DateParts = { y: NaN, m: NaN, d: NaN, hh: 0, mi: 0, ss: 0 };
  fields.forEach((f, i) => {
    const n = Number(match[i + 1]);
    if (f === 'y') p.y = n;
    else if (f === 'M') p.m = n;
    else if (f === 'd') p.d = n;
    else if (f === 'H') p.hh = n;
    else if (f === 'm') p.mi = n;
    else if (f === 's') p.ss = n;
  });
  return isValidParts(p) ? p : null;
}

function isValidParts(p: DateParts): boolean {
  if (![p.y, p.m, p.d].every(Number.isInteger)) return false;
  if (p.hh > 23 || p.mi > 59 || p.ss > 59) return false;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return dt.getUTCFullYear() === p.y && dt.getUTCMonth() === p.m - 1 && dt.getUTCDate() === p.d;
}

export function parseDateValue(
  raw: RawValue,
  formats: readonly string[],
  date1904 = false,
): DateParts | null {
  if (typeof raw === 'number') {
    return formats.includes('excelSerial') ? excelSerialToParts(raw, date1904) : null;
  }
  if (typeof raw !== 'string') return null;
  for (const f of formats) {
    if (f === 'excelSerial') {
      // A serial typed as text (e.g. from CSV).
      if (/^\d+(\.\d+)?$/.test(raw.trim())) {
        const parts = excelSerialToParts(Number(raw), date1904);
        if (parts) return parts;
      }
      continue;
    }
    const parts = parseDateString(raw, f);
    if (parts) return parts;
  }
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatDate(p: DateParts): string {
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
}

export function formatDateTime(p: DateParts): string {
  return `${formatDate(p)}T${pad(p.hh)}:${pad(p.mi)}:${pad(p.ss)}`;
}
