import {
  Bool,
  DateDay,
  Decimal as ArrowDecimal,
  Float64,
  Int64,
  makeData,
  makeVector,
  TimestampMicrosecond,
  Utf8,
  type Data,
  type Vector as ArrowVector,
} from 'apache-arrow';
import { Big } from '../core/decimal';
import {
  DecimalBuilder,
  DecimalVector,
  IntegerVector,
  isValid,
  StringBuilder,
  StringVector,
  BooleanVector,
  type Vector,
} from '../core/table';
import { decimalToSql, SCALE } from './sql';

/*
 * Columnar engine vectors ⇄ Arrow record batches (spec §9.4, §13.1). Arrow data is assembled
 * from typed arrays with `makeData`: apache-arrow's Builders compile code with `new Function`,
 * which the CSP (no 'unsafe-eval') blocks.
 */

const POW10 = Array.from({ length: 23 }, (_, i) => 10 ** i);
const TWO_24 = 16777216;

/** Null count of rows [from, from + n) of a validity bitmap. */
function nullsIn(bitmap: Uint8Array | null, from: number, n: number): number {
  if (!bitmap) return 0;
  let nulls = 0;
  for (let i = from; i < from + n; i++) if (!isValid(bitmap, i)) nulls++;
  return nulls;
}

/** Validity bits of rows [from, from + n), re-based at bit 0 (zero-copy when byte aligned). */
function chunkBitmap(bitmap: Uint8Array, from: number, n: number): Uint8Array {
  if ((from & 7) === 0) return bitmap.subarray(from >> 3, (from + n + 7) >> 3);
  const out = new Uint8Array((n + 7) >> 3);
  for (let i = 0; i < n; i++) if (isValid(bitmap, from + i)) out[i >> 3]! |= 1 << (i & 7);
  return out;
}

function validityOf(vec: Vector, from: number, n: number) {
  const nulls = nullsIn(vec.valid, from, n);
  return nulls === 0
    ? { nullCount: 0 }
    : { nullCount: nulls, nullBitmap: chunkBitmap(vec.valid!, from, n) };
}

/**
 * Write `y × 10^k` (0 ≤ y < 2^53 integer, 0 ≤ k ≤ 10) as a 128-bit little-endian two's
 * complement integer (negated when `negative`) at `words[4w…4w+3]`. Exact limb arithmetic in
 * doubles (base 2^24), no BigInt.
 */
export function writeScaled(
  words: Uint32Array,
  w: number,
  y: number,
  k: number,
  negative: boolean,
): void {
  const m = POW10[k]!;
  const m0 = m % TWO_24;
  const m1 = Math.floor(m / TWO_24);
  const y0 = y % TWO_24;
  const yh = Math.floor(y / TWO_24);
  const y1 = yh % TWO_24;
  const y2 = Math.floor(yh / TWO_24);
  // Limbs of y × m in base 2^24 (each partial sum < 2^50: exact in doubles).
  let t = y0 * m0;
  const l0 = t % TWO_24;
  t = Math.floor(t / TWO_24) + y1 * m0 + y0 * m1;
  const l1 = t % TWO_24;
  t = Math.floor(t / TWO_24) + y2 * m0 + y1 * m1;
  const l2 = t % TWO_24;
  t = Math.floor(t / TWO_24) + y2 * m1;
  const l3 = t % TWO_24;
  const l4 = Math.floor(t / TWO_24);
  let w0 = (l0 + (l1 % 256) * TWO_24) >>> 0;
  let w1 = (Math.floor(l1 / 256) + (l2 % 65536) * 65536) >>> 0;
  let w2 = (Math.floor(l2 / 65536) + l3 * 256) >>> 0;
  let w3 = l4 >>> 0;
  if (negative && (w0 | w1 | w2 | w3) !== 0) {
    w0 = ~w0 >>> 0;
    w1 = ~w1 >>> 0;
    w2 = ~w2 >>> 0;
    w3 = ~w3 >>> 0;
    w0 = (w0 + 1) >>> 0;
    if (w0 === 0) {
      w1 = (w1 + 1) >>> 0;
      if (w1 === 0) {
        w2 = (w2 + 1) >>> 0;
        if (w2 === 0) w3 = (w3 + 1) >>> 0;
      }
    }
  }
  words[4 * w] = w0;
  words[4 * w + 1] = w1;
  words[4 * w + 2] = w2;
  words[4 * w + 3] = w3;
}

