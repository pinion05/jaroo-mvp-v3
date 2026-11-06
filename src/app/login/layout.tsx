import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isExpectedSupabaseAuthMiss } from '@/lib/supabase/auth-error'

// /login page.tsx 는 'use client' 라 metadata 를 내보낼 수 없어 라우트 layout 이 대신 담당한다.
// 자기 참조 canonical(TC-BBL-020) — metadataBase(루트 layout) 기준 절대 URL로 직렬화된다.
export const metadata: Metadata = {
  title: '로그인 | Jaroo',
  description: '이메일·Google·카카오로 Jaroo에 로그인하고 MTS 스크린샷 한 장으로 내 포트폴리오를 AI 진단받아보세요.',
  alternates: { canonical: '/login' },
}

async function isAuthenticatedUser(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()
    return !error && Boolean(data.user)
  } catch (error) {
    // 세션 확인 불가(일시적 장애)면 게스트 취급 — 루트 페이지(src/app/page.tsx) 가드와 동일한 정책.
    if (error instanceof Error && !isExpectedSupabaseAuthMiss(error)) {
      console.error('[layout] login auth resolution failed', error)
    }
    return false
  }
}

// 이미 인증된 사용자가 /login 에 재접근하면 로그인 화면 대신 앱(/home)으로 안내한다(TC-BBF-008).
export default async function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (await isAuthenticatedUser()) {
    redirect('/home')
  }

  return <>{children}</>
}
