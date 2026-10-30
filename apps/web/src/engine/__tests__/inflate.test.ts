import { constants, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { InflateOverflowError, inflateRawBounded } from '../io/inflate';

/** Bounded raw-DEFLATE decoder (zip-bomb guard, AC-B4-90) against Node's zlib. Fake data only. */

function data(n: number, seed: number, alphabet: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    // Runs and repeats so that every block type and long matches occur.
    out[i] = i % 97 < 40 ? out[Math.max(0, i - 300)]! : 32 + (s % alphabet);
  }
  return out;
}

describe('inflateRawBounded', () => {
  it.each([
    ['empty', new Uint8Array(0), 6],
    ['small text', new TextEncoder().encode('<row r="1"><c r="A1"><v>Nguyễn</v></c></row>'), 6],
    ['random 1 MB, stored', data(1 << 20, 1, 256), 0],
    ['mixed 2 MB, fast', data(2 << 20, 2, 60), 1],
    ['mixed 2 MB, best', data(2 << 20, 3, 20), 9],
    ['zeros 5 MB', new Uint8Array(5 << 20), 9],
  ])('%s matches zlib', (_n, raw, level) => {
    const z = deflateRawSync(raw, { level });
    expect(
      Buffer.from(inflateRawBounded(new Uint8Array(z), raw.length)).equals(Buffer.from(raw)),
    ).toBe(true);
  });

  it('fixed Huffman blocks', () => {
    const raw = data(100_000, 4, 30);
    const z = deflateRawSync(raw, { strategy: constants.Z_FIXED });
    expect(
      Buffer.from(inflateRawBounded(new Uint8Array(z), raw.length)).equals(Buffer.from(raw)),
    ).toBe(true);
  });

  it('stops at the declared size: a 1 GiB stream with size 1000 fails fast', () => {
    const z = new Uint8Array(deflateRawSync(new Uint8Array(1 << 30), { level: 9 }));
    const t0 = performance.now();
    expect(() => inflateRawBounded(z, 1000)).toThrow(InflateOverflowError);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('shorter output than declared or a truncated stream is corrupt', () => {
    const raw = data(10_000, 5, 50);
    const z = new Uint8Array(deflateRawSync(raw));
    expect(() => inflateRawBounded(z, raw.length + 1)).toThrow(/corrupt/);
    expect(() => inflateRawBounded(z.subarray(0, z.length >> 1), raw.length)).toThrow();
    expect(() => inflateRawBounded(new Uint8Array([0xff, 0xff, 0xff]), 10)).toThrow();
  });
});
