import type { DataType } from '@hrflow/flow-schema';
import { Big, isDecimal, type Decimal } from './decimal';

/**
 * Columnar table storage (spec §13, decision 2026-10-27 17:50). One typed-array vector per
 * column, laid out like Apache Arrow (validity bitmap, UTF-8 offsets + bytes), so a table of a
 * million rows is a few dozen buffers instead of millions of live JS objects:
 *
 * - `string` / `date` / `datetime`: UTF-8 bytes + Int32 offsets (dates as ISO text);
 * - `decimal`: one double per cell **whose shortest decimal representation is the exact value**
 *   (e.g. 26.5, 15000000), plus an `exact` map (row → decimal text) for values a double cannot
 *   represent exactly. `get` always returns a big.js `Big` of the exact value (spec §9.4): the
 *   double is only a compact, lossless encoding, never used for arithmetic;
 * - `integer`: Float64 (safe integers only);
 * - `boolean`: one byte per cell.
 *
 * Values read through `get` are the engine `Value`s of `types.ts` (Big for decimals). Vectors are
 * immutable once built; builders grow geometrically.
 */

export type CellValue = string | number | boolean | Decimal | null;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Validity bitmap helpers (bit i set = row i not null; `null` bitmap = no nulls). */
export function isValid(bitmap: Uint8Array | null, i: number): boolean {
  return bitmap === null || (bitmap[i >> 3]! & (1 << (i & 7))) !== 0;
}

/** Decimal text of a double as big.js prints it (`String(x)`; same exponent thresholds). */
function numText(x: number): string {
  return String(x);
}

/**
 * Lossless double encoding of a decimal: the double whose shortest representation is exactly
 * `text` (canonical big.js text), or `null` when no double has that representation.
 */
export function exactDouble(text: string): number | null {
  const x = Number(text);
  return Number.isFinite(x) && String(x) === text ? (x === 0 ? 0 : x) : null;
}

interface VectorBase {
  readonly type: DataType;
  readonly length: number;
  readonly valid: Uint8Array | null;
  isNull(i: number): boolean;
  get(i: number): CellValue;
}

export class StringVector implements VectorBase {
  constructor(
    readonly type: DataType,
    readonly length: number,
    readonly offsets: Int32Array,
    readonly bytes: Uint8Array,
    readonly valid: Uint8Array | null,
  ) {}

  isNull(i: number): boolean {
    return !isValid(this.valid, i);
  }

  get(i: number): string | null {
    if (!isValid(this.valid, i)) return null;
    const a = this.offsets[i]!;
    const b = this.offsets[i + 1]!;
    if (b - a <= 24) {
      // Short ASCII text (codes, dates): cheaper than TextDecoder.
      let ascii = true;
      for (let k = a; k < b; k++) {
        if (this.bytes[k]! >= 0x80) {
          ascii = false;
          break;
        }
      }
      if (ascii) return String.fromCharCode.apply(null, this.bytes.subarray(a, b) as never);
    }
    return decoder.decode(this.bytes.subarray(a, b));
  }
}

export class DecimalVector implements VectorBase {
  readonly type = 'decimal' as const;
  constructor(
    readonly length: number,
    /** Exact-representation doubles (see file comment); NaN where `exact` holds the value. */
    readonly values: Float64Array,
    readonly valid: Uint8Array | null,
    /** Row → canonical decimal text for values no double represents exactly. */
    readonly exact: ReadonlyMap<number, string> | null,
  ) {}

  isNull(i: number): boolean {
    return !isValid(this.valid, i);
  }

  /** Canonical decimal text (big.js `toString`), or null. */
  text(i: number): string | null {
    if (!isValid(this.valid, i)) return null;
    return this.exact?.get(i) ?? numText(this.values[i]!);
  }

  get(i: number): Decimal | null {
    const t = this.text(i);
    return t === null ? null : new Big(t);
  }

