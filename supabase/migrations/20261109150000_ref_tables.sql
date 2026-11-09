-- Phase 2 step 1, round 1: reference tables with validity dates (spec §34 AC-RT-01, 02, 05, 06, 09).
--
-- `ref_tables`: one row per table (code, name, column definitions shared by every version).
-- `ref_table_versions`: the data of a table, versioned like flows (§14): draft -> published (valid
-- [effective_from, effective_to), never overlapping, immutable) -> retired; a draft that is given
-- up becomes `discarded` (kept, hidden, its number is not reused). Rows are JSON objects keyed by
-- column key: string / integer (JSON number) / decimal (canonical text "12.5") / date
-- ("yyyy-mm-dd") / boolean; null or absent = blank.
--
-- Reference data is NOT personal data (MEMORY 2026-10-26 08:20, spec §17): column names that look
-- like personal data need an explicit Admin confirmation, recorded in audit_logs (no data).
--
-- Round 1: Admins only. Users read nothing yet (round 2 adds the read policy through
-- `flow_versions.ref_tables`); anon has no privilege at all.
--
-- Written without any destructive statement or keyword (HANDOFF §3): rows are never removed,
-- there is no removal privilege nor policy, and the file can be applied through the Supabase
-- connection as is and re-run (create or replace / if not exists).
--
-- Error codes the client maps to i18n (apps/web/src/features/admin/ref-tables/ref-tables-api.ts):
--   42501 forbidden · 22023 invalid argument (message: invalid_columns, invalid_rows,
--   rows_too_many, rows_too_large, key_blank, duplicate_key, effective_from_required,
--   change_note_required, expected_updated_at_required) · P0002 not found ·
--   HF001 ref_version_immutable · HF002 draft_conflict (optimistic check failed) ·
--   23505 duplicate (code taken / table already has a draft) · 23P01 overlap · 23514 check.

-- ---------------------------------------------------------------------------------------------
-- Column definitions (AC-RT-02): [{ key, title, type, aliases, isKey }], 1..100 columns, unique
-- keys, at least one key column.
-- ---------------------------------------------------------------------------------------------

