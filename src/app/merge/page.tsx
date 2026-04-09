'use client'

import dynamic from 'next/dynamic'

const JarooMergeScreen = dynamic(() => import('@/components/merge/jaroo-merge-screen'), {
  ssr: false,
})

export default function MergePage() {
  return <JarooMergeScreen />
}
