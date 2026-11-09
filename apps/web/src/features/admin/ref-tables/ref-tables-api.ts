import type { Json, RefVersionStatus } from '../../../lib/database.types';
import type { Supabase } from '../../../lib/supabase';
import { dbErrorKey, type AdminErrorKey } from '../admin-api';
import { parseColumns, type RefColumn, type RefRow } from './model';

/**
 * Reference tables data access (spec §34), under the Admin's own session: PostgREST + the RPCs of
 * supabase/migrations/20261109150000_ref_tables.sql (RLS: Admins only). Rows are reference data,
 * never personal data; nothing here is logged.
 */

/** Errors specific to reference tables (22023 messages raised by the database). */
export type RefErrorKey =
  | 'invalid_columns'
  | 'invalid_rows'
  | 'rows_too_many'
  | 'rows_too_large'
  | 'key_blank'
  | 'duplicate_key';

export type RefApiErrorKey = AdminErrorKey | RefErrorKey;

const REF_KEYS = new Set<string>([
  'invalid_columns',
  'invalid_rows',
  'rows_too_many',
  'rows_too_large',
  'key_blank',
  'duplicate_key',
]);

export class RefApiError extends Error {
  constructor(readonly key: RefApiErrorKey) {
    super(key);
    this.name = 'RefApiError';
  }
}

export function refErrorKey(error: { code?: string; message?: string } | null): RefApiErrorKey {
  if (error?.code === '22023' && REF_KEYS.has(error.message ?? ''))
    return error.message as RefErrorKey;
  return dbErrorKey(error);
}

/** Key of any thrown value (unknown errors → `unknown`). */
export function refErrorOf(e: unknown): RefApiErrorKey {
  return e instanceof RefApiError ? e.key : 'unknown';
}

/** i18n key of an error: shared Admin texts, or the reference-table ones. */
export function refErrorText(key: RefApiErrorKey): string {
  return REF_KEYS.has(key) ? `refTables:errors.${key}` : `common:admin.errors.${key}`;
}