create or replace function private.ref_columns_valid(p_columns jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_columns) = 'array'
    and jsonb_array_length(p_columns) between 1 and 100
    and not exists (
      select 1
      from jsonb_array_elements(p_columns) as c(col)
      where jsonb_typeof(c.col) <> 'object'
         or exists (select 1 from jsonb_object_keys(c.col) as k(name)
                    where k.name not in ('key', 'title', 'type', 'aliases', 'isKey'))
         or jsonb_typeof(c.col -> 'key') is distinct from 'string'
         or (c.col ->> 'key') !~ '^[a-z][a-z0-9_]{0,62}$'
         or jsonb_typeof(c.col -> 'title') is distinct from 'string'
         or char_length(btrim(c.col ->> 'title')) not between 1 and 120
         or coalesce(c.col ->> 'type', '') not in ('string', 'integer', 'decimal', 'date', 'boolean')
         or jsonb_typeof(c.col -> 'aliases') is distinct from 'array'
         or jsonb_array_length(c.col -> 'aliases') > 20
         or exists (select 1 from jsonb_array_elements(c.col -> 'aliases') as a(alias)
                    where jsonb_typeof(a.alias) <> 'string'
                       or char_length(btrim(a.alias #>> '{}')) not between 1 and 120)
         or jsonb_typeof(c.col -> 'isKey') is distinct from 'boolean'
    )
    and (select count(distinct c.col ->> 'key') from jsonb_array_elements(p_columns) as c(col))
        = jsonb_array_length(p_columns)
    and exists (select 1 from jsonb_array_elements(p_columns) as c(col)
                where c.col -> 'isKey' = 'true'::jsonb),
    false)
$$;

/** Byte size of the rows as stored (jsonb text form); the client computes the same figure. */
create or replace function private.ref_rows_bytes(p_rows jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select octet_length(p_rows::text)
$$;

/**
 * Rows of a version against the table's columns (AC-RT-01..04): an array of ≤ 50,000 objects,
 * ≤ 5 MiB, only known keys, values of the column type, every key column filled, no two rows with
 * the same key (text keys compared without case / extra spaces, like the `unique` rule of slots).
 */
create or replace function private.assert_ref_rows(p_columns jsonb, p_rows jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 50000 then
    raise exception 'rows_too_many' using errcode = '22023';
  end if;
  if private.ref_rows_bytes(p_rows) > 5242880 then
    raise exception 'rows_too_large' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    return;
  end if;
  if not private.ref_columns_valid(p_columns) then
    raise exception 'invalid_columns' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) as r(row) where jsonb_typeof(r.row) <> 'object') then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as r(row)
    cross join lateral jsonb_each(r.row) as e(key, value)
    left join lateral (
      select c.col from jsonb_array_elements(p_columns) as c(col) where c.col ->> 'key' = e.key
    ) as d on true
    where d.col is null
       or (jsonb_typeof(e.value) <> 'null' and not (
            case d.col ->> 'type'
              when 'string' then jsonb_typeof(e.value) = 'string'
              when 'integer' then jsonb_typeof(e.value) = 'number'
                and (e.value #>> '{}') ~ '^-?[0-9]{1,16}$'
              when 'decimal' then jsonb_typeof(e.value) = 'string'
                and (e.value #>> '{}') ~ '^-?[0-9]{1,28}(\.[0-9]{1,10})?$'
              when 'date' then jsonb_typeof(e.value) = 'string'
                and (e.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              when 'boolean' then jsonb_typeof(e.value) = 'boolean'
              else false
            end))
  ) then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as r(row)
    cross join jsonb_array_elements(p_columns) as c(col)
    where c.col -> 'isKey' = 'true'::jsonb
      and (jsonb_typeof(r.row -> (c.col ->> 'key'))  is distinct from 'string'
             and jsonb_typeof(r.row -> (c.col ->> 'key')) is distinct from 'number'
             and jsonb_typeof(r.row -> (c.col ->> 'key')) is distinct from 'boolean'
           or btrim(r.row ->> (c.col ->> 'key')) = '')
  ) then
    raise exception 'key_blank' using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select string_agg(
               case when c.col ->> 'type' = 'string'
                 then lower(regexp_replace(btrim(r.row ->> (c.col ->> 'key')), '\s+', ' ', 'g'))
                 else r.row ->> (c.col ->> 'key')
               end,
               chr(31) order by c.ord) as k
      from jsonb_array_elements(p_rows) with ordinality as r(row, rn)
      cross join jsonb_array_elements(p_columns) with ordinality as c(col, ord)
      where c.col -> 'isKey' = 'true'::jsonb
      group by r.rn
    ) as keys
    group by keys.k
    having count(*) > 1
  ) then
    raise exception 'duplicate_key' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.ref_columns_valid(jsonb) from public, anon, authenticated;
revoke all on function private.ref_rows_bytes(jsonb) from public, anon, authenticated;
revoke all on function private.assert_ref_rows(jsonb, jsonb) from public, anon, authenticated;
-- Used by CHECK constraints and triggers evaluated with the writing role's privileges.
grant execute on function private.ref_columns_valid(jsonb) to authenticated, service_role;
grant execute on function private.ref_rows_bytes(jsonb) to authenticated, service_role;
grant execute on function private.assert_ref_rows(jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists public.ref_tables (
  id uuid primary key default gen_random_uuid(),
  -- Identifier used by flows (`input.refTable`, round 2): upper case, digits, underscore.
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 1000),
  columns jsonb not null check (private.ref_columns_valid(columns)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Plain uuids (no foreign key): an account removed later leaves the author unknown.
  created_by uuid default auth.uid()
);

comment on table public.ref_tables is
  'Reference tables (spec §34): lists, code mappings, rates. Never personal data.';

create table if not exists public.ref_table_versions (
  id uuid primary key default gen_random_uuid(),
  ref_table_id uuid not null references public.ref_tables (id),
  -- Assigned by the guard trigger (max + 1 per table, discarded drafts included).
  version_no integer not null check (version_no >= 1),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired', 'discarded')),
  effective_from date,
  -- Exclusive upper bound; null = open-ended.
  effective_to date,
  change_note text not null default '' check (char_length(change_note) <= 1000),
  rows jsonb not null default '[]'::jsonb,
  row_count integer generated always as (
    case when jsonb_typeof(rows) = 'array' then jsonb_array_length(rows) else 0 end
  ) stored,
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (ref_table_id, version_no),
  constraint ref_table_versions_effective_from_required
    check (status in ('draft', 'discarded') or effective_from is not null),
  constraint ref_table_versions_effective_range
    check (effective_to is null or effective_from is null or effective_to > effective_from),
  constraint ref_table_versions_rows_array check (jsonb_typeof(rows) = 'array'),
  constraint ref_table_versions_rows_count check (jsonb_array_length(rows) <= 50000),
  constraint ref_table_versions_rows_size check (private.ref_rows_bytes(rows) <= 5242880)
);
create index if not exists ref_table_versions_table_idx on public.ref_table_versions (ref_table_id);

comment on table public.ref_table_versions is
  'Versioned data of a reference table (spec §34). JSON rows keyed by column key; no personal data.';

-- Published validity ranges of one table never overlap (like flows, spec §7.2).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ref_table_versions_no_overlap') then
    alter table public.ref_table_versions
      add constraint ref_table_versions_no_overlap
      exclude using gist (
        ref_table_id with =,
        daterange(effective_from, effective_to, '[)') with &&
      ) where (status = 'published');
  end if;
end
$$;

-- At most one open draft per table.
create unique index if not exists ref_table_versions_one_draft_idx
  on public.ref_table_versions (ref_table_id) where (status = 'draft');

/**
 * Lifecycle guard (spec §34 AC-RT-01, §14.1):
 * - insert: only drafts; version_no = max + 1; publish stamps cleared; rows checked.
 * - draft: rows editable (checked against the table's columns); -> published stamps
 *   published_at/by and checks the rows again (columns may have changed); -> discarded.
 * - published: immutable except `effective_to` and `status -> retired`.
 * - retired, discarded: immutable.
 * `updated_by` is always the caller. Errors: HF001 with a stable message.
 */
create or replace function private.ref_table_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_columns jsonb;
begin
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'ref_version_invalid_status' using errcode = 'HF001';
    end if;
    select coalesce(max(v.version_no), 0) + 1 into new.version_no
      from public.ref_table_versions v where v.ref_table_id = new.ref_table_id;
    new.effective_from := null;
    new.effective_to := null;
    new.published_at := null;
    new.published_by := null;
    new.created_by := auth.uid();
    select t.columns into v_columns from public.ref_tables t where t.id = new.ref_table_id;
    perform private.assert_ref_rows(v_columns, new.rows);
    return new;
  end if;

  -- UPDATE
  if old.status = 'draft' then
    if new.status = 'retired' then
      raise exception 'ref_version_invalid_status' using errcode = 'HF001';
    end if;
    if (new.id, new.ref_table_id, new.version_no, new.created_at, new.created_by)
       is distinct from (old.id, old.ref_table_id, old.version_no, old.created_at, old.created_by)
    then
      raise exception 'ref_version_immutable' using errcode = 'HF001';
    end if;
    if new.status = 'published' then
      new.published_at := now();
      new.published_by := auth.uid();
    else
      new.published_at := null;
      new.published_by := null;
    end if;
    if new.status = 'published' or new.rows is distinct from old.rows then
      select t.columns into v_columns from public.ref_tables t where t.id = new.ref_table_id;
      perform private.assert_ref_rows(v_columns, new.rows);
    end if;
    return new;
  end if;

  if old.status in ('retired', 'discarded') then
    raise exception 'ref_version_immutable' using errcode = 'HF001',
      detail = 'Retired or discarded versions cannot be changed.';
  end if;

  -- old.status = 'published'
  if new.status not in ('published', 'retired')
     or (new.id, new.ref_table_id, new.version_no, new.rows, new.effective_from, new.change_note,
         new.published_by, new.published_at, new.created_at, new.created_by)
        is distinct from
        (old.id, old.ref_table_id, old.version_no, old.rows, old.effective_from, old.change_note,
         old.published_by, old.published_at, old.created_at, old.created_by)
  then
    raise exception 'ref_version_immutable' using errcode = 'HF001',
      detail = 'A published version only allows changing effective_to or retiring it.';
  end if;
  return new;
end;
$$;
revoke all on function private.ref_table_versions_guard() from public, anon, authenticated;

-- Trigger names fire alphabetically: "guard" runs before "set_updated_at".
create or replace trigger guard before insert or update on public.ref_table_versions
  for each row execute function private.ref_table_versions_guard();
create or replace trigger set_updated_at before update on public.ref_table_versions
  for each row execute function private.set_updated_at();
create or replace trigger set_updated_at before update on public.ref_tables
  for each row execute function private.set_updated_at();

/**
 * Audit of ref_table_versions without the data: `rows` is replaced by its row count and size
 * (the generic audit_row would copy up to 5 MB of rows into every entry).
 */
create or replace function private.audit_ref_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) - 'rows' end;
  v_new jsonb := to_jsonb(new) - 'rows';
  v_diff jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value)),
                    '{}'::jsonb)
      into v_diff
      from jsonb_each(v_new) as n(key, value)
     where n.key not in ('updated_at', 'updated_by')
       and (v_old -> n.key) is distinct from n.value;
    if new.rows is distinct from old.rows then
      v_diff := v_diff || jsonb_build_object('rows', jsonb_build_object(
        'changed', true, 'count', new.row_count, 'bytes', private.ref_rows_bytes(new.rows)));
    end if;
    if v_diff = '{}'::jsonb then
      return null;
    end if;
  else
    v_diff := (v_new - 'created_at' - 'updated_at')
      || jsonb_build_object('rows_bytes', private.ref_rows_bytes(new.rows));
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, diff)
  values (auth.uid(), lower(tg_op), tg_table_name, new.id::text, v_diff);
  return null;
