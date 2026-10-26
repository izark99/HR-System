-- HR Data Flow Platform — core schema (spec §7). Step 2 of Phase 1.
--
-- Server data is METADATA ONLY: accounts, groups, flow configuration/versions, assignments,
-- run-log metadata (no cell values, no raw error text, file names only as SHA-256), audit log,
-- app settings. `ref_tables`, `ref_table_versions` and `templates` (§7.1) come in step 3.
--
-- Apply in filename order. Statements are idempotent where reasonable (if not exists / or replace /
-- drop … if exists) so a partially applied file can be re-run.

create extension if not exists pgcrypto with schema extensions;
-- `flow_id WITH =` inside a GiST exclusion constraint needs btree_gist (spec §7.2).
create extension if not exists btree_gist with schema extensions;

-- Helpers that must not be callable through the REST API live in a schema PostgREST does not expose.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- profiles (1-1 with auth.users). Created by the admin-users Edge Function / bootstrap seed only.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Login name; the auth e-mail is `<username>@users.hrflow.local` (spec §6).
  username text not null unique
    check (username ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$'),
  full_name text not null default '' check (char_length(full_name) <= 120),
  role text not null default 'user' check (role in ('admin', 'user')),
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  password_changed_at timestamptz,
  locale text not null default 'vi' check (locale in ('vi', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index if not exists profiles_created_by_idx on public.profiles (created_by);

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- groups, group_members
-- ---------------------------------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists groups_created_by_idx on public.groups (created_by);

drop trigger if exists set_updated_at on public.groups;
create trigger set_updated_at before update on public.groups
  for each row execute function private.set_updated_at();

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (group_id, user_id)
);
create index if not exists group_members_user_id_idx on public.group_members (user_id);
create index if not exists group_members_created_by_idx on public.group_members (created_by);

-- ---------------------------------------------------------------------------------------------
-- flows, flow_versions (spec §7.2, §14)
-- ---------------------------------------------------------------------------------------------

create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  -- URL-safe identifier used in /run/:flowCode.
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 1000),
  category text not null default '' check (char_length(category) <= 80),
  -- Short guidance written by the Admin, shown on the run page.
  instructions text not null default '' check (char_length(instructions) <= 2000),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists flows_created_by_idx on public.flows (created_by);

drop trigger if exists set_updated_at on public.flows;
create trigger set_updated_at before update on public.flows
  for each row execute function private.set_updated_at();

create table if not exists public.flow_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows (id) on delete cascade,
  -- Assigned by trigger (max + 1 per flow) when omitted.
  version_no integer not null check (version_no >= 1),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  effective_from date,
  -- Exclusive upper bound; null = open-ended.
  effective_to date,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  schema_version integer not null check (schema_version >= 1),
  change_note text not null default '' check (char_length(change_note) <= 1000),
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (flow_id, version_no),
  constraint flow_versions_effective_from_required
    check (status = 'draft' or effective_from is not null),
  constraint flow_versions_effective_range
    check (effective_to is null or effective_from is null or effective_to > effective_from),
  -- Flow configuration only; keeps a single row well under the 1 MB PostgREST default.
  constraint flow_versions_definition_size check (pg_column_size(definition) <= 1048576)
);

-- Published validity ranges of one flow never overlap (spec §7.2). Retired/draft rows are ignored.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'flow_versions_no_overlap'
  ) then
    alter table public.flow_versions
      add constraint flow_versions_no_overlap
      exclude using gist (
        flow_id with =,
        daterange(effective_from, effective_to, '[)') with &&
      ) where (status = 'published');
  end if;
end
$$;

-- At most one open draft per flow (spec §14.1).
create unique index if not exists flow_versions_one_draft_idx
  on public.flow_versions (flow_id) where (status = 'draft');
create index if not exists flow_versions_published_by_idx on public.flow_versions (published_by);
create index if not exists flow_versions_created_by_idx on public.flow_versions (created_by);

/**
 * Lifecycle guard (spec §7.2, §14.1):
 * - insert: version_no / schema_version / published_* filled in; inserting `retired` is refused.
 * - draft: freely editable; draft -> published stamps published_at/by (client values ignored).
 * - published: immutable except `effective_to` and `status -> retired`.
 * - retired: immutable.
 * - delete: only drafts.
 * Errors use SQLSTATE HF001 with a stable message the client maps to i18n.
 */
