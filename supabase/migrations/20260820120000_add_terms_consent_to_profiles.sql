-- Terms/privacy signup consent record (MVP beta legal P0).
-- Stores when the user accepted the required terms so the consent is auditable.
-- terms_version pins which Terms/Privacy revision the user agreed to ('v1' = 2026-08-20).

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

comment on column public.profiles.terms_accepted_at is 'Timestamp when the user accepted the required service terms/privacy consent.';
comment on column public.profiles.terms_version is 'Terms/privacy revision the user consented to (e.g. v1, effective 2026-08-20).';

-- Email signup path: consent arrives via signUp options.data because the user may not
-- have a session yet (email confirmation pending). Mirror it into profiles on creation.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, email, display_name, terms_accepted_at, terms_version)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name'),
    NULLIF(new.raw_user_meta_data ->> 'terms_accepted_at', '')::timestamptz,
    NULLIF(new.raw_user_meta_data ->> 'terms_version', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = coalesce(excluded.display_name, public.profiles.display_name),
      terms_accepted_at = coalesce(public.profiles.terms_accepted_at, excluded.terms_accepted_at),
      terms_version = coalesce(public.profiles.terms_version, excluded.terms_version),
      updated_at = now();

  return new;
end;
$$;
