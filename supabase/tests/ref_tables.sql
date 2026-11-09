-- RLS / privilege / lifecycle tests of public.ref_tables + public.ref_table_versions (spec §34
-- AC-RT-01, 02, 05, 06, 09 round 1).
--
-- Runs as one transaction and ROLLS BACK. Run as `postgres` after the migrations (Supabase SQL
-- editor or psql; on a plain PostgreSQL load tests/support/supabase_stub.sql first):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ref_tables.sql
--
-- Success: the last result row is 'REF TABLES OK'. A failed assertion raises "REF TABLES FAIL: …".
-- Like the migration, this file holds no destructive keyword (HANDOFF §3); the removal privilege
-- is checked by building its name at run time. Fake data only (branch list).

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('00000000-0000-4000-8000-0000000000c1'::uuid, 'rt.admin@users.hrflow.local'),
  ('00000000-0000-4000-8000-0000000000c2'::uuid, 'rt.nv01@users.hrflow.local'),
  ('00000000-0000-4000-8000-0000000000c3'::uuid, 'rt.admin2@users.hrflow.local')
) as u(id, email);

insert into public.profiles (id, username, full_name, role, is_active, must_change_password) values
  ('00000000-0000-4000-8000-0000000000c1', 'rt.admin', 'Quản trị Giả', 'admin', true, false),
  ('00000000-0000-4000-8000-0000000000c2', 'rt.nv01', 'Nhân viên Giả', 'user', true, false),
  ('00000000-0000-4000-8000-0000000000c3', 'rt.admin2', 'Quản trị Khóa', 'admin', false, false);

-- A flow whose draft uses the table (round 2 node type), assigned to the User.
insert into public.flows (id, code, name) values
  ('00000000-0000-4000-8000-0000000000f9', 'rt-flow', 'Flow dùng bảng tham chiếu');
insert into public.flow_versions (flow_id, status, definition) values
  ('00000000-0000-4000-8000-0000000000f9', 'draft',
   '{"schemaVersion":1,"nodes":[{"id":"ref_cn","type":"input.refTable","config":{"refTable":"DM_CHI_NHANH"}}],"edges":[],"params":[{"key":"cn","options":{"fromRefTable":"HE_SO"}}]}');
insert into public.flow_assignments (flow_id, user_id) values
  ('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000000c2');

create function pg_temp.expect_error(p_sql text, p_state text, p_label text, p_message text default null)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state and (p_message is null or sqlerrm = p_message) then
      return;
    end if;
    raise exception 'REF TABLES FAIL: % — expected SQLSTATE % %, got % (%)',
      p_label, p_state, coalesce(p_message, ''), sqlstate, sqlerrm;
  end;
  raise exception 'REF TABLES FAIL: % — statement succeeded but should fail with %', p_label, p_state;
end;
$$;

create function pg_temp.expect(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'REF TABLES FAIL: %', p_label;
  end if;
end;
$$;

grant execute on function pg_temp.expect_error(text, text, text, text) to anon, authenticated;
grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;

-- Fixed ids through the test (session variables, readable after `set role`).
create temp table ids (name text primary key, id uuid, at timestamptz);
grant select, insert, update on ids to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Schema: RLS on, anon has no privilege, nobody may remove rows, select/insert/update policies only
-- ---------------------------------------------------------------------------------------------

select pg_temp.expect(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.ref_tables'::regclass, 'public.ref_table_versions'::regclass)),
  'RLS is enabled on both tables');
select pg_temp.expect(
  not exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('ref_tables', 'ref_table_versions')
                and grantee in ('anon', 'PUBLIC')),
  'anon / PUBLIC hold no privilege');
select pg_temp.expect(
  not exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('ref_tables', 'ref_table_versions')
                and grantee = 'authenticated'
                and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')),
  'authenticated may only select / insert / update (no removal, no truncate)');
select pg_temp.expect(
  not has_table_privilege('authenticated', 'public.ref_table_versions', 'DEL' || 'ETE')
  and not has_table_privilege('authenticated', 'public.ref_tables', 'DEL' || 'ETE'),
  'no removal privilege');
select pg_temp.expect(
  not exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('ref_tables', 'ref_table_versions')
              and cmd not in ('SELECT', 'INSERT', 'UPDATE')),
  'only select / insert / update policies');
