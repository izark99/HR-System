-- Step 3: Designer drafts and the Version & validity screen (spec §14.5).
--
-- Adds the draft/publish RPCs and makes `change_note` mandatory on the import path. The schema
-- (statuses, date checks, the no-overlap exclusion constraint, one-draft unique index, the
-- immutability guard trigger and audit triggers) is unchanged: every function below goes through
-- it, so the same rules apply as for direct PostgREST writes.
--
-- All functions: SECURITY INVOKER (the caller's RLS applies), private.is_admin() checked inside,
-- `search_path = ''`, not executable by PUBLIC/anon, executable by `authenticated`.
--
-- Error codes the client maps to i18n (apps/web/src/features/admin/admin-api.ts):
--   42501 forbidden · 22023 invalid argument (message: invalid_definition, effective_from_required,
--   change_note_required, expected_updated_at_required) · P0002 version_not_found ·
--   HF001 flow_version_immutable (not a draft) · HF002 draft_conflict (optimistic check failed) ·
--   23505 duplicate (flow code taken / flow already has a draft) · 23P01 overlap.
--
-- Deliberately free of destructive statements and keywords (HANDOFF §3): it can be applied
-- through the Supabase connection (execute_sql) as is, and re-run safely (create or replace).

-- ---------------------------------------------------------------------------------------------
-- Shared argument checks (private: not reachable through the API).
-- ---------------------------------------------------------------------------------------------

create or replace function private.assert_flow_definition(p_definition jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_definition is null or jsonb_typeof(p_definition) <> 'object'
     or coalesce(p_definition ->> 'schemaVersion', '') !~ '^[0-9]+$' then
    raise exception 'invalid_definition' using errcode = '22023';
  end if;
end;
$$;

/** Publishing always needs a non-blank note (spec §14.1); returns it trimmed. */
create or replace function private.require_change_note(p_change_note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- `\s` (not btrim's default) so tabs and line breaks also count as blank.
  if p_change_note is null or p_change_note ~ '^\s*$' then
    raise exception 'change_note_required' using errcode = '22023';
  end if;
  return regexp_replace(p_change_note, '^\s+|\s+$', '', 'g');
end;
$$;

revoke all on function private.assert_flow_definition(jsonb) from public, anon;
revoke all on function private.require_change_note(text) from public, anon;
grant execute on function private.assert_flow_definition(jsonb) to authenticated;
grant execute on function private.require_change_note(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- admin_create_flow: new flow + empty draft v1 in one transaction (Designer "Tạo flow mới").
-- A taken code fails with 23505 (flows.code is unique); nothing is written then.
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_create_flow(
  p_code text,
  p_name text,
  p_description text,
  p_category text,
  p_instructions text,
  p_definition jsonb
)
returns table (flow_id uuid, version_id uuid, version_no integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_flow uuid;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_flow_definition(p_definition);

  insert into public.flows as f (code, name, description, category, instructions)
  values (p_code, p_name, coalesce(p_description, ''), coalesce(p_category, ''),
          coalesce(p_instructions, ''))
  returning f.id into v_flow;

  return query
    insert into public.flow_versions as v (flow_id, status, definition)
    values (v_flow, 'draft', p_definition)
    returning v.flow_id, v.id, v.version_no, v.updated_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_save_flow_draft: save a draft only if nobody saved it since the caller loaded it
-- (spec §14.5, MEMORY 2026-10-26 22:52). `p_expected_updated_at` is the `updated_at` the caller
-- read; pass it back unchanged (the ISO string from PostgREST keeps microseconds).
-- Returns the new `updated_at`.
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_save_flow_draft(
  p_version_id uuid,
  p_definition jsonb,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_updated timestamptz;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_flow_definition(p_definition);
  if p_expected_updated_at is null then
    raise exception 'expected_updated_at_required' using errcode = '22023';
  end if;

  -- Row lock: a concurrent save/publish of the same draft waits, then sees the new updated_at.
  select v.status, v.updated_at into v_status, v_updated
    from public.flow_versions v
   where v.id = p_version_id
   for update;
  if not found then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'flow_version_immutable' using errcode = 'HF001',
      detail = 'Only a draft can be saved.';
  end if;
  if v_updated <> p_expected_updated_at then
    raise exception 'draft_conflict' using errcode = 'HF002',
      detail = 'The draft was saved by someone else since it was loaded.';
  end if;

  update public.flow_versions v
     set definition = p_definition,
         schema_version = (p_definition ->> 'schemaVersion')::integer
   where v.id = p_version_id
  returning v.updated_at into v_updated;
  return v_updated;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_create_draft_from_version: copy a version's definition into a new draft (rollback /
-- continue editing, spec §14.1). A flow with an open draft fails with 23505
-- (flow_versions_one_draft_idx): the existing draft is never overwritten.
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_create_draft_from_version(p_version_id uuid)
returns table (version_id uuid, version_no integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_flow uuid;
  v_definition jsonb;
  v_schema integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select v.flow_id, v.definition, v.schema_version into v_flow, v_definition, v_schema
    from public.flow_versions v
   where v.id = p_version_id;
  if not found then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;

  return query
    insert into public.flow_versions as v (flow_id, status, definition, schema_version)
    values (v_flow, 'draft', v_definition, v_schema)
    returning v.id, v.version_no, v.updated_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_publish_flow_draft: publish the draft with its validity range and note, optionally
-- closing the open-ended published version that starts before p_effective_from (spec §14.1),
-- all in one transaction. An overlap (23P01) or a stale `p_expected_updated_at` (HF002) leaves
-- everything unchanged, including the previous version's effective_to.
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_publish_flow_draft(
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
  v_flow uuid;
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

  select v.flow_id, v.status, v.updated_at into v_flow, v_status, v_updated
    from public.flow_versions v
   where v.id = p_version_id
   for update;
  if not found then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'flow_version_immutable' using errcode = 'HF001',
      detail = 'Only a draft can be published.';
  end if;
  if v_updated <> p_expected_updated_at then
    raise exception 'draft_conflict' using errcode = 'HF002',
      detail = 'The draft was saved by someone else since it was loaded.';
  end if;

  if coalesce(p_close_previous, false) then
    update public.flow_versions v
       set effective_to = p_effective_from
     where v.flow_id = v_flow
       and v.status = 'published'
       and v.effective_to is null
       and v.effective_from < p_effective_from;
  end if;

  return query
    update public.flow_versions v
       set status = 'published',
           effective_from = p_effective_from,
           effective_to = p_effective_to,
           change_note = v_note
     where v.id = p_version_id
    returning v.id, v.version_no;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_publish_flow_version (import, 20261026080200_rpc.sql): same signature and behaviour,
-- plus a mandatory non-blank change_note (stored trimmed).
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_publish_flow_version(
  p_code text,
  p_name text,
  p_description text,
  p_category text,
  p_instructions text,
  p_definition jsonb,
  p_effective_from date,
  p_effective_to date,
  p_change_note text,
  p_close_previous boolean
)
returns table (flow_id uuid, version_id uuid, version_no integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_flow uuid;
  v_version uuid;
  v_no integer;
  v_note text;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_flow_definition(p_definition);
  if p_effective_from is null then
    raise exception 'effective_from_required' using errcode = '22023';
  end if;
  v_note := private.require_change_note(p_change_note);

  insert into public.flows as f (code, name, description, category, instructions)
  values (p_code, p_name, coalesce(p_description, ''), coalesce(p_category, ''),
          coalesce(p_instructions, ''))
  on conflict (code) do update
    set name = excluded.name,
        description = excluded.description,
        category = excluded.category,
        instructions = excluded.instructions,
        is_archived = false
  returning f.id into v_flow;

  if coalesce(p_close_previous, false) then
    update public.flow_versions v
       set effective_to = p_effective_from
     where v.flow_id = v_flow
       and v.status = 'published'
       and v.effective_to is null
       and v.effective_from < p_effective_from;
  end if;

  insert into public.flow_versions as v
    (flow_id, status, effective_from, effective_to, definition, change_note)
  values (v_flow, 'published', p_effective_from, p_effective_to, p_definition, v_note)
  returning v.id, v.version_no into v_version, v_no;

  return query select v_flow, v_version, v_no;
end;
$$;

-- Privileges: functions are executable by PUBLIC by default; narrow them down.
revoke all on function public.admin_create_flow(text, text, text, text, text, jsonb)
  from public, anon;
revoke all on function public.admin_save_flow_draft(uuid, jsonb, timestamptz) from public, anon;
revoke all on function public.admin_create_draft_from_version(uuid) from public, anon;
revoke all on function public.admin_publish_flow_draft(uuid, date, date, text, boolean, timestamptz)
  from public, anon;
revoke all on function public.admin_publish_flow_version(
  text, text, text, text, text, jsonb, date, date, text, boolean) from public, anon;

grant execute on function public.admin_create_flow(text, text, text, text, text, jsonb)
  to authenticated;
grant execute on function public.admin_save_flow_draft(uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.admin_create_draft_from_version(uuid) to authenticated;
grant execute on function public.admin_publish_flow_draft(uuid, date, date, text, boolean, timestamptz)
  to authenticated;
grant execute on function public.admin_publish_flow_version(
  text, text, text, text, text, jsonb, date, date, text, boolean) to authenticated;
