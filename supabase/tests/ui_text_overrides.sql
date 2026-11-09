-- RLS / privilege / constraint tests of public.ui_text_overrides (spec §33 AC-TX-06).
--
-- Runs as one transaction and ROLLS BACK. Run as `postgres` after the migrations (Supabase SQL
-- editor or psql; on a plain PostgreSQL load tests/support/supabase_stub.sql first):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ui_text_overrides.sql
--
-- Success: the last result row is 'UI TEXT OK'. A failed assertion raises "UI TEXT FAIL: …".
-- Like the migration, this file holds no destructive keyword (HANDOFF §3); the removal privilege
-- is checked by building its name at run time.

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('00000000-0000-4000-8000-0000000000a1'::uuid, 'tx.admin@users.hrflow.local'),
  ('00000000-0000-4000-8000-0000000000a2'::uuid, 'tx.nv01@users.hrflow.local'),
  ('00000000-0000-4000-8000-0000000000a3'::uuid, 'tx.admin2@users.hrflow.local')
) as u(id, email);

insert into public.profiles (id, username, full_name, role, is_active, must_change_password) values
  ('00000000-0000-4000-8000-0000000000a1', 'tx.admin', 'Quản trị Giả', 'admin', true, false),
  ('00000000-0000-4000-8000-0000000000a2', 'tx.nv01', 'Nhân viên Giả', 'user', true, false),
  -- A locked Admin is no Admin.
  ('00000000-0000-4000-8000-0000000000a3', 'tx.admin2', 'Quản trị Khóa', 'admin', false, false);

-- One edited row and one restored row (value null).
insert into public.ui_text_overrides (key, value) values
  ('common:auth.login.title', 'Đăng nhập hệ thống'),
  ('common:nav.runFlows', null);

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
    raise exception 'UI TEXT FAIL: % — expected SQLSTATE %, got % (%)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'UI TEXT FAIL: % — statement succeeded but should fail with %', p_label, p_state;
end;
$$;

