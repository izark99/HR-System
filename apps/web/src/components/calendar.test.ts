import { describe, expect, it } from 'vitest';
import {
  addMonths,
  addMonthsToDate,
  dateValue,
  monthValue,
  monthWeeks,
  moveDate,
  moveMonth,
  parseDateValue,
  parseMonthValue,
} from './calendar';
import { panelShift } from './picker-shared';

describe('calendar helpers (month/date pickers)', () => {
  it('parse/format ISO values', () => {
    expect(parseMonthValue('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonthValue('2026-13')).toBeNull();
    expect(parseMonthValue('')).toBeNull();
    expect(monthValue({ year: 2026, month: 3 })).toBe('2026-03');
    expect(parseDateValue('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseDateValue('2026-02-29')).toBeNull();
    expect(dateValue({ year: 2026, month: 1, day: 5 })).toBe('2026-01-05');
  });

  it('month arithmetic crosses years', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonthsToDate({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });

  it('month grid keys: arrows, Home/End within the row of 4, PageUp/PageDown = year', () => {
    const oct = { year: 2026, month: 10 };
    expect(moveMonth(oct, 'ArrowRight')).toEqual({ year: 2026, month: 11 });
    expect(moveMonth({ year: 2026, month: 12 }, 'ArrowRight')).toEqual({ year: 2027, month: 1 });
    expect(moveMonth(oct, 'ArrowUp')).toEqual({ year: 2026, month: 6 });
    expect(moveMonth({ year: 2026, month: 2 }, 'ArrowUp')).toEqual({ year: 2025, month: 10 });
    expect(moveMonth(oct, 'Home')).toEqual({ year: 2026, month: 9 });
    expect(moveMonth(oct, 'End')).toEqual({ year: 2026, month: 12 });
    expect(moveMonth(oct, 'PageUp')).toEqual({ year: 2025, month: 10 });
    expect(moveMonth(oct, 'PageDown')).toEqual({ year: 2027, month: 10 });
    expect(moveMonth(oct, 'a')).toBeNull();
  });

  it('day grid: Monday-first weeks and APG keys', () => {
    // 1 Oct 2026 is a Thursday → 3 blanks before it.
    const weeks = monthWeeks(2026, 10);
    expect(weeks[0]).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(weeks.at(-1)).toEqual([26, 27, 28, 29, 30, 31, null]);
    const d = { year: 2026, month: 10, day: 1 };
    expect(moveDate(d, 'ArrowLeft')).toEqual({ year: 2026, month: 9, day: 30 });
    expect(moveDate(d, 'ArrowDown')).toEqual({ year: 2026, month: 10, day: 8 });
    expect(moveDate(d, 'Home')).toEqual({ year: 2026, month: 9, day: 28 });
    expect(moveDate(d, 'End')).toEqual({ year: 2026, month: 10, day: 4 });
    expect(moveDate(d, 'PageDown')).toEqual({ year: 2026, month: 11, day: 1 });
    expect(moveDate(d, 'PageUp', true)).toEqual({ year: 2025, month: 10, day: 1 });
  });

  it('popover stays inside a 390px viewport', () => {
    expect(panelShift(16, 1280, 336)).toBe(0);
    // Trigger near the right edge of a phone: shift left so the panel ends 12px from the edge.
    const shift = panelShift(200, 390, 336);
    expect(200 + shift + Math.min(336, 390 - 24)).toBeLessThanOrEqual(390 - 12);
    expect(200 + shift).toBeGreaterThanOrEqual(12);
  });
});
