/**
 * Columnar table storage (core/table.ts) and the Arrow encoding helpers (duckdb/arrow-io.ts):
 * decimals stay exact through the double encoding, the 128-bit scaled writer matches BigInt,
 * builders, take/select/concat. Fake data only.
 */
import { makeData, makeVector, Utf8 } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import type { DecimalVector } from '../core/table';
import {
  concatVectors,
  DecimalBuilder,
  exactDouble,
  StringBuilder,
  Table,
  vectorFrom,
} from '../core/table';
import { decimalAscii, decimalFromUtf8, integerFromUtf8, writeScaled } from '../duckdb/arrow-io';

const enc = new TextEncoder();

function utf8Arrow(values: (string | null)[]) {
  const offsets = new Int32Array(values.length + 1);
  const parts = values.map((v) => (v === null ? new Uint8Array(0) : enc.encode(v)));
  let pos = 0;
  parts.forEach((p, i) => (offsets[i + 1] = pos += p.length));
  const data = new Uint8Array(pos);
  parts.forEach((p, i) => data.set(p, offsets[i]));
  const bitmap = new Uint8Array((values.length + 7) >> 3);
  values.forEach((v, i) => {
    if (v !== null) bitmap[i >> 3]! |= 1 << (i & 7);
  });
  return makeVector(
    makeData({
      type: new Utf8(),
      length: values.length,
      nullCount: values.filter((v) => v === null).length,
      nullBitmap: bitmap,
      valueOffsets: offsets,
      data,
    }),
  );
}

describe('decimal vectors are exact', () => {
  const texts = [
    '0',
    '26.5',
    '-0.25',
    '15000000',
    '0.1',
    '1e-7',
    '123456789012345.67',
    '12345678901234567890.1234567891',
    '0.30000000000000004',
    '99999999999999999999999999',
    '-1.0000000001',
  ];

  it('round-trips any big.js value through the builder', () => {
    const b = new DecimalBuilder(2);
    for (const t of texts) b.push(new Big(t));
    b.pushNull();
    const v = b.finish();
    expect(v.length).toBe(texts.length + 1);
    texts.forEach((t, i) => expect(v.get(i)!.eq(new Big(t))).toBe(true));
    texts.forEach((t, i) => expect(v.text(i)).toBe(new Big(t).toString()));
    expect(v.get(texts.length)).toBeNull();
  });

  it('keeps only non-representable values as text', () => {
    const v = vectorFrom(
      'decimal',
      texts.map((t) => new Big(t)),
    ) as DecimalVector;
    const exact = [...(v.exact?.values() ?? [])];
    expect(exact).toEqual(
      ['12345678901234567890.1234567891', '99999999999999999999999999'].map((t) =>
        new Big(t).toString(),
      ),
    );
    expect(exactDouble('26.5')).toBe(26.5);
    expect(exactDouble('12345678901234567890.1234567891')).toBeNull();
  });

  it('compares exactly, through doubles or text', () => {
    const v = vectorFrom('decimal', [
      new Big('0.1'),
      new Big('0.2'),
      new Big('12345678901234567890.1'),
      new Big('12345678901234567890.2'),
    ]) as DecimalVector;
    expect(v.compare(0, 1)).toBe(-1);
    expect(v.compare(3, 2)).toBe(1);
    expect(v.compare(0, 2)).toBe(-1);
    expect(v.compare(1, 1)).toBe(0);
  });
});

