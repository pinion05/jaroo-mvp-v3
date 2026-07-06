import 'pretendard/dist/web/static/pretendard.css'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// 시안(design/) 전용 scoped 프레임. 글로벌 --jaroo-* 토큰을 건드리지 않고
// 시안의 팔레트/폰트(Pretendard)를 이 3화면(login/mypage/마이세부)에만 적용한다.
const SPEC_FONT = "-apple-system, 'Pretendard', sans-serif"

export function SpecFrame({
  children,
  backHref,
  onBack,
  title,
  leading,
  footer,
  contentClassName,
  frameClassName,
}: {
  children: ReactNode
  backHref?: string
  onBack?: () => void
  title?: ReactNode
  leading?: ReactNode | null
  footer?: ReactNode
  contentClassName?: string
  frameClassName?: string
}) {
  const backBtn = (
    <span className='flex size-7 items-center justify-center rounded-full bg-white text-[#0F1419] shadow-[0_1px_2px_rgba(0,0,0,0.04)]'>
      <ArrowLeft className='size-[15px]' strokeWidth={2.2} />
    </span>
  )

  return (
    <div className='min-h-screen min-h-dvh bg-[#F5F6F8] sm:bg-[#e8e8e8] sm:px-6 sm:py-4' style={{ fontFamily: SPEC_FONT }}>
      <div
        className={cn(
          'relative mx-auto flex min-h-screen min-h-dvh w-full flex-col overflow-hidden bg-[#F5F6F8] sm:min-h-[calc(100vh-2rem)] sm:max-w-[390px] sm:rounded-[32px] sm:shadow-[0_4px_24px_rgba(0,0,0,0.12)]',
          frameClassName,
        )}
      >
        <header className='flex items-center gap-3 px-4 py-[14px]'>
          {leading !== undefined ? (
            leading ? <div className='shrink-0'>{leading}</div> : null
          ) : (
            <div className='shrink-0'>
              {onBack ? (
                <button type='button' onClick={onBack} aria-label='뒤로'>{backBtn}</button>
              ) : backHref ? (
                <Link href={backHref} aria-label='뒤로'>{backBtn}</Link>
              ) : null}
            </div>
          )}
          {title ? <div className='min-w-0 flex-1 truncate text-sm font-semibold text-[#0F1419]'>{title}</div> : null}
        </header>

        <main className={cn('flex flex-1 flex-col overflow-y-auto', contentClassName)}>{children}</main>

        {footer}
      </div>
    </div>
  )
}