  /** Exact comparison of two non-null cells (doubles compare exactly; see file comment). */
  compare(i: number, j: number): number {
    const ei = this.exact?.get(i);
    const ej = this.exact?.get(j);
    if (ei === undefined && ej === undefined) {
      const a = this.values[i]!;
      const b = this.values[j]!;
      return a < b ? -1 : a > b ? 1 : 0;
    }
    return this.get(i)!.cmp(this.get(j)!);
  }
}

export class IntegerVector implements VectorBase {
  readonly type = 'integer' as const;
  constructor(
    readonly length: number,
    readonly values: Float64Array,
    readonly valid: Uint8Array | null,
  ) {}

  isNull(i: number): boolean {
    return !isValid(this.valid, i);
  }

  get(i: number): number | null {
    return isValid(this.valid, i) ? this.values[i]! : null;
  }
}

export class BooleanVector implements VectorBase {
  readonly type = 'boolean' as const;
  constructor(
    readonly length: number,
    readonly values: Uint8Array,
    readonly valid: Uint8Array | null,
  ) {}

  isNull(i: number): boolean {
    return !isValid(this.valid, i);
  }

  get(i: number): boolean | null {
    return isValid(this.valid, i) ? this.values[i] === 1 : null;
  }
}

export type Vector = StringVector | DecimalVector | IntegerVector | BooleanVector;

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

class ValidityBuilder {
  bitmap: Uint8Array | null = null;

  /** Mark row `i` (0-based, rows < i already pushed) as null. */
  setNull(i: number, capacity: number): void {
    if (!this.bitmap) {
      this.bitmap = new Uint8Array((Math.max(capacity, i + 1) + 7) >> 3);
      // Every row before the first null was valid.
      this.bitmap.fill(0xff, 0, i >> 3);
      for (let k = i & ~7; k < i; k++) this.bitmap[k >> 3]! |= 1 << (k & 7);
    }
    this.ensure(i + 1);
    this.bitmap[i >> 3]! &= ~(1 << (i & 7));
  }

  setValid(i: number): void {
    if (!this.bitmap) return;
    this.ensure(i + 1);
    this.bitmap[i >> 3]! |= 1 << (i & 7);
  }

  private ensure(n: number): void {
    const need = (n + 7) >> 3;
    if (this.bitmap!.length >= need) return;
    const bigger = new Uint8Array(Math.max(need, this.bitmap!.length * 2));
    bigger.set(this.bitmap!);
    this.bitmap = bigger;
  }

  finish(n: number): Uint8Array | null {
    if (!this.bitmap) return null;
    const need = (n + 7) >> 3;
    return this.bitmap.length === need ? this.bitmap : this.bitmap.slice(0, need);
  }
}

/** Shrink a buffer to `n` elements, copying only when the slack is worth it. */
function fit<T extends Float64Array | Uint8Array | Int32Array>(buf: T, n: number): T {
  if (buf.length === n) return buf;
  return (buf.length - n > n / 8 ? buf.slice(0, n) : buf.subarray(0, n)) as T;
}

export interface ColumnBuilder {
  readonly type: DataType;
  readonly length: number;
  push(v: CellValue | undefined): void;
  pushNull(): void;
  /** Append cell `i` of a vector of the same storage kind (no decoding). */
  pushFrom(vec: Vector, i: number): void;
  finish(): Vector;
}

export class StringBuilder implements ColumnBuilder {
  private offsets: Int32Array;
  private bytes: Uint8Array;
  private pos = 0;
  private n = 0;
  private readonly validity = new ValidityBuilder();

  constructor(
    readonly type: DataType = 'string',
    capacity = 1024,
  ) {
    this.offsets = new Int32Array(capacity + 1);
    this.bytes = new Uint8Array(Math.max(1024, capacity * 8));
  }

  get length(): number {
    return this.n;
  }

