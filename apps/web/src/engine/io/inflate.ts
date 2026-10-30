/**
 * Raw DEFLATE decoder (RFC 1951) with a hard output size, for the synchronous reads of the .xlsx
 * reader (zip-bomb guard, AC-B4-90). The output buffer is exactly `size` bytes: the decoder stops
 * the moment the stream would write past it (`InflateOverflowError`), so a lying entry never costs
 * more than `size` bytes and the time to produce them. SheetJS's inflater, used before, keeps
 * decoding the whole stream even when given a size.
 */

export class InflateOverflowError extends Error {
  constructor() {
    super('inflate output larger than declared');
    this.name = 'InflateOverflowError';
  }
}

const LBASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LEXT = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DBASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DEXT = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huffman {
  /** Indexed by the next `bits` input bits (LSB first): (symbol << 4) | code length; 0 = invalid. */
  table: Int32Array;
  bits: number;
}

function corrupt(): Error {
  return new Error('corrupt deflate stream');
}

function build(lengths: ArrayLike<number>, n: number): Huffman {
  let bits = 0;
  const count = new Int32Array(16);
  for (let i = 0; i < n; i++) {
    const l = lengths[i]!;
    count[l]!++;
    if (l > bits) bits = l;
  }
  if (bits === 0) return { table: new Int32Array(1), bits: 1 };
  count[0] = 0;
  const next = new Int32Array(16);
  let code = 0;
  for (let b = 1; b <= 15; b++) {
    code = (code + count[b - 1]!) << 1;
    next[b] = code;
  }
  const size = 1 << bits;
  const table = new Int32Array(size);
  for (let sym = 0; sym < n; sym++) {
    const len = lengths[sym]!;
    if (len === 0) continue;
    const c = next[len]!++;
    if (c >= 1 << len) throw corrupt(); // over-subscribed
    let rev = 0;
    for (let k = 0; k < len; k++) rev |= ((c >> k) & 1) << (len - 1 - k);
    const entry = (sym << 4) | len;
    for (let j = rev; j < size; j += 1 << len) table[j] = entry;
  }
  return { table, bits };
}

let FIXED: { lit: Huffman; dist: Huffman } | null = null;
function fixed(): { lit: Huffman; dist: Huffman } {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144);
  l.fill(9, 144, 256);
  l.fill(7, 256, 280);
  l.fill(8, 280, 288);
  const d = new Uint8Array(30).fill(5);
  return (FIXED = { lit: build(l, 288), dist: build(d, 30) });
}

/**
 * Inflate `src` (raw DEFLATE) into exactly `size` bytes. Throws `InflateOverflowError` as soon as
 * the stream produces more, and an `Error` when the stream is corrupt or shorter than `size`.
 */
export function inflateRawBounded(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const end = src.length;
  let inPos = 0;
  let buf = 0;
  let cnt = 0;
  let outPos = 0;

  /** At least `n` (≤ 24) bits in `buf`; past the end of input, zero bits (checked at the end). */
  const need = (n: number) => {
    while (cnt < n) {
      if (inPos > end + 4) throw corrupt();
      buf |= (inPos < end ? src[inPos]! : 0) << cnt;
      inPos++;
      cnt += 8;
    }
  };
  const take = (n: number): number => {
    need(n);
    const v = buf & ((1 << n) - 1);
    buf >>>= n;
    cnt -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    need(h.bits);
    const e = h.table[buf & ((1 << h.bits) - 1)]!;
    const len = e & 15;
    if (len === 0) throw corrupt();
    buf >>>= len;
    cnt -= len;
    return e >> 4;
  };

  let last = 0;
  while (!last) {
    last = take(1);
    const type = take(2);
    if (type === 0) {
      // Stored block: drop to a byte boundary, give back whole buffered bytes.
      buf >>>= cnt & 7;
      cnt -= cnt & 7;
      inPos -= cnt >> 3;
      buf = 0;
      cnt = 0;
      if (inPos + 4 > end) throw corrupt();
      const len = src[inPos]! | (src[inPos + 1]! << 8);
      const nlen = src[inPos + 2]! | (src[inPos + 3]! << 8);
      if ((len ^ 0xffff) !== nlen) throw corrupt();
      inPos += 4;
      if (inPos + len > end) throw corrupt();
      if (outPos + len > size) throw new InflateOverflowError();
      out.set(src.subarray(inPos, inPos + len), outPos);
      outPos += len;
      inPos += len;
      continue;
    }
    let lit: Huffman;
    let dist: Huffman;
    if (type === 1) ({ lit, dist } = fixed());
    else if (type === 2) {
      const hlit = take(5) + 257;
      const hdist = take(5) + 1;
      const hclen = take(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]!] = take(3);
      const clh = build(cl, 19);
      const lengths = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const sym = decode(clh);
        if (sym < 16) lengths[i++] = sym;
        else {
          let rep: number;
          let val = 0;
          if (sym === 16) {
            if (i === 0) throw corrupt();
            val = lengths[i - 1]!;
            rep = 3 + take(2);
          } else if (sym === 17) rep = 3 + take(3);
          else rep = 11 + take(7);
          if (i + rep > hlit + hdist) throw corrupt();
          lengths.fill(val, i, i + rep);
          i += rep;
        }
      }
      if (lengths[256] === 0) throw corrupt();
      lit = build(lengths.subarray(0, hlit), hlit);
      dist = build(lengths.subarray(hlit), hdist);
    } else throw corrupt();

    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        if (outPos >= size) throw new InflateOverflowError();
        out[outPos++] = sym;
        continue;
      }
      if (sym === 256) break;
      const li = sym - 257;
      if (li >= 29) throw corrupt();
      const len = LBASE[li]! + take(LEXT[li]!);
      const di = decode(dist);
      if (di >= 30) throw corrupt();
      const d = DBASE[di]! + take(DEXT[di]!);
      if (d > outPos) throw corrupt();
      if (outPos + len > size) throw new InflateOverflowError();
      if (d >= len) {
        out.copyWithin(outPos, outPos - d, outPos - d + len);
        outPos += len;
      } else {
        for (let k = 0; k < len; k++, outPos++) out[outPos] = out[outPos - d]!;
      }
    }
  }
  // Bits read past the end of input must have been padding only.
  if (inPos - (cnt >> 3) > end) throw corrupt();
  if (outPos !== size) throw corrupt();
  return out;
}
