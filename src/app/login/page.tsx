'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { buildOAuthRedirectTo } from '@/lib/supabase/oauth-redirect'
import { SpecFrame } from '@/components/spec/spec-frame'
import { cn } from '@/lib/utils'
import styles from './login.module.css'

type View = 'select' | 'email'
type Mode = 'login' | 'signup'

// 시안의 히어로 샘플 주식 (정적 장식). 한국식 색상: 상승=빨강, 하락=파랑.
const SAMPLE_STOCKS = [
  { name: '삼성전자', rate: '+31.5%', dir: 'up' as const, dot: '#E5484D' },
  { name: 'LG디스플레이', rate: '+1.3%', dir: 'up' as const, dot: '#E5484D' },
  { name: 'SFA반도체', rate: '−14.3%', dir: 'down' as const, dot: '#2B6BE6' },
]

export default function LoginPage() {
  const router = useRouter()
  const [view, setView] = useState<View>('select')
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [nextPath, setNextPath] = useState('/home')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error') === 'oauth') {
      setError('구글 로그인을 완료하지 못했어요. 다시 시도해주세요.')
      router.replace('/login', { scroll: false })
    }
    const next = params.get('next')
    // same-origin 상대 경로만 허용 (오픈 리다이렉트 방지)
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      setNextPath(next)
    }
  }, [router])

  const loginSuccessPath = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/home'

  async function handleGoogle() {
    setError(null)
    setPending(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${buildOAuthRedirectTo()}?next=${encodeURIComponent(loginSuccessPath)}` },
    })
    if (error) {
      setError(error.message || '구글 로그인을 시작하지 못했어요.')
      setPending(false)
    }
    // 성공 시 signInWithOAuth 가 브라우저를 Google로 이동시키므로 pending 해제 불필요(컴포넌트 언마운트).
  }

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setInfo(null)
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string }; needsEmailConfirmation?: boolean }

      if (!response.ok) {
        setError(payload.error?.message || '요청을 처리하지 못했어요. 다시 시도해주세요.')
        return
      }
      if (payload.needsEmailConfirmation) {
        setInfo('확인 이메일을 보냈어요. 메일 인증 후 로그인해주세요.')
        return
      }
      router.replace(loginSuccessPath)
      router.refresh()
    } catch {
      setError('네트워크 연결을 확인한 뒤 다시 시도해주세요.')
    } finally {
      setPending(false)
    }
  }

  if (view === 'select') {
    return (
      <SpecFrame backHref='/home'>
        <div className={styles.body}>
          <div className={styles.hero}>
            <div className={styles.brand}>Jaroo</div>
            <div className={styles.heroSub}>
              MTS 스크린샷 한 장으로
              <br />
              <b>내 주식을 AI가 진단</b>해드려요.
            </div>
            <div className={styles.heroVisual}>
              {SAMPLE_STOCKS.map((s) => (
                <div className={styles.hvRow} key={s.name}>
                  <span className={styles.hvDot} style={{ background: s.dot }} />
                  <span className={styles.hvName}>{s.name}</span>
                  <span className={cn(styles.hvRate, s.dir === 'up' ? styles.up : styles.down)}>{s.rate}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.loginArea}>
            <button
              type='button'
              className={cn(styles.loginBtn, styles.primary)}
              onClick={() => {
                setError(null)
                setMode('login')
                setView('email')
              }}
            >
              <span className={styles.loginBtnIco}>
                <MailIcon />
              </span>
              이메일로 시작하기
            </button>
            <button type='button' className={styles.loginBtn} onClick={handleGoogle} disabled={pending}>
              <span className={styles.loginBtnIco}>
                <GoogleIcon />
              </span>
              Google로 시작하기
            </button>

            <div className={styles.divider}>
              <span className={styles.dividerSpan}>준비 중</span>
            </div>

            <button type='button' className={cn(styles.loginBtn, styles.disabled)} disabled>
              <span className={styles.loginBtnIco}>
                <KakaoIcon />
              </span>
              카카오로 시작하기
              <span className={styles.soon}>준비 중</span>
            </button>
            <button type='button' className={cn(styles.loginBtn, styles.disabled)} disabled>
              <span className={styles.loginBtnIco}>
                <AppleIcon />
              </span>
              Apple로 시작하기
              <span className={styles.soon}>준비 중</span>
            </button>

            {error ? <p className={styles.error} aria-live='polite'>{error}</p> : null}

            <button type='button' className={styles.guestBtn} onClick={() => router.push('/home')}>
              게스트로 둘러보기
            </button>

            <div className={styles.terms}>
              시작하면 <span className={styles.termsA}>서비스 약관</span>과 <span className={styles.termsA}>개인정보처리방침</span>에
              <br />
              동의하는 것으로 간주돼요.
            </div>
          </div>
        </div>
      </SpecFrame>
    )
  }

  return (
    <SpecFrame
      onBack={() => {
        setError(null)
        setInfo(null)
        setView('select')
      }}
    >
      <div className={styles.body}>
        <div className={cn(styles.hero, styles.heroSm)}>
          <div className={cn(styles.brand, styles.brandSm)}>이메일로 시작</div>
          <div className={cn(styles.heroSub, styles.heroSubSm)}>계정이 없으면 자동으로 만들어져요.</div>
        </div>

        <form onSubmit={handleEmail}>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>이메일</div>
            <input
              className={styles.fieldInput}
              name='email'
              type='email'
              autoComplete='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder='you@example.com'
              required
            />
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>비밀번호</div>
            <input
              className={styles.fieldInput}
              name='password'
              type='password'
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='••••••••'
              minLength={8}
              required
            />
            <div className={styles.forgot}>비밀번호를 잊으셨나요?</div>
          </div>

          {error ? <p className={styles.error} aria-live='polite'>{error}</p> : null}
          {info ? <p className={styles.info} aria-live='polite'>{info}</p> : null}

          <button type='submit' className={cn(styles.loginBtn, styles.primary)} disabled={pending} style={{ marginTop: 8 }}>
            {pending ? '처리 중...' : mode === 'login' ? '로그인' : '계정 만들기'}
          </button>

          <div className={styles.signupLine}>
            {mode === 'login' ? '처음이신가요?' : '이미 계정이 있나요?'}
            <button
              type='button'
              className={styles.signupLineBtn}
              onClick={() => setMode((m) => (m === 'login' ? 'signup' : 'login'))}
            >
              {mode === 'login' ? '이메일로 가입' : '로그인'}
            </button>
          </div>

          <div className={styles.terms} style={{ marginTop: 28 }}>
            시작하면 <span className={styles.termsA}>서비스 약관</span>과 <span className={styles.termsA}>개인정보처리방침</span>에
            <br />
            동의하는 것으로 간주돼요.
          </div>
        </form>
      </div>
    </SpecFrame>
  )
}

function MailIcon() {
  return (
    <svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <rect x='2' y='4' width='20' height='16' rx='2' />
      <path d='m22 7-10 6L2 7' />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width='17' height='17' viewBox='0 0 24 24' aria-hidden='true'>
      <path fill='#4285F4' d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z' />
      <path fill='#34A853' d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z' />
      <path fill='#FBBC05' d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93z' />
      <path fill='#EA4335' d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z' />
    </svg>
  )
}

function KakaoIcon() {
  return (
    <svg width='17' height='17' viewBox='0 0 24 24' fill='#97A0AE' aria-hidden='true'>
      <path d='M12 3C6.48 3 2 6.48 2 10.8c0 2.77 1.84 5.21 4.6 6.6-.2.7-.73 2.62-.83 3.03-.13.5.18.5.38.36.16-.1 2.5-1.7 3.52-2.4.75.1 1.53.16 2.33.16 5.52 0 10-3.48 10-7.75S17.52 3 12 3z' />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='#97A0AE' aria-hidden='true'>
      <path d='M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.02-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.15-.47 7.81 1.3 10.37.86 1.25 1.89 2.66 3.24 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.29-1.28 3.14-2.54.99-1.46 1.4-2.87 1.42-2.94-.03-.01-2.72-1.04-2.75-4.15zM14.53 4.5c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.55-.66.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.45z' />
    </svg>
  )
}