  private grow(rows: number, bytes: number): void {
    if (this.n + rows + 1 > this.offsets.length) {
      const bigger = new Int32Array(Math.max(this.n + rows + 1, this.offsets.length * 2));
      bigger.set(this.offsets.subarray(0, this.n + 1));
      this.offsets = bigger;
    }
    if (this.pos + bytes > this.bytes.length) {
      const bigger = new Uint8Array(Math.max(this.pos + bytes, this.bytes.length * 2));
      bigger.set(this.bytes.subarray(0, this.pos));
      this.bytes = bigger;
    }
  }

  push(v: CellValue | undefined): void {
    if (v === null || v === undefined) return this.pushNull();
    const s = typeof v === 'string' ? v : isDecimal(v) ? v.toFixed() : String(v);
    this.grow(1, s.length * 3);
    this.pos += encoder.encodeInto(s, this.bytes.subarray(this.pos)).written;
    this.validity.setValid(this.n);
    this.offsets[++this.n] = this.pos;
  }

  /** Append raw UTF-8 bytes as one value. */
  pushBytes(src: Uint8Array, start: number, end: number): void {
    this.grow(1, end - start);
    this.bytes.set(src.subarray(start, end), this.pos);
    this.pos += end - start;
    this.validity.setValid(this.n);
    this.offsets[++this.n] = this.pos;
  }

  pushNull(): void {
    this.grow(1, 0);
    this.validity.setNull(this.n, this.offsets.length - 1);
    this.offsets[++this.n] = this.pos;
  }

  pushFrom(vec: Vector, i: number): void {
    if (!(vec instanceof StringVector)) return this.push(vec.get(i));
    if (vec.isNull(i)) return this.pushNull();
    this.pushBytes(vec.bytes, vec.offsets[i]!, vec.offsets[i + 1]!);
  }

  finish(): StringVector {
    return new StringVector(
      this.type,
      this.n,
      fit(this.offsets, this.n + 1),
      fit(this.bytes, this.pos),
      this.validity.finish(this.n),
    );
  }
}

class FloatStore {
  values: Float64Array;
  n = 0;
  constructor(capacity: number) {
    this.values = new Float64Array(capacity);
  }
  add(x: number): number {
    if (this.n === this.values.length) {
      const bigger = new Float64Array(Math.max(16, this.values.length * 2));
      bigger.set(this.values);
      this.values = bigger;
    }
    this.values[this.n] = x;
    return this.n++;
  }
}

export class DecimalBuilder implements ColumnBuilder {
  readonly type = 'decimal' as const;
  private readonly store: FloatStore;
  private readonly validity = new ValidityBuilder();
  private exact: Map<number, string> | null = null;

  constructor(capacity = 1024) {
    this.store = new FloatStore(capacity);
  }

  get length(): number {
    return this.store.n;
  }

  /** A double that is already the exact value (e.g. an Excel number read with 15 digits). */
  pushDouble(x: number): void {
    this.validity.setValid(this.store.add(x === 0 ? 0 : x));
  }

  /** Canonical decimal text (big.js `toString`). */
  pushText(text: string): void {
    const x = exactDouble(text);
    if (x !== null) return this.pushDouble(x);
    const i = this.store.add(NaN);
    this.validity.setValid(i);
    (this.exact ??= new Map()).set(i, text);
  }

  push(v: CellValue | undefined): void {
    if (v === null || v === undefined) return this.pushNull();
    if (typeof v === 'number') {
      // A JS number in a decimal column is the decimal of its shortest representation.
      if (!Number.isFinite(v)) return this.pushNull();
      return this.pushDouble(v);
    }
    const big = isDecimal(v) ? v : new Big(String(v));
    this.pushText(big.toString());
  }

  pushNull(): void {
    const i = this.store.add(0);
    this.validity.setNull(i, this.store.values.length);
  }

  pushFrom(vec: Vector, i: number): void {
    if (!(vec instanceof DecimalVector)) return this.push(vec.get(i));
    if (vec.isNull(i)) return this.pushNull();
    const e = vec.exact?.get(i);
    if (e !== undefined) this.pushText(e);
    else this.pushDouble(vec.values[i]!);
  }

