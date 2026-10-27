-- RLS / privilege tests (spec §7.3, §20). No pgTAP needed.
--
-- Runs as one transaction and ROLLS BACK: nothing it creates survives. Run it as the `postgres`
-- role (Supabase SQL editor / management connection, or psql):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
--
-- Success: the last result row is 'RLS OK'. Any failed assertion raises an exception whose text
-- starts with "RLS FAIL:" and aborts the script.
--
-- Fake accounts only (NV-style usernames, @users.hrflow.local). UUIDs are fixed so the script is
-- readable; they cannot clash with real auth users (version-4 shape with a 0000… prefix).

begin;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as postgres: table owner, RLS not applied)
-- ---------------------------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('00000000-0000-4000-8000-00000000000a'::uuid, 'rls.admin@users.hrflow.local'),
  ('00000000-0000-4000-8000-000000000001'::uuid, 'rls.nv01@users.hrflow.local'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'rls.nv02@users.hrflow.local'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'rls.nv03@users.hrflow.local')
) as u(id, email);

insert into public.profiles (id, username, full_name, role, is_active, must_change_password) values
  ('00000000-0000-4000-8000-00000000000a', 'rls.admin', 'Quản trị Giả', 'admin', true, false),
  ('00000000-0000-4000-8000-000000000001', 'rls.nv01', 'Nhân viên Giả 1', 'user', true, true),
  ('00000000-0000-4000-8000-000000000002', 'rls.nv02', 'Nhân viên Giả 2', 'user', true, false),
  ('00000000-0000-4000-8000-000000000003', 'rls.nv03', 'Nhân viên Giả 3', 'user', false, false);

insert into public.groups (id, name) values
  ('00000000-0000-4000-8000-0000000000b1', 'RLS nhóm A'),
  ('00000000-0000-4000-8000-0000000000b2', 'RLS nhóm B');
insert into public.group_members (group_id, user_id) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000003');

insert into public.flows (id, code, name) values
  ('00000000-0000-4000-8000-0000000000f1', 'rls-f1', 'RLS flow 1 (group A)'),
  ('00000000-0000-4000-8000-0000000000f2', 'rls-f2', 'RLS flow 2 (direct nv02)'),
  ('00000000-0000-4000-8000-0000000000f3', 'rls-f3', 'RLS flow 3 (unassigned)'),
  ('00000000-0000-4000-8000-0000000000f4', 'rls-f4', 'RLS flow 4 (group A, draft only)');

insert into public.flow_versions (id, flow_id, status, effective_from, effective_to, definition) values
  ('00000000-0000-4000-8000-0000000001f1', '00000000-0000-4000-8000-0000000000f1', 'published',
   '2026-01-01', '2026-09-01', '{"schemaVersion":1,"nodes":[],"inputSlots":[{}]}'),
  ('00000000-0000-4000-8000-0000000002f1', '00000000-0000-4000-8000-0000000000f1', 'published',
   '2026-09-01', null, '{"schemaVersion":1,"nodes":[],"inputSlots":[{},{}],"params":[{"key":"ky_luong","label":"Kỳ lương","type":"month"}]}'),
  ('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000000f1', 'draft',
   null, null, '{"schemaVersion":1,"nodes":[]}'),
  ('00000000-0000-4000-8000-0000000001f2', '00000000-0000-4000-8000-0000000000f2', 'published',
   '2026-01-01', null, '{"schemaVersion":1,"nodes":[]}'),
  ('00000000-0000-4000-8000-0000000001f3', '00000000-0000-4000-8000-0000000000f3', 'published',
   '2026-01-01', null, '{"schemaVersion":1,"nodes":[]}'),
  ('00000000-0000-4000-8000-0000000001f4', '00000000-0000-4000-8000-0000000000f4', 'draft',
   null, null, '{"schemaVersion":1,"nodes":[]}');

insert into public.flow_assignments (flow_id, group_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b1'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000b1');
insert into public.flow_assignments (flow_id, user_id) values
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-000000000002');

