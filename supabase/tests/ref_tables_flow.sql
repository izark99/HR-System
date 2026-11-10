-- Reference tables used by flows (spec §34 AC-RT-08, 09 round 2): `flow_versions.ref_tables`
-- computed from the definition and never set by a client, User read access through the flows
-- assigned to them, `run_logs.ref_versions` shape.
--
-- Runs as one transaction and ROLLS BACK. Run as `postgres` after the migrations (Supabase SQL
-- editor or psql; on a plain PostgreSQL load tests/support/supabase_stub.sql first):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ref_tables_flow.sql
--
-- Success: the last result row is 'REF TABLES FLOW OK'. A failed assertion raises
-- "REF TABLES FLOW FAIL: …". No destructive keyword (HANDOFF §3). Fake data only.

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('00000000-0000-4000-8000-0000000000d1'::uuid, 'rf.admin@users.hrflow.local'),
  ('00000000-0000-4000-8000-0000000000d2'::uuid, 'rf.nv01@users.hrflow.local'),
  ('00000000-0000-4000-8000-0000000000d3'::uuid, 'rf.nv02@users.hrflow.local'),
  ('00000000-0000-4000-8000-0000000000d4'::uuid, 'rf.nv03@users.hrflow.local'),
  ('00000000-0000-4000-8000-0000000000d5'::uuid, 'rf.nv04@users.hrflow.local')
) as u(id, email);

insert into public.profiles (id, username, full_name, role, is_active, must_change_password) values
  ('00000000-0000-4000-8000-0000000000d1', 'rf.admin', 'Quản trị Giả', 'admin', true, false),
  -- Assigned directly.
  ('00000000-0000-4000-8000-0000000000d2', 'rf.nv01', 'Nhân viên Giả 1', 'user', true, false),
  -- Not assigned.
  ('00000000-0000-4000-8000-0000000000d3', 'rf.nv02', 'Nhân viên Giả 2', 'user', true, false),
  -- Assigned through a group.
  ('00000000-0000-4000-8000-0000000000d4', 'rf.nv03', 'Nhân viên Giả 3', 'user', true, false),
  -- Assigned directly but locked.
  ('00000000-0000-4000-8000-0000000000d5', 'rf.nv04', 'Nhân viên Giả 4', 'user', false, false);

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
    raise exception 'REF TABLES FLOW FAIL: % — expected SQLSTATE %, got % (%)',
      p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'REF TABLES FLOW FAIL: % — statement succeeded but should fail with %',
    p_label, p_state;
end;
$$;

