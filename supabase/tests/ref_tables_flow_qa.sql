-- Adversarial checks (verifier) for reference tables used by flows (spec §34 AC-RT-08, 09 round 2):
-- try to read reference rows a User must not see, to forge `flow_versions.ref_tables`, to write
-- arbitrary JSON or other users' run logs, and to reach rows through the Admin RPCs.
--
-- Runs as one transaction and ROLLS BACK. Run as `postgres` after the migrations (on a plain
-- PostgreSQL load tests/support/supabase_stub.sql first):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ref_tables_flow_qa.sql
--
-- Success: the last result row is 'REF TABLES FLOW QA OK'. A failed assertion raises
-- "REF TABLES FLOW QA FAIL: …". No destructive keyword (HANDOFF §3). Fake data only.

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('00000000-0000-4000-8000-00000000a0d1'::uuid, 'qa.admin@users.hrflow.local'),
  ('00000000-0000-4000-8000-00000000a0d2'::uuid, 'qa.nv01@users.hrflow.local'),
  ('00000000-0000-4000-8000-00000000a0d3'::uuid, 'qa.nv02@users.hrflow.local')
) as u(id, email);

insert into public.profiles (id, username, full_name, role, is_active, must_change_password) values
  ('00000000-0000-4000-8000-00000000a0d1', 'qa.admin', 'Quản trị QA', 'admin', true, false),
  -- Assigned to F1 through a group only.
  ('00000000-0000-4000-8000-00000000a0d2', 'qa.nv01', 'Nhân viên QA 1', 'user', true, false),
  -- Assigned to F1 directly.
  ('00000000-0000-4000-8000-00000000a0d3', 'qa.nv02', 'Nhân viên QA 2', 'user', true, false);