-- A run log of nv02 (nv01 must not see it) and one of nv03 from before the lock.
insert into public.run_logs (user_id, flow_version_id, status, duration_ms) values
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000001f2', 'succeeded', 10),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000002f1', 'succeeded', 10);
-- A direct assignment of nv03 (still hidden once locked).
insert into public.flow_assignments (flow_id, user_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000003');

-- Generic "this statement must fail with SQLSTATE x" helper (dropped by the rollback).
create function pg_temp.expect_error(p_sql text, p_state text, p_label text)
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
    raise exception 'RLS FAIL: % — expected SQLSTATE %, got % (%)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'RLS FAIL: % — statement succeeded but should fail with %', p_label, p_state;
end;
$$;

create function pg_temp.expect(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'RLS FAIL: %', p_label;
  end if;
end;
$$;

grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated;
grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- User nv01 (member of group A)
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.expect(
  (select array_agg(code order by code) from public.flows where code like 'rls-%') = array['rls-f1'],
  'nv01 sees exactly the flow assigned through group A (not unassigned, not draft-only)');

select pg_temp.expect(
  (select array_agg(id order by id) from public.flow_versions)
    = array['00000000-0000-4000-8000-0000000001f1', '00000000-0000-4000-8000-0000000002f1']::uuid[],
  'nv01 sees only the published versions of rls-f1 (no draft)');

select pg_temp.expect(
  (select count(*) from public.my_flows('2026-09-15') where code like 'rls-%') = 1
  and (select version_no from public.my_flows('2026-09-15') where code = 'rls-f1') = 2
  and (select input_count from public.my_flows('2026-09-15') where code = 'rls-f1') = 2,
  'my_flows(2026-09-15) returns rls-f1 with v2 (effective from 2026-09-01)');

select pg_temp.expect(
  (select version_no from public.my_flows('2026-03-01') where code = 'rls-f1') = 1,
  'my_flows(2026-03-01) picks v1');

select pg_temp.expect(
  (select version_no from public.my_flows('2025-12-31') where code = 'rls-f1') is null
  and exists (select 1 from public.my_flows('2025-12-31') where code = 'rls-f1'),
  'my_flows before any version: flow listed, no version');

select pg_temp.expect(
  (select applies and version_no = 1 from public.resolve_flow_version('rls-f1', '2026-08-31')),
  'resolve_flow_version: 2026-08-31 -> v1 (effective_to is exclusive)');
select pg_temp.expect(
  (select applies and version_no = 2 from public.resolve_flow_version('rls-f1', '2026-09-01')),
  'resolve_flow_version: 2026-09-01 -> v2');
select pg_temp.expect(
  (select not applies and version_no = 2 from public.resolve_flow_version('rls-f1', '2025-01-01')),
  'resolve_flow_version: no effective version -> latest, applies = false');
select pg_temp.expect(
  not exists (select 1 from public.resolve_flow_version('rls-f3', '2026-09-01')),
  'resolve_flow_version: unassigned flow returns nothing');

select pg_temp.expect(
  (select array_agg(username) from public.profiles) = array['rls.nv01'],
  'nv01 sees only their own profile');

select pg_temp.expect(
  (select count(*) from public.groups where name like 'RLS%') = 1,
  'nv01 sees only their own group');

select pg_temp.expect(
  (select count(*) from public.flow_assignments) = 2,
  'nv01 sees the 2 assignments of group A only');

update public.profiles set full_name = 'Tên Giả Mới' where id = '00000000-0000-4000-8000-000000000001';
select pg_temp.expect(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-000000000001') = 'Tên Giả Mới',
  'nv01 can update own full_name');

select pg_temp.expect_error(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000001'$$,
  '42501', 'nv01 cannot change own role');
select pg_temp.expect_error(
  $$update public.profiles set is_active = true where id = '00000000-0000-4000-8000-000000000001'$$,
  '42501', 'nv01 cannot change own is_active');
select pg_temp.expect_error(
  $$update public.profiles set must_change_password = false where id = '00000000-0000-4000-8000-000000000001'$$,
  '42501', 'nv01 cannot clear must_change_password');
select pg_temp.expect_error(
  $$update public.profiles set username = 'rls.hacker' where id = '00000000-0000-4000-8000-000000000001'$$,
  '42501', 'nv01 cannot change own username');
select pg_temp.expect_error(
  $$insert into public.profiles (id, username) values (gen_random_uuid(), 'rls.new')$$,
  '42501', 'nv01 cannot insert profiles');

do $$
declare
  n integer;
begin
  update public.profiles set full_name = 'x' where id = '00000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'nv01 cannot update another profile');
end
$$;

select pg_temp.expect_error(
  $$insert into public.flows (code, name) values ('rls-hack', 'x')$$,
  '42501', 'nv01 cannot insert flows');
select pg_temp.expect_error(
  $$insert into public.flow_versions (flow_id, definition) values ('00000000-0000-4000-8000-0000000000f1', '{"schemaVersion":1}')$$,
  '42501', 'nv01 cannot insert flow versions');
select pg_temp.expect_error(
  $$insert into public.flow_assignments (flow_id, user_id) values ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-000000000001')$$,
  '42501', 'nv01 cannot assign flows to themself');
select pg_temp.expect_error(
  $$insert into public.group_members (group_id, user_id) values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000001')$$,
  '42501', 'nv01 cannot join groups');
select pg_temp.expect_error(
  $$select public.admin_publish_flow_version('rls-x', 'x', '', '', '', '{"schemaVersion":1}', '2026-01-01', null, '', false)$$,
  '42501', 'nv01 cannot publish flows');
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('rls-x', 'x', '', '', '', '{"schemaVersion":1}')$$,
  '42501', 'nv01 cannot create flows');
select pg_temp.expect_error(
  $$select public.admin_save_flow_draft('00000000-0000-4000-8000-0000000003f1', '{"schemaVersion":1}', now())$$,
  '42501', 'nv01 cannot save drafts');
select pg_temp.expect_error(
  $$select * from public.admin_create_draft_from_version('00000000-0000-4000-8000-0000000001f1')$$,
  '42501', 'nv01 cannot create drafts from a version');
select pg_temp.expect_error(
  $$select * from public.admin_publish_flow_draft('00000000-0000-4000-8000-0000000003f1', '2027-01-01', null, 'x', false, now())$$,
  '42501', 'nv01 cannot publish drafts');
select pg_temp.expect_error(
  $$select public.admin_revoke_user_sessions('00000000-0000-4000-8000-000000000002')$$,
  '42501', 'nv01 cannot call admin_revoke_user_sessions');
select pg_temp.expect_error(
  $$select public.purge_run_logs(1)$$,
  '42501', 'nv01 cannot purge run logs');

do $$
declare
  n integer;
begin
  update public.flows set name = 'x' where code = 'rls-f1';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'nv01 cannot update an assigned flow');
  delete from public.flow_versions where flow_id = '00000000-0000-4000-8000-0000000000f1';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'nv01 cannot delete flow versions');
