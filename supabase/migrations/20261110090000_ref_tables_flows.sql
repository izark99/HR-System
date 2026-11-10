-- Phase 2 step 1, round 2: reference tables used by flows (spec §34 AC-RT-08, 09, 10, 15).
--
-- `flow_versions.ref_tables`: codes of the reference tables a version uses (nodes
-- `input.refTable` → config.refTable, list params → options.fromRefTable). A stored generated
-- column computed from `definition` on every insert / update: the client can never set it, and
-- published versions (immutable definition) keep the list they were published with.
--
-- Users read a reference table and its PUBLISHED versions only when the table is listed in a
-- published version of a flow assigned to them (directly or through a group, flow not archived,
-- account active); drafts / retired versions never. anon reads nothing (no privilege at all).
--
-- `run_logs.ref_versions`: which version of each table a run used (table code → version id).
-- Metadata only: the shape check refuses anything else (no row, no cell value).
--
-- Written without any destructive statement or keyword (HANDOFF §3) and re-runnable.

-- ---------------------------------------------------------------------------------------------
-- Tables a flow definition uses
-- ---------------------------------------------------------------------------------------------

/** Distinct, sorted codes of the reference tables used by a flow definition (ill-formed parts ignored). */
create or replace function private.flow_ref_tables(p_definition jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct u.code order by u.code), '{}'::text[])
  from (
    select n.node -> 'config' ->> 'refTable' as code
      from jsonb_array_elements(
             case when jsonb_typeof(p_definition -> 'nodes') = 'array'
                  then p_definition -> 'nodes' else '[]'::jsonb end) as n(node)
     where jsonb_typeof(n.node) = 'object'
       and n.node ->> 'type' = 'input.refTable'
       and jsonb_typeof(n.node -> 'config') = 'object'
    union all
    select p.param -> 'options' ->> 'fromRefTable'
      from jsonb_array_elements(
             case when jsonb_typeof(p_definition -> 'params') = 'array'
                  then p_definition -> 'params' else '[]'::jsonb end) as p(param)
     where jsonb_typeof(p.param) = 'object'
       and jsonb_typeof(p.param -> 'options') = 'object'
  ) as u
  where u.code ~ '^[A-Z][A-Z0-9_]{1,63}$'
$$;

revoke all on function private.flow_ref_tables(jsonb) from public, anon, authenticated;
-- Evaluated with the privileges of whoever writes flow_versions (Admin RPCs run as invoker).
grant execute on function private.flow_ref_tables(jsonb) to authenticated, service_role;

alter table public.flow_versions
  add column if not exists ref_tables text[]
  generated always as (private.flow_ref_tables(definition)) stored;

comment on column public.flow_versions.ref_tables is
  'Reference table codes used by the definition (input.refTable, fromRefTable); computed, read-only.';

create index if not exists flow_versions_ref_tables_idx
  on public.flow_versions using gin (ref_tables) where (status = 'published');

-- ---------------------------------------------------------------------------------------------
-- Read access of Users (AC-RT-09)
-- ---------------------------------------------------------------------------------------------

/**
 * The caller (active) may run a published version, of a flow assigned to them, that uses the
 * table. SECURITY DEFINER: reads flow_versions / ref_tables as owner (no recursive RLS).
 */
create or replace function private.can_read_ref_table(p_ref_table_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and exists (
      select 1
      from public.ref_tables t
      join public.flow_versions v on t.code = any (v.ref_tables)
      where t.id = p_ref_table_id
        and v.status = 'published'
        and private.can_access_flow(v.flow_id)
    )
$$;

revoke all on function private.can_read_ref_table(uuid) from public, anon, authenticated;
grant execute on function private.can_read_ref_table(uuid) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'ref_tables' and policyname = 'ref_tables_user_select') then
    create policy ref_tables_user_select on public.ref_tables for select to authenticated
      using ((select private.can_read_ref_table(id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'ref_table_versions'
                 and policyname = 'ref_table_versions_user_select') then
    create policy ref_table_versions_user_select on public.ref_table_versions for select
      to authenticated
      using (status = 'published' and (select private.can_read_ref_table(ref_table_id)));
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Run log: versions of the reference tables used by a run (AC-RT-08)
-- ---------------------------------------------------------------------------------------------

/** `{ "TABLE_CODE": "<version uuid>", … }`, at most 50 entries, nothing else. */
create or replace function private.is_valid_ref_versions(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and (select count(*) from jsonb_object_keys(p)) <= 50
    and not exists (
      select 1
      from jsonb_each(p) as e(k, v)
      where not coalesce(
        e.k ~ '^[A-Z][A-Z0-9_]{1,63}$'
        and jsonb_typeof(e.v) = 'string'
        and (e.v #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        false)
    ),
    false)
$$;

revoke all on function private.is_valid_ref_versions(jsonb) from public, anon, authenticated;
-- Used by the CHECK constraint below (evaluated with the inserting role's privileges).
grant execute on function private.is_valid_ref_versions(jsonb) to authenticated, service_role;

alter table public.run_logs
  add column if not exists ref_versions jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'run_logs_ref_versions_shape') then
    alter table public.run_logs
      add constraint run_logs_ref_versions_shape check (private.is_valid_ref_versions(ref_versions));
  end if;
end
$$;

comment on column public.run_logs.ref_versions is
  'Reference table code -> version id used by the run (no data).';