/** Decimal text (plain or exponent notation) → scaled DECIMAL(38,10) words (rounded half-up). */
function writeScaledText(words: Uint32Array, w: number, text: string, column: string): void {
  const plain = decimalToSql(new Big(text), column);
  const dot = plain.indexOf('.');
  const int = dot < 0 ? plain : plain.slice(0, dot);
  const frac = dot < 0 ? '' : plain.slice(dot + 1);
  const scaled = BigInt.asUintN(128, BigInt(`${int}${frac.padEnd(SCALE, '0')}`));
  for (let k = 0; k < 4; k++) words[4 * w + k] = Number((scaled >> BigInt(32 * k)) & 0xffffffffn);
}

/**
 * Exact-representation double → scaled words. The double's shortest representation is the
 * decimal value; when it has at most 15 significant digits and 10 decimals it is `y × 10^-p`
 * with `y/10^p === x` (decimals of ≤ 15 digits map to distinct doubles), so no text is needed.
 */
function writeScaledDouble(words: Uint32Array, w: number, x: number, column: string): void {
  const negative = x < 0;
  const a = negative ? -x : x;
  if (Number.isInteger(a)) {
    if (a <= Number.MAX_SAFE_INTEGER) return writeScaled(words, w, a, SCALE, negative);
  } else {
    for (let p = 1; p <= SCALE; p++) {
      const y = Math.round(a * POW10[p]!);
      if (y < 1e15 && y / POW10[p]! === a) return writeScaled(words, w, y, SCALE - p, negative);
    }
  }
  writeScaledText(words, w, String(x), column);
}

const TWO_32 = 4294967296;

/** Days in month `m` (1–12) of proleptic Gregorian year `y`. */
function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's days_from_civil). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** `n` ASCII digits at `bytes[at…]` as a number, or -1. */
function digits(bytes: Uint8Array, at: number, n: number): number {
  let v = 0;
  for (let k = at; k < at + n; k++) {
    const d = bytes[k]! - 48;
    if (d < 0 || d > 9) return -1;
    v = v * 10 + d;
  }
  return v;
}

/**
 * Strict "YYYY-MM-DD" (year 0001–9999, a real calendar day) at `bytes[s…e)` → days since epoch,
 * else `null`. Only this exact form takes the fast path; anything else is left to DuckDB's cast.
 */
export function isoDateDays(bytes: Uint8Array, s: number, e: number): number | null {
  if (e - s !== 10 || bytes[s + 4] !== 45 || bytes[s + 7] !== 45) return null;
  const y = digits(bytes, s, 4);
  const m = digits(bytes, s + 5, 2);
  const d = digits(bytes, s + 8, 2);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return daysFromCivil(y, m, d);
}

/** Strict "YYYY-MM-DDTHH:mm:ss" → seconds since epoch, else `null` (see `isoDateDays`). */
export function isoDateTimeSeconds(bytes: Uint8Array, s: number, e: number): number | null {
  if (e - s !== 19 || bytes[s + 10] !== 84 || bytes[s + 13] !== 58 || bytes[s + 16] !== 58) {
    return null;
  }
  const days = isoDateDays(bytes, s, s + 10);
  if (days === null) return null;
  const h = digits(bytes, s + 11, 2);
  const mi = digits(bytes, s + 14, 2);
  const se = digits(bytes, s + 17, 2);
  if (h < 0 || h > 23 || mi < 0 || mi > 59 || se < 0 || se > 59) return null;
  return days * 86400 + h * 3600 + mi * 60 + se;
}

type Valid = ReturnType<typeof validityOf>;

function utf8Chunk(vec: StringVector, from: number, n: number, valid: Valid): ArrowVector {
  const base = vec.offsets[from]!;
  const offsets = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) offsets[i] = vec.offsets[from + i]! - base;
  return makeVector(
    makeData({
      type: new Utf8(),
      length: n,
      ...valid,
      valueOffsets: offsets,
      data: vec.bytes.subarray(base, vec.offsets[from + n]),
    }),
  );
}

/** ISO date / datetime text → Arrow DATE32 / TIMESTAMP(µs); `null` when a cell is not strict ISO. */
function temporalChunk(
  vec: StringVector,
  from: number,
  n: number,
  valid: Valid,
): ArrowVector | null {
  const { offsets, bytes } = vec;
  if (vec.type === 'date') {
    const days = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const r = from + i;
      if (!isValid(vec.valid, r)) continue;
      const v = isoDateDays(bytes, offsets[r]!, offsets[r + 1]!);
      if (v === null) return null;
      days[i] = v;
    }
    return makeVector(makeData({ type: new DateDay(), length: n, ...valid, data: days }));
  }
  const micros = new BigInt64Array(n);
  for (let i = 0; i < n; i++) {
    const r = from + i;
    if (!isValid(vec.valid, r)) continue;
    const v = isoDateTimeSeconds(bytes, offsets[r]!, offsets[r + 1]!);
    if (v === null) return null;
    micros[i] = BigInt(v) * 1_000_000n;
  }
  return makeVector(
    makeData({ type: new TimestampMicrosecond(), length: n, ...valid, data: micros }),
  );
}