end
$$;

-- Run logs: own rows for runnable versions, metadata shape only.
insert into public.run_logs (user_id, flow_version_id, params, inputs_meta, status, duration_ms,
                             rows_out, error_code, error_node_id)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000002f1',
        '{"ky_luong":"2026-09"}',
        ('[{"slot":"bang_luong","rows":75,"files":[{"sha256":"' || repeat('ab', 32) || '","size":1234}]}]')::jsonb,
        'failed', 1500, null, 'executor.error.engineCrashed', 'cmp');

select pg_temp.expect_error(
  $$insert into public.run_logs (flow_version_id, status, duration_ms) values ('00000000-0000-4000-8000-0000000001f3', 'succeeded', 1)$$,
  '42501', 'nv01 cannot log a run of an unassigned flow');
select pg_temp.expect_error(
  $$insert into public.run_logs (flow_version_id, status, duration_ms) values ('00000000-0000-4000-8000-0000000003f1', 'succeeded', 1)$$,
  '42501', 'nv01 cannot log a run of a draft version');
select pg_temp.expect_error(
  $$insert into public.run_logs (user_id, flow_version_id, status, duration_ms) values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000002f1', 'succeeded', 1)$$,
  '42501', 'nv01 cannot log a run as another user');
select pg_temp.expect_error(
  $$insert into public.run_logs (flow_version_id, status, duration_ms, error_code) values ('00000000-0000-4000-8000-0000000002f1', 'failed', 1, 'Lỗi dòng 5: NV00001 Nguyễn Văn A')$$,
  '23514', 'run_logs.error_code rejects raw message text');
