import type { Metadata } from 'next'

// /login page.tsx 는 'use client' 라 metadata 를 내보낼 수 없어 라우트 layout 이 대신 담당한다.
// 자기 참조 canonical(TC-BBL-020) — metadataBase(루트 layout) 기준 절대 URL로 직렬화된다.
export const metadata: Metadata = {
  title: '로그인 | Jaroo',
  description: '이메일·Google·카카오로 Jaroo에 로그인하고 MTS 스크린샷 한 장으로 내 포트폴리오를 AI 진단받아보세요.',
  alternates: { canonical: '/login' },
}

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>
}
