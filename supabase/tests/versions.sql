-- Edge cases of the Designer / Version RPCs (spec §14, AC-B3-61..70, AC-B3-74).
-- Complements supabase/tests/rls.sql; same conventions: one transaction, rolled back, fake data.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/versions.sql
--
-- Success: last row is 'VERSIONS OK'. A failed assertion raises "VERSIONS FAIL: ...".

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('00000000-0000-4000-8000-00000000000a'::uuid, 'ver.admin@users.hrflow.local'),
  ('00000000-0000-4000-8000-00000000000b'::uuid, 'ver.locked@users.hrflow.local'),
  ('00000000-0000-4000-8000-000000000001'::uuid, 'ver.nv01@users.hrflow.local')
) as u(id, email);

insert into public.profiles (id, username, full_name, role, is_active, must_change_password) values
  ('00000000-0000-4000-8000-00000000000a', 'ver.admin', 'Quản trị Giả', 'admin', true, false),
  ('00000000-0000-4000-8000-00000000000b', 'ver.locked', 'Admin Bị Khóa', 'admin', false, false),
  ('00000000-0000-4000-8000-000000000001', 'ver.nv01', 'Nhân viên Giả 1', 'user', true, false);

create function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then return; end if;
    raise exception 'VERSIONS FAIL: % — expected SQLSTATE %, got % (%)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'VERSIONS FAIL: % — statement succeeded but should fail with %', p_label, p_state;
end;
$$;