select pg_temp.expect_error(
  $$insert into public.run_logs (flow_version_id, status, duration_ms, inputs_meta) values ('00000000-0000-4000-8000-0000000002f1', 'succeeded', 1, '[{"slot":"bang_luong","rows":1,"files":[{"name":"bang_luong_CN01.xlsx","size":1}]}]')$$,
  '23514', 'run_logs.inputs_meta rejects plain file names');
select pg_temp.expect_error(
  $$insert into public.run_logs (flow_version_id, status, duration_ms, inputs_meta) values ('00000000-0000-4000-8000-0000000002f1', 'succeeded', 1, '[{"slot":"bang_luong","rows":1,"files":[{"sha256":"nothex","size":1}]}]')$$,
  '23514', 'run_logs.inputs_meta requires SHA-256 hex digests');
select pg_temp.expect_error(
  $$insert into public.run_logs (flow_version_id, status, duration_ms, params) values ('00000000-0000-4000-8000-0000000002f1', 'succeeded', 1, '{"rows":[["NV00001","Nguyễn Văn A"]]}')$$,
  '23514', 'run_logs.params rejects nested values (no table data)');

select pg_temp.expect(
  (select count(*) from public.run_logs) = 1
  and (select user_id from public.run_logs) = '00000000-0000-4000-8000-000000000001',
  'nv01 sees only their own run log');
select pg_temp.expect(
  (select count(*) from public.my_recent_runs(10)) = 1
  and (select version_no = 2 and param_defs -> 0 ->> 'label' = 'Kỳ lương'
       from public.my_recent_runs(10)),
  'my_recent_runs returns own runs with version and param labels');
select pg_temp.expect_error(
  $$delete from public.run_logs$$, '42501', 'run logs are append-only for users');
select pg_temp.expect_error(
  $$update public.run_logs set status = 'succeeded'$$, '42501', 'users cannot edit run logs');
select pg_temp.expect(
  (select count(*) from public.audit_logs) = 0, 'nv01 cannot read the audit log');

reset role;

-- ---------------------------------------------------------------------------------------------
-- User nv02 (direct assignment)
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.expect(
  (select array_agg(code order by code) from public.flows where code like 'rls-%') = array['rls-f2'],
  'nv02 sees exactly the flow assigned directly');
select pg_temp.expect(
  (select count(*) from public.groups where name like 'RLS%') = 0, 'nv02 sees no group');

reset role;

-- ---------------------------------------------------------------------------------------------
-- Locked user nv03 (member of group A, is_active = false)
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.expect(
  (select count(*) from public.flows where code like 'rls-%') = 0, 'locked user sees no flows');
select pg_temp.expect(
  (select count(*) from public.my_flows(current_date) where code like 'rls-%') = 0,
  'locked user: my_flows is empty');
select pg_temp.expect_error(
  $$insert into public.run_logs (flow_version_id, status, duration_ms) values ('00000000-0000-4000-8000-0000000002f1', 'succeeded', 1)$$,
  '42501', 'locked user cannot log runs');
select pg_temp.expect(
  (select count(*) from public.app_settings) = 0, 'locked user cannot read app settings');
select pg_temp.expect(
  (select count(*) from public.groups where name like 'RLS %') = 0, 'locked user sees no groups');
select pg_temp.expect(
  (select count(*) from public.group_members) = 0, 'locked user sees no group memberships');
select pg_temp.expect(
  (select count(*) from public.flow_assignments) = 0, 'locked user sees no flow assignments');
select pg_temp.expect(
  (select count(*) from public.run_logs) = 0, 'locked user sees no run logs (not even own)');
select pg_temp.expect(
  (select count(*) from public.my_recent_runs(50)) = 0, 'locked user: my_recent_runs is empty');
select pg_temp.expect(
  (select count(*) from public.profiles
    where id = '00000000-0000-4000-8000-000000000003' and not is_active) = 1,
  'locked user still reads own profile (client shows "locked")');
do $$
declare
  n integer;
begin
  update public.profiles set full_name = 'x' where id = '00000000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'locked user cannot edit own profile');
end
$$;

reset role;

-- ---------------------------------------------------------------------------------------------
-- anon (publishable key, no session)
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select pg_temp.expect(
  (select count(*) from public.app_settings) = 0,
  'anon: app_settings readable (keep-alive) but returns no rows');