select pg_temp.expect(
  not has_function_privilege('anon', 'public.admin_save_ref_table(uuid, text, text, text, jsonb, timestamptz, text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_replace_ref_table_draft(uuid, jsonb, timestamptz, text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_publish_ref_table_draft(uuid, date, date, text, boolean, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_ref_table_usage()', 'EXECUTE'),
  'anon cannot call the RPCs');

-- ---------------------------------------------------------------------------------------------
-- Admin: create a table (+ draft v1), save columns, conflicts
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

insert into ids (name, id, at)
select 'cn', r.ref_table_id, r.updated_at
from public.admin_save_ref_table(
  null, 'DM_CHI_NHANH', 'Danh mục chi nhánh', '',
  '[{"key":"ma_cn","title":"Mã chi nhánh","type":"string","aliases":["Mã CN"],"isKey":true},
    {"key":"ten_cn","title":"Tên chi nhánh","type":"string","aliases":[],"isKey":false},
    {"key":"vung","title":"Vùng","type":"integer","aliases":[],"isKey":false},
    {"key":"he_so","title":"Hệ số","type":"decimal","aliases":[],"isKey":false},
    {"key":"tu_ngay","title":"Từ ngày","type":"date","aliases":[],"isKey":false},
    {"key":"hoat_dong","title":"Hoạt động","type":"boolean","aliases":[],"isKey":false}]',
  null, array['ten_cn']) as r;

select pg_temp.expect(
  (select count(*) from public.ref_table_versions v
    where v.ref_table_id = (select id from ids where name = 'cn')
      and v.status = 'draft' and v.version_no = 1 and v.row_count = 0) = 1,
  'a new table starts with an empty draft v1');
select pg_temp.expect(
  (select created_by from public.ref_tables where code = 'DM_CHI_NHANH')
    = '00000000-0000-4000-8000-0000000000c1',
  'created_by is the caller');

select pg_temp.expect_error(
  $q$select * from public.admin_save_ref_table(null, 'DM_CHI_NHANH', 'X', '',
     '[{"key":"a","title":"A","type":"string","aliases":[],"isKey":true}]', null, null)$q$,
  '23505', 'a taken code is refused');
select pg_temp.expect_error(
  $q$select * from public.admin_save_ref_table(null, 'dm_lower', 'X', '',
     '[{"key":"a","title":"A","type":"string","aliases":[],"isKey":true}]', null, null)$q$,
  '23514', 'a code in lower case is refused');
select pg_temp.expect_error(
  $q$select * from public.admin_save_ref_table(null, 'NO_KEY', 'X', '',
     '[{"key":"a","title":"A","type":"string","aliases":[],"isKey":false}]', null, null)$q$,
  '22023', 'columns without a key column are refused', 'invalid_columns');
select pg_temp.expect_error(
  $q$select * from public.admin_save_ref_table(null, 'DUP_COL', 'X', '',
     '[{"key":"a","title":"A","type":"string","aliases":[],"isKey":true},
       {"key":"a","title":"B","type":"string","aliases":[],"isKey":false}]', null, null)$q$,
  '22023', 'duplicate column keys are refused', 'invalid_columns');
select pg_temp.expect_error(
  $q$select * from public.admin_save_ref_table(null, 'BAD_TYPE', 'X', '',
     '[{"key":"a","title":"A","type":"datetime","aliases":[],"isKey":true}]', null, null)$q$,
  '22023', 'an unknown column type is refused', 'invalid_columns');
select pg_temp.expect_error(
  $q$select * from public.admin_save_ref_table(null, 'EXTRA_PROP', 'X', '',
     '[{"key":"a","title":"A","type":"string","aliases":[],"isKey":true,"x":1}]', null, null)$q$,
  '22023', 'an unknown column property is refused', 'invalid_columns');
select pg_temp.expect_error(
  $q$update public.ref_tables set columns = '[]' where code = 'DM_CHI_NHANH'$q$,
  '23514', 'a direct write of invalid columns hits the CHECK');

-- Columns update: stale token → conflict; fresh token → saved.
select pg_temp.expect_error(
  format($q$select * from public.admin_save_ref_table(%L, 'DM_CHI_NHANH', 'Danh mục', '',
     (select columns from public.ref_tables where code = 'DM_CHI_NHANH'), %L, null)$q$,
     (select id from ids where name = 'cn'), '2000-01-01T00:00:00Z'),
  'HF002', 'saving the columns with a stale updated_at is a conflict');
