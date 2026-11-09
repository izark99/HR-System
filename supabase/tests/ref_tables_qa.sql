-- Verifier checks of reference tables round 1 (spec §34 AC-RT-01, 05, 06, 09), independent of
-- supabase/tests/ref_tables.sql. Runs as one transaction and ROLLS BACK; run as `postgres` after
-- the migrations (plain PostgreSQL: load tests/support/supabase_stub.sql first):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ref_tables_qa.sql
--
-- Success: the last result row is 'REF TABLES QA OK'. Fake data only (rate table).

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('00000000-0000-4000-8000-0000000000e1'::uuid, 'qa.admin@users.hrflow.local'),
  ('00000000-0000-4000-8000-0000000000e2'::uuid, 'qa.user@users.hrflow.local')
) as u(id, email);
insert into public.profiles (id, username, full_name, role, is_active, must_change_password) values
  ('00000000-0000-4000-8000-0000000000e1', 'qa.admin', 'Quản trị QA', 'admin', true, false),
  ('00000000-0000-4000-8000-0000000000e2', 'qa.user', 'Người dùng QA', 'user', true, false);

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
    raise exception 'REF TABLES QA FAIL: % — expected SQLSTATE %, got % (%)',
      p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'REF TABLES QA FAIL: % — statement succeeded but should fail with %', p_label, p_state;
end;
$$;

