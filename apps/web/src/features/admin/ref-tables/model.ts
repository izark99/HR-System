/**
 * Reference tables (spec §34): column definitions, cell values, keys, size and diff. Pure
 * functions (no React, no network), shared by the screens, the grid and the unit tests.
 *
 * Stored rows are JSON objects keyed by column key (supabase/migrations/20261109150000):
 * string → string, integer → number, decimal → canonical text ("12.5"), date → "yyyy-mm-dd",
 * boolean → true/false; a blank cell is absent. Reference data is never personal data.
 */

export const REF_TYPES = ['string', 'integer', 'decimal', 'date', 'boolean'] as const;
export type RefType = (typeof REF_TYPES)[number];

export interface RefColumn {
  /** Identifier used by flows: `[a-z][a-z0-9_]*`, ≤ 63 characters. */
  key: string;
  title: string;
  type: RefType;
  /** Other header texts accepted in an imported file (the title always is). */
  aliases: string[];
  isKey: boolean;
}

export type RefValue = string | number | boolean;
export type RefRow = Record<string, RefValue | null | undefined>;

/** Limits of one version (checked again by the database). */
export const MAX_ROWS = 50_000;
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_COLUMNS = 100;

export const TABLE_CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const COLUMN_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;

// ---- text folding (diacritics, case, spaces) ---------------------------------------------------

/** Lower case, no Vietnamese marks, `_`/`-`/`.` and runs of spaces as one space. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Suggested column key from a title ("Mã chi nhánh" → "ma_chi_nhanh"). */
export function keyFromTitle(title: string): string {
  const slug = fold(title)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
  if (!slug) return '';
  return /^[a-z]/.test(slug) ? slug : `c_${slug}`.slice(0, 63);
}

// ---- personal data heuristic (AC-RT-05) --------------------------------------------------------

/**
 * Words of column names that usually hold personal data (spec §17), folded. Matched as whole
 * words (or a whole glued token like "hoten"), so "Tên chi nhánh" or "Vùng" never match.
 */
const PERSONAL_PATTERNS = [
  'ho ten',
  'ho va ten',
  'hoten',
  'full name',
  'fullname',
  'ten nhan vien',
  'ten nv',
  'ma nv',
  'ma nhan vien',
  'manv',
  'msnv',
  'ma so nhan vien',
  'employee',
  'employee id',
  'cccd',
  'cmnd',
  'can cuoc',
  'chung minh nhan dan',
  'ho chieu',
  'passport',
  'so dien thoai',
  'dien thoai',
  'sodienthoai',
  'sdt',
  'dtdd',
  'phone',
  'mobile',
  'email',
  'e mail',
  'thu dien tu',
  'ngay sinh',
  'ngaysinh',
  'nam sinh',
  'dob',
  'birthday',
  'date of birth',
  'dia chi',
  'diachi',
  'address',
  'noi o',
  'que quan',
  'so tai khoan',
  'stk',
  'tai khoan ngan hang',
  'bank account',
  'ma so thue ca nhan',
  'mst ca nhan',
  'so bhxh',
  'so so bhxh',
  'ma bhxh',
  'gioi tinh',
] as const;

/** True when a column name looks like personal data. */
export function looksPersonal(text: string): boolean {
  const words = ` ${fold(text)} `;
  return PERSONAL_PATTERNS.some((p) => words.includes(` ${p} `));
}

/** Columns whose title, key or one of the aliases looks personal. */
export function personalColumns(columns: readonly RefColumn[]): RefColumn[] {
  return columns.filter(
    (c) => looksPersonal(c.title) || looksPersonal(c.key) || c.aliases.some(looksPersonal),
  );
}

// ---- column definitions (AC-RT-02) -------------------------------------------------------------

export type ColumnProblem =
  | 'keyInvalid'
  | 'keyDuplicate'
  | 'titleRequired'
  | 'titleDuplicate'
  | 'aliasTooMany'
  | 'aliasTooLong';

/** Problems of one column inside the list (index `i`); empty = fine. */
export function columnProblems(columns: readonly RefColumn[], i: number): ColumnProblem[] {
  const c = columns[i]!;
  const out: ColumnProblem[] = [];
  if (!COLUMN_KEY_RE.test(c.key)) out.push('keyInvalid');
  else if (columns.some((o, j) => j !== i && o.key === c.key)) out.push('keyDuplicate');
  const title = c.title.trim();
  if (!title || title.length > 120) out.push('titleRequired');
  else if (columns.some((o, j) => j !== i && fold(o.title) === fold(title)))
    out.push('titleDuplicate');
  if (c.aliases.length > 20) out.push('aliasTooMany');
  if (c.aliases.some((a) => a.trim().length > 120)) out.push('aliasTooLong');
  return out;
}