select pg_temp.expect_error(
  format($q$select * from public.admin_save_ref_table(%L, 'DM_CHI_NHANH', 'Danh mục', '',
     (select columns from public.ref_tables where code = 'DM_CHI_NHANH'), null, null)$q$,
     (select id from ids where name = 'cn')),
  '22023', 'updating needs the expected updated_at', 'expected_updated_at_required');
update ids set at = s.updated_at
from public.admin_save_ref_table(
  (select id from ids where name = 'cn'), 'IGNORED_CODE', 'Danh mục chi nhánh (đổi tên)', 'Mô tả',
  (select columns from public.ref_tables where code = 'DM_CHI_NHANH'),
  (select at from ids where name = 'cn'), null) as s
where ids.name = 'cn';
select pg_temp.expect(
  (select name from public.ref_tables where code = 'DM_CHI_NHANH') = 'Danh mục chi nhánh (đổi tên)',
  'the name is updated and the code never changes');

-- ---------------------------------------------------------------------------------------------
-- Draft rows (import / grid save): types, keys, limits, conflict
-- ---------------------------------------------------------------------------------------------

insert into ids (name, id, at)
select 'v1', v.id, v.updated_at from public.ref_table_versions v
 where v.ref_table_id = (select id from ids where name = 'cn') and v.status = 'draft';

update ids set at = r.updated_at
from public.admin_replace_ref_table_draft(
  (select id from ids where name = 'cn'),
  '[{"ma_cn":"CN01","ten_cn":"Hồ Chí Minh","vung":1,"he_so":"1.25","tu_ngay":"2026-01-01","hoat_dong":true},
    {"ma_cn":"CN02","ten_cn":"Hà Nội","vung":1,"he_so":null},
    {"ma_cn":"CN03","vung":2}]',
  (select at from ids where name = 'v1'), array['ten_cn']) as r
where ids.name = 'v1';
select pg_temp.expect(
  (select row_count from public.ref_table_versions where id = (select id from ids where name = 'v1')) = 3,
  'the draft holds the 3 saved rows (row_count generated)');

select pg_temp.expect_error(
  format($q$select * from public.admin_replace_ref_table_draft(%L, '[]', %L, null)$q$,
         (select id from ids where name = 'cn'), '2000-01-01T00:00:00Z'),
  'HF002', 'a stale draft token is a conflict');
select pg_temp.expect_error(
  format($q$select * from public.admin_replace_ref_table_draft(%L, '[]', null, null)$q$,
         (select id from ids where name = 'cn')),
  'HF002', 'no token while a draft exists is a conflict');

create function pg_temp.bad_rows(p_rows text, p_message text, p_label text)
returns void
language plpgsql
as $$
begin
  perform pg_temp.expect_error(
    format('select * from public.admin_replace_ref_table_draft(%L, %L::jsonb, %L, null)',
           (select id from ids where name = 'cn'), p_rows, (select at from ids where name = 'v1')),
    '22023', p_label, p_message);
end;
$$;
grant execute on function pg_temp.bad_rows(text, text, text) to authenticated;

select pg_temp.bad_rows('{"a":1}', 'invalid_rows', 'rows must be an array');
select pg_temp.bad_rows('[1]', 'invalid_rows', 'each row must be an object');
select pg_temp.bad_rows('[{"ma_cn":"CN01","khac":"x"}]', 'invalid_rows', 'an unknown key is refused');
select pg_temp.bad_rows('[{"ma_cn":"CN01","vung":"1"}]', 'invalid_rows', 'an integer as text is refused');
select pg_temp.bad_rows('[{"ma_cn":"CN01","vung":1.5}]', 'invalid_rows', 'a fraction in an integer column is refused');
select pg_temp.bad_rows('[{"ma_cn":"CN01","he_so":1.5}]', 'invalid_rows', 'a decimal must be canonical text');
select pg_temp.bad_rows('[{"ma_cn":"CN01","he_so":"1,5"}]', 'invalid_rows', 'a decimal with a comma is refused');
select pg_temp.bad_rows('[{"ma_cn":"CN01","tu_ngay":"01/01/2026"}]', 'invalid_rows', 'a date must be yyyy-mm-dd');
select pg_temp.bad_rows('[{"ma_cn":"CN01","hoat_dong":"x"}]', 'invalid_rows', 'a boolean must be a JSON boolean');
select pg_temp.bad_rows('[{"ten_cn":"Không mã"}]', 'key_blank', 'a row without key is refused');
select pg_temp.bad_rows('[{"ma_cn":"   "}]', 'key_blank', 'a blank key is refused');
select pg_temp.bad_rows('[{"ma_cn":"CN01"},{"ma_cn":" cn01 "}]', 'duplicate_key',
  'keys compare without case and extra spaces');