/** 64-bit two's complement little-endian words of safe integers; `null` when a value is not one. */
function int64Words(values: Float64Array, from: number, n: number, valid: Uint8Array | null) {
  const words = new Int32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const r = from + i;
    if (!isValid(valid, r)) continue;
    const x = values[r]!;
    if (!Number.isSafeInteger(x)) return null;
    const hi = Math.floor(x / TWO_32);
    words[2 * i] = (x - hi * TWO_32) | 0;
    words[2 * i + 1] = hi;
  }
  return words;
}

/** Dense 1-based row numbers `from + 1 … from + n` as an Arrow BIGINT column (`__ord`). */
export function ordVector(from: number, n: number): ArrowVector {
  const words = new Int32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const v = from + i + 1;
    const hi = Math.floor(v / TWO_32);
    words[2 * i] = (v - hi * TWO_32) | 0;
    words[2 * i + 1] = hi;
  }
  return makeVector(
    makeData({ type: new Int64(), length: n, nullCount: 0, data: new BigInt64Array(words.buffer) }),
  );
}

/**
 * Rows [from, from + n) of an engine vector as an Arrow vector for DuckDB (spec §9.4). Values
 * already cross in the column's DuckDB type where that is exact (DECIMAL(38,10), BIGINT, DATE,
 * TIMESTAMP, BOOLEAN, VARCHAR), so the upload needs no cast. A chunk that does not fit (e.g. a
 * date text that is not strict ISO) crosses as before (VARCHAR / DOUBLE) and DuckDB casts it on
 * insert into the typed table, exactly like the former `CAST(…)`.
 */
export function toArrow(vec: Vector, from: number, n: number, column: string): ArrowVector {
  const valid = validityOf(vec, from, n);
  if (vec instanceof StringVector) {
    if (vec.type === 'date' || vec.type === 'datetime') {
      const typed = temporalChunk(vec, from, n, valid);
      if (typed) return typed;
    }
    return utf8Chunk(vec, from, n, valid);
  }
  if (vec instanceof DecimalVector) {
    const words = new Uint32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const r = from + i;
      if (!isValid(vec.valid, r)) continue;
      const exact = vec.exact?.get(r);
      if (exact !== undefined) writeScaledText(words, i, exact, column);
      else writeScaledDouble(words, i, vec.values[r]!, column);
    }
    return makeVector(
      makeData({ type: new ArrowDecimal(SCALE, 38, 128), length: n, ...valid, data: words }),
    );
  }
  if (vec instanceof IntegerVector) {
    const words = int64Words(vec.values, from, n, vec.valid);
    if (words) {
      return makeVector(
        makeData({ type: new Int64(), length: n, ...valid, data: new BigInt64Array(words.buffer) }),
      );
    }
    return makeVector(
      makeData({
        type: new Float64(),
        length: n,
        ...valid,
        data: vec.values.subarray(from, from + n),
      }),
    );
  }
  const bits = new Uint8Array((n + 7) >> 3);
  for (let i = 0; i < n; i++) if (vec.values[from + i] === 1) bits[i >> 3]! |= 1 << (i & 7);
  return makeVector(makeData({ type: new Bool(), length: n, ...valid, data: bits }));
}

// ---------------------------------------------------------------------------------------------
// DuckDB → engine (results read as VARCHAR / BOOLEAN, see SqlScope.read)
// ---------------------------------------------------------------------------------------------

interface Utf8Chunk {
  length: number;
  offset: number;
  valueOffsets: Int32Array;
  values: Uint8Array;
  nullBitmap: Uint8Array | undefined;
  nullCount: number;
}