select pg_temp.expect_error($$select * from public.flows$$, '42501', 'anon cannot read flows');
select pg_temp.expect_error($$select * from public.profiles$$, '42501', 'anon cannot read profiles');
select pg_temp.expect_error($$select * from public.my_flows(current_date)$$, '42501', 'anon cannot call my_flows');
select pg_temp.expect_error($$select * from public.run_logs$$, '42501', 'anon cannot read run logs');

reset role;

-- ---------------------------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.expect(
  (select count(*) from public.flows where code like 'rls-%') = 4, 'admin sees all flows');
select pg_temp.expect(
  (select count(*) from public.flow_versions v join public.flows f on f.id = v.flow_id
    where f.code like 'rls-%') = 6, 'admin sees all versions incl. drafts');
select pg_temp.expect(
  (select count(*) from public.profiles where username like 'rls.%') = 4, 'admin sees all profiles');
select pg_temp.expect(
  (select count(*) from public.run_logs r join public.profiles p on p.id = r.user_id
    where p.username like 'rls.%') = 3, 'admin sees all run logs');
select pg_temp.expect(
  (select count(*) from public.my_flows('2026-09-15') where code like 'rls-%') = 3,
  'admin: my_flows lists every flow with a published version');

insert into public.flows (code, name) values ('rls-admin-new', 'Flow mới của Admin');
insert into public.groups (name) values ('RLS nhóm C');
insert into public.group_members (group_id, user_id) values
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000002');
insert into public.flow_assignments (flow_id, group_id) values
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000b2');

select pg_temp.expect_error(
  $$insert into public.flow_assignments (flow_id, user_id, group_id) values ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b2')$$,
  '23514', 'an assignment targets a user OR a group, not both');
select pg_temp.expect_error(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000002'$$,
  '42501', 'admin changes roles only through the Edge Function (no column privilege)');

-- Versioning rules.
select pg_temp.expect_error(
  $$insert into public.flow_versions (flow_id, status, effective_from, definition) values ('00000000-0000-4000-8000-0000000000f1', 'published', '2026-10-01', '{"schemaVersion":1}')$$,
  '23P01', 'published ranges of one flow cannot overlap');
select pg_temp.expect_error(
  $$update public.flow_versions set definition = '{"schemaVersion":1,"x":1}' where id = '00000000-0000-4000-8000-0000000001f1'$$,
  'HF001', 'published definition is immutable');
select pg_temp.expect_error(
  $$update public.flow_versions set effective_from = '2025-01-01' where id = '00000000-0000-4000-8000-0000000001f1'$$,
  'HF001', 'published effective_from is immutable');
select pg_temp.expect_error(
  $$update public.flow_versions set id = '00000000-0000-4000-8000-0000000009f1' where id = '00000000-0000-4000-8000-0000000002f1'$$,
  'HF001', 'published id is immutable');
select pg_temp.expect_error(
  $$update public.flow_versions set version_no = 99 where id = '00000000-0000-4000-8000-0000000002f1'$$,
  'HF001', 'published version_no is immutable');
select pg_temp.expect_error(
  $$update public.flow_versions set flow_id = '00000000-0000-4000-8000-0000000000f3' where id = '00000000-0000-4000-8000-0000000002f1'$$,
  'HF001', 'published flow_id is immutable');
select pg_temp.expect_error(
  $$delete from public.flow_versions where id = '00000000-0000-4000-8000-0000000001f1'$$,
  'HF001', 'published versions cannot be deleted');
select pg_temp.expect_error(
  $$insert into public.flow_versions (flow_id, status, definition) values ('00000000-0000-4000-8000-0000000000f1', 'draft', '{"schemaVersion":1}')$$,
  '23505', 'only one open draft per flow');

update public.flow_versions set effective_to = '2026-08-15' where id = '00000000-0000-4000-8000-0000000001f1';
update public.flow_versions set status = 'retired' where id = '00000000-0000-4000-8000-0000000001f1';
select pg_temp.expect_error(
  $$update public.flow_versions set effective_to = '2026-08-20' where id = '00000000-0000-4000-8000-0000000001f1'$$,
  'HF001', 'retired versions are immutable');
update public.flow_versions set definition = '{"schemaVersion":1,"nodes":[1]}'
 where id = '00000000-0000-4000-8000-0000000003f1';
-- Close v2 first (effective_to of a published version may change), then publish the draft.
update public.flow_versions set effective_to = '2027-01-01'
 where id = '00000000-0000-4000-8000-0000000002f1';
