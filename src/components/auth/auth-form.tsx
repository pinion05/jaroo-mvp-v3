'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
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
  const c = copy[mode]

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setErrorMessage(null)
    setInfoMessage(null)

    const formData = new FormData(event.currentTarget)
    const body = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      name: mode === 'signup' ? String(formData.get('name') ?? '') : undefined,
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

  return (
    <section className='space-y-5 rounded-[28px] border border-[color:var(--jaroo-border)] bg-white p-5 shadow-[0_16px_40px_rgba(15,47,78,0.08)]'>
      <div>
        <p className='text-xs font-semibold text-[color:var(--jaroo-primary)]'>{c.eyebrow}</p>
        <h1 className='mt-2 text-2xl font-semibold tracking-[-0.03em] text-[color:var(--jaroo-ink)]'>{c.title}</h1>
        <p className='mt-2 text-sm leading-6 text-[color:var(--jaroo-muted)]'>{c.subtitle}</p>
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

        {errorMessage ? <p className='rounded-2xl bg-[color:var(--jaroo-danger-ghost)] px-3 py-2 text-xs leading-5 text-[color:var(--jaroo-danger)]' aria-live='polite'>{errorMessage}</p> : null}
        {infoMessage ? <p className='rounded-2xl bg-[color:var(--jaroo-success-ghost)] px-3 py-2 text-xs leading-5 text-[color:var(--jaroo-success)]' aria-live='polite'>{infoMessage}</p> : null}

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