create or replace function private.flow_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'flow_version_immutable' using errcode = 'HF001',
        detail = 'Only draft versions can be deleted.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'retired' then
      raise exception 'flow_version_invalid_status' using errcode = 'HF001';
    end if;
    if new.version_no is null then
      select coalesce(max(v.version_no), 0) + 1 into new.version_no
      from public.flow_versions v where v.flow_id = new.flow_id;
    end if;
    if new.schema_version is null and (new.definition ->> 'schemaVersion') ~ '^[0-9]+$' then
      new.schema_version := (new.definition ->> 'schemaVersion')::integer;
    end if;
    if new.status = 'published' then
      new.published_at := now();
      new.published_by := auth.uid();
    else
      new.published_at := null;
      new.published_by := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'draft' then
    if new.status = 'retired' then
      raise exception 'flow_version_invalid_status' using errcode = 'HF001';
    end if;
    if new.flow_id <> old.flow_id then
      raise exception 'flow_version_immutable' using errcode = 'HF001';
    end if;
    if new.status = 'published' then
      new.published_at := now();
      new.published_by := auth.uid();
    else
      new.published_at := null;
      new.published_by := null;
    end if;
    return new;
  end if;

  if old.status = 'retired' then
    raise exception 'flow_version_immutable' using errcode = 'HF001',
      detail = 'Retired versions cannot be changed.';
  end if;

  -- old.status = 'published'
  if new.status not in ('published', 'retired')
     or (new.flow_id, new.version_no, new.definition, new.schema_version, new.effective_from,
         new.change_note, new.published_by, new.published_at, new.created_at, new.created_by)
        is distinct from
        (old.flow_id, old.version_no, old.definition, old.schema_version, old.effective_from,
         old.change_note, old.published_by, old.published_at, old.created_at, old.created_by)
  then
    raise exception 'flow_version_immutable' using errcode = 'HF001',
      detail = 'A published version only allows changing effective_to or retiring it.';
  end if;
  return new;
end;
$$;

-- Trigger names fire alphabetically: "guard" runs before "set_updated_at".
drop trigger if exists guard on public.flow_versions;
create trigger guard before insert or update or delete on public.flow_versions
  for each row execute function private.flow_versions_guard();
drop trigger if exists set_updated_at on public.flow_versions;
create trigger set_updated_at before update on public.flow_versions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- flow_assignments: a flow is assigned to exactly one user OR one group per row.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.flow_assignments (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint flow_assignments_one_target check (num_nonnulls(user_id, group_id) = 1)
);
create unique index if not exists flow_assignments_user_uniq
  on public.flow_assignments (flow_id, user_id) where (user_id is not null);
create unique index if not exists flow_assignments_group_uniq
  on public.flow_assignments (flow_id, group_id) where (group_id is not null);
create index if not exists flow_assignments_user_id_idx on public.flow_assignments (user_id);
create index if not exists flow_assignments_group_id_idx on public.flow_assignments (group_id);
create index if not exists flow_assignments_created_by_idx on public.flow_assignments (created_by);

-- ---------------------------------------------------------------------------------------------
-- run_logs: METADATA ONLY (spec §7.1, MEMORY "Dữ liệu & tuân thủ").
-- The shape checks below make it impossible to store free text (cell values, raw error messages,
-- original file names) even if a client tried: params/client_info are small flat scalar maps,
-- inputs_meta only holds slot keys, SHA-256 hex digests, byte sizes and row counts, and the error
-- fields only accept i18n-key / node-id shaped identifiers.
-- Retention: rows older than app_settings.run_log_retention_months (default 12, spec §16) are
-- removed by public.purge_run_logs() — schedule it daily with pg_cron (see README).
-- ---------------------------------------------------------------------------------------------