create function pg_temp.expect(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'VERSIONS FAIL: %', p_label; end if;
end;
$$;

/** Documents a known bug: the statement currently SUCCEEDS (its effects are rolled back). When it
 *  starts failing with p_fixed_state the bug is fixed: turn the call into expect_error. */
create function pg_temp.known_bug(p_sql text, p_fixed_state text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'known bug still present' using errcode = 'HF999';
  exception
    when sqlstate 'HF999' then
      raise notice 'KNOWN BUG still present: %', p_label;
    when others then
      if sqlstate = p_fixed_state then
        raise exception 'VERSIONS FAIL: KNOWN BUG FIXED, convert to expect_error: %', p_label;
      end if;
      raise exception 'VERSIONS FAIL: % — unexpected SQLSTATE % (%)', p_label, sqlstate, sqlerrm;
  end;
end;
$$;
grant execute on function pg_temp.known_bug(text, text, text) to anon, authenticated;

/** Inside one transaction now() never advances, so updated_at would not change between two saves.
 *  Simulate time passing: move a row's updated_at 1 s into the future (trigger bypassed), as a
 *  separate transaction in production would. Runs as the postgres owner, then restores the role. */
create function pg_temp.bump(p_id uuid) returns void language plpgsql as $$
declare
  v_role text := current_user;
begin
  reset role;
  alter table public.flow_versions disable trigger set_updated_at;
  update public.flow_versions set updated_at = updated_at + interval '1 second' where id = p_id;
  alter table public.flow_versions enable trigger set_updated_at;
  execute format('set local role %I', v_role);
end;
$$;
grant execute on function pg_temp.bump(uuid) to authenticated;

/** Draft token (updated_at) of a version, as the client would read it. */
create function pg_temp.tok(p_id uuid) returns timestamptz language sql as
  $$ select updated_at from public.flow_versions where id = p_id $$;

grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated;
grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;
grant execute on function pg_temp.tok(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Non-admin callers: a normal user, a locked admin and anon are all refused.
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('ver-x', 'x', '', '', '', '{"schemaVersion":1}')$$,
  '42501', 'a locked (is_active = false) admin cannot create flows');
select pg_temp.expect_error(
  $$select * from public.admin_publish_flow_draft('00000000-0000-4000-8000-00000000dead', '2026-01-01', null, 'x', false, now())$$,
  '42501', 'a locked admin cannot publish drafts');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('ver-x', 'x', '', '', '', '{"schemaVersion":1}')$$,
  '42501', 'anon cannot execute admin_create_flow (permission denied)');
select pg_temp.expect_error(
  $$select public.admin_save_flow_draft('00000000-0000-4000-8000-00000000dead', '{"schemaVersion":1}', now())$$,
  '42501', 'anon cannot execute admin_save_flow_draft');
select pg_temp.expect_error(
  $$select * from public.admin_create_draft_from_version('00000000-0000-4000-8000-00000000dead')$$,
  '42501', 'anon cannot execute admin_create_draft_from_version');
select pg_temp.expect_error(
  $$select * from public.admin_publish_flow_draft('00000000-0000-4000-8000-00000000dead', '2026-01-01', null, 'x', false, now())$$,
  '42501', 'anon cannot execute admin_publish_flow_draft');
select pg_temp.expect_error(
  $$select * from public.admin_publish_flow_version('x', 'x', '', '', '', '{"schemaVersion":1}', '2026-01-01', null, 'x', false)$$,
  '42501', 'anon cannot execute admin_publish_flow_version');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

-- Hostile text is stored as a value, never executed; a hostile code is refused by flows_code_check.
select pg_temp.expect(
  (select version_no = 1 from public.admin_create_flow(
     'ver-inj', $q$n'); drop table public.flows; --$q$, $q$d'; delete from public.flows; --$q$,
     $q$c' or '1'='1$q$, $q$i'); truncate public.flows; --$q$, '{"schemaVersion":1,"nodes":[]}')),
  'admin_create_flow binds hostile text as a value');
select pg_temp.expect(
  exists (select 1 from public.flows where code = 'ver-inj'
          and name = $q$n'); drop table public.flows; --$q$),
  'the hostile name was stored literally and public.flows still exists');
select pg_temp.expect_error(
  $q$select * from public.admin_create_flow($$x'); drop table public.flows; --$$, 'x', '', '', '', '{"schemaVersion":1}')$q$,
  '23514', 'a code with SQL metacharacters is refused by the code check');

-- Definition validation.
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('ver-arr', 'x', '', '', '', '[1]')$$,
  '22023', 'definition must be an object');
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('ver-null', 'x', '', '', '', null)$$,
  '22023', 'definition must not be null');
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('ver-sv', 'x', '', '', '', '{"schemaVersion":"abc"}')$$,
  '22023', 'schemaVersion must be digits');
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('ver-sv2', 'x', '', '', '', '{"schemaVersion":1.5}')$$,
  '22023', 'schemaVersion must be an integer');
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('ver-sv3', 'x', '', '', '', '{"schemaVersion":-1}')$$,
  '22023', 'schemaVersion must not be negative');
select pg_temp.expect_error(
  $$select * from public.admin_create_flow('ver-sv4', 'x', '', '', '', '{"schemaVersion":99999999999}')$$,
  '22003', 'KNOWN BUG: an out-of-range schemaVersion should be 22023 invalid_definition (private.assert_flow_definition), it overflows integer (22003); switch to 22023 once fixed');

-- KNOWN BUG (reviewer MINOR): schemaVersion 0 passes assert_flow_definition and is only stopped
-- by the table CHECK (23514); the contract says 22023 invalid_definition. Switch once fixed.
select pg_temp.expect_error(
  $q$select * from public.admin_create_flow('ver-sv0', 'x', '', '', '', '{"schemaVersion":0}')$q$,
  '23514', 'KNOWN BUG: schemaVersion 0 should be 22023, currently the table CHECK 23514');

do $$
declare
  v_flow uuid;
  v1 uuid; v2 uuid; v3 uuid; v4 uuid;
  t timestamptz;
  t2 timestamptz;
