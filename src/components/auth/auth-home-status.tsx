'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { JarooAuthMe } from '@/lib/supabase/types'
import styles from '@/components/home/jaroo-home-screen.module.css'

export function AuthHomeStatus() {
  const [authState, setAuthState] = useState<JarooAuthMe | null>(null)
  const user = authState?.authScope === 'authenticated' ? authState.user : null

  useEffect(() => {
    let cancelled = false

    const loadAuthState = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        const payload = (await response.json()) as JarooAuthMe
        if (!cancelled) setAuthState(payload)
      } catch {
        if (!cancelled) setAuthState(null)
      }
    }

    void loadAuthState()

    return () => {
      cancelled = true
    }
  }, [])

  if (authState === null) {
    return <span className={styles.authStatus}>확인 중</span>
  }

  if (user) {
    return (
      // mypage-only-logout: 홈 헤더에서는 로그인 사용자 표시만 하고, 로그아웃은 마이페이지에서 제공한다.
      <span className={styles.authStatus} data-auth-scope='authenticated'>
        <span className={styles.authStatusName}>{user.displayName ?? user.email ?? '사용자'}</span>
      </span>
    )
  }

  return (
    <span className={styles.authStatus} data-auth-scope='guest'>
      <span className={styles.authStatusName}>게스트</span>
      <Link href='/login' className={styles.authStatusAction}>로그인</Link>
    </span>
  )
}
