-- Row Level Security and privileges (spec §3, §7.3).
--
-- Model:
-- - Admin (profiles.role = 'admin' AND is_active): full access to configuration tables, reads
--   all run/audit logs. Account changes (create, reset password, lock, role) go through the
--   admin-users Edge Function (service role), never through direct table writes.
-- - User (active): reads own profile, own groups/assignments, flows assigned directly or via a
--   group and only their PUBLISHED versions; inserts and reads own run logs.
-- - Locked users (is_active = false) see nothing, even with a still-valid access token.
-- - anon: nothing, except SELECT on app_settings (RLS returns no rows; used by the keep-alive ping).

-- ---------------------------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER, fixed search_path). They read profiles/assignments as the
-- table owner, so policies can use them without recursive RLS evaluation.
-- ---------------------------------------------------------------------------------------------

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.is_active
  )
$$;

-- Assigned to the caller directly or through one of the caller's groups, flow not archived.
create or replace function private.can_access_flow(p_flow_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and exists (
      select 1 from public.flows f where f.id = p_flow_id and not f.is_archived
    )
    and exists (
      select 1
      from public.flow_assignments a
      where a.flow_id = p_flow_id
        and (
          a.user_id = (select auth.uid())
          or a.group_id in (
            select gm.group_id from public.group_members gm
            where gm.user_id = (select auth.uid())
          )
        )
    )
$$;

-- The caller may run (and therefore log) this version: published, flow not archived, and the
-- caller is an Admin or the flow is assigned to them.
create or replace function private.can_run_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.flow_versions v
    join public.flows f on f.id = v.flow_id
    where v.id = p_version_id
      and v.status = 'published'
      and not f.is_archived
      and (private.is_admin() or private.can_access_flow(v.flow_id))
  )
$$;

create or replace function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = (select auth.uid())
  )
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_active_user() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.can_access_flow(uuid) to authenticated, service_role;
grant execute on function private.can_run_version(uuid) to authenticated, service_role;
grant execute on function private.is_group_member(uuid) to authenticated, service_role;
-- Used by CHECK constraints of run_logs (evaluated with the inserting role's privileges).
grant execute on function private.is_flat_scalar_map(jsonb, integer) to authenticated, service_role;
grant execute on function private.is_valid_inputs_meta(jsonb) to authenticated, service_role;
-- The auth server updates auth.users as supabase_auth_admin; let it fire the password trigger.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.on_auth_password_changed() to supabase_auth_admin;

-- ---------------------------------------------------------------------------------------------
-- Table privileges: start from nothing for the API roles, then grant what the policies need.
-- (Supabase grants ALL on new public tables to anon/authenticated by default.)
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

grant select on public.app_settings to anon;

grant select on public.profiles to authenticated;
-- Users may only change these columns of their own row; role, is_active, must_change_password,
-- username are not updatable through the API (column privilege, checked before RLS).
grant update (full_name, locale) on public.profiles to authenticated;

grant select, insert, update, delete on
  public.groups, public.group_members, public.flows, public.flow_versions,
  public.flow_assignments, public.app_settings
to authenticated;

grant select, insert on public.run_logs to authenticated;
grant select on public.audit_logs to authenticated;

-- Undo Supabase's per-schema default grants for objects the migration role creates later: a
-- future table/sequence/function in public gets no anon/authenticated privileges until its
-- migration grants them explicitly (as above). PostgreSQL's built-in EXECUTE-to-PUBLIC default
-- for functions is global and cannot be revoked per schema, so every new function must also
-- `revoke all on function … from public, anon` itself (see 20261026080200_rpc.sql).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.flows enable row level security;
alter table public.flow_versions enable row level security;
alter table public.flow_assignments enable row level security;
alter table public.run_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

-- profiles ------------------------------------------------------------------------------------
-- Deliberately without is_active_user(): a locked user can still read their own row, so the
-- client can tell "locked" apart from other failures. Every other SELECT policy requires an
-- active caller.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select private.is_active_user()))
  with check (id = (select auth.uid()));
