-- Bootstrap the FIRST Admin account (MEMORY 2026-10-26 13:37). Run ONCE, as `postgres`, after the
-- migrations. Refuses to run when an Admin already exists or the username is taken.
--
-- Parameters (psql variables):
--   admin_username   login name, e.g. admin  (3-32 chars: a-z 0-9 . _ -)
--   admin_password   temporary password, >= 10 chars; the account must change it at first login
--   admin_full_name  display name (may be empty)
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v admin_username=admin -v admin_password='<temp password>' -v admin_full_name='Admin' \
--     -f supabase/seed/create_first_admin.sql
--
-- Without psql (SQL editor / management API): replace the three :'…' placeholders below with
-- quoted literals, e.g. :'admin_username' -> 'admin'. Never commit the substituted file, and do
-- not keep the password in shell history (prefer `read -s` + an env var).
--
-- The password never lands in a table and the script runs no DDL with it (statements are not
-- written to the server log under log_statement = 'ddl'): psql cannot substitute variables inside
-- a dollar-quoted DO body, so the values travel as transaction-local settings set by one plain
-- SELECT, are read once by the DO block and cleared before commit. Change the temporary
-- password right after the first login (the app forces it anyway).
--
-- The login e-mail is synthetic: <username>@users.hrflow.local (spec §6), confirmed, no mail sent.

begin;

-- Prints only "t": set_config returns the value, which must not be echoed.
select
  set_config('hrflow.first_admin_username', lower(btrim(:'admin_username')), true) is not null
  and set_config('hrflow.first_admin_password', :'admin_password', true) is not null
  and set_config('hrflow.first_admin_full_name', btrim(:'admin_full_name'), true) is not null
  as inputs_set;

do $$
declare
  v_in record;
  v_id uuid := gen_random_uuid();
  v_email text;
begin
  select
    current_setting('hrflow.first_admin_username', true) as username,
    current_setting('hrflow.first_admin_password', true) as password,
    current_setting('hrflow.first_admin_full_name', true) as full_name
  into v_in;
  -- Do not leave the password readable in the session for the rest of the transaction.
  perform set_config('hrflow.first_admin_password', '', true);

  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'first admin already exists: refusing to create another one';
  end if;
  if coalesce(v_in.username, '') !~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$' then
    raise exception 'invalid username (3-32 chars: a-z 0-9 . _ -)';
  end if;
  if char_length(coalesce(v_in.password, '')) < 10 then
    raise exception 'password must have at least 10 characters';
  end if;

  v_email := v_in.username || '@users.hrflow.local';
  if exists (select 1 from auth.users where email = v_email)
     or exists (select 1 from public.profiles where username = v_in.username) then
    raise exception 'username already exists';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(v_in.password, extensions.gen_salt('bf', 10)), now(),
    -- GoTrue expects empty strings, not NULL, in these token columns.
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_in.username),
    now(), now()
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', null, now(), now()
  );

  insert into public.profiles (id, username, full_name, role, is_active, must_change_password)
  values (v_id, v_in.username, coalesce(v_in.full_name, ''), 'admin', true, true);

  insert into public.audit_logs (actor_id, action, entity, entity_id, diff)
  values (null, 'user.bootstrap_admin', 'profiles', v_id::text,
          jsonb_build_object('username', v_in.username, 'role', 'admin'));

  raise notice 'first admin "%" created (must change password at first login)', v_in.username;
end
$$;

commit;
