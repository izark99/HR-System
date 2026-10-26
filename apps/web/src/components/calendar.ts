/**
 * Pure calendar helpers for the month/date pickers. Values stay ISO strings (`YYYY-MM`,
 * `YYYY-MM-DD`) so the engine and as-of resolution do not change. Months are 1-based.
 */

export interface YearMonth {
  year: number;
  month: number;
}

export interface Ymd extends YearMonth {
  day: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function parseMonthValue(value: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

export function monthValue({ year, month }: YearMonth): string {
  return `${year}-${pad(month)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseDateValue(value: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function dateValue({ year, month, day }: Ymd): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function todayYmd(now: Date = new Date()): Ymd {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** Same day in another month, clamped to that month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsToDate(d: Ymd, delta: number): Ymd {
  const ym = addMonths(d, delta);
  return { ...ym, day: Math.min(d.day, daysInMonth(ym.year, ym.month)) };
}

export function addDays(d: Ymd, delta: number): Ymd {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + delta));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 0 = Monday … 6 = Sunday (Vietnamese weeks start on Monday). */
export function weekdayMonFirst(d: Ymd): number {
  return (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;
}

/** Weeks (Monday-first) of a month; `null` pads days outside the month. */
export function monthWeeks(year: number, month: number): (number | null)[][] {
  const first = weekdayMonFirst({ year, month, day: 1 });
  const total = daysInMonth(year, month);
  const cells: (number | null)[] = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const MONTH_COLUMNS = 4;

/** Keyboard move in the 4×3 month grid. Returns null for keys the grid does not handle. */
export function moveMonth(current: YearMonth, key: string): YearMonth | null {
  const col = (current.month - 1) % MONTH_COLUMNS;
  switch (key) {
    case 'ArrowLeft':
      return addMonths(current, -1);
    case 'ArrowRight':
      return addMonths(current, 1);
    case 'ArrowUp':
      return addMonths(current, -MONTH_COLUMNS);
    case 'ArrowDown':
      return addMonths(current, MONTH_COLUMNS);
    case 'Home':
      return { year: current.year, month: current.month - col };
    case 'End':
      return { year: current.year, month: current.month - col + MONTH_COLUMNS - 1 };
    case 'PageUp':
      return { year: current.year - 1, month: current.month };
    case 'PageDown':
      return { year: current.year + 1, month: current.month };
    default:
      return null;
  }
}

/** Keyboard move in the day grid (APG date picker). Shift+PageUp/Down = year. */
export function moveDate(current: Ymd, key: string, shift = false): Ymd | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(current, -1);
    case 'ArrowRight':
      return addDays(current, 1);
    case 'ArrowUp':
      return addDays(current, -7);
    case 'ArrowDown':
      return addDays(current, 7);
    case 'Home':
      return addDays(current, -weekdayMonFirst(current));
    case 'End':
      return addDays(current, 6 - weekdayMonFirst(current));
    case 'PageUp':
      return addMonthsToDate(current, shift ? -12 : -1);
    case 'PageDown':
      return addMonthsToDate(current, shift ? 12 : 1);
    default:
      return null;
  }
}