-- No insert/delete policy: rows are created by the Edge Function (service role) or the seed.

-- groups --------------------------------------------------------------------------------------
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_active_user()) and private.is_group_member(id))
  );

drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated
  with check ((select private.is_admin()));
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated
  using ((select private.is_admin()));

-- group_members -------------------------------------------------------------------------------
drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_active_user()) and user_id = (select auth.uid()))
  );

drop policy if exists group_members_insert on public.group_members;
create policy group_members_insert on public.group_members for insert to authenticated
  with check ((select private.is_admin()));
drop policy if exists group_members_update on public.group_members;
create policy group_members_update on public.group_members for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members for delete to authenticated
  using ((select private.is_admin()));

-- flows ---------------------------------------------------------------------------------------
-- Users see an assigned flow only once it has a published version (no drafts-only flows).
drop policy if exists flows_select on public.flows;
create policy flows_select on public.flows for select to authenticated
  using (
    (select private.is_admin())
    or (
      private.can_access_flow(id)
      and exists (
        select 1 from public.flow_versions v
        where v.flow_id = flows.id and v.status = 'published'
      )
    )
  );

drop policy if exists flows_insert on public.flows;
create policy flows_insert on public.flows for insert to authenticated
  with check ((select private.is_admin()));
drop policy if exists flows_update on public.flows;
create policy flows_update on public.flows for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists flows_delete on public.flows;
create policy flows_delete on public.flows for delete to authenticated
  using ((select private.is_admin()));

-- flow_versions -------------------------------------------------------------------------------
drop policy if exists flow_versions_select on public.flow_versions;
create policy flow_versions_select on public.flow_versions for select to authenticated
  using (
    (select private.is_admin())
    or (status = 'published' and private.can_access_flow(flow_id))
  );

drop policy if exists flow_versions_insert on public.flow_versions;
create policy flow_versions_insert on public.flow_versions for insert to authenticated
  with check ((select private.is_admin()));
drop policy if exists flow_versions_update on public.flow_versions;
create policy flow_versions_update on public.flow_versions for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists flow_versions_delete on public.flow_versions;
create policy flow_versions_delete on public.flow_versions for delete to authenticated
  using ((select private.is_admin()));

-- flow_assignments ----------------------------------------------------------------------------
drop policy if exists flow_assignments_select on public.flow_assignments;
create policy flow_assignments_select on public.flow_assignments for select to authenticated
  using (
    (select private.is_admin())
    or (
      (select private.is_active_user())
      and (
        user_id = (select auth.uid())
        or (group_id is not null and private.is_group_member(group_id))
      )
    )
  );

drop policy if exists flow_assignments_insert on public.flow_assignments;
create policy flow_assignments_insert on public.flow_assignments for insert to authenticated
  with check ((select private.is_admin()));
drop policy if exists flow_assignments_update on public.flow_assignments;
create policy flow_assignments_update on public.flow_assignments for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists flow_assignments_delete on public.flow_assignments;
create policy flow_assignments_delete on public.flow_assignments for delete to authenticated
  using ((select private.is_admin()));

-- run_logs ------------------------------------------------------------------------------------
drop policy if exists run_logs_select on public.run_logs;
create policy run_logs_select on public.run_logs for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_active_user()) and user_id = (select auth.uid()))
  );

drop policy if exists run_logs_insert_own on public.run_logs;
create policy run_logs_insert_own on public.run_logs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.can_run_version(flow_version_id)
  );
-- No update/delete: logs are append-only; retention runs through public.purge_run_logs().

-- audit_logs ----------------------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using ((select private.is_admin()));
-- Written only by triggers (SECURITY DEFINER) and the Edge Function (service role).

-- app_settings --------------------------------------------------------------------------------
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated
  using ((select private.is_active_user()));

drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check ((select private.is_admin()));
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists app_settings_delete on public.app_settings;
create policy app_settings_delete on public.app_settings for delete to authenticated
  using ((select private.is_admin()));