begin
  select flow_id, version_id into v_flow, v1
    from public.admin_create_flow('ver-a', 'Flow A', '', '', '', '{"schemaVersion":1,"nodes":[]}');

  perform pg_temp.bump(v1);
  -- Change note: blank variants (spaces, tab, LF, CR, NBSP, em space, ideographic space).
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-01-01', null, %L, false, %L)$f$,
    v1, E' \t\r\n ', pg_temp.tok(v1)), '22023', 'tab/CR/LF-only note is blank');
  -- JS String.trim() (the client check) treats NBSP as blank; the DB regex `\s` does not.
  perform pg_temp.known_bug(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-01-01', null, %L, false, %L)$f$,
    v1, chr(160) || chr(160), pg_temp.tok(v1)), '22023', 'NBSP-only note is accepted by admin_publish_flow_draft');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-01-01', null, %L, false, %L)$f$,
    v1, chr(8195) || chr(12288), pg_temp.tok(v1)), '22023', 'em/ideographic-space-only note is blank');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-01-01', null, null, false, %L)$f$,
    v1, pg_temp.tok(v1)), '22023', 'null note is refused');
  -- Length: 1000 chars fine after trimming, 1001 refused.
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-01-01', null, %L, false, %L)$f$,
    v1, repeat('a', 1001), pg_temp.tok(v1)), '23514', 'a 1001-character note is refused');
  perform pg_temp.expect(
    (select status = 'draft' from public.flow_versions where id = v1),
    'refused publishes leave the draft a draft');

  -- Token precision: a token truncated to milliseconds (JS Date) is not the stored token.
  t := pg_temp.tok(v1);
  perform pg_temp.expect_error(format(
    $f$select public.admin_save_flow_draft(%L, '{"schemaVersion":1}', %L)$f$,
    v1, date_trunc('milliseconds', t) - interval '1 millisecond'),
    'HF002', 'a token that is off by 1 ms is a conflict');
  -- Saving twice with the same (old) token: the second one conflicts, the first wins.
  t2 := public.admin_save_flow_draft(v1, '{"schemaVersion":1,"nodes":[{"id":"n1"}]}', t);
  perform pg_temp.expect_error(format(
    $f$select public.admin_save_flow_draft(%L, '{"schemaVersion":1,"nodes":[{"id":"n2"}]}', %L)$f$,
    v1, t), 'HF002', 'second save with the old token conflicts');
  perform pg_temp.expect(
    (select definition -> 'nodes' -> 0 ->> 'id' from public.flow_versions where id = v1) = 'n1',
    'the conflicting save wrote nothing');
  perform pg_temp.expect_error(format(
    $f$select public.admin_save_flow_draft(%L, '{"schemaVersion":1}', null)$f$, v1),
    '22023', 'a null token is refused, not treated as "no check"');
  perform pg_temp.expect_error(format(
    $f$select public.admin_publish_flow_draft(%L, '2026-01-01', null, 'x', false, %L)$f$, v1, t),
    'HF002', 'publishing with a token from before the last save conflicts');
  -- schema_version column follows the saved definition.
  t2 := public.admin_save_flow_draft(v1, '{"schemaVersion":2,"nodes":[]}', t2);
  perform pg_temp.expect(
    (select schema_version = 2 from public.flow_versions where id = v1),
    'save updates schema_version');
  t2 := public.admin_save_flow_draft(v1, '{"schemaVersion":1,"nodes":[]}', t2);

  -- v1 published from 2026-01-01 to (excl.) 2026-03-01.
  perform public.admin_publish_flow_draft(v1, '2026-01-01', '2026-03-01', E'  Bản ' || chr(160) || E'đầu \n ', false, t2);
  perform pg_temp.expect(
    (select change_note = 'Bản ' || chr(160) || 'đầu' from public.flow_versions where id = v1),
    'the note is trimmed at both ends but inner whitespace is kept');

  -- Exclusive effective_to: v2 starting exactly on 2026-03-01 does not overlap v1.
  select version_id into v2 from public.admin_create_draft_from_version(v1);
  perform public.admin_publish_flow_draft(v2, '2026-03-01', '2026-04-01', 'v2', false, pg_temp.tok(v2));
  perform pg_temp.expect(
    (select version_no from public.resolve_flow_version('ver-a', '2026-02-28')) = 1
    and (select version_no from public.resolve_flow_version('ver-a', '2026-03-01')) = 2
    and (select version_no from public.resolve_flow_version('ver-a', '2026-03-31')) = 2
    and (select not applies from public.resolve_flow_version('ver-a', '2026-04-01'))
    and (select not applies from public.resolve_flow_version('ver-a', '2025-12-31')),
    'boundaries: from is inclusive, to is exclusive, outside the ranges nothing applies');

  -- One day of overlap is refused (from = to - 1 day of v2), nothing changes.
  select version_id into v3 from public.admin_create_draft_from_version(v1);
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-03-31', null, 'x', false, %L)$f$,
    v3, pg_temp.tok(v3)), '23P01', 'one day of overlap is refused');
  -- A gap is allowed: v3 from 2026-05-01 (2026-04-01..2026-04-30 uncovered).
  perform public.admin_publish_flow_draft(v3, '2026-05-01', null, 'v3 after a gap', false, pg_temp.tok(v3));
  perform pg_temp.expect(
    (select not applies from public.resolve_flow_version('ver-a', '2026-04-15')),
    'a gap is allowed and nothing resolves inside it');

  -- close_previous: only the open published version that starts BEFORE the new date.
  -- v3 is open from 05-01. A draft from 05-01 (same day) must not close it: overlap.
  select version_id into v4 from public.admin_create_draft_from_version(v1);
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-05-01', null, 'x', true, %L)$f$,
    v4, pg_temp.tok(v4)), '23P01', 'close_previous never closes a version starting the same day');
  perform pg_temp.expect(
    (select effective_to is null from public.flow_versions where id = v3),
    'v3 is untouched after the refused publish');
  -- A draft with effective_to <= effective_from fails the check AFTER the close step: the
  -- close must be rolled back too.
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-06-01', '2026-06-01', 'x', true, %L)$f$,
    v4, pg_temp.tok(v4)), '23514', 'empty range refused');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-06-01', '2026-05-15', 'x', true, %L)$f$,
    v4, pg_temp.tok(v4)), '23514', 'reversed range refused');
  perform pg_temp.expect(
    (select effective_to is null from public.flow_versions where id = v3)
    and (select status = 'draft' from public.flow_versions where id = v4),
    'a failed publish does not leave v3 closed (atomic)');
  -- A stale token with close_previous = true also changes nothing.
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-06-01', null, 'x', true, '2000-01-01')$f$,
    v4), 'HF002', 'stale token refused');
  perform pg_temp.expect(
    (select effective_to is null from public.flow_versions where id = v3),
    'a stale-token publish does not close v3');
  -- Null close_previous behaves as false (-> overlap), true closes at the new date.
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2026-06-01', null, 'x', null, %L)$f$,
    v4, pg_temp.tok(v4)), '23P01', 'null close_previous = false');
  perform public.admin_publish_flow_draft(v4, '2026-06-01', null, 'v4', true, pg_temp.tok(v4));
  perform pg_temp.expect(
    (select effective_to = '2026-06-01' from public.flow_versions where id = v3)
    and (select effective_to = '2026-04-01' from public.flow_versions where id = v2)
    and (select effective_to = '2026-03-01' from public.flow_versions where id = v1),
    'close_previous touches only the open version; closed ones keep their ends');

  -- Changing effective_to of a published version (direct UPDATE, as the UI does).
  perform pg_temp.expect_error(format(
    $f$update public.flow_versions set effective_to = '2026-06-02' where id = %L$f$, v3),
    '23P01', 'extending v3 over v4 is an overlap');
  perform pg_temp.expect_error(format(
    $f$update public.flow_versions set effective_to = '2026-05-01' where id = %L$f$, v3),
    '23514', 'effective_to equal to effective_from is refused');
  update public.flow_versions set effective_to = '2026-05-15' where id = v3;
  perform pg_temp.expect(
    (select effective_to = '2026-05-15' and status = 'published' and change_note = 'v3 after a gap'
       from public.flow_versions where id = v3),
    'only effective_to changed on v3');
  perform pg_temp.expect_error(format(
    $f$update public.flow_versions set change_note = 'edited' where id = %L$f$, v3),
    'HF001', 'the note of a published version is immutable');

  -- Retire v4, then its period is free for a new version (retired is outside the overlap check).
  update public.flow_versions set status = 'retired' where id = v4;
  select version_id into v4 from public.admin_create_draft_from_version(
    (select id from public.flow_versions where flow_id = v_flow and version_no = 4));
  perform pg_temp.expect(
    (select definition = (select definition from public.flow_versions where flow_id = v_flow and version_no = 4)
       from public.flow_versions where id = v4),
    'a draft can be cloned from a retired version');
  perform public.admin_publish_flow_draft(v4, '2026-06-01', null, 'reuse retired period', false, pg_temp.tok(v4));
  perform pg_temp.expect(
    (select version_no from public.resolve_flow_version('ver-a', '2026-07-01')) = 5,
    'a retired version does not block a new one over its range and is not resolved');

  -- Draft lifecycle: clone refused while a draft exists, even from the draft itself;
  -- cancelling the draft makes cloning possible again; only drafts can be deleted.
  select version_id into v4 from public.admin_create_draft_from_version(v1);
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_create_draft_from_version(%L)$f$, v4),
    '23505', 'cloning the open draft itself is a duplicate draft');
  delete from public.flow_versions where id = v4;
  perform pg_temp.expect(
    not exists (select 1 from public.flow_versions where id = v4),
    'a draft can be cancelled');
  perform pg_temp.expect_error(format(
    $f$select public.admin_save_flow_draft(%L, '{"schemaVersion":1}', now())$f$, v4),
    'P0002', 'saving a cancelled draft reports version_not_found');
  perform pg_temp.expect_error(format(
    $f$select * from public.admin_publish_flow_draft(%L, '2027-01-01', null, 'x', false, now())$f$, v4),
    'P0002', 'publishing a cancelled draft reports version_not_found');
  perform pg_temp.expect_error(format(
    $f$select public.admin_save_flow_draft(%L, '{"schemaVersion":1}', now())$f$, v1),
    'HF001', 'a retired/published version cannot be saved over');