create or replace function private.is_flat_scalar_map(p jsonb, max_keys integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and (select count(*) from jsonb_object_keys(p)) <= max_keys
    and not exists (
      select 1
      from jsonb_each(p) as e(k, v)
      where not coalesce(
        e.k ~ '^[a-z_][a-z0-9_]{0,63}$'
        and (
          jsonb_typeof(e.v) in ('number', 'boolean', 'null')
          or (jsonb_typeof(e.v) = 'string' and char_length(e.v #>> '{}') <= 100)
        ),
        false
      )
    ),
    false
  )
$$;

create or replace function private.is_valid_inputs_meta(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 50
    and not exists (
      select 1
      from jsonb_array_elements(p) as s(item)
      where not coalesce(
        jsonb_typeof(s.item) = 'object'
        and not exists (
          select 1 from jsonb_object_keys(s.item) as k(name)
          where k.name not in ('slot', 'files', 'rows')
        )
        and (s.item ->> 'slot') ~ '^[a-z_][a-z0-9_]{0,63}$'
        and jsonb_typeof(s.item -> 'rows') = 'number'
        and jsonb_typeof(s.item -> 'files') = 'array'
        and jsonb_array_length(s.item -> 'files') <= 200
        and not exists (
          select 1
          from jsonb_array_elements(s.item -> 'files') as f(file)
          where not coalesce(
            jsonb_typeof(f.file) = 'object'
            and not exists (
              select 1 from jsonb_object_keys(f.file) as fk(name)
              where fk.name not in ('sha256', 'size')
            )
            and (f.file ->> 'sha256') ~ '^[0-9a-f]{64}$'
            and jsonb_typeof(f.file -> 'size') = 'number',
            false
          )
        ),
        false
      )
    ),
    false
  )
$$;

create table if not exists public.run_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  flow_version_id uuid not null references public.flow_versions (id) on delete restrict,
  params jsonb not null default '{}'::jsonb
    check (private.is_flat_scalar_map(params, 20)),
  inputs_meta jsonb not null default '[]'::jsonb
    check (private.is_valid_inputs_meta(inputs_meta)),
  status text not null check (status in ('succeeded', 'failed', 'cancelled')),
  duration_ms integer not null check (duration_ms >= 0),
  rows_out integer check (rows_out >= 0),
  -- i18n message key of the engine error (e.g. "executor.error.engineCrashed"), never raw text.
  error_code text check (error_code ~ '^[A-Za-z][A-Za-z0-9_.]{0,99}$'),
  error_node_id text check (error_node_id ~ '^[a-z_][a-z0-9_]{0,63}$'),
  client_info jsonb check (client_info is null or private.is_flat_scalar_map(client_info, 10)),
  created_at timestamptz not null default now()
);
create index if not exists run_logs_user_created_idx on public.run_logs (user_id, created_at desc);
create index if not exists run_logs_flow_version_id_idx on public.run_logs (flow_version_id);
create index if not exists run_logs_created_at_idx on public.run_logs (created_at);

-- ---------------------------------------------------------------------------------------------
-- audit_logs: admin actions (config tables via trigger, account actions via the Edge Function).
-- ---------------------------------------------------------------------------------------------

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  -- null = system (service role, migrations).
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action ~ '^[a-z_.]{1,64}$'),
  entity text not null check (entity ~ '^[a-z_]{1,64}$'),
  entity_id text,
  diff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_actor_id_idx on public.audit_logs (actor_id);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at);

/**
 * Row-level audit for configuration tables. Flow definitions are configuration, but can be large:
 * the diff records only that `definition` changed (and its size), not its content.
 */
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_diff jsonb;
  v_id text;
begin
  v_id := coalesce(
    v_row ->> 'id',
    concat_ws(':', v_row ->> 'group_id', v_row ->> 'user_id', v_row ->> 'key')
  );
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(
             n.key,
             case when n.key = 'definition'
               then jsonb_build_object('changed', true, 'bytes', pg_column_size(n.value))
               else jsonb_build_object('old', v_old -> n.key, 'new', n.value)
             end), '{}'::jsonb)
      into v_diff
    from jsonb_each(v_new) as n(key, value)
    where n.key not in ('updated_at')
      and (v_old -> n.key) is distinct from n.value;
    if v_diff = '{}'::jsonb then
      return null;
    end if;
  else
    v_diff := v_row - 'definition' - 'created_at' - 'updated_at';
    if v_row ? 'definition' then
      v_diff := v_diff || jsonb_build_object('definition_bytes', pg_column_size(v_row -> 'definition'));
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, diff)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_diff);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------------------------

create table if not exists public.app_settings (
  key text primary key check (key ~ '^[a-z_][a-z0-9_.]{0,63}$'),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists app_settings_created_by_idx on public.app_settings (created_by);

drop trigger if exists set_updated_at on public.app_settings;
create trigger set_updated_at before update on public.app_settings
  for each row execute function private.set_updated_at();

insert into public.app_settings (key, value)
values ('run_log_retention_months', '12'::jsonb)
on conflict (key) do nothing;

-- Audit triggers on configuration tables.
do $$
declare
  t text;
begin
  foreach t in array array['groups', 'group_members', 'flows', 'flow_versions',
                           'flow_assignments', 'app_settings']
  loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format(
      'create trigger audit after insert or update or delete on public.%I '
      'for each row execute function private.audit_row()', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Password change clears the first-login flag (spec §6).
-- The user changes the password with supabase.auth.updateUser(); this trigger is the only way
-- must_change_password becomes false, so it cannot be cleared without an actual password change.
-- An Admin reset (Edge Function) sets the new temp password first and the flag back to true after.
-- ---------------------------------------------------------------------------------------------

create or replace function private.on_auth_password_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set must_change_password = false,
         password_changed_at = now()
   where id = new.id;
  return null;
end;
$$;

drop trigger if exists hrflow_on_password_changed on auth.users;
create trigger hrflow_on_password_changed
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.on_auth_password_changed();
