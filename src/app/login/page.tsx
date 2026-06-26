import Link from 'next/link'
import { AuthForm } from '@/components/auth/auth-form'
import { JarooShell } from '@/components/jaroo-shell'

export default function LoginPage() {
  return (
    <JarooShell
      title='로그인'
      subtitle='Supabase Auth'
      backHref='/home'
      showBottomNav={false}
      action={<Link href='/signup' className='text-xs font-semibold text-[color:var(--jaroo-primary)]'>가입</Link>}
      mainClassName='bg-[color:var(--jaroo-canvas)]'
    >
      <AuthForm mode='login' />
      <p className='px-1 text-xs leading-5 text-[color:var(--jaroo-muted)]'>
        Supabase email/password 세션을 사용합니다. 로그인 후 `/api/auth/me`의 `userContract.userId`가 향후 포트폴리오/OCR/DeepScan 이력의 연결 키가 됩니다.
      </p>
    </JarooShell>
  )
}