update public.flow_versions set status = 'published', effective_from = '2027-01-01'
 where id = '00000000-0000-4000-8000-0000000003f1';
select pg_temp.expect_error(
  $$select 1/0$$,
  '22012', 'expect_error helper sanity check');
select pg_temp.expect(
  (select published_by = '00000000-0000-4000-8000-00000000000a' and published_at is not null
     from public.flow_versions where id = '00000000-0000-4000-8000-0000000003f1'),
  'publishing a draft stamps published_by/at');

-- Atomic import: new flow, then a second version closing the first.
select pg_temp.expect(
  (select version_no from public.admin_publish_flow_version(
     'rls-import', 'Flow nhập', 'mô tả', 'Nhóm', '', '{"schemaVersion":1,"nodes":[]}',
     '2026-01-01', null, 'v1', false)) = 1,
  'admin_publish_flow_version creates v1');
select pg_temp.expect(
  (select version_no from public.admin_publish_flow_version(
     'rls-import', 'Flow nhập', 'mô tả', 'Nhóm', '', '{"schemaVersion":1,"nodes":[]}',
     '2026-06-01', null, 'v2', true)) = 2,
  'admin_publish_flow_version creates v2');
select pg_temp.expect(
  (select effective_to from public.flow_versions v join public.flows f on f.id = v.flow_id
    where f.code = 'rls-import' and v.version_no = 1) = '2026-06-01',
  'second import closes the open version at the new effective_from');
select pg_temp.expect_error(
  $$select public.admin_publish_flow_version('rls-import', 'x', '', '', '', '{"schemaVersion":1}', '2026-03-01', null, 'chồng', false)$$,
  '23P01', 'import overlapping an existing published range is rejected');
select pg_temp.expect_error(
  $$select public.admin_publish_flow_version('rls-import-2', 'x', '', '', '', '{"schemaVersion":1}', '2026-03-01', null, '', false)$$,
  '22023', 'import requires a change note');
select pg_temp.expect_error(
  $$select public.admin_publish_flow_version('rls-import-2', 'x', '', '', '', '{"schemaVersion":1}', '2026-03-01', null, E' \t ', false)$$,
  '22023', 'import rejects a whitespace-only change note');
select pg_temp.expect(
  not exists (select 1 from public.flows where code = 'rls-import-2'),
  'a rejected import writes nothing');

-- Designer / Version screen RPCs (spec §14.5, AC-B3-61..70).
select pg_temp.expect(
  (select version_no = 1 and updated_at is not null from public.admin_create_flow(
     'rls-designer', 'Flow Designer', 'mô tả', 'Nhóm', 'hướng dẫn', '{"schemaVersion":1,"nodes":[]}')),
  'admin_create_flow creates the flow with draft v1');
select pg_temp.expect(
  (select status = 'draft' and effective_from is null
     from public.flow_versions v join public.flows f on f.id = v.flow_id
    where f.code = 'rls-designer'),
  'the new flow has exactly one draft');
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('rls-designer', 'x', '', '', '', '{"schemaVersion":1}')$$,
  '23505', 'admin_create_flow rejects a taken code');
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('rls-designer-2', 'x', '', '', '', '{"nodes":[]}')$$,
  '22023', 'admin_create_flow rejects a definition without schemaVersion');
select pg_temp.expect(
  not exists (select 1 from public.flows where code = 'rls-designer-2'),
  'a rejected admin_create_flow writes nothing');

do $$
declare
  v_flow uuid := (select id from public.flows where code = 'rls-designer');
  v_draft uuid := (select id from public.flow_versions where flow_id = v_flow);
  v_seen timestamptz := (select updated_at from public.flow_versions where id = v_draft);
  v_saved timestamptz;
  v_v2 uuid;
  v_v3 uuid;