create function pg_temp.expect(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'REF TABLES FLOW FAIL: %', p_label;
  end if;
end;
$$;

grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated;
grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reference tables (fake): DM_CN (node), HE_SO (list param), KHAC (only in a draft / another flow)
-- ---------------------------------------------------------------------------------------------

insert into public.ref_tables (id, code, name, columns) values
  ('00000000-0000-4000-8000-0000000000e1', 'DM_CN', 'Danh mục chi nhánh',
   '[{"key":"ma_cn","title":"Mã chi nhánh","type":"string","aliases":[],"isKey":true},
     {"key":"ten_cn","title":"Tên chi nhánh","type":"string","aliases":[],"isKey":false}]'),
  ('00000000-0000-4000-8000-0000000000e2', 'HE_SO', 'Hệ số',
   '[{"key":"bac","title":"Bậc","type":"integer","aliases":[],"isKey":true},
     {"key":"he_so","title":"Hệ số","type":"decimal","aliases":[],"isKey":false}]'),
  ('00000000-0000-4000-8000-0000000000e3', 'KHAC', 'Bảng khác',
   '[{"key":"ma","title":"Mã","type":"string","aliases":[],"isKey":true}]');

-- v1 of each table, published from 2026-01-01; DM_CN also has an open draft v2.
insert into public.ref_table_versions (id, ref_table_id, version_no, rows) values
  ('00000000-0000-4000-8000-0000000001e1', '00000000-0000-4000-8000-0000000000e1', 1,
   '[{"ma_cn":"CN01","ten_cn":"Chi nhánh Một"},{"ma_cn":"CN02","ten_cn":"Chi nhánh Hai"}]'),
  ('00000000-0000-4000-8000-0000000001e2', '00000000-0000-4000-8000-0000000000e2', 1,
   '[{"bac":1,"he_so":"1.5"}]'),
  ('00000000-0000-4000-8000-0000000001e3', '00000000-0000-4000-8000-0000000000e3', 1,
   '[{"ma":"A"}]');
update public.ref_table_versions
   set status = 'published', effective_from = '2026-01-01', change_note = 'Khởi tạo';
insert into public.ref_table_versions (id, ref_table_id, version_no, rows) values
  ('00000000-0000-4000-8000-0000000002e1', '00000000-0000-4000-8000-0000000000e1', 2,
   '[{"ma_cn":"CN09","ten_cn":"Chi nhánh Nháp"}]');

-- ---------------------------------------------------------------------------------------------
-- Flows: F1 (assigned to nv01 + group of nv03 + locked nv04) published version uses DM_CN and
-- HE_SO, its draft uses KHAC; F2 (not assigned) published version uses KHAC; F3 archived.
-- ---------------------------------------------------------------------------------------------

insert into public.flows (id, code, name) values
  ('00000000-0000-4000-8000-0000000000f1', 'rf-flow-1', 'Flow dùng bảng tham chiếu'),
  ('00000000-0000-4000-8000-0000000000f2', 'rf-flow-2', 'Flow không được gán'),
  ('00000000-0000-4000-8000-0000000000f3', 'rf-flow-3', 'Flow đã lưu trữ');
insert into public.groups (id, name) values
  ('00000000-0000-4000-8000-0000000000b9', 'Nhóm giả');
insert into public.group_members (group_id, user_id) values
  ('00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000d4');
insert into public.flow_assignments (flow_id, user_id, group_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d2', null),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d5', null),
  ('00000000-0000-4000-8000-0000000000f1', null, '00000000-0000-4000-8000-0000000000b9'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000d2', null);

insert into public.flow_versions (id, flow_id, status, effective_from, change_note, definition)
values
  ('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000000f1', 'published',
   '2026-01-01', 'v1',
   '{"schemaVersion":1,
     "nodes":[{"id":"ref_cn","type":"input.refTable","config":{"refTable":"DM_CN"}},
              {"id":"ref_cn_2","type":"input.refTable","config":{"refTable":"DM_CN"}},
              {"id":"bad_1","type":"input.refTable","config":{"refTable":"lower_case"}},
              {"id":"bad_2","type":"input.refTable","config":"x"},
              {"id":"in_x","type":"input.excel","config":{"slot":"x","refTable":"KHAC"}}],
     "edges":[],
     "params":[{"key":"cn","label":"Bậc","type":"select",
                "options":{"fromRefTable":"HE_SO","valueColumn":"bac","labelColumn":"bac"}},
               {"key":"ky","label":"Kỳ","type":"month","options":[{"value":"KHAC","label":"x"}]}]}'),
  ('00000000-0000-4000-8000-0000000003f2', '00000000-0000-4000-8000-0000000000f2', 'published',
   '2026-01-01', 'v1',
   '{"schemaVersion":1,"nodes":[{"id":"r","type":"input.refTable","config":{"refTable":"KHAC"}}],
     "edges":[],"params":[]}'),
  ('00000000-0000-4000-8000-0000000003f3', '00000000-0000-4000-8000-0000000000f3', 'published',
   '2026-01-01', 'v1',
   '{"schemaVersion":1,"nodes":[{"id":"r","type":"input.refTable","config":{"refTable":"KHAC"}}],
     "edges":[],"params":[]}');
insert into public.flow_versions (id, flow_id, status, definition) values
  ('00000000-0000-4000-8000-0000000004f1', '00000000-0000-4000-8000-0000000000f1', 'draft',
   '{"schemaVersion":1,"nodes":[{"id":"r","type":"input.refTable","config":{"refTable":"KHAC"}}],
     "edges":[],"params":[]}');
update public.flows set is_archived = true where id = '00000000-0000-4000-8000-0000000000f3';

-- ---------------------------------------------------------------------------------------------
-- ref_tables: computed from the definition, distinct + sorted, ill-formed parts ignored
-- ---------------------------------------------------------------------------------------------

select pg_temp.expect(
  (select ref_tables from public.flow_versions where id = '00000000-0000-4000-8000-0000000003f1')
    = array['DM_CN', 'HE_SO'],
  'published F1 lists DM_CN (node, once) and HE_SO (list param); bad codes / other nodes ignored');
select pg_temp.expect(
  (select ref_tables from public.flow_versions where id = '00000000-0000-4000-8000-0000000004f1')
    = array['KHAC'],
  'the draft lists its own table');
select pg_temp.expect(private.flow_ref_tables('[]'::jsonb) = '{}'::text[]
  and private.flow_ref_tables('{"nodes":{"a":1},"params":"x"}'::jsonb) = '{}'::text[],
  'a malformed definition gives an empty list');
update public.flow_versions
   set definition = '{"schemaVersion":1,"nodes":[],"edges":[],"params":[]}'
 where id = '00000000-0000-4000-8000-0000000004f1';
select pg_temp.expect(
  (select ref_tables from public.flow_versions where id = '00000000-0000-4000-8000-0000000004f1')
    = '{}'::text[],
  'saving a draft recomputes the list');
update public.flow_versions
   set definition = '{"schemaVersion":1,"nodes":[{"id":"r","type":"input.refTable","config":{"refTable":"KHAC"}}],"edges":[],"params":[]}'
 where id = '00000000-0000-4000-8000-0000000004f1';

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect_error(
  $q$update public.flow_versions set ref_tables = array['KHAC']
      where id = '00000000-0000-4000-8000-0000000004f1'$q$,
  '428C9', 'an Admin cannot set ref_tables on update');
select pg_temp.expect_error(
  $q$insert into public.flow_versions (flow_id, status, definition, ref_tables)
     values ('00000000-0000-4000-8000-0000000000f2', 'draft', '{"schemaVersion":1}', array['DM_CN'])$q$,
  '428C9', 'an Admin cannot set ref_tables on insert');
select pg_temp.expect((select count(*) from public.ref_tables) = 3, 'an Admin reads every table');
select pg_temp.expect((select count(*) from public.ref_table_versions) = 4,
  'an Admin reads every version (drafts too)');
reset role;

-- ---------------------------------------------------------------------------------------------
-- nv01 (assigned): tables of the published F1 only, published versions only
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect(
  (select array_agg(code order by code) from public.ref_tables) = array['DM_CN', 'HE_SO'],
  'an assigned User reads the tables of the published version only (not KHAC of the draft / of an unassigned or archived flow)');
select pg_temp.expect(
  (select array_agg(id::text order by id) from public.ref_table_versions)
    = array['00000000-0000-4000-8000-0000000001e1', '00000000-0000-4000-8000-0000000001e2'],
  'an assigned User reads the published versions only (no draft, no KHAC)');
select pg_temp.expect(
  (select rows -> 0 ->> 'ma_cn' from public.ref_table_versions
    where id = '00000000-0000-4000-8000-0000000001e1') = 'CN01',
  'an assigned User reads the rows of a published version');
select pg_temp.expect(
  not exists (select 1 from public.ref_table_versions
               where id = '00000000-0000-4000-8000-0000000002e1'),
  'the draft of a used table stays hidden');
update public.ref_table_versions set status = 'retired';
select pg_temp.expect_error(
  $q$insert into public.ref_tables (code, name, columns) values ('X_USER', 'X',
     '[{"key":"a","title":"A","type":"string","aliases":[],"isKey":true}]')$q$,
  '42501', 'a User still cannot insert a table');

-- Run log: ref_versions holds table code -> version id, nothing else.
insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
values ('00000000-0000-4000-8000-0000000003f1', 'succeeded', 10,
        '{"DM_CN":"00000000-0000-4000-8000-0000000001e1","HE_SO":"00000000-0000-4000-8000-0000000001e2"}');
insert into public.run_logs (flow_version_id, status, duration_ms)
values ('00000000-0000-4000-8000-0000000003f1', 'succeeded', 10);
select pg_temp.expect(
  (select count(*) from public.run_logs where ref_versions = '{}'::jsonb) = 1,
  'ref_versions defaults to an empty object');
select pg_temp.expect_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-0000000003f1', 'succeeded', 1, '{"DM_CN":"CN01 Chi nhánh Một"}')$q$,
  '23514', 'ref_versions refuses a value that is not a version id');
select pg_temp.expect_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-0000000003f1', 'succeeded', 1,
             '{"DM_CN":{"rows":[{"ma_cn":"CN01"}]}}')$q$,
  '23514', 'ref_versions refuses rows / nested objects');
