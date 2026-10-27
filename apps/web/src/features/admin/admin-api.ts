import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import type { FlowVersionRow, Json, Role, VersionStatus } from '../../lib/database.types';
import type { Supabase } from '../../lib/supabase';

/**
 * Admin data access. Configuration tables go through PostgREST under the Admin's own session
 * (RLS: Admins only); account actions go through the `admin-users` Edge Function, which holds
 * the service role key server-side. The client never has a service key.
 */

export type AdminErrorKey =
  // Edge Function codes (supabase/functions/admin-users/handler.ts)
  | 'origin_not_allowed'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_input'
  | 'username_taken'
  | 'not_found'
  | 'group_not_found'
  // Database
  | 'duplicate'
  | 'overlap'
  | 'immutable'
  | 'invalid_definition'
  | 'check_failed'
  | 'draft_conflict'
  | 'version_not_found'
  | 'change_note_required'
  // Client-side validation (never sent by the server)
  | 'group_name_required'
  // Transport / other
  | 'network'
  | 'unknown';

const FUNCTION_CODES = new Set<AdminErrorKey>([
  'origin_not_allowed',
  'unauthorized',
  'forbidden',
  'invalid_input',
  'username_taken',
  'not_found',
  'group_not_found',
]);

/** Non-fatal notice of a successful account action (the action itself happened). */
export type AdminWarning = 'audit_failed';

function warningOf(data: { warning?: unknown }): { warning?: AdminWarning } {
  return data.warning === 'audit_failed' ? { warning: 'audit_failed' } : {};
}

export class AdminApiError extends Error {
  constructor(readonly key: AdminErrorKey) {
    super(key);
    this.name = 'AdminApiError';
  }
}

interface PgErrorLike {
  code?: string;
  message?: string;
}

/**
 * PostgREST / Postgres error → key (never the raw message). For 22023 the stable identifier the
 * RPCs raise as message (e.g. `change_note_required`) is matched, never displayed.
 */
export function dbErrorKey(error: PgErrorLike | null | undefined): AdminErrorKey {
  switch (error?.code) {
    case 'HF002':
      return 'draft_conflict';
    case 'P0002':
      return 'version_not_found';
    case '23505':
      return 'duplicate';
    case '23P01':
      return 'overlap';
    case '42501':
    case 'PGRST301':
      return 'forbidden';
    case 'HF001':
      return 'immutable';
    case '22023':
      return error.message === 'change_note_required'
        ? 'change_note_required'
        : 'invalid_definition';
    case '23514':
    case '22P02':
      return 'check_failed';
    case undefined:
    case '':
      return 'network';
    default:
      return 'unknown';
  }
}

/** Edge Function invoke error → key, reading `{ error: { code } }` from the response body. */
export async function functionErrorKey(error: unknown): Promise<AdminErrorKey> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await (error.context as Response).json()) as { error?: { code?: unknown } };
      const code = body.error?.code;
      if (typeof code === 'string' && FUNCTION_CODES.has(code as AdminErrorKey)) {
        return code as AdminErrorKey;
      }
    } catch {
      // not JSON
    }
    return 'unknown';
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return 'network';
  }
  return 'unknown';
}

export interface AdminUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  groupIds: string[];
}

export interface AdminGroup {
  id: string;
  name: string;
  description: string;
}

export interface AdminFlowVersion {
  id: string;
  versionNo: number;
  status: VersionStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  publishedAt: string | null;
}

export interface AdminFlow {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  isArchived: boolean;
  versions: AdminFlowVersion[];
}

/** A version with everything the Version & validity screen needs (spec §14.4). */
export interface AdminVersionDetail extends AdminFlowVersion {
  changeNote: string;
  /** Username of the publisher (null for drafts or a deleted account). */
  publishedBy: string | null;
  /** Optimistic-lock token for drafts: pass back unchanged (keeps microseconds). */
  updatedAt: string;
  definition: Json;
}

export interface FlowVersions {
  flow: AdminFlow;
  versions: AdminVersionDetail[];
}

export interface PublishDraftInput {
  versionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeNote: string;
  closePrevious: boolean;
  expectedUpdatedAt: string;
}