end
$$;

-- Import path: same blank-note rules, nothing written on refusal.
select pg_temp.known_bug(
  format($f$select public.admin_publish_flow_version('ver-imp-nb', 'x', '', '', '', '{"schemaVersion":1}', '2026-01-01', null, %L, false)$f$, chr(160)),
  '22023', 'import accepts an NBSP-only change note');
select pg_temp.expect_error(
  $$select public.admin_publish_flow_version('ver-imp', 'x', '', '', '', '{"schemaVersion":1}', null, null, 'x', false)$$,
  '22023', 'import requires effective_from');
select pg_temp.expect(
  not exists (select 1 from public.flows where code = 'ver-imp'),
  'a refused import writes no flow');

-- Closing in one flow never touches another flow's open version.
select pg_temp.expect(
  (select version_no from public.admin_publish_flow_version('ver-b1', 'B1', '', '', '', '{"schemaVersion":1}', '2026-01-01', null, 'b1', false)) = 1,
  'flow B1 v1');
select pg_temp.expect(
  (select version_no from public.admin_publish_flow_version('ver-b2', 'B2', '', '', '', '{"schemaVersion":1}', '2026-03-01', null, 'b2', true)) = 1,
  'flow B2 v1 with close_previous = true');
select pg_temp.expect(
  (select effective_to is null from public.flow_versions v join public.flows f on f.id = v.flow_id where f.code = 'ver-b1'),
  'close_previous in B2 did not close B1');

-- Definitions are never copied into the audit log, and draft saves are audited without them.
select pg_temp.expect(
  not exists (select 1 from public.audit_logs where diff::text like '%"nodes"%'),
  'no definition content in audit_logs');

reset role;
select 'VERSIONS OK' as versions_result;
rollback;