export type TableProblem = 'codeInvalid' | 'nameRequired' | 'noColumns' | 'noKey' | 'tooMany';

export function tableProblems(code: string, name: string, columns: readonly RefColumn[]) {
  const out: TableProblem[] = [];
  if (!TABLE_CODE_RE.test(code)) out.push('codeInvalid');
  if (!name.trim() || name.trim().length > 160) out.push('nameRequired');
  if (columns.length === 0) out.push('noColumns');
  else if (!columns.some((c) => c.isKey)) out.push('noKey');
  if (columns.length > MAX_COLUMNS) out.push('tooMany');
  return out;
}

/** Column list as stored: trimmed title, aliases trimmed, blank and repeated ones removed. */
export function cleanColumns(columns: readonly RefColumn[]): RefColumn[] {
  return columns.map((c) => {
    const title = c.title.trim();
    const seen = new Set([fold(title)]);
    const aliases: string[] = [];
    for (const a of c.aliases) {
      const t = a.trim();
      if (!t || seen.has(fold(t))) continue;
      seen.add(fold(t));
      aliases.push(t);
    }
    return { key: c.key, title, type: c.type, aliases, isKey: c.isKey };
  });
}

/** Column definitions read back from the database (unknown shapes dropped). */
export function parseColumns(raw: unknown): RefColumn[] {
  if (!Array.isArray(raw)) return [];
  const out: RefColumn[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    if (!c || typeof c.key !== 'string' || typeof c.title !== 'string') continue;
    const type = REF_TYPES.includes(c.type as RefType) ? (c.type as RefType) : 'string';
    const aliases = Array.isArray(c.aliases)
      ? c.aliases.filter((a): a is string => typeof a === 'string')
      : [];
    out.push({ key: c.key, title: c.title, type, aliases, isKey: c.isKey === true });
  }
  return out;
}

/** What changes between two column lists (for the warning listing the flows, AC-RT-02). */
export function columnChanges(before: readonly RefColumn[], after: readonly RefColumn[]) {
  const removed = before.filter((b) => !after.some((a) => a.key === b.key)).map((c) => c.key);
  const added = after.filter((a) => !before.some((b) => b.key === a.key)).map((c) => c.key);
  const retyped = after
    .filter((a) => before.some((b) => b.key === a.key && b.type !== a.type))
    .map((c) => c.key);
  return { removed, added, retyped, any: removed.length + added.length + retyped.length > 0 };
}

// ---- cell values -------------------------------------------------------------------------------

export type CellProblem = 'type' | 'keyBlank' | 'keyDuplicate' | 'tooPrecise';
export type ParseResult =
  { ok: true; value: RefValue | null } | { ok: false; problem: CellProblem };

const TRUE_WORDS = new Set(['true', 'dung', 'co', 'x', '1', 'yes']);
const FALSE_WORDS = new Set(['false', 'sai', 'khong', '0', 'no']);

/** "0012.500" → "12.5", "-0" → "0". Input must match /^-?\d+(\.\d+)?$/. */
function canonicalDecimal(text: string): string {
  const neg = text.startsWith('-');
  const [int = '', frac = ''] = (neg ? text.slice(1) : text).split('.');
  const i = int.replace(/^0+(?=\d)/, '');
  const f = frac.replace(/0+$/, '');
  const body = f ? `${i}.${f}` : i;
  return neg && body !== '0' ? `-${body}` : body;
}

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  return d <= days;
}

/**
 * Text typed or pasted in a grid cell → stored value. Blank → null. Numbers use "." as decimal
 * separator (like `transform.formula`); dates are dd/MM/yyyy or yyyy-mm-dd.
 */
