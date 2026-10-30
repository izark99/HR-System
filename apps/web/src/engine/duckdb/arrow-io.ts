import {
  Bool,
  Decimal as ArrowDecimal,
  Float64,
  makeData,
  makeVector,
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
  const r = [y0 * m0, y1 * m0 + y0 * m1, y2 * m0 + y1 * m1, y2 * m1, 0];
  const l = [0, 0, 0, 0, 0];
  let carry = 0;
  for (let i = 0; i < 5; i++) {
    const t = r[i]! + carry;
    l[i] = t % TWO_24;
    carry = Math.floor(t / TWO_24);
  }
  let w0 = (l[0]! + (l[1]! % 256) * TWO_24) >>> 0;
  let w1 = (Math.floor(l[1]! / 256) + (l[2]! % 65536) * 65536) >>> 0;
  let w2 = (Math.floor(l[2]! / 65536) + l[3]! * 256) >>> 0;
  let w3 = l[4]! >>> 0;
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

/** Rows [from, from + n) of an engine vector as an Arrow vector for DuckDB's raw table. */
export function toArrow(vec: Vector, from: number, n: number, column: string): ArrowVector {
  const valid = validityOf(vec, from, n);
  if (vec instanceof StringVector) {
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
