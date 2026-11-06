import { describe, expect, it } from 'vitest';
import { freeSpot, type Rect } from '../model';

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('freeSpot (node added from the palette, MEMORY 2026-11-06 18:27)', () => {
  it('keeps the spot when it is free', () => {
    expect(freeSpot([{ x: 1000, y: 1000, w: 260, h: 140 }], [0, 0], [260, 140])).toEqual([0, 0]);
  });

  it('moves off a node sitting at the centre, to the nearest free spot', () => {
    const taken = [{ x: 0, y: 0, w: 260, h: 140 }];
    const [x, y] = freeSpot(taken, [0, 0], [260, 140]);
    const box = { x, y, w: 260, h: 140 };
    expect(overlaps(box, taken[0]!)).toBe(false);
    // Nearest: straight above or below (140 + 24 margin → 5 steps of 40), not far away.
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(200);
  });

  it('a second and third node added at the same centre do not cover each other', () => {
    const taken: Rect[] = [{ x: 0, y: 0, w: 260, h: 140 }];
    for (let k = 0; k < 3; k++) {
      const [x, y] = freeSpot(taken, [0, 0], [260, 140]);
      const box = { x, y, w: 260, h: 140 };
      for (const r of taken) expect(overlaps(box, r)).toBe(false);
      taken.push(box);
    }
  });

  it('stays inside the visible canvas when there is room there', () => {
    const bounds = { x: -400, y: -100, w: 800, h: 400 };
    // Above and below the centre node are outside the bounds: it goes beside it.
    const taken = [{ x: 0, y: 0, w: 260, h: 140 }];
    const [x, y] = freeSpot(taken, [0, 0], [260, 140], bounds);
    expect(x >= bounds.x && y >= bounds.y).toBe(true);
    expect(x + 260 <= bounds.x + bounds.w && y + 140 <= bounds.y + bounds.h).toBe(true);
    expect(overlaps({ x, y, w: 260, h: 140 }, taken[0]!)).toBe(false);
    // No room inside: the nearest free spot outside.
    const full = [{ x: -400, y: -100, w: 800, h: 400 }];
    const out = freeSpot(full, [0, 0], [260, 140], bounds);
    expect(overlaps({ x: out[0], y: out[1], w: 260, h: 140 }, full[0]!)).toBe(false);
  });

  it('gives the start back when nothing is free within the rings', () => {
    expect(
      freeSpot([{ x: -1e6, y: -1e6, w: 2e6, h: 2e6 }], [5, 5], [260, 140], undefined, 3),
    ).toEqual([5, 5]);
  });
});