create function pg_temp.qa_error(p_sql text, p_state text, p_label text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then
      return;
    end if;
    raise exception 'REF TABLES FLOW QA FAIL: % — expected SQLSTATE %, got % (%)',
      p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'REF TABLES FLOW QA FAIL: % — statement succeeded but should fail with %',
    p_label, p_state;
end;
$$;

create function pg_temp.qa(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'REF TABLES FLOW QA FAIL: %', p_label;
  end if;
end;
$$;

grant execute on function pg_temp.qa_error(text, text, text) to anon, authenticated;
grant execute on function pg_temp.qa(boolean, text) to anon, authenticated;

-- Tables: QA_A (used by F1 published), QA_B (only in a node of another type / bad shapes),
-- QA_C (only in F2 which has a draft but no published version).
insert into public.ref_tables (id, code, name, columns) values
  ('00000000-0000-4000-8000-00000000a0e1', 'QA_A', 'Bảng QA A',
   '[{"key":"ma","title":"Mã","type":"string","aliases":[],"isKey":true}]'),
  ('00000000-0000-4000-8000-00000000a0e2', 'QA_B', 'Bảng QA B',
   '[{"key":"ma","title":"Mã","type":"string","aliases":[],"isKey":true}]'),
  ('00000000-0000-4000-8000-00000000a0e3', 'QA_C', 'Bảng QA C',
   '[{"key":"ma","title":"Mã","type":"string","aliases":[],"isKey":true}]');

-- QA_A: v1 published 2026-01-01 → 2026-06-01, v2 published 2026-06-01 (open), v3 draft,
-- v4 discarded draft. Retired v1 is checked later.
insert into public.ref_table_versions (id, ref_table_id, version_no, rows) values
  ('00000000-0000-4000-8000-00000001a0e1', '00000000-0000-4000-8000-00000000a0e1', 1, '[{"ma":"V1"}]'),
  ('00000000-0000-4000-8000-00000001a0e2', '00000000-0000-4000-8000-00000000a0e2', 1, '[{"ma":"B1"}]'),
  ('00000000-0000-4000-8000-00000001a0e3', '00000000-0000-4000-8000-00000000a0e3', 1, '[{"ma":"C1"}]');
update public.ref_table_versions set status = 'published', effective_from = '2026-01-01',
       effective_to = '2026-06-01', change_note = 'v1'
 where id = '00000000-0000-4000-8000-00000001a0e1';
update public.ref_table_versions set status = 'published', effective_from = '2026-06-01',
       change_note = 'v1'
 where id in ('00000000-0000-4000-8000-00000001a0e2', '00000000-0000-4000-8000-00000001a0e3');
insert into public.ref_table_versions (id, ref_table_id, version_no, rows) values
  ('00000000-0000-4000-8000-00000002a0e1', '00000000-0000-4000-8000-00000000a0e1', 2, '[{"ma":"V2"}]');
update public.ref_table_versions set status = 'published', effective_from = '2026-06-01',
       change_note = 'v2'
 where id = '00000000-0000-4000-8000-00000002a0e1';
insert into public.ref_table_versions (id, ref_table_id, version_no, rows) values
  ('00000000-0000-4000-8000-00000003a0e1', '00000000-0000-4000-8000-00000000a0e1', 3,
   '[{"ma":"NHAP"}]');
update public.ref_table_versions set status = 'discarded'
 where id = '00000000-0000-4000-8000-00000003a0e1';
insert into public.ref_table_versions (id, ref_table_id, version_no, rows) values
  ('00000000-0000-4000-8000-00000004a0e1', '00000000-0000-4000-8000-00000000a0e1', 3,
   '[{"ma":"NHAP2"}]');

insert into public.flows (id, code, name) values
  ('00000000-0000-4000-8000-00000000a0f1', 'qa-flow-1', 'Flow QA 1'),
  ('00000000-0000-4000-8000-00000000a0f2', 'qa-flow-2', 'Flow QA 2 (chỉ có draft)');
insert into public.groups (id, name) values ('00000000-0000-4000-8000-00000000a0b9', 'Nhóm QA');
insert into public.group_members (group_id, user_id) values
  ('00000000-0000-4000-8000-00000000a0b9', '00000000-0000-4000-8000-00000000a0d2');
insert into public.flow_assignments (flow_id, user_id, group_id) values
  ('00000000-0000-4000-8000-00000000a0f1', null, '00000000-0000-4000-8000-00000000a0b9'),
  ('00000000-0000-4000-8000-00000000a0f1', '00000000-0000-4000-8000-00000000a0d3', null),
  ('00000000-0000-4000-8000-00000000a0f2', '00000000-0000-4000-8000-00000000a0d3', null);

-- F1 published: QA_A via a node; QA_B only in shapes that must NOT count (wrong node type,
-- refTable as a number / array / object, lowercase or injected code, nested deeper).
insert into public.flow_versions (id, flow_id, status, effective_from, change_note, definition)
values ('00000000-0000-4000-8000-00000001a0f1', '00000000-0000-4000-8000-00000000a0f1',
        'published', '2026-01-01', 'v1',
        $j${"schemaVersion":1,
            "nodes":[{"id":"a","type":"input.refTable","config":{"refTable":"QA_A"}},
                     {"id":"b","type":"transform.select","config":{"refTable":"QA_B"}},
                     {"id":"c","type":"input.refTable","config":{"refTable":["QA_B"]}},
                     {"id":"d","type":"input.refTable","config":{"refTable":{"x":"QA_B"}}},
                     {"id":"e","type":"input.refTable","config":{"refTable":"QA_B' or '1'='1"}},
                     {"id":"f","type":"input.refTable","config":{"refTable":" QA_B"}},
                     {"id":"g","type":"input.refTable","config":{"inner":{"refTable":"QA_B"}}},
                     "QA_B", null, 7],
            "edges":[],
            "params":[{"key":"p","type":"select","options":["QA_B"]},
                      {"key":"q","type":"select","options":{"fromRefTable":"qa_b"}},
                      {"key":"r","type":"select","options":{"fromRefTable":"QA_B\n"}},
                      "QA_B"]}$j$);
-- F2 only has a draft using QA_C.
insert into public.flow_versions (id, flow_id, status, definition) values
  ('00000000-0000-4000-8000-00000001a0f2', '00000000-0000-4000-8000-00000000a0f2', 'draft',
   '{"schemaVersion":1,"nodes":[{"id":"r","type":"input.refTable","config":{"refTable":"QA_C"}}],"edges":[],"params":[]}');

select pg_temp.qa(
  (select ref_tables from public.flow_versions where id = '00000000-0000-4000-8000-00000001a0f1')
    = array['QA_A'],
  'ill-formed / foreign node shapes and trailing-whitespace codes never add a table');
select pg_temp.qa(private.flow_ref_tables(null) = '{}'::text[]
  and private.flow_ref_tables('"x"'::jsonb) = '{}'::text[]
  and private.flow_ref_tables('{"nodes":null,"params":null}'::jsonb) = '{}'::text[],
  'null / scalar definitions give an empty list (no error)');

-- ---------------------------------------------------------------------------------------------
-- nv01 (through the group)
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000a0d2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.qa((select array_agg(code order by code) from public.ref_tables) = array['QA_A'],
  'group User reads QA_A only');
select pg_temp.qa(
  (select array_agg(version_no order by version_no) from public.ref_table_versions) = array[1, 2],
  'group User reads both published versions of QA_A, never the draft or the discarded one');
-- Filters a PostgREST client could send cannot reach hidden rows.
select pg_temp.qa(
  not exists (select 1 from public.ref_table_versions where rows::text like '%NHAP%'
              or status in ('draft', 'discarded') or ref_table_id <> '00000000-0000-4000-8000-00000000a0e1'),
  'filters on rows / status / table id never surface hidden versions');
-- A User cannot change what they can read.
update public.ref_table_versions set status = 'published'
 where id = '00000000-0000-4000-8000-00000004a0e1';
update public.ref_tables set columns = '[]' where code = 'QA_A';
-- RLS filters the row out (0 rows updated); checked after reset role below.
update public.flow_versions
   set definition = '{"nodes":[{"type":"input.refTable","config":{"refTable":"QA_B"}}]}'
 where id = '00000000-0000-4000-8000-00000001a0f1';
select pg_temp.qa_error(
  $q$insert into public.flow_versions (flow_id, status, definition)
     values ('00000000-0000-4000-8000-00000000a0f1', 'draft',
             '{"nodes":[{"type":"input.refTable","config":{"refTable":"QA_B"}}]}')$q$,
  '42501', 'a User cannot insert a flow version');
-- Admin RPCs refuse a User (no rows, no draft copied from a readable published version).
select pg_temp.qa((select count(*) from public.admin_ref_table_usage()) = 0,
  'admin_ref_table_usage gives a User no row');
select pg_temp.qa_error(
  $q$select * from public.admin_create_ref_draft_from_version('00000000-0000-4000-8000-00000002a0e1')$q$,
  '42501', 'a User cannot copy a readable published version into a draft');
-- Run log: own logs only, metadata shape only.
select pg_temp.qa_error(
  $q$insert into public.run_logs (user_id, flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-00000000a0d3', '00000000-0000-4000-8000-00000001a0f1',
             'succeeded', 1, '{}')$q$,
  '42501', 'a User cannot write a run log for another user');
select pg_temp.qa_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-00000001a0f2', 'succeeded', 1, '{}')$q$,
  '42501', 'a User cannot log a run of a draft version');
select pg_temp.qa_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-00000001a0f1', 'succeeded', 1, null)$q$,
  '23502', 'ref_versions cannot be null');
