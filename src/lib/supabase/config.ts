import { readJarooRuntimeEnv } from '../jaroo-runtime-env'

export function getSupabaseUrl(): string {
  // 클라이언트: 루트 레이아웃이 주입한 런타임 env(window.__JAROO_ENV__)를 최우선한다.
  // 빌드타임 NEXT_PUBLIC_* 인라인은 CLI 업로드 배포에서 stale 스냅샷으로 굽는 경우가
  // 있어(2026-10-27 실측) 빌드 의존을 제거한다.
  const runtime = readJarooRuntimeEnv()
  if (runtime.supabaseUrl?.trim()) {
    return runtime.supabaseUrl.trim()
  }
  if (typeof window === 'undefined') {
    // 서버: 런타임 SUPABASE_URL을 우선(같은 이유). prod에선 두 값이 동일해 무해하다.
    return process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''
  }
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || ''
}

export function getSupabaseAnonKey(): string {
  const runtime = readJarooRuntimeEnv()
  if (runtime.supabaseAnonKey?.trim()) {
    return runtime.supabaseAnonKey.trim()
  }
  if (typeof window === 'undefined') {
    return process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ''
  }
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || ''
}

export function hasSupabaseBrowserConfig(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey())
}

export function assertSupabaseConfig(): { url: string; anonKey: string } {
  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()

  if (!url || !anonKey) {
    throw new Error('Supabase URL/anon key is not configured')
  }

  return { url, anonKey }
}

export function getSupabaseServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
}

export function assertSupabaseServiceConfig(): { url: string; serviceRoleKey: string } {
  const url = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase URL/service-role key is not configured')
  }

  return { url, serviceRoleKey }
}
