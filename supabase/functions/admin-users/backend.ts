/**
 * Service-role implementation of AdminBackend. The service key exists only inside the Edge
 * Function runtime (env), never in the web app.
 */
import { createClient } from '@supabase/supabase-js';
import { AdminError, type AdminBackend, type ProfileRow } from './handler.ts';

/** Long ban = locked until an Admin unlocks (GoTrue has no "forever"). */
const BAN_DURATION = '876000h';

interface DbError {
  code?: string;
}

function check(error: DbError | null): void {
  if (error) throw new Error(`db error ${error.code ?? ''}`.trim());
}

export function createBackend(url: string, serviceKey: string): AdminBackend {
  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async userIdFromToken(token) {
      const { data, error } = await sb.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },

    async getProfile(id) {
      const { data, error } = await sb
        .from('profiles')
        .select('id, username, full_name, role, is_active')
        .eq('id', id)
        .maybeSingle();
      check(error);
      const row: ProfileRow | null = data;
      return row;
    },

    async usernameExists(username) {
      const { count, error } = await sb
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('username', username);
      check(error);
      return (count ?? 0) > 0;
    },

    async missingGroups(ids) {
      const { data, error } = await sb
        .from('groups')
        .select('id')
        .in('id', [...ids]);
      check(error);
      const found = new Set(((data ?? []) as { id: string }[]).map((g) => g.id));
      return ids.filter((id) => !found.has(id));
    },

    async createAuthUser(email, password, username) {
      const { data, error } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username },
      });
      if (error) {
        if (error.code === 'email_exists' || error.status === 422) {
          throw new AdminError('username_taken');
        }
        throw new Error(`auth error ${error.code ?? error.status ?? ''}`.trim());
      }
      return data.user.id;
    },

    async deleteAuthUser(id) {
      const { error } = await sb.auth.admin.deleteUser(id);
      if (error) throw new Error(`auth error ${error.code ?? ''}`.trim());
    },

    async setPassword(id, password) {
      const { error } = await sb.auth.admin.updateUserById(id, { password });
      if (error) throw new Error(`auth error ${error.code ?? ''}`.trim());
    },

    async setBanned(id, banned) {
      const { error } = await sb.auth.admin.updateUserById(id, {
        ban_duration: banned ? BAN_DURATION : 'none',
      });
      if (error) throw new Error(`auth error ${error.code ?? ''}`.trim());
    },

    async revokeSessions(id) {
      const { error } = await sb.rpc('admin_revoke_user_sessions', { p_user_id: id });
      check(error);
    },

    async insertProfile(row) {
      const { error } = await sb.from('profiles').insert(row);
      if (error?.code === '23505') throw new AdminError('username_taken');
      check(error);
    },

    async updateProfile(id, patch) {
      const { error } = await sb.from('profiles').update(patch).eq('id', id);
      check(error);
    },

    async setGroups(userId, groupIds, actorId) {
      // `not in ()` is invalid for an empty list: then every membership goes.
      if (groupIds.length === 0) {
        const { error } = await sb.from('group_members').delete().eq('user_id', userId);
        check(error);
        return;
      }
      // Ids are validated UUIDs (zod), so building the PostgREST list literal is safe.
      const { error: delError } = await sb
        .from('group_members')
        .delete()
        .eq('user_id', userId)
        .not('group_id', 'in', `(${groupIds.join(',')})`);
      check(delError);
      const { error } = await sb.from('group_members').upsert(
        groupIds.map((group_id) => ({ group_id, user_id: userId, created_by: actorId })),
        { onConflict: 'group_id,user_id', ignoreDuplicates: true },
      );
      check(error);
    },

    async audit(entry) {
      const { error } = await sb.from('audit_logs').insert({
        actor_id: entry.actorId,
        action: entry.action,
        entity: 'profiles',
        entity_id: entry.entityId,
        diff: entry.diff,
      });
      check(error);
    },
  };
}