end;
$$;
revoke all on function private.audit_ref_version() from public, anon, authenticated;

create or replace trigger audit after insert or update on public.ref_table_versions
  for each row execute function private.audit_ref_version();
-- Column definitions are small configuration: the generic row audit.
create or replace trigger audit after insert or update on public.ref_tables
  for each row execute function private.audit_row();

/**
 * "Tôi xác nhận bảng này không chứa dữ liệu cá nhân" (AC-RT-05): who confirmed, for which table,
 * where (column form / import) and which column keys looked personal. Never any cell value.
 */
create or replace function private.audit_ref_no_personal_data(
  p_ref_table_id uuid,
  p_context text,
  p_columns text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_columns is null or cardinality(p_columns) = 0 then
    return;
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, diff)
  values (
    auth.uid(), 'confirm_no_personal_data', 'ref_tables', p_ref_table_id::text,
    jsonb_build_object(
      'context', case when p_context = 'import' then 'import' else 'columns' end,
      -- Column keys or file header names (≤ 50, ≤ 120 characters each), never values.
      'columns', (select coalesce(jsonb_agg(left(c, 120)), '[]'::jsonb)
                    from unnest(p_columns[1:50]) as c)));
end;
$$;
revoke all on function private.audit_ref_no_personal_data(uuid, text, text[]) from public, anon;
grant execute on function private.audit_ref_no_personal_data(uuid, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS. Supabase grants every privilege on new public tables to anon /
-- authenticated by default: taken back first, so only the grants below apply (HANDOFF §4.16e).
-- ---------------------------------------------------------------------------------------------

revoke all on public.ref_tables from public, anon, authenticated;
revoke all on public.ref_table_versions from public, anon, authenticated;
grant select, insert, update on public.ref_tables to authenticated;
grant select, insert, update on public.ref_table_versions to authenticated;
grant all on public.ref_tables to service_role;
grant all on public.ref_table_versions to service_role;

alter table public.ref_tables enable row level security;
alter table public.ref_table_versions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['ref_tables', 'ref_table_versions'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = t and policyname = t || '_admin_select') then
      execute format('create policy %I on public.%I for select to authenticated '
                     'using ((select private.is_admin()))', t || '_admin_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = t and policyname = t || '_admin_insert') then
      execute format('create policy %I on public.%I for insert to authenticated '
                     'with check ((select private.is_admin()))', t || '_admin_insert', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = t and policyname = t || '_admin_update') then
      execute format('create policy %I on public.%I for update to authenticated '
                     'using ((select private.is_admin())) with check ((select private.is_admin()))',
                     t || '_admin_update', t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- RPCs (SECURITY INVOKER like the flow RPCs: the caller's RLS applies; private.is_admin() is
-- checked first; `search_path = ''`; not executable by PUBLIC/anon).
-- ---------------------------------------------------------------------------------------------

/**
 * Create (p_id null: table + empty draft v1, one transaction) or update a table (name,
 * description, columns; the code never changes) unless someone saved it since the caller loaded
 * it (`p_expected_updated_at`, HF002). `p_personal_data_columns`: column keys the Admin confirmed
 * are not personal data (audited).
 */
create or replace function public.admin_save_ref_table(
  p_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_columns jsonb,
  p_expected_updated_at timestamptz,
  p_personal_data_columns text[]
)
returns table (ref_table_id uuid, updated_at timestamptz, draft_version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_updated timestamptz;
  v_draft uuid;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.ref_columns_valid(p_columns) then
    raise exception 'invalid_columns' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.ref_tables as t (code, name, description, columns)
    values (p_code, btrim(p_name), coalesce(p_description, ''), p_columns)
    returning t.id, t.updated_at into v_id, v_updated;
    insert into public.ref_table_versions as v (ref_table_id, status, rows)
    values (v_id, 'draft', '[]'::jsonb)
    returning v.id into v_draft;
  else
    if p_expected_updated_at is null then
      raise exception 'expected_updated_at_required' using errcode = '22023';
    end if;
    select t.updated_at into v_updated from public.ref_tables t where t.id = p_id for update;
    if not found then
      raise exception 'ref_table_not_found' using errcode = 'P0002';
    end if;
    if v_updated <> p_expected_updated_at then
      raise exception 'draft_conflict' using errcode = 'HF002',
        detail = 'The table was saved by someone else since it was loaded.';
    end if;
    update public.ref_tables t
       set name = btrim(p_name),
           description = coalesce(p_description, ''),
           columns = p_columns
     where t.id = p_id
    returning t.id, t.updated_at into v_id, v_updated;
    select v.id into v_draft from public.ref_table_versions v
     where v.ref_table_id = v_id and v.status = 'draft';
  end if;

  perform private.audit_ref_no_personal_data(v_id, 'columns', p_personal_data_columns);
  return query select v_id, v_updated, v_draft;
end;
$$;

/**
 * Replace every row of the draft (import from Excel and the "Lưu draft" button, AC-RT-03/04).
 * A table without a draft gets one (p_expected_updated_at must then be null); with a draft, the
 * caller must pass the `updated_at` it loaded (HF002 when another save came first).
 */
create or replace function public.admin_replace_ref_table_draft(
  p_ref_table_id uuid,
  p_rows jsonb,
  p_expected_updated_at timestamptz,
  p_personal_data_columns text[]
)
returns table (version_id uuid, version_no integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_draft uuid;
  v_updated timestamptz;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.ref_tables t where t.id = p_ref_table_id for update;
  if not found then
    raise exception 'ref_table_not_found' using errcode = 'P0002';
  end if;

  select v.id, v.updated_at into v_draft, v_updated
    from public.ref_table_versions v
   where v.ref_table_id = p_ref_table_id and v.status = 'draft'
   for update;

  if v_draft is null then
    if p_expected_updated_at is not null then
      -- The draft the caller edited was published or discarded meanwhile.
      raise exception 'draft_conflict' using errcode = 'HF002';
    end if;
    perform private.audit_ref_no_personal_data(p_ref_table_id, 'import', p_personal_data_columns);
    return query
      insert into public.ref_table_versions as v (ref_table_id, status, rows)
      values (p_ref_table_id, 'draft', p_rows)
      returning v.id, v.version_no, v.updated_at;
    return;
  end if;

  if p_expected_updated_at is null or v_updated <> p_expected_updated_at then
    raise exception 'draft_conflict' using errcode = 'HF002',
      detail = 'The draft was saved by someone else since it was loaded.';
  end if;
  perform private.audit_ref_no_personal_data(p_ref_table_id, 'import', p_personal_data_columns);
  return query
    update public.ref_table_versions v
       set rows = p_rows
     where v.id = v_draft
    returning v.id, v.version_no, v.updated_at;
end;
$$;

/** Copy the rows of a version into a new draft (rollback, spec §14.1). An open draft: 23505. */
create or replace function public.admin_create_ref_draft_from_version(p_version_id uuid)
returns table (version_id uuid, version_no integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_table uuid;
  v_rows jsonb;
  v_status text;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select v.ref_table_id, v.rows, v.status into v_table, v_rows, v_status
    from public.ref_table_versions v
   where v.id = p_version_id;
  if not found or v_status = 'discarded' then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;

  return query
    insert into public.ref_table_versions as v (ref_table_id, status, rows)
    values (v_table, 'draft', v_rows)
    returning v.id, v.version_no, v.updated_at;
end;
$$;

/**
 * Publish the draft with its validity range and mandatory note, optionally closing the open-ended
 * published version starting before p_effective_from, in one transaction (AC-RT-06). An overlap
 * (23P01), stale `p_expected_updated_at` (HF002) or rows that no longer fit the columns (22023)
 * leave everything unchanged.
 */
create or replace function public.admin_publish_ref_table_draft(
  p_version_id uuid,
  p_effective_from date,
  p_effective_to date,
  p_change_note text,
  p_close_previous boolean,
  p_expected_updated_at timestamptz
)
returns table (version_id uuid, version_no integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_note text;
  v_table uuid;
  v_status text;
  v_updated timestamptz;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_effective_from is null then
    raise exception 'effective_from_required' using errcode = '22023';
  end if;
  v_note := private.require_change_note(p_change_note);
  if p_expected_updated_at is null then
    raise exception 'expected_updated_at_required' using errcode = '22023';
  end if;

  select v.ref_table_id, v.status, v.updated_at into v_table, v_status, v_updated
    from public.ref_table_versions v
   where v.id = p_version_id
   for update;
  if not found then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'ref_version_immutable' using errcode = 'HF001',
      detail = 'Only a draft can be published.';
  end if;
  if v_updated <> p_expected_updated_at then
    raise exception 'draft_conflict' using errcode = 'HF002',
      detail = 'The draft was saved by someone else since it was loaded.';
  end if;

  if coalesce(p_close_previous, false) then
    update public.ref_table_versions v
       set effective_to = p_effective_from
     where v.ref_table_id = v_table
       and v.status = 'published'
       and v.effective_to is null
       and v.effective_from < p_effective_from;
  end if;

  return query
    update public.ref_table_versions v
       set status = 'published',
           effective_from = p_effective_from,
           effective_to = p_effective_to,
           change_note = v_note
     where v.id = p_version_id
    returning v.id, v.version_no;
end;
$$;

/**
 * Flows (draft / published versions) using each table: nodes `input.refTable` (config.refTable)
 * and list parameters `options.fromRefTable` (round 2). For the warnings of AC-RT-02 and the
 * "Dùng trong" column; Admins only (others get no row).
 */
create or replace function public.admin_ref_table_usage()
returns table (ref_table_code text, flow_id uuid, flow_code text, flow_name text,
               version_no integer, status text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct u.code, f.id, f.code, f.name, v.version_no, v.status
  from public.flow_versions v
  join public.flows f on f.id = v.flow_id
  cross join lateral (
    select n.node -> 'config' ->> 'refTable' as code
      from jsonb_array_elements(
             case when jsonb_typeof(v.definition -> 'nodes') = 'array'
                  then v.definition -> 'nodes' else '[]'::jsonb end) as n(node)
     where n.node ->> 'type' = 'input.refTable'
    union
    select p.param -> 'options' ->> 'fromRefTable'
      from jsonb_array_elements(
             case when jsonb_typeof(v.definition -> 'params') = 'array'
                  then v.definition -> 'params' else '[]'::jsonb end) as p(param)
     where jsonb_typeof(p.param -> 'options') = 'object'
  ) as u
  where u.code is not null
    and v.status in ('draft', 'published')
    and (select private.is_admin())
$$;

revoke all on function public.admin_save_ref_table(uuid, text, text, text, jsonb, timestamptz, text[])
  from public, anon;
revoke all on function public.admin_replace_ref_table_draft(uuid, jsonb, timestamptz, text[])
  from public, anon;
revoke all on function public.admin_create_ref_draft_from_version(uuid) from public, anon;
revoke all on function public.admin_publish_ref_table_draft(uuid, date, date, text, boolean, timestamptz)
  from public, anon;
revoke all on function public.admin_ref_table_usage() from public, anon;

grant execute on function public.admin_save_ref_table(uuid, text, text, text, jsonb, timestamptz, text[])
  to authenticated;
grant execute on function public.admin_replace_ref_table_draft(uuid, jsonb, timestamptz, text[])
  to authenticated;
grant execute on function public.admin_create_ref_draft_from_version(uuid) to authenticated;
grant execute on function public.admin_publish_ref_table_draft(uuid, date, date, text, boolean, timestamptz)
  to authenticated;
grant execute on function public.admin_ref_table_usage() to authenticated;
