import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isExpectedSupabaseAuthMiss } from '@/lib/supabase/auth-error'

type RootPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

function appendSearchParam(query: URLSearchParams, key: string, value: string | string[] | undefined) {
  if (typeof value === 'string') {
    query.append(key, value)
    return
  }

  value?.forEach((entry) => query.append(key, entry))
}

async function isAuthenticatedUser(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()
    return !error && Boolean(data.user)
  } catch (error) {
    // 세션 확인 불가(일시적 장애)면 게스트 취급 — 로그인 페이지로 자연 복구 유도.
    if (error instanceof Error && !isExpectedSupabaseAuthMiss(error)) {
      console.error('[page] root auth resolution failed', error)
    }
    return false
  }
}

// 앱 입구: 로그인된 사용자는 /home 로, 게스트는 로그인 페이지로.
// (첫 접속 = 로그인 페이지. 게스트는 '게스트로 둘러보기'로 /home 진입)
export default async function Page({ searchParams }: RootPageProps = {}) {
  const params = await searchParams
  if (params?.code) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      appendSearchParam(query, key, value)
    }

    redirect(`/auth/callback?${query.toString()}`)
  }

  if (await isAuthenticatedUser()) {
    redirect('/home')
  }

  redirect('/login')
}