select pg_temp.qa_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-00000001a0f1', 'succeeded', 1,
             '{"QA_A":"00000000-0000-4000-8000-00000001A0E1"}')$q$,
  '23514', 'ref_versions refuses an upper-case / non-canonical id');
select pg_temp.qa_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-00000001a0f1', 'succeeded', 1,
             '{"QA_A":"00000000-0000-4000-8000-00000001a0e1 CN01"}')$q$,
  '23514', 'ref_versions refuses an id with trailing text');
select pg_temp.qa_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-00000001a0f1', 'succeeded', 1,
             '{"QA_A":"00000000-0000-4000-8000-00000001a0e1\nCN01"}')$q$,
  '23514', 'ref_versions refuses an id followed by a newline and text');
select pg_temp.qa_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-00000001a0f1', 'succeeded', 1,
             '{"QA_A\nNguyen Van A":"00000000-0000-4000-8000-00000001a0e1"}')$q$,
  '23514', 'ref_versions refuses a key followed by a newline and text');
select pg_temp.qa_error(
  format($q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-00000001a0f1', 'succeeded', 1, %L)$q$,
     (select jsonb_object_agg('T_' || g, '00000000-0000-4000-8000-00000001a0e1')
        from generate_series(1, 51) g)),
  '23514', 'ref_versions refuses more than 50 entries');
