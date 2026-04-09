'use client'

import dynamic from 'next/dynamic'

const JarooHomeScreen = dynamic(() => import('@/components/home/jaroo-home-screen').then((module) => module.JarooHomeScreen), {
  ssr: false,
})

export default function HomePage() {
  return <JarooHomeScreen />
}