/** Visit every cell of an Arrow Utf8 column: `(bytes, start, end)` or `null`. */
export function forEachUtf8(
  vec: ArrowVector,
  visit: (bytes: Uint8Array | null, start: number, end: number) => void,
): void {
  for (const d of vec.data as Data[]) {
    const chunk = d as unknown as Utf8Chunk;
    for (let i = 0; i < chunk.length; i++) {
      const at = chunk.offset + i;
      const isNull =
        chunk.nullCount > 0 &&
        chunk.nullBitmap !== undefined &&
        chunk.nullBitmap.length > 0 &&
        (chunk.nullBitmap[at >> 3]! & (1 << (at & 7))) === 0;
      if (isNull) visit(null, 0, 0);
      else visit(chunk.values, chunk.valueOffsets[at]!, chunk.valueOffsets[at + 1]!);
    }
  }
}

const decoder = new TextDecoder();

/**
 * Plain decimal text (ASCII "-123.4500") → the exact-representation double when it has at most
 * 15 significant digits (always exact, see `writeScaledDouble`), else `null` (caller uses text).
 */
export function decimalAscii(bytes: Uint8Array, start: number, end: number): number | null {
  let i = start;
  let negative = false;
  if (bytes[i] === 45) {
    negative = true;
    i++;
  } else if (bytes[i] === 43) i++;
  let dot = -1;
  for (let k = i; k < end; k++) {
    if (bytes[k] === 46) {
      dot = k;
      break;
    }
  }
  let stop = end;
  if (dot >= 0) {
    while (stop > dot + 1 && bytes[stop - 1] === 48) stop--;
    if (stop === dot + 1) stop = dot;
  }
  let m = 0;
  let sig = 0;
  let frac = 0;
  for (let k = i; k < stop; k++) {
    const c = bytes[k]!;
    if (k === dot) continue;
    const d = c - 48;
    if (d < 0 || d > 9) return null;
    if (dot >= 0 && k > dot) frac++;
    if (sig > 0 || d !== 0) sig++;
    m = m * 10 + d;
  }
  if (stop === i) return null;
  if (sig > 15) return frac === 0 && m <= Number.MAX_SAFE_INTEGER ? (negative ? -m : m) : null;
  const x = frac === 0 ? m : m / POW10[frac]!;
  return negative && x !== 0 ? -x : x;
}

/** Read an Arrow VARCHAR column of DECIMAL text into a decimal vector. */
export function decimalFromUtf8(vec: ArrowVector, n: number): DecimalVector {
  const b = new DecimalBuilder(n);
  forEachUtf8(vec, (bytes, s, e) => {
    if (!bytes) return b.pushNull();
    const x = decimalAscii(bytes, s, e);
    if (x !== null) b.pushDouble(x);
    else b.pushText(new Big(decoder.decode(bytes.subarray(s, e))).toString());
  });
  return b.finish();
}

/**
 * Read an Arrow VARCHAR column of integer text. Values beyond the safe integer range (e.g. a
 * large SUM) make the whole column decimal (spec §9.4).
 */
export function integerFromUtf8(vec: ArrowVector, n: number): IntegerVector | DecimalVector {
  const values = new Float64Array(n);
  let valid: Uint8Array | null = null;
  let unsafe: Map<number, string> | null = null;
  let i = 0;
  forEachUtf8(vec, (bytes, s, e) => {
    if (!bytes) {
      if (!valid) {
        valid = new Uint8Array((n + 7) >> 3).fill(0xff);
      }
      valid[i >> 3]! &= ~(1 << (i & 7));
    } else {
      const x = decimalAscii(bytes, s, e);
      if (x !== null && Number.isSafeInteger(x)) values[i] = x;
      else {
        values[i] = NaN;
        (unsafe ??= new Map()).set(i, new Big(decoder.decode(bytes.subarray(s, e))).toString());
      }
    }
    i++;
  });
  if (!unsafe) return new IntegerVector(n, values, valid);
  return new DecimalVector(n, values, valid, unsafe);
}

export function stringFromUtf8(
  vec: ArrowVector,
  n: number,
  type: 'string' | 'date' | 'datetime',
): StringVector {
  const b = new StringBuilder(type, n);
  forEachUtf8(vec, (bytes, s, e) => (bytes ? b.pushBytes(bytes, s, e) : b.pushNull()));
  return b.finish();
}

export function booleanFromArrow(vec: ArrowVector, n: number): BooleanVector {
  const values = new Uint8Array(n);
  let valid: Uint8Array | null = null;
  for (let i = 0; i < n; i++) {
    const v = vec.get(i) as boolean | null | undefined;
    if (v === null || v === undefined) {
      valid ??= new Uint8Array((n + 7) >> 3).fill(0xff);
      valid[i >> 3]! &= ~(1 << (i & 7));
    } else values[i] = v ? 1 : 0;
  }
  return new BooleanVector(n, values, valid);
}
