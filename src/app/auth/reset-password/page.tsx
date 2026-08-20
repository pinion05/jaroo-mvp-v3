'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { SpecFrame } from '@/components/spec/spec-frame'
import { cn } from '@/lib/utils'
import styles from '../../login/login.module.css'

type Phase = 'checking' | 'ready' | 'done' | 'expired'

// 비밀번호 재설정 메일의 링크가 여기로 돌아온다(?code=... PKCE).
// 링크로 성립된 세션으로 새 비밀번호를 설정한다.
export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const establishSession = async () => {
      const supabase = createSupabaseBrowserClient()
      const params = new URLSearchParams(window.location.search)

      // 이미 만료/실패로 돌아온 링크(error, error_description 파라미터)는 곧바로 만료 안내.
      if (params.get('error')) {
        if (!cancelled) setPhase('expired')
        return
      }

      // detectSessionInUrl 이 code 를 소비했을 수 있으므로 getSession 먼저, 그래도
      // 세션이 없고 code 가 남아 있으면 직접 교환한다(이중 교환 오류는 세션 확인으로 흡수).
      let { data } = await supabase.auth.getSession()
      if (!data.session) {
        const code = params.get('code')
        if (code) {
          await supabase.auth.exchangeCodeForSession(code)
          ;({ data } = await supabase.auth.getSession())
        }
      }
      if (!cancelled) setPhase(data.session ? 'ready' : 'expired')
    }

    void establishSession()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 해요.')
      return
    }
    if (password !== confirm) {
      setError('비밀번호가 일치하지 않아요.')
      return
    }
    setPending(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError('비밀번호를 변경하지 못했어요. 링크를 다시 받아서 시도해주세요.')
        return
      }
      setPhase('done')
    } catch {
      setError('네트워크 연결을 확인한 뒤 다시 시도해주세요.')
    } finally {
      setPending(false)
    }
  }

  return (
    <SpecFrame backHref='/login'>
      <div className={styles.body}>
        <div className={cn(styles.hero, styles.heroSm)}>
          <div className={cn(styles.brand, styles.brandSm)}>비밀번호 재설정</div>
          <div className={cn(styles.heroSub, styles.heroSubSm)}>
            {phase === 'checking'
              ? '링크를 확인하고 있어요...'
              : phase === 'done'
                ? '비밀번호를 변경했어요.'
                : phase === 'expired'
                  ? '링크가 만료되었거나 이미 사용됐어요.'
                  : '새 비밀번호를 입력해주세요.'}
          </div>
        </div>

        {phase === 'checking' ? (
          <p className={styles.info} aria-live='polite'>재설정 링크를 확인하는 중이에요. 잠시만 기다려주세요.</p>
        ) : null}

        {phase === 'ready' ? (
          <form onSubmit={handleSubmit}>
            <div className={styles.field}>
              <div className={styles.fieldLabel}>새 비밀번호</div>
              <input
                className={styles.fieldInput}
                name='new-password'
                type='password'
                autoComplete='new-password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder='8자 이상'
                minLength={8}
                required
              />
            </div>
            <div className={styles.field}>
              <div className={styles.fieldLabel}>새 비밀번호 확인</div>
              <input
                className={styles.fieldInput}
                name='new-password-confirm'
                type='password'
                autoComplete='new-password'
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder='한 번 더 입력해주세요'
                minLength={8}
                required
              />
            </div>

            {error ? <p className={styles.error} aria-live='polite'>{error}</p> : null}

            <button type='submit' className={cn(styles.loginBtn, styles.primary)} disabled={pending} style={{ marginTop: 8 }}>
              {pending ? '처리 중...' : '비밀번호 변경'}
            </button>
          </form>
        ) : null}

        {phase === 'done' ? (
          <>
            <p className={styles.info} aria-live='polite'>
              새 비밀번호로 로그인 상태가 유지돼요. 이제 Jaroo를 계속 이용해보세요.
            </p>
            <Link href='/home' className={cn(styles.loginBtn, styles.primary)} style={{ marginTop: 12, marginBottom: 10 }}>
              홈으로 이동
            </Link>
          </>
        ) : null}

        {phase === 'expired' ? (
          <>
            <p className={styles.error} aria-live='polite'>
              재설정 링크는 보안상 한 번만 쓸 수 있어요. 로그인 화면에서 링크를 다시 받아주세요.
            </p>
            <Link href='/login' className={cn(styles.loginBtn, styles.primary)} style={{ marginTop: 12, marginBottom: 10 }}>
              로그인 화면으로
            </Link>
          </>
        ) : null}
      </div>
    </SpecFrame>
  )
}