export interface RefVersionMeta {
  id: string;
  tableId: string;
  versionNo: number;
  /** Discarded drafts are never listed. */
  status: Exclude<RefVersionStatus, 'discarded'>;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  changeNote: string;
  rowCount: number;
  publishedAt: string | null;
  /** Username (null: unknown / removed account). */
  publishedBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface RefTable {
  id: string;
  code: string;
  name: string;
  description: string;
  columns: RefColumn[];
  updatedAt: string;
  /** Newest first, discarded drafts left out. */
  versions: RefVersionMeta[];
}

export interface RefUsage {
  flowId: string;
  flowCode: string;
  flowName: string;
  versionNo: number;
  status: 'draft' | 'published' | 'retired';
}

export interface SaveTableInput {
  id: string | null;
  code: string;
  name: string;
  description: string;
  columns: RefColumn[];
  expectedUpdatedAt: string | null;
  /** Column keys confirmed "not personal data" (audited). */
  personalDataColumns: string[];
}

export type RefClient = Pick<Supabase, 'from' | 'rpc'>;

const VERSION_COLUMNS =
  'id, ref_table_id, version_no, status, effective_from, effective_to, change_note, row_count, ' +
  'published_at, published_by, updated_at, updated_by';

interface VersionRowMeta {
  id: string;
  ref_table_id: string;
  version_no: number;
  status: RefVersionStatus;
  effective_from: string | null;
  effective_to: string | null;
  change_note: string;
  row_count: number;
  published_at: string | null;
  published_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export class RefTablesApi {
  constructor(private readonly sb: RefClient) {}

  private static check(error: { code?: string; message?: string } | null): void {
    if (error) throw new RefApiError(refErrorKey(error));
  }

  private async usernames(): Promise<Map<string, string>> {
    const { data, error } = await this.sb.from('profiles').select('id, username');
    RefTablesApi.check(error);
    return new Map((data ?? []).map((p) => [p.id, p.username]));
  }

  private static version(v: VersionRowMeta, names: Map<string, string>): RefVersionMeta {
    return {
      id: v.id,
      tableId: v.ref_table_id,
      versionNo: v.version_no,
      status: v.status === 'discarded' ? 'retired' : v.status,
      effectiveFrom: v.effective_from,
      effectiveTo: v.effective_to,
      changeNote: v.change_note,
      rowCount: v.row_count,
      publishedAt: v.published_at,
      publishedBy: v.published_by ? (names.get(v.published_by) ?? null) : null,
      updatedAt: v.updated_at,
      updatedBy: v.updated_by ? (names.get(v.updated_by) ?? null) : null,
    };
  }

  /** Every table with its versions (no rows), by code. */
  async listTables(code?: string): Promise<RefTable[]> {
    let tables = this.sb
      .from('ref_tables')
      .select('id, code, name, description, columns, updated_at')
      .order('code');
    if (code) tables = tables.eq('code', code);
    let versions = this.sb
      .from('ref_table_versions')
      .select(VERSION_COLUMNS)
      .neq('status', 'discarded')
      .order('version_no', { ascending: false });
    const [t, names] = await Promise.all([tables, this.usernames()]);
    RefTablesApi.check(t.error);
    const list = t.data ?? [];
    if (code) {
      if (list.length === 0) return [];
      versions = versions.eq('ref_table_id', list[0]!.id);
    }
    const v = await versions;
    RefTablesApi.check(v.error);
    const byTable = new Map<string, RefVersionMeta[]>();
    for (const row of (v.data ?? []) as unknown as VersionRowMeta[]) {
      byTable.set(row.ref_table_id, [
        ...(byTable.get(row.ref_table_id) ?? []),
        RefTablesApi.version(row, names),
      ]);
    }
    return list.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      columns: parseColumns(r.columns),
      updatedAt: r.updated_at,
      versions: byTable.get(r.id) ?? [],
    }));
  }

  async getTable(code: string): Promise<RefTable | null> {
    return (await this.listTables(code))[0] ?? null;
  }

  /** Rows of one version (up to 50,000). */
  async getRows(versionId: string): Promise<RefRow[]> {
    const { data, error } = await this.sb
      .from('ref_table_versions')
      .select('id, rows')
      .eq('id', versionId)
      .maybeSingle();
    RefTablesApi.check(error);
    if (!data) throw new RefApiError('version_not_found');
    return Array.isArray(data.rows) ? (data.rows as RefRow[]) : [];
  }

  /** Flows using each table (by code): `input.refTable` nodes and list parameters. */
  async usage(): Promise<Map<string, RefUsage[]>> {
    const { data, error } = await this.sb.rpc('admin_ref_table_usage');
    RefTablesApi.check(error);
    const out = new Map<string, RefUsage[]>();
    for (const u of data ?? []) {
      out.set(u.ref_table_code, [
        ...(out.get(u.ref_table_code) ?? []),
        {
          flowId: u.flow_id,
          flowCode: u.flow_code,
          flowName: u.flow_name,
          versionNo: u.version_no,
          status: u.status,
        },
      ]);
    }
    return out;
  }

  async saveTable(input: SaveTableInput): Promise<{ id: string; updatedAt: string }> {
    const { data, error } = await this.sb.rpc('admin_save_ref_table', {
      p_id: input.id,
      p_code: input.code,
      p_name: input.name,
      p_description: input.description,
      p_columns: input.columns as unknown as Json,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_personal_data_columns: input.personalDataColumns,
    });
    RefTablesApi.check(error);
    const row = data?.[0];
    if (!row) throw new RefApiError('unknown');
    return { id: row.ref_table_id, updatedAt: row.updated_at };
  }

  /**
   * Replace every row of the draft (import / "Lưu draft"); creates the draft when the table has
   * none (`expectedUpdatedAt` null). Conflict (HF002) when another save came first.
   */
  async replaceDraft(
    tableId: string,
    rows: RefRow[],
    expectedUpdatedAt: string | null,
    personalDataColumns: string[] = [],
  ): Promise<{ versionId: string; versionNo: number; updatedAt: string }> {
    const { data, error } = await this.sb.rpc('admin_replace_ref_table_draft', {
      p_ref_table_id: tableId,
      p_rows: rows as unknown as Json,
      p_expected_updated_at: expectedUpdatedAt,
      p_personal_data_columns: personalDataColumns,
    });
    RefTablesApi.check(error);
    const row = data?.[0];
    if (!row) throw new RefApiError('unknown');
    return { versionId: row.version_id, versionNo: row.version_no, updatedAt: row.updated_at };
  }

  async createDraftFrom(versionId: string): Promise<{ versionNo: number }> {
    const { data, error } = await this.sb.rpc('admin_create_ref_draft_from_version', {
      p_version_id: versionId,
    });
    RefTablesApi.check(error);
    const row = data?.[0];
    if (!row) throw new RefApiError('unknown');
    return { versionNo: row.version_no };
  }

  async publish(input: {
    versionId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    changeNote: string;
    closePrevious: boolean;
    expectedUpdatedAt: string;
  }): Promise<{ versionNo: number }> {
    const { data, error } = await this.sb.rpc('admin_publish_ref_table_draft', {
      p_version_id: input.versionId,
      p_effective_from: input.effectiveFrom,
      p_effective_to: input.effectiveTo,
      p_change_note: input.changeNote,
      p_close_previous: input.closePrevious,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    RefTablesApi.check(error);
    const row = data?.[0];
    if (!row) throw new RefApiError('unknown');
    return { versionNo: row.version_no };
  }

  private async patch(
    id: string,
    status: RefVersionStatus,
    body: { status?: RefVersionStatus; effective_to?: string | null },
  ): Promise<void> {
    const { data, error } = await this.sb
      .from('ref_table_versions')
      .update(body)
      .eq('id', id)
      .eq('status', status)
      .select('id');
    RefTablesApi.check(error);
    // Nothing matched: changed meanwhile (e.g. already published by another Admin).
    if (!data || data.length === 0) throw new RefApiError('draft_conflict');
  }

  retire(id: string): Promise<void> {
    return this.patch(id, 'published', { status: 'retired' });
  }

  /** "Hủy draft": the row stays (status discarded), hidden; its number is not reused. */
  discard(id: string): Promise<void> {
    return this.patch(id, 'draft', { status: 'discarded' });
  }

  setEffectiveTo(id: string, effectiveTo: string | null): Promise<void> {
    return this.patch(id, 'published', { effective_to: effectiveTo });
  }
}
