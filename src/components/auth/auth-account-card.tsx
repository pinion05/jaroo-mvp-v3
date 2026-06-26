'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import type { JarooAuthMe } from '@/lib/supabase/types'

const guestState: JarooAuthMe = {
  authScope: 'guest',
  provider: null,
  user: null,
  userContract: { userId: 'guest', authScope: 'guest', provider: null, email: null, displayName: null },
}

export function AuthAccountCard() {
  const router = useRouter()
  const [authState, setAuthState] = useState<JarooAuthMe | null>(null)
  const user = authState?.authScope === 'authenticated' ? authState.user : null
  const label = user?.displayName ?? user?.email ?? '게스트'
  const fallback = useMemo(() => label.slice(0, 1).toUpperCase(), [label])

  useEffect(() => {
    let cancelled = false

    const loadAuthState = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        const payload = (await response.json()) as JarooAuthMe
        if (!cancelled) setAuthState(payload)
      } catch {
        if (!cancelled) setAuthState(guestState)
      }
    }

    void loadAuthState()

    return () => {
      cancelled = true
    }
  }, [])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthState(guestState)
    router.refresh()
  }

  if (authState === null) {
    return (
      <Card className='rounded-[26px] border-0 bg-[linear-gradient(180deg,var(--jaroo-primary-strong),var(--jaroo-primary))] p-5 text-white shadow-none ring-0'>
        <p className='text-sm font-semibold'>Supabase 세션 확인 중...</p>
        <p className='mt-1 text-xs text-white/65'>쿠키 기반 로그인 상태를 확인하고 있어요.</p>
      </Card>
    )
  }

  if (!user) {
    return (
      <Card className='rounded-[26px] border-0 bg-[linear-gradient(180deg,var(--jaroo-primary-strong),var(--jaroo-primary))] p-5 text-white shadow-none ring-0'>
        <div className='flex items-center gap-4'>
          <Avatar className='size-[52px] border border-white/20'>
            <AvatarFallback className='bg-white/15 text-lg font-semibold text-white'>게</AvatarFallback>
          </Avatar>
          <div className='min-w-0 flex-1'>
            <p className='text-base font-semibold'>게스트 모드</p>
            <p className='mt-1 text-xs text-white/65'>로그인하면 Supabase 사용자 ID로 이력을 연결할 수 있어요.</p>
          </div>
        </div>
        <div className='mt-4 grid grid-cols-2 gap-2'>
          <Link href='/login' className='rounded-xl bg-white px-3 py-2 text-center text-xs font-semibold text-[color:var(--jaroo-primary-strong)]'>로그인</Link>
          <Link href='/signup' className='rounded-xl border border-white/30 bg-white/12 px-3 py-2 text-center text-xs font-semibold text-white'>회원가입</Link>
        </div>
      </Card>
    )
  }

  return (
    <Card className='rounded-[26px] border-0 bg-[linear-gradient(180deg,var(--jaroo-primary-strong),var(--jaroo-primary))] p-5 text-white shadow-none ring-0'>
      <div className='flex items-center gap-4'>
        <Avatar className='size-[52px] border border-white/20'>
          <AvatarFallback className='bg-white/15 text-lg font-semibold text-white'>{fallback}</AvatarFallback>
        </Avatar>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-base font-semibold'>{label}님</p>
          <p className='mt-1 truncate text-xs text-white/65'>{user.email}</p>
          <p className='mt-1 text-[10px] text-white/55'>Supabase user id: {user.id.slice(0, 8)}...</p>
        </div>
        <button type='button' className='rounded-xl border border-white/30 bg-white/12 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/20' onClick={logout}>
          로그아웃
        </button>
      </div>
    </Card>
  )
}
