import BigJs from 'big.js';

/**
 * Decimal arithmetic for money/day values (spec §9.4: no float).
 *
 * big.js (MIT, ~6 kB) is used by the pure-TS executor. When the DuckDB executor lands, decimal
 * columns map to DuckDB DECIMAL(18, s) and cross the Arrow boundary as decimal strings, so the
 * value representation stays lossless end to end.
 *
 * `BigJs()` returns an independent constructor, so our config never leaks to other users of big.js.
 */
export const Big = BigJs();
Big.DP = 20;
Big.RM = Big.roundHalfUp;

export type Decimal = BigJs.Big;

export function isDecimal(v: unknown): v is Decimal {
  return v instanceof Big;
}

/**
 * Convert an Excel/JS number into a Decimal without float noise.
 * Excel stores IEEE doubles with ~15 significant digits; 25.499999999999996 → 25.5.
 */
export function decimalFromNumber(n: number): Decimal {
  return new Big(Number(n.toPrecision(15)).toString());
}

export function decimalFrom(v: string | number | Decimal): Decimal {
  if (isDecimal(v)) return v;
  if (typeof v === 'number') return decimalFromNumber(v);
  return new Big(v);
}

export const ZERO = new Big(0);
