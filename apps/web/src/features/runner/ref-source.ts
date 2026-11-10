import type { RefColumnDef, RefTableDef } from '../../engine/core/types';
import type { Supabase } from '../../lib/supabase';

/**
 * Reference tables for the run page and the Designer (spec §34 AC-RT-07..10, 15): definitions and
 * PUBLISHED versions (metadata) read under the caller's RLS — a User only sees the tables of the
 * flows assigned to them — and the rows of one version on demand. Rows stay in the memory of the
 * open page (never localStorage / IndexedDB / Cache Storage / URL, never logged).
 * Loaded with the run page / Designer chunks, never with the app entry.
 */

export interface RefVersionInfo {
  id: string;
  versionNo: number;
  /** ISO dates; `effectiveTo` exclusive, null = open-ended. */
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface RefTableMeta {
  id: string;
  code: string;
  name: string;
  columns: RefColumnDef[];
  /** Published versions, oldest first. */
  versions: RefVersionInfo[];
}

export type RefClient = Pick<Supabase, 'from'>;

/** Failure reading reference tables (server or network). */
export class RefSourceError extends Error {
  constructor() {
    super('reference tables unavailable');
    this.name = 'RefSourceError';
  }
}

const TYPES = new Set<RefColumnDef['type']>(['string', 'integer', 'decimal', 'date', 'boolean']);

/** `ref_tables.columns` → key / title / type (other attributes are for the Admin screens). */
export function parseRefColumns(raw: unknown): RefColumnDef[] {
  if (!Array.isArray(raw)) return [];
  const out: RefColumnDef[] = [];
  for (const c of raw as unknown[]) {
    if (typeof c !== 'object' || c === null) continue;
    const { key, title, type } = c as Record<string, unknown>;
    if (typeof key !== 'string' || !TYPES.has(type as RefColumnDef['type'])) continue;
    out.push({
      key,
      title: typeof title === 'string' && title.trim() ? title : key,
      type: type as RefColumnDef['type'],
    });
  }
  return out;
}

/** Tables (all readable ones, or those of `codes`) with their published versions. */
export async function loadRefCatalog(
  sb: RefClient,
  codes?: readonly string[],
): Promise<RefTableMeta[]> {
  if (codes && codes.length === 0) return [];
  let tables = sb.from('ref_tables').select('id, code, name, columns').order('code');
  if (codes) tables = tables.in('code', [...codes]);
  const t = await tables;
  if (t.error) throw new RefSourceError();
  const list = t.data ?? [];
  if (list.length === 0) return [];
  const v = await sb
    .from('ref_table_versions')
    .select('id, ref_table_id, version_no, effective_from, effective_to')
    .eq('status', 'published')
    .in(
      'ref_table_id',
      list.map((r) => r.id),
    )
    .order('version_no');
  if (v.error) throw new RefSourceError();
  const byTable = new Map<string, RefVersionInfo[]>();
  for (const r of v.data ?? []) {
    if (!r.effective_from) continue;
    byTable.set(r.ref_table_id, [
      ...(byTable.get(r.ref_table_id) ?? []),
      {
        id: r.id,
        versionNo: r.version_no,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
      },
    ]);
  }
  return list.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    columns: parseRefColumns(r.columns),
    versions: byTable.get(r.id) ?? [],
  }));
}

/** Rows of one version (array of objects keyed by column key). */
export async function loadRefRows(sb: RefClient, versionId: string): Promise<unknown[]> {
  const { data, error } = await sb
    .from('ref_table_versions')
    .select('id, rows')
    .eq('id', versionId)
    .maybeSingle();
  if (error || !data) throw new RefSourceError();
  return Array.isArray(data.rows) ? data.rows : [];
}

/** The published version effective on `asOf` (`effective_from ≤ asOf < effective_to`), if any. */
export function effectiveVersion(
  versions: readonly RefVersionInfo[],
  asOf: string,
): RefVersionInfo | null {
  return (
    versions.find(
      (v) => v.effectiveFrom <= asOf && (v.effectiveTo === null || asOf < v.effectiveTo),
    ) ?? null
  );
}

/** Definitions for the engine's design check (`published`: has a published version). */
export function refDefinitions(tables: readonly RefTableMeta[]): Record<string, RefTableDef> {
  return Object.fromEntries(
    tables.map((t) => [
      t.code,
      { code: t.code, name: t.name, columns: t.columns, published: t.versions.length > 0 },
    ]),
  );
}

/** Text of a cell for a list option: decimals and dates as stored, booleans as TRUE/FALSE. */
function optionText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/**
 * Options of a list param taken from a table (AC-RT-10): one per row with a value, in row order,
 * duplicates dropped; shown as "value – label" when the label says more than the value.
 */
export function refParamOptions(
  rows: readonly unknown[],
  valueColumn: string,
  labelColumn: string,
): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const value = optionText(r[valueColumn]).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const label = optionText(r[labelColumn]).trim();
    out.push({ value, label: label && label !== value ? `${value} – ${label}` : value });
  }
  return out;
}