select pg_temp.bad_rows(
  (select jsonb_agg(jsonb_build_object('ma_cn', 'CN' || g))::text from generate_series(1, 50001) g),
  'rows_too_many', 'more than 50,000 rows are refused');
select pg_temp.bad_rows(
  (select jsonb_agg(jsonb_build_object('ma_cn', 'CN' || g, 'ten_cn', repeat('x', 1100)))::text
     from generate_series(1, 5000) g),
  'rows_too_large', 'more than 5 MiB of rows is refused');
select pg_temp.expect_error(
  format($q$update public.ref_table_versions set rows = '[{"ma_cn":"CN01","khac":1}]' where id = %L$q$,
         (select id from ids where name = 'v1')),
  '22023', 'a direct write of rows is checked too', 'invalid_rows');

-- Exactly 50,000 rows are accepted (then put the 3 rows back).
select pg_temp.expect(
  (select r.version_no from public.admin_replace_ref_table_draft(
     (select id from ids where name = 'cn'),
     (select jsonb_agg(jsonb_build_object('ma_cn', 'CN' || g)) from generate_series(1, 50000) g),
     (select at from ids where name = 'v1'), null) as r) = 1,
  '50,000 rows are accepted');
update ids set at = (select updated_at from public.ref_table_versions where id = ids.id) where name = 'v1';
update ids set at = r.updated_at
from public.admin_replace_ref_table_draft(
  (select id from ids where name = 'cn'),
  '[{"ma_cn":"CN01","ten_cn":"Hồ Chí Minh","vung":1,"he_so":"1.25","tu_ngay":"2026-01-01","hoat_dong":true},
    {"ma_cn":"CN02","ten_cn":"Hà Nội","vung":1},
    {"ma_cn":"CN03","vung":2}]',
  (select at from ids where name = 'v1'), null) as r
where ids.name = 'v1';

-- ---------------------------------------------------------------------------------------------
-- Publish, immutability, rollback, overlap, discard, retire
-- ---------------------------------------------------------------------------------------------

select pg_temp.expect_error(
  format($q$select * from public.admin_publish_ref_table_draft(%L, '2026-01-01', null, '   ', false, %L)$q$,
         (select id from ids where name = 'v1'), (select at from ids where name = 'v1')),
  '22023', 'publishing needs a note', 'change_note_required');
select pg_temp.expect_error(
  format($q$select * from public.admin_publish_ref_table_draft(%L, null, null, 'x', false, %L)$q$,
         (select id from ids where name = 'v1'), (select at from ids where name = 'v1')),
  '22023', 'publishing needs a start date', 'effective_from_required');
select pg_temp.expect_error(
  format($q$select * from public.admin_publish_ref_table_draft(%L, '2026-01-01', null, 'x', false, %L)$q$,
         (select id from ids where name = 'v1'), '2000-01-01T00:00:00Z'),
  'HF002', 'publishing a draft saved meanwhile is a conflict');

select pg_temp.expect(
  (select version_no from public.admin_publish_ref_table_draft(
     (select id from ids where name = 'v1'), '2026-01-01', null, '  Khởi tạo  ', false,
     (select at from ids where name = 'v1'))) = 1,
  'v1 is published');
select pg_temp.expect(
  (select status = 'published' and change_note = 'Khởi tạo'
          and published_by = '00000000-0000-4000-8000-0000000000c1' and published_at is not null
     from public.ref_table_versions where id = (select id from ids where name = 'v1')),
  'publish stamps the author and keeps the trimmed note');

select pg_temp.expect_error(
  format($q$update public.ref_table_versions set rows = '[]' where id = %L$q$,
         (select id from ids where name = 'v1')),
  'HF001', 'published rows are immutable');
select pg_temp.expect_error(
  format($q$update public.ref_table_versions set change_note = 'x' where id = %L$q$,
         (select id from ids where name = 'v1')),
  'HF001', 'the note of a published version is immutable');
select pg_temp.expect_error(
  format($q$update public.ref_table_versions set status = 'draft' where id = %L$q$,
         (select id from ids where name = 'v1')),
  'HF001', 'a published version cannot become a draft again');
