import { describe, expect, it } from 'vitest';
import { filterSections, flatten, foldText, sectionsOf, typeAheadIndex } from './select-logic';

const opts = (...labels: string[]) => labels.map((label) => ({ value: label, label }));

describe('select logic', () => {
  it('sections: ungrouped options first, empty groups dropped', () => {
    const s = sectionsOf(opts('Tất cả'), [
      { label: 'Nhóm', options: [] },
      { label: 'Tài khoản', options: opts('hr.nv01') },
    ]);
    expect(s.map((x) => x.label)).toEqual([null, 'Tài khoản']);
    expect(flatten(s).map((o) => o.label)).toEqual(['Tất cả', 'hr.nv01']);
  });

  it('search ignores case, accents and đ; keeps group headers of matches only', () => {
    expect(foldText('  Đặng Văn ')).toBe('dang van');
    const s = sectionsOf(undefined, [
      { label: 'Nhóm', options: opts('C&B', 'Đào tạo') },
      { label: 'Tài khoản', options: opts('dao.nv02', 'hr.nv01') },
    ]);
    const r = filterSections(s, 'DAO');
    expect(r.map((x) => [x.label, x.options.map((o) => o.label)])).toEqual([
      ['Nhóm', ['Đào tạo']],
      ['Tài khoản', ['dao.nv02']],
    ]);
    expect(filterSections(s, 'zzz')).toEqual([]);
    expect(filterSections(s, '  ')).toHaveLength(2);
  });

  it('type-ahead: prefix match from the current option, repeated letter cycles, wraps', () => {
    const o = opts('CN01', 'CN02', 'Dương', 'Đặng', 'Em');
    expect(typeAheadIndex(o, 'c', -1)).toBe(0);
    expect(typeAheadIndex(o, 'c', 0)).toBe(1);
    expect(typeAheadIndex(o, 'cc', 1)).toBe(0); // cycles, wraps
    expect(typeAheadIndex(o, 'cn02', 0)).toBe(1);
    expect(typeAheadIndex(o, 'đ', 2)).toBe(3); // "Đặng" folds to "dang"
    expect(typeAheadIndex(o, 'x', 0)).toBe(-1);
    expect(typeAheadIndex([], 'a', 0)).toBe(-1);
  });
});