describe('writeScaled (DECIMAL(38,10) words)', () => {
  const toBig = (w: Uint32Array) =>
    BigInt.asIntN(
      128,
      BigInt(w[0]!) | (BigInt(w[1]!) << 32n) | (BigInt(w[2]!) << 64n) | (BigInt(w[3]!) << 96n),
    );
  it('matches BigInt arithmetic', () => {
    const cases: [number, number, boolean][] = [
      [0, 10, false],
      [1, 10, false],
      [1, 10, true],
      [123456789, 0, false],
      [Number.MAX_SAFE_INTEGER, 10, false],
      [Number.MAX_SAFE_INTEGER, 10, true],
      [999999999999999, 3, true],
      [16777216, 7, false],
      [4294967295, 10, true],
    ];
    for (const [y, k, neg] of cases) {
      const w = new Uint32Array(4);
      writeScaled(w, 0, y, k, neg);
      const want = BigInt(y) * 10n ** BigInt(k) * (neg ? -1n : 1n);
      expect(toBig(w)).toBe(want);
    }
  });
});

describe('DuckDB text → vectors', () => {
  it('parses decimal text exactly (fast path and text fallback)', () => {
    const b = enc.encode('-123.4500000000');
    expect(decimalAscii(b, 0, b.length)).toBe(-123.45);
    const z = enc.encode('0.0000000000');
    expect(decimalAscii(z, 0, z.length)).toBe(0);
    const long = enc.encode('1234567890123456.1');
    expect(decimalAscii(long, 0, long.length)).toBeNull();
    const v = decimalFromUtf8(
      utf8Arrow(['26.5000000000', null, '1234567890123456789012.0000000001']),
      3,
    );
    expect(v.text(0)).toBe('26.5');
    expect(v.get(1)).toBeNull();
    expect(v.get(2)!.toFixed()).toBe('1234567890123456789012.0000000001');
  });

  it('turns an integer column decimal when a value is beyond 2^53', () => {
    const small = integerFromUtf8(utf8Arrow(['1', null, '-42']), 3);
    expect(small.type).toBe('integer');
    expect([small.get(0), small.get(1), small.get(2)]).toEqual([1, null, -42]);
    const big = integerFromUtf8(utf8Arrow(['1', '123456789012345678901']), 2);
    expect(big.type).toBe('decimal');
    expect(String(big.get(0))).toBe('1');
    expect(String(big.get(1))).toBe('123456789012345678901');
  });
});

describe('Table', () => {
  const columns = [
    { key: 's', type: 'string' as const },
    { key: 'd', type: 'decimal' as const },
    { key: 'i', type: 'integer' as const },
    { key: 'b', type: 'boolean' as const },
  ];
  const rows = [
    { s: 'Nguyễn Văn Giả', d: new Big('1.5'), i: 1, b: true },
    { s: null, d: null, i: null, b: null },
    { s: 'NV00003', d: new Big('-2'), i: 3, b: false },
  ];

  it('fromRows → rows round-trip', () => {
    const t = Table.fromRows(columns, rows);
    expect(t.rowCount).toBe(3);
    expect(t.rows).toEqual(rows);
    expect(t.value(0, 's')).toBe('Nguyễn Văn Giả');
    expect(t.value(0, 'missing')).toBeNull();
  });

  it('take, head, select, concat', () => {
    const t = Table.fromRows(columns, rows);
    expect(t.take([2, 0]).rows).toEqual([rows[2], rows[0]]);
    expect(t.head(1).rows).toEqual([rows[0]]);
    expect(t.select([columns[2]!, columns[0]!]).rows[2]).toEqual({ i: 3, s: 'NV00003' });
    const other = Table.fromRows([columns[0]!], [{ s: 'x' }]);
    const all = Table.concat(columns, [t, other]);
    expect(all.rowCount).toBe(4);
    expect(all.rows[3]).toEqual({ s: 'x', d: null, i: null, b: null });
  });

  it('string builder grows and keeps nulls positioned', () => {
    const b = new StringBuilder('string', 1);
    for (let i = 0; i < 5000; i++) b.push(i % 7 === 0 ? null : `giá trị ${i}`);
    const v = b.finish();
    expect(v.get(0)).toBeNull();
    expect(v.get(4999)).toBe('giá trị 4999');
    expect(v.get(4998)).toBeNull();
    const joined = concatVectors('string', [v, v], 10000);
    expect(joined.get(9999)).toBe('giá trị 4999');
  });
});