begin
  -- Save with the updated_at that was read.
  v_saved := public.admin_save_flow_draft(
    v_draft, '{"schemaVersion":1,"nodes":[{"id":"a"}]}', v_seen);
  perform pg_temp.expect(
    v_saved is not null
    and (select definition -> 'nodes' -> 0 ->> 'id' from public.flow_versions where id = v_draft) = 'a',
    'admin_save_flow_draft saves with the expected updated_at');
  -- A stale updated_at (another tab saved in between) is refused and changes nothing.
  perform pg_temp.expect_error(format(
    $f$select public.admin_save_flow_draft(%L, '{"schemaVersion":1,"nodes":[]}', '2000-01-01')$f$,
    v_draft), 'HF002', 'admin_save_flow_draft refuses a stale updated_at (draft_conflict)');
  perform pg_temp.expect(
    (select definition -> 'nodes' -> 0 ->> 'id' from public.flow_versions where id = v_draft) = 'a',
    'a refused save leaves the draft unchanged');
  perform pg_temp.expect_error(format(
    $f$select public.admin_save_flow_draft(%L, '{"schemaVersion":1}', now())$f$,
    '00000000-0000-4000-8000-0000000002f1'), 'HF001', 'admin_save_flow_draft refuses a published version');
  perform pg_temp.expect_error(
    $f$select public.admin_save_flow_draft('00000000-0000-4000-8000-00000000dead', '{"schemaVersion":1}', now())$f$,
    'P0002', 'admin_save_flow_draft: unknown version');

  -- Publish checks: note required (also whitespace only), date required, stale updated_at.
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-01-01', null, '', false, %L)$f$,
    v_draft, v_saved), '22023', 'admin_publish_flow_draft requires a change note');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-01-01', null, '   ', false, %L)$f$,
    v_draft, v_saved), '22023', 'admin_publish_flow_draft rejects a whitespace-only note');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, null, null, 'x', false, %L)$f$,
    v_draft, v_saved), '22023', 'admin_publish_flow_draft requires effective_from');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-01-01', null, 'x', false, '2000-01-01')$f$,
    v_draft), 'HF002', 'admin_publish_flow_draft refuses a stale updated_at');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-01-01', '2026-01-01', 'x', false, %L)$f$,
    v_draft, v_saved), '23514', 'admin_publish_flow_draft: effective_to must be after effective_from');

  -- v1: published from 2026-01-01, open-ended.
  perform pg_temp.expect(
    (select version_no from public.admin_publish_flow_draft(
       v_draft, '2026-01-01', null, '  Bản đầu  ', false, v_saved)) = 1,
    'admin_publish_flow_draft publishes v1');
  perform pg_temp.expect(
    (select status = 'published' and change_note = 'Bản đầu' and published_at is not null
       and published_by = '00000000-0000-4000-8000-00000000000a'
       from public.flow_versions where id = v_draft),
    'publish stores the trimmed note and stamps published_by/at');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-02-01', null, 'x', false, now())$f$,
    v_draft), 'HF001', 'a published version cannot be published again');

  -- v2 draft cloned from v1 (AC-B3-67): same definition.
  select version_id into v_v2 from public.admin_create_draft_from_version(v_draft);
  perform pg_temp.expect(
    (select status = 'draft' and version_no = 2
       and definition = (select definition from public.flow_versions where id = v_draft)
       from public.flow_versions where id = v_v2),
    'admin_create_draft_from_version copies the definition into draft v2');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_create_draft_from_version(%L)$f$, v_draft),
    '23505', 'a second draft is refused (AC-B3-68)');
  perform pg_temp.expect_error(
    $f$select * from public.admin_create_draft_from_version('00000000-0000-4000-8000-00000000dead')$f$,
    'P0002', 'admin_create_draft_from_version: unknown version');

  -- Without closing v1, v2 from 2026-10-01 overlaps: refused, nothing written (AC-B3-64).
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-10-01', null, 'v2', false, %L)$f$,
    v_v2, (select updated_at from public.flow_versions where id = v_v2)),
    '23P01', 'publishing over an open version without closing it is refused');
  perform pg_temp.expect(
    (select effective_to is null from public.flow_versions where id = v_draft)
    and (select status = 'draft' from public.flow_versions where id = v_v2),
    'a refused publish changes neither version');

  -- With close_previous: v1 ends at 2026-10-01 and v2 starts there, atomically (AC-B3-63).
  perform public.admin_publish_flow_draft(
    v_v2, '2026-10-01', null, 'v2', true,
    (select updated_at from public.flow_versions where id = v_v2));
  perform pg_temp.expect(
    (select effective_from = '2026-01-01' and effective_to = '2026-10-01'
       from public.flow_versions where id = v_draft)
    and (select status = 'published' and effective_from = '2026-10-01'
           from public.flow_versions where id = v_v2),
    'publish with close_previous closes v1 at the new effective_from');
  perform pg_temp.expect(
    (select version_no from public.resolve_flow_version('rls-designer', '2026-09-15')) = 1
    and (select version_no from public.resolve_flow_version('rls-designer', '2026-10-01')) = 2,
    'period 09/2026 resolves to v1, 10/2026 to v2');

  -- Rollback: draft v3 from v1, published later; v1 unchanged.
  select version_id into v_v3 from public.admin_create_draft_from_version(v_draft);
  update public.flow_versions set effective_to = '2027-01-01' where id = v_v2;
  perform public.admin_publish_flow_draft(
    v_v3, '2027-01-01', null, 'rollback v1', false,
    (select updated_at from public.flow_versions where id = v_v3));
  perform pg_temp.expect(
    (select definition from public.flow_versions where id = v_v3)
      = (select definition from public.flow_versions where id = v_draft)
    and (select effective_to = '2026-10-01' and change_note = 'Bản đầu'
           from public.flow_versions where id = v_draft),
    'rollback publishes v1 content as v3 and leaves v1 as it was');

  -- Retire: no longer resolved for its period (AC-B3-66).
  update public.flow_versions set status = 'retired' where id = v_v2;
  perform pg_temp.expect(
    (select not applies from public.resolve_flow_version('rls-designer', '2026-11-15')),
    'a retired version is not chosen for its period');
  perform pg_temp.expect_error(format(
    $f$update public.flow_versions set status = 'published' where id = %L$f$, v_v2),
    'HF001', 'a retired version cannot be published again');
  perform pg_temp.expect_error(format(
    $f$delete from public.flow_versions where id = %L$f$, v_v3),
    'HF001', 'a published version cannot be deleted (AC-B3-69)');

  -- Every version action is audited (AC-B3-70).
  perform pg_temp.expect(
    (select count(*) from public.audit_logs
      where entity = 'flow_versions'
        and entity_id in (v_draft::text, v_v2::text, v_v3::text)) >= 7,
    'version actions are recorded in audit_logs');