  finish(): DecimalVector {
    const n = this.store.n;
    return new DecimalVector(n, fit(this.store.values, n), this.validity.finish(n), this.exact);
  }
}

export class IntegerBuilder implements ColumnBuilder {
  readonly type = 'integer' as const;
  private readonly store: FloatStore;
  private readonly validity = new ValidityBuilder();

  constructor(capacity = 1024) {
    this.store = new FloatStore(capacity);
  }

  get length(): number {
    return this.store.n;
  }

  push(v: CellValue | undefined): void {
    if (v === null || v === undefined) return this.pushNull();
    const x = typeof v === 'number' ? v : Number(isDecimal(v) ? v.toFixed() : v);
    this.validity.setValid(this.store.add(x));
  }

  pushNull(): void {
    const i = this.store.add(0);
    this.validity.setNull(i, this.store.values.length);
  }

  pushFrom(vec: Vector, i: number): void {
    if (vec.isNull(i)) return this.pushNull();
    if (vec instanceof IntegerVector) this.validity.setValid(this.store.add(vec.values[i]!));
    else this.push(vec.get(i));
  }

  finish(): IntegerVector {
    const n = this.store.n;
    return new IntegerVector(n, fit(this.store.values, n), this.validity.finish(n));
  }
}

export class BooleanBuilder implements ColumnBuilder {
  readonly type = 'boolean' as const;
  private values: Uint8Array;
  private n = 0;
  private readonly validity = new ValidityBuilder();

  constructor(capacity = 1024) {
    this.values = new Uint8Array(capacity);
  }

  get length(): number {
    return this.n;
  }

  private add(b: number): number {
    if (this.n === this.values.length) {
      const bigger = new Uint8Array(Math.max(16, this.values.length * 2));
      bigger.set(this.values);
      this.values = bigger;
    }
    this.values[this.n] = b;
    return this.n++;
  }

  push(v: CellValue | undefined): void {
    if (v === null || v === undefined) return this.pushNull();
    this.validity.setValid(this.add(v === true || v === 'true' ? 1 : 0));
  }

  pushNull(): void {
    const i = this.add(0);
    this.validity.setNull(i, this.values.length);
  }

  pushFrom(vec: Vector, i: number): void {
    this.push(vec.get(i));
  }

  finish(): BooleanVector {
    return new BooleanVector(this.n, fit(this.values, this.n), this.validity.finish(this.n));
  }
}

export function columnBuilder(type: DataType, capacity = 1024): ColumnBuilder {
  switch (type) {
    case 'decimal':
      return new DecimalBuilder(capacity);
    case 'integer':
      return new IntegerBuilder(capacity);
    case 'boolean':
      return new BooleanBuilder(capacity);
    default:
      return new StringBuilder(type, capacity);
  }
}

/** Gather `indexes` of a vector into a new vector. */
export function takeVector(vec: Vector, indexes: ArrayLike<number>): Vector {
  const b = columnBuilder(vec.type, indexes.length);
  for (let k = 0; k < indexes.length; k++) b.pushFrom(vec, indexes[k]!);
  return b.finish();
}

/** Vectors one after another (one vector of `type`, `total` rows). */
export function concatVectors(type: DataType, parts: readonly Vector[], total: number): Vector {
  if (parts.length === 1 && parts[0]!.type === type) return parts[0]!;
  const b = columnBuilder(type, total);
  for (const v of parts) for (let i = 0; i < v.length; i++) b.pushFrom(v, i);
  return b.finish();
}

/** Encode a whole column of values. */
export function vectorFrom(type: DataType, values: ArrayLike<CellValue | undefined>): Vector {
  const b = columnBuilder(type, values.length);
  for (let i = 0; i < values.length; i++) b.push(values[i]);
  return b.finish();
}

export interface TableColumn {
  key: string;
  type: DataType;
  title?: string;
  numFmt?: string;
}

export type RowObject = Record<string, CellValue>;

