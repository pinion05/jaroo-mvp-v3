import Link from 'next/link'
import { AuthForm } from '@/components/auth/auth-form'
import { JarooShell } from '@/components/jaroo-shell'

export default function SignupPage() {
  return (
    <JarooShell
      title='회원가입'
      subtitle='Supabase Auth'
      backHref='/home'
      showBottomNav={false}
      action={<Link href='/login' className='text-xs font-semibold text-[color:var(--jaroo-primary)]'>로그인</Link>}
      mainClassName='bg-[color:var(--jaroo-canvas)]'
    >
      <AuthForm mode='signup' />
      <section className='rounded-[22px] border border-[color:var(--jaroo-border)] bg-white p-4 text-xs leading-5 text-[color:var(--jaroo-muted)]'>
        <p className='font-semibold text-[color:var(--jaroo-ink)]'>사용자 ID 계약</p>
        <p className='mt-1'>Supabase `auth.users.id`를 Jaroo의 안정적인 사용자 ID로 사용합니다. `public.profiles.id`도 같은 UUID를 참조합니다.</p>
      </section>
    </JarooShell>
  )
}
