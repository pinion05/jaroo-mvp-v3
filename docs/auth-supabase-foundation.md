# Jaroo Supabase Auth Foundation

Issue: #144 회원가입/로그인 시스템 도입

## Provider decision

Jaroo auth foundation은 Supabase Auth email/password를 기준으로 한다.

- Session: Supabase SSR cookie session via `@supabase/ssr`
- Browser/server clients: `@supabase/supabase-js` + `@supabase/ssr`
- Jaroo user id contract: Supabase `auth.users.id`
- Public profile table: `public.profiles.id` references `auth.users.id`

## Routes

- `GET /login`
- `GET /signup`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

`/api/auth/me` returns:

```json
{
  "authScope": "authenticated",
  "provider": "supabase-email-password",
  "user": {
    "id": "auth.users.id",
    "email": "user@example.com",
    "displayName": "닉네임"
  },
  "userContract": {
    "userId": "auth.users.id",
    "authScope": "authenticated",
    "provider": "supabase-email-password",
    "email": "user@example.com",
    "displayName": "닉네임"
  }
}
```

Guest response:

```json
{
  "authScope": "guest",
  "provider": null,
  "user": null,
  "userContract": {
    "userId": "guest",
    "authScope": "guest",
    "provider": null,
    "email": null,
    "displayName": null
  }
}
```

## Environment variables

Local development and OCI runtime need:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
```

This repo also has server-only crawler/cache variables:

```bash
SUPABASE_URL="https://<project-ref>.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="<service role key>"
```

Do not expose the service role key to client components. Auth UI/API uses the anon key through Supabase SSR.

## Database migration

`supabase/migrations/20260626084500_create_auth_profiles.sql` creates:

- `public.profiles`
- RLS policies for authenticated users to select/insert/update only their own profile
- `public.handle_new_auth_user()` trigger on `auth.users` inserts

Apply with the existing Supabase migration workflow after reviewing target environment:

```bash
supabase migration list
supabase db push
```

Production writes require explicit confirmation before applying migrations.

## UX integration

- `/home` top bar shows guest/login state.
- `/mypage` account card shows guest CTA or Supabase user/account id.
- Existing guest OCR → DeepScan flow remains available.