create function pg_temp.expect(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'REF TABLES QA FAIL: %', p_label;
  end if;
end;
$$;
grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated;
grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;

create temp table ids (name text primary key, id uuid);
grant select, insert, update on ids to authenticated;

-- Privileges of the private helpers: anon executes none of them.
select pg_temp.expect(
  not has_function_privilege('anon', 'private.audit_ref_no_personal_data(uuid, text, text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'private.assert_ref_rows(jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_create_ref_draft_from_version(uuid)', 'EXECUTE'),
  'anon cannot execute the private helpers nor the rollback RPC');
select pg_temp.expect(
  not has_function_privilege('authenticated', 'private.ref_table_versions_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.audit_ref_version()', 'EXECUTE'),
  'trigger functions are not callable by clients');

-- ---------------------------------------------------------------------------------------------
-- Admin: a table with two published versions
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

insert into ids
select 'hs', r.ref_table_id from public.admin_save_ref_table(
  null, 'HE_SO_QA', 'Hệ số QA', '',
  '[{"key":"ma","title":"Mã","type":"string","aliases":[],"isKey":true},
    {"key":"hs","title":"Hệ số","type":"decimal","aliases":[],"isKey":false}]', null, null) as r;
insert into ids
select 'v1', v.id from public.ref_table_versions v
 where v.ref_table_id = (select id from ids where name = 'hs') and v.status = 'draft';

select public.admin_replace_ref_table_draft((select id from ids where name = 'hs'),
  '[{"ma":"A","hs":"1.5"}]',
  (select updated_at from public.ref_table_versions where id = (select id from ids where name = 'v1')), null);

-- An end before the start is refused by the CHECK, nothing published.
select pg_temp.expect_error(
  format($q$select * from public.admin_publish_ref_table_draft(%L, '2026-07-01', '2026-06-01', 'x', false, %L)$q$,
         (select id from ids where name = 'v1'),
         (select updated_at from public.ref_table_versions where id = (select id from ids where name = 'v1'))),
  '23514', 'effective_to before effective_from is refused');
select public.admin_publish_ref_table_draft((select id from ids where name = 'v1'),
  '2026-07-01', null, 'Khởi tạo', false,
  (select updated_at from public.ref_table_versions where id = (select id from ids where name = 'v1')));

-- A draft published BEFORE the open v1 with "close previous": v1 starts later, so it is not the
-- previous one and stays open; the new range [2026-01-01, ∞) overlaps v1 → refused, unchanged.
insert into ids
select 'v2', r.version_id from public.admin_create_ref_draft_from_version((select id from ids where name = 'v1')) as r;
select pg_temp.expect_error(
  format($q$select * from public.admin_publish_ref_table_draft(%L, '2026-01-01', null, 'x', true, %L)$q$,
         (select id from ids where name = 'v2'),
         (select updated_at from public.ref_table_versions where id = (select id from ids where name = 'v2'))),
  '23P01', 'publishing before an open later version still needs an end date');
select pg_temp.expect(
  (select effective_to is null from public.ref_table_versions where id = (select id from ids where name = 'v1')),
  'the later open version was not touched');
-- With an end date right at v1's start it fits.
select public.admin_publish_ref_table_draft((select id from ids where name = 'v2'),
  '2026-01-01', '2026-07-01', 'Bổ sung kỳ trước', true,
  (select updated_at from public.ref_table_versions where id = (select id from ids where name = 'v2')));
select pg_temp.expect(
  (select count(*) from public.ref_table_versions
    where ref_table_id = (select id from ids where name = 'hs') and status = 'published') = 2,
  'two adjacent published versions');

-- A published version cannot be moved to overlap its neighbour through effective_to.
select pg_temp.expect_error(
  format($q$update public.ref_table_versions set effective_to = '2026-08-01' where id = %L$q$,
         (select id from ids where name = 'v2')),
  '23P01', 'extending effective_to over the next version is refused');
-- The published rows cannot be swapped by a direct write either.
select pg_temp.expect_error(
  format($q$update public.ref_table_versions set rows = '[{"ma":"B"}]' where id = %L$q$,
         (select id from ids where name = 'v2')),
  'HF001', 'published rows stay immutable');
-- Moving a version to another table is refused.
select pg_temp.expect_error(
  format($q$update public.ref_table_versions set ref_table_id = gen_random_uuid() where id = %L$q$,
         (select id from ids where name = 'v2')),
  'HF001', 'a version cannot move to another table');

-- Retire v1, then a new version may take its range.
update public.ref_table_versions set status = 'retired' where id = (select id from ids where name = 'v1');
insert into ids
select 'v3', r.version_id from public.admin_create_ref_draft_from_version((select id from ids where name = 'v1')) as r;
select pg_temp.expect(
  (select version_no = 3 from public.ref_table_versions where id = (select id from ids where name = 'v3')),
  'a draft can be made from a retired version (rollback)');
select public.admin_publish_ref_table_draft((select id from ids where name = 'v3'),
  '2026-07-01', null, 'Phục hồi', false,
  (select updated_at from public.ref_table_versions where id = (select id from ids where name = 'v3')));

reset role;

-- ---------------------------------------------------------------------------------------------
-- User: the security-definer audit helper and the invoker RPCs refuse; nothing changes
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect_error(
  format($q$select private.audit_ref_no_personal_data(%L, 'import', array['x'])$q$,
         (select id from ids where name = 'hs')),
  '42501', 'a User cannot write a confirmation into audit_logs');
select pg_temp.expect_error(
  format($q$select * from public.admin_create_ref_draft_from_version(%L)$q$,
         (select id from ids where name = 'v2')),
  '42501', 'a User cannot start a draft');
select pg_temp.expect_error(
  format($q$select * from public.admin_publish_ref_table_draft(%L, '2027-01-01', null, 'x', false, now())$q$,
         (select id from ids where name = 'v2')),
  '42501', 'a User cannot publish');
select pg_temp.expect_error(
  format($q$insert into public.ref_table_versions (ref_table_id, rows) values (%L, '[]')$q$,
         (select id from ids where name = 'hs')),
  '42501', 'a User cannot insert a version');
update public.ref_tables set name = 'Bị đổi';
reset role;
select pg_temp.expect(
  (select name from public.ref_tables where code = 'HE_SO_QA') = 'Hệ số QA',
  'a User update of a table changes nothing');
select pg_temp.expect(
  not exists (select 1 from public.audit_logs
               where actor_id = '00000000-0000-4000-8000-0000000000e2'),
  'the User left no audit entry');
select pg_temp.expect(
  not exists (select 1 from public.audit_logs
               where entity = 'ref_table_versions' and diff::text like '%"1.5"%'),
  'no cell value in the version audit entries');

select 'REF TABLES QA OK' as ref_tables_qa_result;

rollback;