/**
 * A table: column definitions + one vector per column (same order). Row objects are only made on
 * demand (`row(i)`, `rows`) for small tables, tests and the UI page being shown.
 */
export class Table<C extends TableColumn = TableColumn> {
  readonly rowCount: number;
  private byKey: Map<string, Vector> | null = null;

  constructor(
    readonly columns: C[],
    readonly vectors: readonly Vector[],
    rowCount?: number,
  ) {
    if (vectors.length !== columns.length) throw new Error('columns/vectors mismatch');
    this.rowCount = rowCount ?? vectors[0]?.length ?? 0;
    for (const v of vectors) if (v.length !== this.rowCount) throw new Error('ragged table');
  }

  static empty<C extends TableColumn>(columns: C[]): Table<C> {
    return new Table(
      columns,
      columns.map((c) => columnBuilder(c.type, 0).finish()),
      0,
    );
  }

  /** Build from row objects (small tables, tests). Missing keys are null. */
  static fromRows<C extends TableColumn>(columns: C[], rows: readonly RowObject[]): Table<C> {
    const builders = columns.map((c) => columnBuilder(c.type, rows.length));
    for (const row of rows) {
      for (let c = 0; c < columns.length; c++) builders[c]!.push(row[columns[c]!.key]);
    }
    return new Table(
      columns,
      builders.map((b) => b.finish()),
      rows.length,
    );
  }

  vector(key: string): Vector | undefined {
    if (!this.byKey) {
      this.byKey = new Map();
      this.columns.forEach((c, i) => this.byKey!.set(c.key, this.vectors[i]!));
    }
    return this.byKey.get(key);
  }

  /** Cell value (`null` for blank cells and unknown keys). */
  value(i: number, key: string): CellValue {
    return this.vector(key)?.get(i) ?? null;
  }

  row(i: number): RowObject {
    const out: RowObject = {};
    this.columns.forEach((c, k) => (out[c.key] = this.vectors[k]!.get(i)));
    return out;
  }

  /**
   * All rows as objects. Allocates one object per row: for tests, small tables and debugging
   * only — engine code reads vectors.
   */
  get rows(): RowObject[] {
    const out = new Array<RowObject>(this.rowCount);
    for (let i = 0; i < this.rowCount; i++) out[i] = this.row(i);
    return out;
  }

  /** Rows `indexes` (in that order) as a new table. */
  take(indexes: ArrayLike<number>): Table<C> {
    return new Table(
      this.columns,
      this.vectors.map((v) => takeVector(v, indexes)),
      indexes.length,
    );
  }

  /** The first `n` rows. */
  head(n: number): Table<C> {
    if (n >= this.rowCount) return this;
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    return this.take(idx);
  }

  /** Same rows, other column definitions (subset / reorder by key; vectors are shared). */
  select<D extends TableColumn>(columns: D[]): Table<D> {
    return new Table(
      columns,
      columns.map((c) => {
        const v = this.vector(c.key);
        if (v && v.type === c.type) return v;
        const b = columnBuilder(c.type, this.rowCount);
        for (let i = 0; i < this.rowCount; i++) {
          if (v) b.pushFrom(v, i);
          else b.pushNull();
        }
        return b.finish();
      }),
      this.rowCount,
    );
  }

  /** Rows of several tables, matched by column key; a column missing in a table is null there. */
  static concat<C extends TableColumn>(columns: C[], tables: readonly Table[]): Table<C> {
    if (tables.length === 1) return tables[0]!.select(columns);
    const total = tables.reduce((n, t) => n + t.rowCount, 0);
    const vectors = columns.map((c) => {
      const b = columnBuilder(c.type, total);
      for (const t of tables) {
        const v = t.vector(c.key);
        for (let i = 0; i < t.rowCount; i++) {
          if (v) b.pushFrom(v, i);
          else b.pushNull();
        }
      }
      return b.finish();
    });
    return new Table(columns, vectors, total);
  }
}