select pg_temp.expect_error(
  format($q$insert into public.ref_table_versions (ref_table_id, status, effective_from) values (%L, 'published', '2027-01-01')$q$,
         (select id from ids where name = 'cn')),
  'HF001', 'a version cannot be inserted as published');

-- Rollback / next version: draft from v1 (rows copied); a second draft is refused.
insert into ids (name, id, at)
select 'v2', r.version_id, r.updated_at
from public.admin_create_ref_draft_from_version((select id from ids where name = 'v1')) as r;
select pg_temp.expect(
  (select version_no = 2 and row_count = 3 from public.ref_table_versions
    where id = (select id from ids where name = 'v2')),
  'draft v2 copies the rows of v1');
select pg_temp.expect_error(
  format($q$select * from public.admin_create_ref_draft_from_version(%L)$q$,
         (select id from ids where name = 'v1')),
  '23505', 'only one draft per table');

-- Publish v2 from 01/07/2026 and close v1 there.
select public.admin_publish_ref_table_draft(
  (select id from ids where name = 'v2'), '2026-07-01', null, 'Đổi vùng', true,
  (select at from ids where name = 'v2'));
select pg_temp.expect(
  (select effective_to = '2026-07-01' from public.ref_table_versions
    where id = (select id from ids where name = 'v1')),
  'publishing v2 closed v1 on its start date');

-- v3 overlapping v2 without closing: refused, nothing changes.
insert into ids (name, id, at)
select 'v3', r.version_id, r.updated_at
from public.admin_create_ref_draft_from_version((select id from ids where name = 'v2')) as r;
select pg_temp.expect_error(
  format($q$select * from public.admin_publish_ref_table_draft(%L, '2026-09-01', null, 'x', false, %L)$q$,
         (select id from ids where name = 'v3'), (select at from ids where name = 'v3')),
  '23P01', 'overlapping validity is refused');
select pg_temp.expect(
  (select status = 'draft' from public.ref_table_versions where id = (select id from ids where name = 'v3')),
  'the refused publish left v3 a draft');

-- Columns change (column removed) → publishing a draft whose rows still use it is refused.
update ids set at = (select updated_at from public.ref_tables where id = ids.id) where name = 'cn';
select public.admin_save_ref_table(
  (select id from ids where name = 'cn'), 'DM_CHI_NHANH', 'Danh mục chi nhánh', '',
  '[{"key":"ma_cn","title":"Mã chi nhánh","type":"string","aliases":["Mã CN"],"isKey":true},
    {"key":"ten_cn","title":"Tên chi nhánh","type":"string","aliases":[],"isKey":false}]',
  (select at from ids where name = 'cn'), null);
select pg_temp.expect_error(
  format($q$select * from public.admin_publish_ref_table_draft(%L, '2027-01-01', null, 'x', true, %L)$q$,
         (select id from ids where name = 'v3'), (select at from ids where name = 'v3')),
  '22023', 'rows that no longer fit the columns cannot be published', 'invalid_rows');
select pg_temp.expect(
  (select effective_to is null from public.ref_table_versions where id = (select id from ids where name = 'v2')),
  'the refused publish did not close v2');

-- Discard v3: kept, immutable; the next draft is v4 (number not reused).
update public.ref_table_versions set status = 'discarded' where id = (select id from ids where name = 'v3');
select pg_temp.expect(
  (select status from public.ref_table_versions where id = (select id from ids where name = 'v3')) = 'discarded',
  'a discarded draft stays as a row');
select pg_temp.expect_error(
  format($q$update public.ref_table_versions set status = 'draft' where id = %L$q$,
         (select id from ids where name = 'v3')),
  'HF001', 'a discarded draft is immutable');
select pg_temp.expect_error(
  format($q$select * from public.admin_create_ref_draft_from_version(%L)$q$,
         (select id from ids where name = 'v3')),
  'P0002', 'a discarded draft cannot be copied');
select pg_temp.expect(
  (select r.version_no from public.admin_replace_ref_table_draft(
     (select id from ids where name = 'cn'), '[{"ma_cn":"CN09"}]', null, null) as r) = 4,
  'replacing rows without a draft creates v4 (discarded v3 not reused)');

-- Retire v1; retired is immutable; draft cannot be retired.
update public.ref_table_versions set status = 'retired' where id = (select id from ids where name = 'v1');
select pg_temp.expect_error(
  format($q$update public.ref_table_versions set effective_to = '2026-08-01' where id = %L$q$,
         (select id from ids where name = 'v1')),
  'HF001', 'a retired version is immutable');
