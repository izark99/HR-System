/**
 * Pure helpers of the custom Select (spec §25.3 "Select (dropdown)"): flattening groups, search
 * filtering (case- and accent-insensitive, Vietnamese "đ" included) and type-ahead matching.
 */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectGroup {
  /** Group header, shown as an eyebrow (e.g. "Tài khoản" / "Nhóm"). */
  label: string;
  options: SelectOption[];
}

/** Options and groups in display order; options without a group come first. */
export interface SelectSection {
  label: string | null;
  options: SelectOption[];
}

/** Above this many options the popover shows a search box. */
export const SEARCH_THRESHOLD = 8;

export function sectionsOf(
  options: readonly SelectOption[] | undefined,
  groups: readonly SelectGroup[] | undefined,
): SelectSection[] {
  const out: SelectSection[] = [];
  if (options && options.length > 0) out.push({ label: null, options: [...options] });
  for (const g of groups ?? []) {
    if (g.options.length > 0) out.push({ label: g.label, options: [...g.options] });
  }
  return out;
}

export function flatten(sections: readonly SelectSection[]): SelectOption[] {
  return sections.flatMap((s) => s.options);
}

/** Lower case, no diacritics, "đ" → "d", trimmed: "Đặng Văn" → "dang van". */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
}

/** Sections keeping only options whose label contains the query (empty sections dropped). */
export function filterSections(sections: readonly SelectSection[], query: string): SelectSection[] {
  const q = foldText(query);
  if (!q) return [...sections];
  return sections
    .map((s) => ({ ...s, options: s.options.filter((o) => foldText(o.label).includes(q)) }))
    .filter((s) => s.options.length > 0);
}

/**
 * Type-ahead: index of the option to move to for the typed `buffer`. A single repeated character
 * cycles through the options starting with it (after `from`); a longer buffer matches the first
 * option starting with it, searching from `from` (inclusive) and wrapping around. -1 = none.
 */
export function typeAheadIndex(
  options: readonly SelectOption[],
  buffer: string,
  from: number,
): number {
  const q = foldText(buffer);
  if (!q || options.length === 0) return -1;
  const repeated = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0]! : q;
  const start = repeated || q.length === 1 ? from + 1 : Math.max(from, 0);
  for (let k = 0; k < options.length; k++) {
    const i = (((start + k) % options.length) + options.length) % options.length;
    if (foldText(options[i]!.label).startsWith(needle)) return i;
  }
  return -1;
}
