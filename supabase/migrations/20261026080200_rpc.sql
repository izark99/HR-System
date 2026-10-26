-- RPCs used by the web app (PostgREST /rest/v1/rpc/*).
-- SECURITY INVOKER unless stated: RLS of the caller applies, the function only shapes the result.

-- ---------------------------------------------------------------------------------------------
-- my_flows(as_of): flows the caller can run, with the published version effective on as_of
-- (spec §14.2: effective_from <= as_of < coalesce(effective_to, +inf)). Version columns are null
-- when no version is effective on that date (the run page can still pick another period).
-- Users: flows assigned directly or via a group (RLS). Admins: every non-archived flow that has a
-- published version.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.my_flows(date);
create function public.my_flows(p_as_of date default current_date)
returns table (
  flow_id uuid,
  code text,
  name text,
  description text,
  category text,
  instructions text,
  version_id uuid,
  version_no integer,
  effective_from date,
  effective_to date,
  input_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    f.id, f.code, f.name, f.description, f.category, f.instructions,
    cur.id, cur.version_no, cur.effective_from, cur.effective_to,
    case when jsonb_typeof(coalesce(cur.definition, lat.definition) -> 'inputSlots') = 'array'
      then jsonb_array_length(coalesce(cur.definition, lat.definition) -> 'inputSlots')
      else 0
    end
  from public.flows f
  left join lateral (
    select v.id, v.version_no, v.effective_from, v.effective_to, v.definition
    from public.flow_versions v
    where v.flow_id = f.id
      and v.status = 'published'
      and v.effective_from <= p_as_of
      and (v.effective_to is null or v.effective_to > p_as_of)
    limit 1
  ) cur on true
  left join lateral (
    select v.definition
    from public.flow_versions v
    where v.flow_id = f.id and v.status = 'published'
    order by v.effective_from desc
    limit 1
  ) lat on true
  where not f.is_archived
    and lat.definition is not null
  order by f.category, f.name
$$;

-- ---------------------------------------------------------------------------------------------
-- resolve_flow_version(code, as_of): the published version effective on as_of (applies = true).
-- When none is effective, the latest published version is returned with applies = false so the
-- run page can still render its params and tell the User that the chosen period has no version.
-- No row = flow unknown, archived, or not visible to the caller.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.resolve_flow_version(text, date);
create function public.resolve_flow_version(p_code text, p_as_of date)
returns table (
  version_id uuid,
  flow_id uuid,
  code text,
  name text,
  description text,
  category text,
  instructions text,
  version_no integer,
  effective_from date,
  effective_to date,
  definition jsonb,
  applies boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    v.id, f.id, f.code, f.name, f.description, f.category, f.instructions,
    v.version_no, v.effective_from, v.effective_to, v.definition,
    (v.effective_from <= p_as_of and (v.effective_to is null or v.effective_to > p_as_of))
      as applies
  from public.flows f
  join public.flow_versions v on v.flow_id = f.id and v.status = 'published'
  where f.code = p_code and not f.is_archived
  order by applies desc, v.effective_from desc
  limit 1
$$;

-- ---------------------------------------------------------------------------------------------
-- my_recent_runs(limit): the caller's own runs with flow name, version number and the labels of
-- the logged params (spec §15.1 step 7). SECURITY DEFINER because a past run may reference a
-- version that is retired now (not readable by Users); the WHERE clause pins it to the caller.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.my_recent_runs(integer);
create function public.my_recent_runs(p_limit integer default 10)
returns table (
  id uuid,
  created_at timestamptz,
  flow_code text,
  flow_name text,
  version_no integer,
  params jsonb,
  param_defs jsonb,
  status text,
  duration_ms integer,
  rows_out integer,
  error_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id, r.created_at, f.code, f.name, v.version_no, r.params,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', p ->> 'key', 'label', p ->> 'label', 'type', p ->> 'type'))
      from jsonb_array_elements(
        case when jsonb_typeof(v.definition -> 'params') = 'array'
          then v.definition -> 'params' else '[]'::jsonb end) as p
    ), '[]'::jsonb),
    r.status, r.duration_ms, r.rows_out, r.error_code
  from public.run_logs r
  join public.flow_versions v on v.id = r.flow_version_id
  join public.flows f on f.id = v.flow_id
  where r.user_id = (select auth.uid())
    and private.is_active_user()
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_publish_flow_version: import a flow JSON as a new published version, atomically.
-- Creates the flow when the code is new (else updates its metadata). With p_close_previous, the
-- open-ended published version that starts before p_effective_from gets effective_to =
-- p_effective_from (spec §14.1). Overlaps are rejected by the exclusion constraint (23P01).
-- SECURITY INVOKER: only Admins pass RLS on flows/flow_versions.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.admin_publish_flow_version(
  text, text, text, text, text, jsonb, date, date, text, boolean);
create function public.admin_publish_flow_version(
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
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_definition is null or jsonb_typeof(p_definition) <> 'object'
     or coalesce(p_definition ->> 'schemaVersion', '') !~ '^[0-9]+$' then
    raise exception 'invalid_definition' using errcode = '22023';
  end if;
  if p_effective_from is null then
    raise exception 'effective_from_required' using errcode = '22023';
  end if;

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
  values (v_flow, 'published', p_effective_from, p_effective_to, p_definition,
          coalesce(p_change_note, ''))
  returning v.id, v.version_no into v_version, v_no;

  return query select v_flow, v_version, v_no;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- purge_run_logs: retention (spec §16). Deletes run logs older than N months (default:
-- app_settings.run_log_retention_months, else 12). Admin or service role only.
-- Schedule daily with pg_cron, e.g.:
--   select cron.schedule('hrflow-purge-run-logs', '30 18 * * *',
--                        $$select public.purge_run_logs()$$);
-- ---------------------------------------------------------------------------------------------

drop function if exists public.purge_run_logs(integer);
create function public.purge_run_logs(p_months integer default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_months integer;
  v_count integer;
begin
  -- No JWT role claim = direct database session (pg_cron, SQL editor); API calls always carry one.
  if auth.role() is not null
     and auth.role() <> 'service_role'
     and not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(
           p_months,
           (select (s.value #>> '{}')::integer from public.app_settings s
             where s.key = 'run_log_retention_months'
               and (s.value #>> '{}') ~ '^[0-9]+$'),
           12)
    into v_months;
  if v_months < 1 then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;
  delete from public.run_logs where created_at < now() - make_interval(months => v_months);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_revoke_user_sessions: end every session of a user (lock / password reset). Called by the
-- admin-users Edge Function with the service role; not executable by API users.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.admin_revoke_user_sessions(uuid);
create function public.admin_revoke_user_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

-- Privileges: functions are executable by PUBLIC by default; narrow them down.
revoke all on function public.my_flows(date) from public, anon;
revoke all on function public.resolve_flow_version(text, date) from public, anon;
revoke all on function public.my_recent_runs(integer) from public, anon;
revoke all on function public.admin_publish_flow_version(
  text, text, text, text, text, jsonb, date, date, text, boolean) from public, anon;
revoke all on function public.purge_run_logs(integer) from public, anon;
revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;

grant execute on function public.my_flows(date) to authenticated;
grant execute on function public.resolve_flow_version(text, date) to authenticated;
grant execute on function public.my_recent_runs(integer) to authenticated;
grant execute on function public.admin_publish_flow_version(
  text, text, text, text, text, jsonb, date, date, text, boolean) to authenticated;
grant execute on function public.purge_run_logs(integer) to authenticated, service_role;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;