export function parseCell(text: string, type: RefType): ParseResult {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  switch (type) {
    case 'string':
      return { ok: true, value: t };
    case 'integer': {
      if (!/^[+-]?\d+$/.test(t)) return { ok: false, problem: 'type' };
      const n = Number(t);
      return Number.isSafeInteger(n) ? { ok: true, value: n } : { ok: false, problem: 'type' };
    }
    case 'decimal': {
      const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(t);
      if (!m || (m[2] === '' && !m[3])) return { ok: false, problem: 'type' };
      const int = m[2] || '0';
      const frac = (m[3] ?? '').replace(/0+$/, '');
      if (frac.length > 10 || int.replace(/^0+/, '').length > 28)
        return { ok: false, problem: 'tooPrecise' };
      return {
        ok: true,
        value: canonicalDecimal(`${m[1] === '-' ? '-' : ''}${int}${frac ? `.${frac}` : ''}`),
      };
    }
    case 'date': {
      let y: number, mo: number, d: number;
      let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
      if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)))
        [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else return { ok: false, problem: 'type' };
      if (!validDate(y, mo, d)) return { ok: false, problem: 'type' };
      const p = (n: number, w = 2) => String(n).padStart(w, '0');
      return { ok: true, value: `${p(y, 4)}-${p(mo)}-${p(d)}` };
    }
    case 'boolean': {
      const w = fold(t);
      if (TRUE_WORDS.has(w)) return { ok: true, value: true };
      if (FALSE_WORDS.has(w)) return { ok: true, value: false };
      return { ok: false, problem: 'type' };
    }
  }
}

/** Stored value → text shown and edited in the grid (dates dd/MM/yyyy, booleans TRUE/FALSE). */
export function formatCell(value: RefValue | null | undefined, type: RefType): string {
  if (value === null || value === undefined) return '';
  if (type === 'date' && typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
  }
  if (type === 'boolean')
    return value === true ? 'TRUE' : value === false ? 'FALSE' : String(value);
  return String(value);
}

// ---- keys --------------------------------------------------------------------------------------

/**
 * Comparable key of a row (key columns only): text compared without case, NFC, spaces collapsed
 * (like the slot `unique` rule and the database check); null when a key cell is blank.
 */
export function rowKey(row: RefRow, keyColumns: readonly RefColumn[]): string | null {
  const parts: string[] = [];
  for (const c of keyColumns) {
    const v = row[c.key];
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
    parts.push(
      typeof v === 'string'
        ? v.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
        : String(v),
    );
  }
  return parts.join('\u001f');
}

/** Key shown to people ("CN01" or "CN01 · 2"). */
export function keyLabel(row: RefRow, keyColumns: readonly RefColumn[]): string {
  return keyColumns.map((c) => formatCell(row[c.key], c.type)).join(' · ');
}

// ---- size (AC-RT-01) ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Rows as stored: blank cells left out, keys in column order. */
export function compactRow(row: RefRow, columns: readonly RefColumn[]): Record<string, RefValue> {
  const out: Record<string, RefValue> = {};
  for (const c of columns) {
    const v = row[c.key];
    if (v !== null && v !== undefined) out[c.key] = v;
  }
  return out;
}

/**
 * Bytes of the rows in the database (`octet_length(rows::text)`): JSON with jsonb's spacing,
 * one space after each `:` and `,` (the limit is checked on that figure).
 */
export function rowsBytes(rows: readonly Record<string, RefValue>[]): number {
  if (rows.length === 0) return 2;
  let total = 2 + (rows.length - 1) * 2; // "[" "]" and ", " between rows
  for (const r of rows) {
    const keys = Object.keys(r).length;
    total += encoder.encode(JSON.stringify(r)).length + keys + Math.max(0, keys - 1);
  }
  return total;
}

// ---- diff by key (AC-RT-06) --------------------------------------------------------------------

export interface RowChange {
  key: string;
  before: RefRow;
  after: RefRow;
  /** Keys of the columns that differ. */
  columns: string[];
}

export interface RowDiff {
  added: RefRow[];
  removed: RefRow[];
  changed: RowChange[];
  unchanged: number;
}

function same(a: RefValue | null | undefined, b: RefValue | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/** Rows added / removed / changed between two versions, matched by key (current columns). */
export function diffRows(
  columns: readonly RefColumn[],
  before: readonly RefRow[],
  after: readonly RefRow[],
): RowDiff {
  const keyCols = columns.filter((c) => c.isKey);
  const old = new Map<string, RefRow>();
  for (const r of before) {
    const k = rowKey(r, keyCols);
    if (k !== null && !old.has(k)) old.set(k, r);
  }
  const diff: RowDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  const seen = new Set<string>();
  for (const r of after) {
    const k = rowKey(r, keyCols);
    if (k === null || seen.has(k)) continue;
    seen.add(k);
    const o = old.get(k);
    if (!o) {
      diff.added.push(r);
      continue;
    }
    const cols = columns.filter((c) => !same(o[c.key], r[c.key])).map((c) => c.key);
    if (cols.length === 0) diff.unchanged++;
    else diff.changed.push({ key: keyLabel(r, keyCols), before: o, after: r, columns: cols });
  }
  for (const [k, r] of old) if (!seen.has(k)) diff.removed.push(r);
  return diff;
}
