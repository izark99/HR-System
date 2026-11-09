import { textVars } from '../../../lib/text-vars';

/** Checks of an edited UI text before saving (spec §33 AC-TX-03, AC-TX-10, AC-TX-11). */

export type TextProblem =
  | { kind: 'empty' }
  | { kind: 'missing'; vars: string[] }
  | { kind: 'extra'; vars: string[] }
  | { kind: 'tooLong'; max: number }
  | { kind: 'html' };

/** Same limit as the database check on `value`. */
export const DB_MAX_LENGTH = 2000;

/** ≤ 2 × the default text, at least 40 characters (MEMORY 2026-11-09 09:14). */
export function maxLength(original: string): number {
  return Math.min(DB_MAX_LENGTH, Math.max(40, 2 * original.length));
}

/** A tag or a comment / doctype ("<b", "</", "<!", "<?"); "<>" or "<5" are plain text. */
export function hasHtml(text: string): boolean {
  return /<[A-Za-z/!?]/.test(text);
}

/** First problem of `text` (checked in this order), null when it can be saved. */
export function checkText(original: string, text: string): TextProblem | null {
  if (text.trim() === '') return { kind: 'empty' };
  const need = textVars(original);
  const have = textVars(text);
  const missing = need.filter((v) => !have.includes(v));
  if (missing.length > 0) return { kind: 'missing', vars: missing };
  const extra = have.filter((v) => !need.includes(v));
  if (extra.length > 0) return { kind: 'extra', vars: extra };
  const max = maxLength(original);
  if (text.length > max) return { kind: 'tooLong', max };
  if (hasHtml(text)) return { kind: 'html' };
  return null;
}

/**
 * AC-TX-11: a variable typed without its format (`{{count}}`) gets back the format of the
 * default text (`{{count, number}}`), so numbers keep their Vietnamese grouping. Applied when
 * saving.
 */
export function restoreFormats(original: string, text: string): string {
  const formatted = new Map<string, string>();
  for (const m of original.matchAll(/{{-?\s*([\w.]+)\s*,[^}]*}}/g)) {
    if (!formatted.has(m[1]!)) formatted.set(m[1]!, m[0]);
  }
  return text.replace(/{{\s*([\w.]+)\s*}}/g, (all, name: string) => formatted.get(name) ?? all);
}

/** What is stored for `typed`: null = back to the default (same text as the default). */
export function valueToSave(original: string, typed: string): string | null {
  const value = restoreFormats(original, typed);
  return value === original ? null : value;
}

/** Fixed sample values of the preview (fake data only). */
export const SAMPLE_VALUES: Record<string, string> = {
  period: '09/2026',
  count: '9',
  total: '1.411',
  file: 'luong_CN01.xlsx',
  files: '2',
  row: '12',
  rows: '1.200',
  column: 'Mã NV',
  columns: 'Mã NV',
  value: 'NV0012',
  sheet: 'Sheet1',
  side: 'bảng lương',
  slot: 'Bảng lương',
  name: 'Đối chiếu lương – công',
  node: 'Đối chiếu',
  min: '2',
  max: '50',
  n: '3',
  version: 'v3',
  date: '01/10/2026',
};

/** Text with every variable replaced by a sample value (unknown variable: its name). */
export function fillSample(text: string): string {
  return text.replace(
    /{{-?\s*([\w.]+)[^}]*}}/g,
    (_all, name: string) => SAMPLE_VALUES[name] ?? name,
  );
}

/** Lower case without Vietnamese diacritics, for the search (AC-TX-09). */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Text split into plain parts and `{{…}}` variables (highlighted in the table). */
export function splitVars(text: string): { text: string; isVar: boolean }[] {
  const parts: { text: string; isVar: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(/{{[^}]*}}/g)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index), isVar: false });
    parts.push({ text: m[0], isVar: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), isVar: false });
  return parts;
}
