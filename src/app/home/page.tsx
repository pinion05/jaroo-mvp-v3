'use client'

import dynamic from 'next/dynamic'

const JarooHomeScreen = dynamic(() => import('@/components/home/jaroo-home-screen').then((module) => module.JarooHomeScreen), {
  ssr: false,
})

export default function HomePage() {
  return (
    <>
      {/* 페이지 대표 헤딩(TC-BBL-008) — 빈 포트폴리오/보유 중 어느 상태든 
          '내 포트폴리오' 화면임을 나타낸다. 화면 카피는 그대로 두고 sr-only로 계층만 노출. */}
      <h1 className='sr-only'>내 포트폴리오</h1>
      <JarooHomeScreen />
    </>
  )
}
