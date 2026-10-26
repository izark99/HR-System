import type { DataType } from '@hrflow/flow-schema';
import type { CellValue } from '../engine/protocol';

/**
 * Vietnamese display formatting (spec §18, §25.4): "1.234.567,89". Decimals arrive from the
 * worker as strings and are formatted textually, so no float rounding is involved.
 */
export function formatDecimalString(s: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return s;
  const [, sign, int = '0', frac] = m;
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped}${frac ? `,${frac}` : ''}`;
}

const integerFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

export function formatInteger(n: number): string {
  return integerFormat.format(n);
}

/** Seconds for display: "1,2", or two decimals under one second ("0,04"). */
export function formatSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return formatDecimalString(s.toFixed(s < 1 ? 2 : 1));
}

/** "2026-09" → "09/2026". */
export function formatMonth(value: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? `${m[2]}/${m[1]}` : value;
}

export function formatCell(value: CellValue, type: DataType, t: (key: string) => string): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
  if (typeof value === 'number') {
    return type === 'integer' ? formatInteger(value) : formatDecimalString(String(value));
  }
  if (type === 'decimal' || type === 'integer') return formatDecimalString(value);
  if (type === 'date' || type === 'datetime') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}:\d{2}))?$/.exec(value);
    if (m) return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}` : ''}`;
  }
  return value;
}

export function isNumericType(type: DataType): boolean {
  return type === 'decimal' || type === 'integer';
}