select pg_temp.qa_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-00000001a0f1', 'succeeded', 1, '"QA_A"')$q$,
  '23514', 'ref_versions refuses a JSON string');
reset role;

select pg_temp.qa(
  (select status from public.ref_table_versions where id = '00000000-0000-4000-8000-00000004a0e1') = 'draft'
  and (select jsonb_array_length(columns) from public.ref_tables where code = 'QA_A') = 1
  and (select ref_tables from public.flow_versions where id = '00000000-0000-4000-8000-00000001a0f1') = array['QA_A'],
  'User updates on tables / versions / flows changed nothing');

-- nv02 (direct on F1, plus F2 which only has a draft using QA_C)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.qa((select array_agg(code order by code) from public.ref_tables) = array['QA_A'],
  'a table used only by the draft of an assigned flow stays hidden');
reset role;

-- Retire QA_A v1: retired versions are hidden.
update public.ref_table_versions set status = 'retired'
 where id = '00000000-0000-4000-8000-00000001a0e1';
-- Group membership removed → nv01 loses access at once.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.qa(
  (select array_agg(version_no order by version_no) from public.ref_table_versions) = array[2],
  'a retired version is hidden from Users');
reset role;
insert into public.groups (id, name) values ('00000000-0000-4000-8000-00000000a0ba', 'Nhóm QA khác');
update public.group_members set group_id = '00000000-0000-4000-8000-00000000a0ba'
 where user_id = '00000000-0000-4000-8000-00000000a0d2';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000a0d2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.qa((select count(*) from public.ref_tables) = 0
  and (select count(*) from public.ref_table_versions) = 0,
  'a User moved out of the group reads nothing');
reset role;

-- Archiving F1 removes access of the direct assignee too.
update public.flows set is_archived = true where id = '00000000-0000-4000-8000-00000000a0f1';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000a0d3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.qa((select count(*) from public.ref_tables) = 0
  and (select count(*) from public.ref_table_versions) = 0,
  'archived flow → no access');
reset role;

-- Definer helpers are safe: fixed search_path, not callable by anon, and a User calling
-- can_read_ref_table directly learns nothing beyond what RLS already allows.
select pg_temp.qa(
  (select bool_and(p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('can_read_ref_table', 'flow_ref_tables', 'is_valid_ref_versions')),
  'helpers pin search_path to empty');
select pg_temp.qa(
  not has_function_privilege('anon', 'private.is_valid_ref_versions(jsonb)', 'EXECUTE')
  and not has_function_privilege('public', 'private.can_read_ref_table(uuid)', 'EXECUTE'),
  'PUBLIC / anon cannot execute the helpers');
select 'REF TABLES FLOW QA OK' as ref_tables_flow_qa_result;

rollback;