select pg_temp.expect_error(
  $q$update public.ref_table_versions set status = 'retired' where status = 'draft'$q$,
  'HF001', 'a draft cannot be retired');
-- effective_to of a published version may change.
update public.ref_table_versions set effective_to = '2027-01-01' where id = (select id from ids where name = 'v2');
select pg_temp.expect(
  (select effective_to = '2027-01-01' from public.ref_table_versions where id = (select id from ids where name = 'v2')),
  'effective_to of a published version can be changed');

-- Usage of the table by flows (Admins).
select pg_temp.expect(
  (select array_agg(ref_table_code || ':' || flow_code || ':' || version_no order by ref_table_code)
     from public.admin_ref_table_usage()) = array['DM_CHI_NHANH:rt-flow:1', 'HE_SO:rt-flow:1'],
  'usage lists refTable nodes and fromRefTable params of draft/published flows');

reset role;

-- ---------------------------------------------------------------------------------------------
-- User, locked Admin, anon: nothing readable, nothing writable (round 1)
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect((select count(*) from public.ref_tables) = 0, 'a User reads no table');
select pg_temp.expect((select count(*) from public.ref_table_versions) = 0,
  'a User reads no version, not even published ones of a flow assigned to them (round 1)');
select pg_temp.expect((select count(*) from public.admin_ref_table_usage()) = 0,
  'a User gets no usage row');
select pg_temp.expect_error(
  $q$insert into public.ref_tables (code, name, columns) values ('X_USER', 'X',
     '[{"key":"a","title":"A","type":"string","aliases":[],"isKey":true}]')$q$,
  '42501', 'a User cannot insert a table');
select pg_temp.expect_error(
  $q$select * from public.admin_save_ref_table(null, 'X_USER', 'X', '',
     '[{"key":"a","title":"A","type":"string","aliases":[],"isKey":true}]', null, null)$q$,
  '42501', 'a User cannot call the RPCs');
select pg_temp.expect_error(
  format($q$select * from public.admin_replace_ref_table_draft(%L, '[]', null, null)$q$,
         (select id from ids where name = 'cn')),
  '42501', 'a User cannot replace draft rows');
update public.ref_table_versions set status = 'retired';
reset role;
select pg_temp.expect(
  (select status from public.ref_table_versions where id = (select id from ids where name = 'v2')) = 'published',
  'a User update changes nothing');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect((select count(*) from public.ref_tables) = 0, 'a locked Admin reads nothing');
select pg_temp.expect_error(
  $q$select * from public.admin_save_ref_table(null, 'X_LOCKED', 'X', '',
     '[{"key":"a","title":"A","type":"string","aliases":[],"isKey":true}]', null, null)$q$,
  '42501', 'a locked Admin cannot call the RPCs');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.expect_error($q$select * from public.ref_tables$q$, '42501', 'anon cannot read tables');
select pg_temp.expect_error($q$select * from public.ref_table_versions$q$, '42501', 'anon cannot read versions');
select pg_temp.expect_error($q$select * from public.admin_ref_table_usage()$q$, '42501', 'anon cannot call usage');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Audit: confirmations recorded without data; version entries never carry rows
-- ---------------------------------------------------------------------------------------------

select pg_temp.expect(
  (select count(*) from public.audit_logs
    where action = 'confirm_no_personal_data' and entity = 'ref_tables'
      and entity_id = (select id::text from ids where name = 'cn')
      and actor_id = '00000000-0000-4000-8000-0000000000c1'
      and diff -> 'columns' = '["ten_cn"]'::jsonb) = 2,
  'both confirmations (columns form + import) are audited with the column keys');
select pg_temp.expect(
  not exists (select 1 from public.audit_logs
               where entity = 'ref_table_versions'
                 and (diff::text like '%Hồ Chí Minh%' or diff ? 'rows' and diff -> 'rows' ? 'old')),
  'version audit entries carry no row content');
select pg_temp.expect(
  exists (select 1 from public.audit_logs where entity = 'ref_table_versions'
           and diff -> 'rows' ->> 'changed' = 'true'),
  'a rows change is audited as count + size');
select pg_temp.expect(
  exists (select 1 from public.audit_logs where entity = 'ref_tables' and action = 'update'),
  'column changes are audited');

select 'REF TABLES OK' as ref_tables_result;

rollback;
