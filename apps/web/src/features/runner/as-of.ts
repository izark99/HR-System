import type { FlowParam } from '@hrflow/flow-schema';
import type { ParamValues } from '../../engine/protocol';

/** Today in the browser's local time zone, YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function isValidDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The param marked `isAsOfDate` (spec §14.2), if any. */
export function asOfParam(params: readonly FlowParam[]): FlowParam | undefined {
  return params.find((p) => p.isAsOfDate && (p.type === 'month' || p.type === 'date'));
}

/**
 * As-of date for version resolution (spec §14.2): the `isAsOfDate` param — a month means its
 * first day — or today when the flow has none or it is not filled in (yet).
 */
export function asOfFromParams(
  params: readonly FlowParam[],
  values: ParamValues,
  today: string,
): string {
  const p = asOfParam(params);
  if (!p) return today;
  const v = String(values[p.key] ?? '').trim();
  if (p.type === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(v);
    if (m && isValidDate(Number(m[1]), Number(m[2]), 1)) return `${v}-01`;
    return today;
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (d && isValidDate(Number(d[1]), Number(d[2]), Number(d[3]))) return v;
  return today;
}