export interface Assignment {
  id: string;
  flowId: string;
  userId: string | null;
  groupId: string | null;
}

export interface PublishFlowInput {
  code: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  definition: Json;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeNote: string;
  closePrevious: boolean;
}

export type AdminClient = Pick<Supabase, 'from' | 'rpc' | 'functions'>;

type FlowVersionDetailRow = Pick<
  FlowVersionRow,
  | 'id'
  | 'version_no'
  | 'status'
  | 'effective_from'
  | 'effective_to'
  | 'published_at'
  | 'published_by'
  | 'change_note'
  | 'updated_at'
  | 'definition'
>;

type FunctionResult<T> = { ok: true; data: T } | { ok: false; error: { code: string } };

export class AdminApi {
  constructor(private readonly sb: AdminClient) {}

  private async call<T>(body: Record<string, unknown>): Promise<T> {
    const res = await this.sb.functions.invoke<FunctionResult<T>>('admin-users', { body });
    const error: unknown = res.error;
    const data = res.data;
    if (error) throw new AdminApiError(await functionErrorKey(error));
    if (!data || !data.ok) throw new AdminApiError('unknown');
    return data.data;
  }

  private static check(error: PgErrorLike | null): void {
    if (error) throw new AdminApiError(dbErrorKey(error));
  }

  async listUsers(): Promise<AdminUser[]> {
    const [profiles, members] = await Promise.all([
      this.sb
        .from('profiles')
        .select('id, username, full_name, role, is_active, must_change_password')
        .order('username'),
      this.sb.from('group_members').select('group_id, user_id'),
    ]);
    AdminApi.check(profiles.error);
    AdminApi.check(members.error);
    const groupsOf = new Map<string, string[]>();
    for (const m of members.data ?? []) {
      groupsOf.set(m.user_id, [...(groupsOf.get(m.user_id) ?? []), m.group_id]);
    }
    return (profiles.data ?? []).map((p) => ({
      id: p.id,
      username: p.username,
      fullName: p.full_name,
      role: p.role,
      isActive: p.is_active,
      mustChangePassword: p.must_change_password,
      groupIds: groupsOf.get(p.id) ?? [],
    }));
  }

  async listGroups(): Promise<AdminGroup[]> {
    const { data, error } = await this.sb
      .from('groups')
      .select('id, name, description')
      .order('name');
    AdminApi.check(error);
    return data ?? [];
  }

  async createGroup(name: string, description: string): Promise<void> {
    const { error } = await this.sb.from('groups').insert({ name: name.trim(), description });
    AdminApi.check(error);
  }

  async updateGroup(id: string, name: string, description: string): Promise<void> {
    const { error } = await this.sb
      .from('groups')
      .update({ name: name.trim(), description })
      .eq('id', id);
    AdminApi.check(error);
  }

  async deleteGroup(id: string): Promise<void> {
    const { error } = await this.sb.from('groups').delete().eq('id', id);
    AdminApi.check(error);
  }

