'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { JarooAuthMe } from '@/lib/supabase/types'
import styles from '@/components/home/jaroo-home-screen.module.css'

export function AuthHomeStatus() {
  const router = useRouter()
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

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthState({ authScope: 'guest', provider: null, user: null, userContract: { userId: 'guest', authScope: 'guest', provider: null, email: null, displayName: null } })
    router.refresh()
  }

  if (authState === null) {
    return <span className={styles.authStatus}>확인 중</span>
  }

  if (user) {
    return (
      <span className={styles.authStatus} data-auth-scope='authenticated'>
        <span className={styles.authStatusName}>{user.displayName ?? user.email ?? '사용자'}</span>
        <button type='button' className={styles.authStatusAction} onClick={logout}>로그아웃</button>
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