end
$$;

select pg_temp.expect(
  (select count(*) from public.audit_logs where entity = 'flows') > 0
  and not exists (select 1 from public.audit_logs where diff::text like '%"nodes"%'),
  'admin reads the audit log; definitions are not copied into it');

select pg_temp.expect_error(
  $$select public.admin_revoke_user_sessions('00000000-0000-4000-8000-000000000002')$$,
  '42501', 'admin_revoke_user_sessions is service-role only');

reset role;

-- ---------------------------------------------------------------------------------------------
-- Password change clears must_change_password (trigger on auth.users)
-- ---------------------------------------------------------------------------------------------

update auth.users set encrypted_password = 'changed'
 where id = '00000000-0000-4000-8000-000000000001';
select pg_temp.expect(
  (select not must_change_password and password_changed_at is not null
     from public.profiles where id = '00000000-0000-4000-8000-000000000001'),
  'a password change clears must_change_password');

-- ---------------------------------------------------------------------------------------------
-- Default privileges: objects created later get no API access until granted explicitly
-- ---------------------------------------------------------------------------------------------

create table public.rls_future_table (id bigint generated always as identity primary key);
create sequence public.rls_future_seq;
create function public.rls_future_fn() returns integer language sql as $$ select 1 $$;
select pg_temp.expect(
  not has_table_privilege('authenticated', 'public.rls_future_table', 'SELECT')
  and not has_table_privilege('anon', 'public.rls_future_table', 'SELECT')
  and not has_table_privilege('authenticated', 'public.rls_future_table', 'INSERT'),
  'a new table gets no anon/authenticated privileges by default');
select pg_temp.expect(
  not has_sequence_privilege('authenticated', 'public.rls_future_seq', 'USAGE')
  and not has_sequence_privilege('anon', 'public.rls_future_seq', 'USAGE'),
  'a new sequence gets no anon/authenticated privileges by default');
select pg_temp.expect(
  not exists (
    select 1
    from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.rls_future_fn()'::regprocedure
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ),
  'a new function gets no direct anon/authenticated grant by default');

select 'RLS OK' as rls_result;

rollback;