select pg_temp.expect_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-0000000003f1', 'succeeded', 1,
             '{"ten nhan vien":"00000000-0000-4000-8000-0000000001e1"}')$q$,
  '23514', 'ref_versions refuses keys that are not table codes');
select pg_temp.expect_error(
  $q$insert into public.run_logs (flow_version_id, status, duration_ms, ref_versions)
     values ('00000000-0000-4000-8000-0000000003f1', 'succeeded', 1, '["DM_CN"]')$q$,
  '23514', 'ref_versions must be an object');
reset role;
select pg_temp.expect(
  (select count(*) from public.ref_table_versions where status = 'retired') = 0,
  'a User update changes nothing');

-- nv02 (not assigned): nothing.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect((select count(*) from public.ref_tables) = 0,
  'a User without the flow reads no table');
select pg_temp.expect((select count(*) from public.ref_table_versions) = 0,
  'a User without the flow reads no version');
reset role;

-- nv03 (through a group): same as nv01.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect(
  (select array_agg(code order by code) from public.ref_tables) = array['DM_CN', 'HE_SO'],
  'a User assigned through a group reads the tables of the flow');
select pg_temp.expect((select count(*) from public.ref_table_versions) = 2,
  'a User assigned through a group reads the published versions');
reset role;

-- nv04 (assigned, locked): nothing.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d5","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect((select count(*) from public.ref_tables) = 0
  and (select count(*) from public.ref_table_versions) = 0, 'a locked User reads nothing');
reset role;

-- Retiring F1's version (or archiving the flow) takes the access away.
update public.flow_versions set status = 'retired'
 where id = '00000000-0000-4000-8000-0000000003f1';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect((select count(*) from public.ref_tables) = 0,
  'no published version using the table = no access');
reset role;

-- anon: no privilege at all.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.expect_error($q$select * from public.ref_tables$q$, '42501', 'anon cannot read tables');
select pg_temp.expect_error($q$select * from public.ref_table_versions$q$, '42501',
  'anon cannot read versions');
reset role;

select pg_temp.expect(
  not has_function_privilege('anon', 'private.can_read_ref_table(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.flow_ref_tables(jsonb)', 'EXECUTE'),
  'anon cannot call the helpers');

select 'REF TABLES FLOW OK' as ref_tables_flow_result;

rollback;
