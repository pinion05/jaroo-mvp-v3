'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { buildOAuthRedirectTo } from '@/lib/supabase/oauth-redirect'
import { useTermsConsent } from '@/components/auth/terms-consent'
import { cn } from '@/lib/utils'

type AuthFormMode = 'login' | 'signup'

type AuthFormProps = {
  mode: AuthFormMode
}

type AuthResponse = {
  needsEmailConfirmation?: boolean
  error?: {
    message?: string
  }
}

const copy = {
  login: {
    eyebrow: 'Supabase Auth',
    title: '로그인',
    subtitle: 'Supabase 세션으로 포트폴리오와 DeepScan 이력을 계정에 연결합니다.',
    cta: '로그인하기',
    switchLabel: '아직 계정이 없나요?',
    switchHref: '/signup',
    switchCta: '회원가입',
  },
  signup: {
    eyebrow: 'Supabase Auth',
    title: '회원가입',
    subtitle: '이메일 계정을 만들고 Supabase auth.users.id를 Jaroo 사용자 ID로 사용합니다.',
    cta: '계정 만들기',
    switchLabel: '이미 계정이 있나요?',
    switchHref: '/login',
    switchCta: '로그인',
  },
} satisfies Record<AuthFormMode, Record<string, string>>

async function parseJson(response: Response): Promise<AuthResponse> {
  try {
    return (await response.json()) as AuthResponse
  } catch {
    return {}
  }
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const { termsAgreed, consentAt, toggleTermsAgreed } = useTermsConsent()
  const c = copy[mode]

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)
    if (!termsAgreed) {
      setErrorMessage('서비스 이용약관과 개인정보처리방침에 동의해주세요.')
      return
    }
    setPending(true)
    setInfoMessage(null)

    const formData = new FormData(event.currentTarget)
    const body = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      name: mode === 'signup' ? String(formData.get('name') ?? '') : undefined,
      termsAcceptedAt: consentAt,
    }

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await parseJson(response)

      if (!response.ok) {
        setErrorMessage(payload.error?.message || '요청을 처리하지 못했어요. 다시 시도해주세요.')
        return
      }

      if (payload.needsEmailConfirmation) {
        setInfoMessage('확인 이메일을 보냈어요. 메일 인증 후 로그인해주세요.')
        return
      }

      router.replace('/home')
      router.refresh()
    } catch {
      setErrorMessage('네트워크 연결을 확인한 뒤 다시 시도해주세요.')
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error') === 'oauth') {
      setErrorMessage('구글 로그인을 완료하지 못했어요. 다시 시도해주세요.')
      router.replace('/login', { scroll: false })
    }
  }, [router])

  const handleGoogle = async () => {
    setErrorMessage(null)
    if (!termsAgreed) {
      setErrorMessage('서비스 이용약관과 개인정보처리방침에 동의해주세요.')
      return
    }
    setInfoMessage(null)
    setPending(true)
    const supabase = createSupabaseBrowserClient()
    // consent: 동의한 시점을 콜백으로 전달해 서버(profiles)에 동의 기록으로 남긴다.
    const consentQuery = consentAt ? `?consent=${encodeURIComponent(consentAt)}` : ''
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${buildOAuthRedirectTo()}${consentQuery}` },
    })
    if (error) {
      setErrorMessage(error.message || '구글 로그인을 시작하지 못했어요.')
      setPending(false)
    }
    // 성공 시 signInWithOAuth 가 브라우저를 Google로 이동시키므로 pending 해제 불필요(컴포넌트 언마운트).
  }

  return (
    <section className='space-y-5 rounded-[28px] border border-[color:var(--jaroo-border)] bg-white p-5 shadow-[0_16px_40px_rgba(15,47,78,0.08)]'>
      <div>
        <p className='text-xs font-semibold text-[color:var(--jaroo-primary)]'>{c.eyebrow}</p>
        <h1 className='mt-2 text-2xl font-semibold tracking-[-0.03em] text-[color:var(--jaroo-ink)]'>{c.title}</h1>
        <p className='mt-2 text-sm leading-6 text-[color:var(--jaroo-muted)]'>{c.subtitle}</p>
      </div>

      {errorMessage ? <p className='rounded-2xl bg-[color:var(--jaroo-danger-ghost)] px-3 py-2 text-xs leading-5 text-[color:var(--jaroo-danger)]' aria-live='polite'>{errorMessage}</p> : null}
      {infoMessage ? <p className='rounded-2xl bg-[color:var(--jaroo-success-ghost)] px-3 py-2 text-xs leading-5 text-[color:var(--jaroo-success)]' aria-live='polite'>{infoMessage}</p> : null}

      <button type='button' onClick={handleGoogle} disabled={pending || !termsAgreed} className='flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#d8e0ea] bg-white text-sm font-semibold text-[color:var(--jaroo-ink)] transition hover:bg-[#f3f5f8] disabled:cursor-not-allowed disabled:opacity-45'>
        <GoogleIcon />
        Google로 계속하기
      </button>

      <label className='flex items-start gap-2 text-xs leading-5 text-[color:var(--jaroo-muted)]'>
        <input
          type='checkbox'
          checked={termsAgreed}
          onChange={(e) => toggleTermsAgreed(e.target.checked)}
          className='mt-1 size-[15px] shrink-0 accent-[color:var(--jaroo-primary)]'
          aria-required='true'
        />
        <span>
          (필수) 만 14세 이상이며{' '}
          <Link href='/terms' className='font-semibold text-[color:var(--jaroo-ink)] underline underline-offset-2'>서비스 이용약관</Link>과{' '}
          <Link href='/privacy' className='font-semibold text-[color:var(--jaroo-ink)] underline underline-offset-2'>개인정보처리방침</Link>에 동의해요.
        </span>
      </label>

      <div className='flex items-center gap-3 py-1 text-xs text-[color:var(--jaroo-muted)]'>
        <span className='h-px flex-1 bg-[color:var(--jaroo-border)]' />
        <span>또는</span>
        <span className='h-px flex-1 bg-[color:var(--jaroo-border)]' />
      </div>

      <form className='space-y-3' onSubmit={handleSubmit}>
        {mode === 'signup' ? (
          <label className='block space-y-1.5 text-sm font-medium text-[color:var(--jaroo-ink)]'>
            이름
            <input name='name' autoComplete='name' placeholder='닉네임' className='h-12 w-full rounded-2xl border border-[#d8e0ea] bg-[#f8f8f6] px-4 text-sm outline-none transition focus:border-[color:var(--jaroo-primary)] focus:bg-white' />
          </label>
        ) : null}

        <label className='block space-y-1.5 text-sm font-medium text-[color:var(--jaroo-ink)]'>
          이메일
          <input name='email' type='email' required autoComplete='email' placeholder='you@example.com' className='h-12 w-full rounded-2xl border border-[#d8e0ea] bg-[#f8f8f6] px-4 text-sm outline-none transition focus:border-[color:var(--jaroo-primary)] focus:bg-white' />
        </label>

        <label className='block space-y-1.5 text-sm font-medium text-[color:var(--jaroo-ink)]'>
          비밀번호
          <input name='password' type='password' required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder='8자 이상' className='h-12 w-full rounded-2xl border border-[#d8e0ea] bg-[#f8f8f6] px-4 text-sm outline-none transition focus:border-[color:var(--jaroo-primary)] focus:bg-white' />
        </label>

        <button type='submit' disabled={pending} className={cn('h-12 w-full rounded-2xl bg-[color:var(--jaroo-primary)] text-sm font-semibold text-white transition hover:bg-[color:var(--jaroo-primary-strong)]', pending && 'cursor-wait opacity-65')}>
          {pending ? '처리 중...' : c.cta}
        </button>
      </form>

      <div className='flex items-center justify-center gap-2 text-xs text-[color:var(--jaroo-muted)]'>
        <span>{c.switchLabel}</span>
        <Link href={c.switchHref} className='font-semibold text-[color:var(--jaroo-primary)]'>{c.switchCta}</Link>
      </div>
    </section>
  )
}

function GoogleIcon() {
  return (
    <svg width='18' height='18' viewBox='0 0 18 18' aria-hidden='true'>
      <path fill='#4285F4' d='M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z' />
      <path fill='#34A853' d='M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z' />
      <path fill='#FBBC05' d='M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z' />
      <path fill='#EA4335' d='M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z' />
    </svg>
  )
}