  async listFlows(): Promise<AdminFlow[]> {
    const [flows, versions] = await Promise.all([
      this.sb
        .from('flows')
        .select('id, code, name, description, category, instructions, is_archived')
        .order('name'),
      // No `definition`: the list only needs version metadata.
      this.sb
        .from('flow_versions')
        .select('id, flow_id, version_no, status, effective_from, effective_to, published_at')
        .order('version_no', { ascending: false }),
    ]);
    AdminApi.check(flows.error);
    AdminApi.check(versions.error);
    const byFlow = new Map<string, AdminFlowVersion[]>();
    for (const v of versions.data ?? []) {
      byFlow.set(v.flow_id, [
        ...(byFlow.get(v.flow_id) ?? []),
        {
          id: v.id,
          versionNo: v.version_no,
          status: v.status,
          effectiveFrom: v.effective_from,
          effectiveTo: v.effective_to,
          publishedAt: v.published_at,
        },
      ]);
    }
    return (flows.data ?? []).map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      description: f.description,
      category: f.category,
      instructions: f.instructions,
      isArchived: f.is_archived,
      versions: byFlow.get(f.id) ?? [],
    }));
  }

  /** Flow with all its versions, newest first, including definitions (for diff and publish). */
  async getFlowVersions(code: string): Promise<FlowVersions | null> {
    const flowRes = await this.sb
      .from('flows')
      .select('id, code, name, description, category, instructions, is_archived')
      .eq('code', code)
      .maybeSingle();
    AdminApi.check(flowRes.error);
    const f = flowRes.data;
    if (!f) return null;
    const [versions, profiles] = await Promise.all([
      this.sb
        .from('flow_versions')
        .select(
          'id, flow_id, version_no, status, effective_from, effective_to, published_at, ' +
            'published_by, change_note, updated_at, definition',
        )
        .eq('flow_id', f.id)
        .order('version_no', { ascending: false }),
      this.sb.from('profiles').select('id, username'),
    ]);
    AdminApi.check(versions.error);
    AdminApi.check(profiles.error);
    const names = new Map((profiles.data ?? []).map((p) => [p.id, p.username]));
    const rows = (versions.data ?? []) as unknown as FlowVersionDetailRow[];
    const list: AdminVersionDetail[] = rows.map((v) => ({
      id: v.id,
      versionNo: v.version_no,
      status: v.status,
      effectiveFrom: v.effective_from,
      effectiveTo: v.effective_to,
      publishedAt: v.published_at,
      publishedBy: v.published_by ? (names.get(v.published_by) ?? null) : null,
      changeNote: v.change_note,
      updatedAt: v.updated_at,
      definition: v.definition,
    }));
    return {
      flow: {
        id: f.id,
        code: f.code,
        name: f.name,
        description: f.description,
        category: f.category,
        instructions: f.instructions,
        isArchived: f.is_archived,
        versions: list,
      },
      versions: list,
    };
  }

  /** New draft with the definition of a version (rollback / continue editing). */
  async createDraftFromVersion(versionId: string): Promise<{ versionNo: number }> {
    const { data, error } = await this.sb.rpc('admin_create_draft_from_version', {
      p_version_id: versionId,
    });
    AdminApi.check(error);
    const row = data?.[0];
    if (!row) throw new AdminApiError('unknown');
    return { versionNo: row.version_no };
  }

  async publishDraft(input: PublishDraftInput): Promise<{ versionNo: number }> {
    const { data, error } = await this.sb.rpc('admin_publish_flow_draft', {
      p_version_id: input.versionId,
      p_effective_from: input.effectiveFrom,
      p_effective_to: input.effectiveTo,
      p_change_note: input.changeNote,
      p_close_previous: input.closePrevious,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    AdminApi.check(error);
    const row = data?.[0];
    if (!row) throw new AdminApiError('unknown');
    return { versionNo: row.version_no };
  }

  /** Designer: save a draft unless someone saved it since `expectedUpdatedAt` (HF002). */
  async saveDraft(versionId: string, definition: Json, expectedUpdatedAt: string): Promise<string> {
    const { data, error } = await this.sb.rpc('admin_save_flow_draft', {
      p_version_id: versionId,
      p_definition: definition,
      p_expected_updated_at: expectedUpdatedAt,
    });
    AdminApi.check(error);
    if (typeof data !== 'string') throw new AdminApiError('unknown');
    return data;
  }

  /** Designer "Tạo flow mới": flow + empty draft v1 in one transaction. */
  async createFlow(input: {
    code: string;
    name: string;
    description: string;
    category: string;
    instructions: string;
    definition: Json;
  }): Promise<{ flowId: string; versionId: string; updatedAt: string }> {
    const { data, error } = await this.sb.rpc('admin_create_flow', {
      p_code: input.code,
      p_name: input.name,
      p_description: input.description,
      p_category: input.category,
      p_instructions: input.instructions,
      p_definition: input.definition,
    });
    AdminApi.check(error);
    const row = data?.[0];
    if (!row) throw new AdminApiError('unknown');
    return { flowId: row.flow_id, versionId: row.version_id, updatedAt: row.updated_at };
  }

  /** Published → retired (the guard trigger refuses anything else). */
  async retireVersion(versionId: string): Promise<void> {
    const { data, error } = await this.sb
      .from('flow_versions')
      .update({ status: 'retired' })
      .eq('id', versionId)
      .eq('status', 'published')
      .select('id');
    AdminApi.check(error);
    if (!data || data.length === 0) throw new AdminApiError('version_not_found');
  }

  /** Change the (exclusive) end date of a published version; null = open-ended. */
  async setEffectiveTo(versionId: string, effectiveTo: string | null): Promise<void> {
    const { data, error } = await this.sb
      .from('flow_versions')
      .update({ effective_to: effectiveTo })
      .eq('id', versionId)
      .eq('status', 'published')
      .select('id');
    AdminApi.check(error);
    if (!data || data.length === 0) throw new AdminApiError('version_not_found');
  }

  /** Delete a draft (only drafts can be deleted: trigger + status filter). */
  async discardDraft(versionId: string): Promise<void> {
    const { data, error } = await this.sb
      .from('flow_versions')
      .delete()
      .eq('id', versionId)
      .eq('status', 'draft')
      .select('id');
    AdminApi.check(error);
    if (!data || data.length === 0) throw new AdminApiError('version_not_found');
  }

  async listAssignments(): Promise<Assignment[]> {
    const { data, error } = await this.sb
      .from('flow_assignments')
      .select('id, flow_id, user_id, group_id');
    AdminApi.check(error);
    return (data ?? []).map((a) => ({
      id: a.id,
      flowId: a.flow_id,
      userId: a.user_id,
      groupId: a.group_id,
    }));
  }

  async assign(flowId: string, target: { userId: string } | { groupId: string }): Promise<void> {
    const { error } = await this.sb.from('flow_assignments').insert({
      flow_id: flowId,
      ...('userId' in target ? { user_id: target.userId } : { group_id: target.groupId }),
    });
    AdminApi.check(error);
  }

  async unassign(assignmentId: string): Promise<void> {
    const { error } = await this.sb.from('flow_assignments').delete().eq('id', assignmentId);
    AdminApi.check(error);
  }

  async publishFlow(input: PublishFlowInput): Promise<{ versionNo: number }> {
    const { data, error } = await this.sb.rpc('admin_publish_flow_version', {
      p_code: input.code,
      p_name: input.name,
      p_description: input.description,
      p_category: input.category,
      p_instructions: input.instructions,
      p_definition: input.definition,
      p_effective_from: input.effectiveFrom,
      p_effective_to: input.effectiveTo,
      p_change_note: input.changeNote,
      p_close_previous: input.closePrevious,
    });
    AdminApi.check(error);
    const row = data?.[0];
    if (!row) throw new AdminApiError('unknown');
    return { versionNo: row.version_no };
  }

  async createUser(input: {
    username: string;
    fullName: string;
    role: Role;
    groupIds: string[];
  }): Promise<{
    user_id: string;
    username: string;
    temp_password: string;
    warning?: AdminWarning;
  }> {
    const data = await this.call<{
      user_id: string;
      username: string;
      temp_password: string;
      warning?: unknown;
    }>({
      action: 'create',
      username: input.username,
      full_name: input.fullName,
      role: input.role,
      group_ids: input.groupIds,
    });
    return {
      user_id: data.user_id,
      username: data.username,
      temp_password: data.temp_password,
      ...warningOf(data),
    };
  }

  async resetPassword(userId: string): Promise<{ temp_password: string; warning?: AdminWarning }> {
    const data = await this.call<{ temp_password: string; warning?: unknown }>({
      action: 'reset_password',
      user_id: userId,
    });
    return { temp_password: data.temp_password, ...warningOf(data) };
  }

  async setActive(userId: string, active: boolean): Promise<void> {
    await this.call({ action: 'set_active', user_id: userId, active });
  }

  async updateUser(
    userId: string,
    patch: { fullName?: string; role?: Role; groupIds?: string[] },
  ): Promise<void> {
    await this.call({
      action: 'update',
      user_id: userId,
      ...(patch.fullName !== undefined ? { full_name: patch.fullName } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.groupIds !== undefined ? { group_ids: patch.groupIds } : {}),
    });
  }
}

/** Unknown thrown value → key (for UI catch blocks). */
export function errorKeyOf(err: unknown): AdminErrorKey {
  return err instanceof AdminApiError ? err.key : 'unknown';
}
