import type { Supabase } from '../../../lib/supabase';
import { AdminApiError, dbErrorKey } from '../admin-api';

/**
 * `public.ui_text_overrides` for the "Văn bản giao diện" tab (spec §33 AC-TX-06), under the
 * Admin's session (RLS: Admins write). Rows are never removed: "Khôi phục mặc định" sets
 * `value` back to null. The author and time are set by the database.
 */

export interface UiTextOverride {
  key: string;
  value: string | null;
  /** Username of the last editor (null: unknown / account gone). */
  updatedBy: string | null;
  updatedAt: string;
}

export type UiTextClient = Pick<Supabase, 'from'>;

function check(error: { code?: string; message?: string } | null): void {
  if (error) throw new AdminApiError(dbErrorKey(error));
}

export async function listUiTextOverrides(sb: UiTextClient): Promise<UiTextOverride[]> {
  const { data, error } = await sb
    .from('ui_text_overrides')
    .select('key, value, updated_by, updated_at');
  check(error);
  const rows = data ?? [];
  const ids = [...new Set(rows.flatMap((r) => (r.updated_by ? [r.updated_by] : [])))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const res = await sb.from('profiles').select('id, username').in('id', ids);
    check(res.error);
    for (const p of res.data ?? []) names.set(p.id, p.username);
  }
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    updatedBy: r.updated_by ? (names.get(r.updated_by) ?? null) : null,
    updatedAt: r.updated_at,
  }));
}

/** Save an edited text; `null` = back to the default. */
export async function saveUiText(
  sb: UiTextClient,
  key: string,
  value: string | null,
): Promise<void> {
  if (value === null) return resetUiText(sb, key);
  const { error } = await sb
    .from('ui_text_overrides')
    .upsert({ key, value }, { onConflict: 'key' });
  check(error);
}

export async function resetUiText(sb: UiTextClient, key: string): Promise<void> {
  const { error } = await sb.from('ui_text_overrides').update({ value: null }).eq('key', key);
  check(error);
}

/** "Khôi phục tất cả": every edited row back to the default. */
export async function resetAllUiTexts(sb: UiTextClient): Promise<void> {
  const { error } = await sb
    .from('ui_text_overrides')
    .update({ value: null })
    .not('value', 'is', null);
  check(error);
}
