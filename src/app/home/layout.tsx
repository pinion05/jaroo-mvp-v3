import type { Metadata } from 'next'

// /home page.tsx 는 'use client'(dynamic ssr:false)라 metadata 를 내보낼 수 없어 라우트 layout 이 대신 담당한다.
// 자기 참조 canonical(TC-BBL-020) — metadataBase(루트 layout) 기준 절대 URL로 직렬화된다.
export const metadata: Metadata = {
  title: '내 포트폴리오 | Jaroo',
  description: '내 주식 포트폴리오 요약과 종목별 현황을 한눈에 — Jaroo 홈.',
  alternates: { canonical: '/home' },
}

export default function HomeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>
}
