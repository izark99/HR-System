-- UI texts edited by Admins (spec §33, AC-TX-06): the "Văn bản giao diện" tab.
--
-- One row per i18n key (`<namespace>:<path>`, e.g. `common:auth.login.title`). `value` null = the
-- built-in default text is used ("Khôi phục mặc định" sets it back to null). Rows are never
-- removed: there is no removal privilege nor policy, and this file holds no destructive statement
-- or keyword (HANDOFF §3), so it can be applied through the Supabase connection as is, and re-run.
--
-- Texts are interface wording only (labels, messages), never personal data.
--
-- Read: anon + authenticated (the app loads the edited texts once at start-up, also on the login
-- page), only rows with a value; Admins see every row. Write: Admins only. `updated_by` /
-- `updated_at` are set by triggers (the client cannot fake them) and are readable by signed-in
-- callers only (anon gets `key`, `value`).

create table if not exists public.ui_text_overrides (
  key text primary key
    check (char_length(key) <= 200 and key ~ '^[a-zA-Z]+:[A-Za-z0-9_.-]+$'),
  value text
    check (
      value is null
      or (char_length(value) <= 2000
          and btrim(value) <> ''
          -- Plain text only: no HTML tag (the app also refuses it before saving).
          and value !~ '<[A-Za-z/!?]')
    ),
  -- Plain uuid (no foreign key): an account removed later leaves the author unknown, not an error.
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists ui_text_overrides_updated_by_idx on public.ui_text_overrides (updated_by);

comment on table public.ui_text_overrides is
  'Admin-edited UI texts (spec §33). value null = built-in default. No personal data.';

-- Author of the last change: always the caller (any client-sent updated_by is replaced).
create or replace function private.set_ui_text_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.set_ui_text_author() from public, anon, authenticated;

create or replace trigger set_author before insert or update on public.ui_text_overrides
  for each row execute function private.set_ui_text_author();
create or replace trigger set_updated_at before update on public.ui_text_overrides
  for each row execute function private.set_updated_at();
create or replace trigger audit after insert or update on public.ui_text_overrides
  for each row execute function private.audit_row();

-- Privileges (column level for anon: no author metadata before sign-in). Supabase grants every
-- privilege on new public tables to anon / authenticated by default: taken back first, so only the
-- grants below apply (no removal privilege at all).
revoke all on public.ui_text_overrides from public, anon, authenticated;
grant select (key, value) on public.ui_text_overrides to anon;
grant select, insert, update on public.ui_text_overrides to authenticated;
grant all on public.ui_text_overrides to service_role;

alter table public.ui_text_overrides enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'ui_text_overrides' and policyname = 'ui_text_overrides_select') then
    create policy ui_text_overrides_select on public.ui_text_overrides for select
      to authenticated
      using (value is not null or (select private.is_admin()));
  end if;
  -- anon cannot call private.is_admin(): its own policy, edited rows only.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'ui_text_overrides' and policyname = 'ui_text_overrides_select_anon') then
    create policy ui_text_overrides_select_anon on public.ui_text_overrides for select
      to anon
      using (value is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'ui_text_overrides' and policyname = 'ui_text_overrides_insert') then
    create policy ui_text_overrides_insert on public.ui_text_overrides for insert
      to authenticated
      with check ((select private.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'ui_text_overrides' and policyname = 'ui_text_overrides_update') then
    create policy ui_text_overrides_update on public.ui_text_overrides for update
      to authenticated
      using ((select private.is_admin())) with check ((select private.is_admin()));
  end if;
end
$$;
