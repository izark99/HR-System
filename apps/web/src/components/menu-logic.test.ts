import { describe, expect, it } from 'vitest';
import { menuKeyTarget, orderMenuItems } from './menu-logic';

describe('menuKeyTarget', () => {
  it('moves down and wraps to the first item', () => {
    expect(menuKeyTarget('ArrowDown', 0, 3)).toBe(1);
    expect(menuKeyTarget('ArrowDown', 2, 3)).toBe(0);
  });
  it('moves up and wraps to the last item', () => {
    expect(menuKeyTarget('ArrowUp', 2, 3)).toBe(1);
    expect(menuKeyTarget('ArrowUp', 0, 3)).toBe(2);
  });
  it('jumps with Home / End', () => {
    expect(menuKeyTarget('Home', 2, 3)).toBe(0);
    expect(menuKeyTarget('End', 0, 3)).toBe(2);
  });
  it('ignores other keys and empty menus', () => {
    expect(menuKeyTarget('a', 0, 3)).toBeNull();
    expect(menuKeyTarget('Enter', 1, 3)).toBeNull();
    expect(menuKeyTarget('ArrowDown', 0, 0)).toBeNull();
  });
  it('a single item stays on itself', () => {
    expect(menuKeyTarget('ArrowDown', 0, 1)).toBe(0);
    expect(menuKeyTarget('ArrowUp', 0, 1)).toBe(0);
  });
});

describe('orderMenuItems', () => {
  it('puts destructive items last, keeping order', () => {
    const items = [
      { key: 'retire', danger: true },
      { key: 'clone' },
      { key: 'discard', danger: true },
      { key: 'export' },
    ];
    expect(orderMenuItems(items).map((i) => i.key)).toEqual([
      'clone',
      'export',
      'retire',
      'discard',
    ]);
  });
});