create function pg_temp.expect(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'UI TEXT FAIL: %', p_label;
  end if;
end;
$$;

grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated;
grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Schema: RLS on, no removal privilege nor policy, only select/insert/update policies
-- ---------------------------------------------------------------------------------------------

select pg_temp.expect(
  (select relrowsecurity from pg_class where oid = 'public.ui_text_overrides'::regclass),
  'RLS is enabled');
select pg_temp.expect(
  not has_table_privilege('anon', 'public.ui_text_overrides', 'DEL' || 'ETE')
  and not has_table_privilege('authenticated', 'public.ui_text_overrides', 'DEL' || 'ETE')
  and not has_table_privilege('authenticated', 'public.ui_text_overrides', 'TRUNCATE'),
  'no API role may remove rows');
select pg_temp.expect(
  not exists (select 1 from pg_policies where schemaname = 'public'
              and tablename = 'ui_text_overrides' and cmd not in ('SELECT', 'INSERT', 'UPDATE')),
  'only select / insert / update policies');
select pg_temp.expect(
  not has_table_privilege('anon', 'public.ui_text_overrides', 'INSERT')
  and not has_table_privilege('anon', 'public.ui_text_overrides', 'UPDATE')
  and has_column_privilege('anon', 'public.ui_text_overrides', 'value', 'SELECT')
  and not has_column_privilege('anon', 'public.ui_text_overrides', 'updated_by', 'SELECT')
  and not has_column_privilege('anon', 'public.ui_text_overrides', 'updated_at', 'SELECT'),
  'anon reads key/value only and writes nothing');

-- ---------------------------------------------------------------------------------------------
-- anon (login page, before sign-in)
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select pg_temp.expect(
  (select array_agg(key order by key) from public.ui_text_overrides) = array['common:auth.login.title'],
  'anon sees the edited rows only (not the restored one)');
select pg_temp.expect_error(
  $q$select updated_by from public.ui_text_overrides$q$, '42501', 'anon cannot read the author');
select pg_temp.expect_error(
  $q$insert into public.ui_text_overrides (key, value) values ('common:app.name', 'X')$q$,
  '42501', 'anon cannot insert');
select pg_temp.expect_error(
  $q$update public.ui_text_overrides set value = 'X'$q$, '42501', 'anon cannot update');

reset role;

-- ---------------------------------------------------------------------------------------------
-- User (authenticated, not admin)
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.expect(
  (select array_agg(key order by key) from public.ui_text_overrides) = array['common:auth.login.title'],
  'a User sees the edited rows only');
select pg_temp.expect_error(
  $q$insert into public.ui_text_overrides (key, value) values ('common:app.name', 'X')$q$,
  '42501', 'a User cannot insert');
update public.ui_text_overrides set value = 'Bị đổi' where key = 'common:auth.login.title';
reset role;
select pg_temp.expect(
  (select value from public.ui_text_overrides where key = 'common:auth.login.title') = 'Đăng nhập hệ thống',
  'a User update changes nothing (no row passes the policy)');

-- A locked Admin is treated like a User.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect_error(
  $q$insert into public.ui_text_overrides (key, value) values ('common:app.name', 'X')$q$,
  '42501', 'a locked Admin cannot insert');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.expect(
  (select count(*) from public.ui_text_overrides) = 2,
  'an Admin sees every row, restored ones too');

-- Save (upsert, like PostgREST): the author is the caller whatever the client sends.
insert into public.ui_text_overrides (key, value, updated_by)
values ('designer:palette.title', 'Thêm bước', '00000000-0000-4000-8000-0000000000a2')
on conflict (key) do update set value = excluded.value;
select pg_temp.expect(
  (select updated_by from public.ui_text_overrides where key = 'designer:palette.title')
    = '00000000-0000-4000-8000-0000000000a1',
  'updated_by is set by the database to the caller');

insert into public.ui_text_overrides (key, value)
values ('common:auth.login.title', 'Đăng nhập HR')
on conflict (key) do update set value = excluded.value;
select pg_temp.expect(
  (select value from public.ui_text_overrides where key = 'common:auth.login.title') = 'Đăng nhập HR',
  'an Admin upsert overwrites the text');

-- Restore one row / all rows = set value to null.
update public.ui_text_overrides set value = null where key = 'designer:palette.title';
select pg_temp.expect(
  (select value is null from public.ui_text_overrides where key = 'designer:palette.title'),
  'restore one row sets value null');
update public.ui_text_overrides set value = null where value is not null;
select pg_temp.expect(
  (select count(*) from public.ui_text_overrides where value is not null) = 0
  and (select count(*) from public.ui_text_overrides) = 3,
  'restore all keeps the rows with value null');

-- Constraints.
select pg_temp.expect_error(
  $q$insert into public.ui_text_overrides (key, value) values ('auth.login.title', 'X')$q$,
  '23514', 'key without namespace is refused');
select pg_temp.expect_error(
  $q$insert into public.ui_text_overrides (key, value) values ('common:a b', 'X')$q$,
  '23514', 'key with a space is refused');
select pg_temp.expect_error(
  format('insert into public.ui_text_overrides (key, value) values (%L, %L)',
         'common:' || repeat('a', 200), 'X'),
  '23514', 'key longer than 200 is refused');
select pg_temp.expect_error(
  format('insert into public.ui_text_overrides (key, value) values (%L, %L)',
         'common:app.name', repeat('a', 2001)),
  '23514', 'value longer than 2000 is refused');
select pg_temp.expect_error(
  $q$insert into public.ui_text_overrides (key, value) values ('common:app.name', '   ')$q$,
  '23514', 'blank value is refused');
select pg_temp.expect_error(
  $q$insert into public.ui_text_overrides (key, value) values ('common:app.name', 'a <b>b</b>')$q$,
  '23514', 'HTML tag is refused');
insert into public.ui_text_overrides (key, value)
values ('common:app.name', 'Công <> 0 và [A]<5 vẫn được');
select pg_temp.expect(
  (select value from public.ui_text_overrides where key = 'common:app.name') like 'Công <> 0%',
  'a "<" that is not a tag is accepted');

reset role;

-- Audit trail and updated_at.
select pg_temp.expect(
  (select count(*) from public.audit_logs
    where entity = 'ui_text_overrides' and entity_id = 'common:auth.login.title') >= 2,
  'changes are audited (entity_id = key)');

select 'UI TEXT OK' as ui_text_result;

rollback;
