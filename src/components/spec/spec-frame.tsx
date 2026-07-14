'use client'

import 'pretendard/dist/web/static/pretendard.css'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AppBottomNav } from '@/components/app-bottom-nav'

// 시안(design/) 전용 scoped 프레임. 글로벌 --jaroo-* 토큰을 건드리지 않고
// 시안의 팔레트/폰트(Pretendard)를 이 3화면(login/mypage/마이세부)에만 적용한다.
const SPEC_FONT = "-apple-system, 'Pretendard', sans-serif"

export function SpecFrame({
  children,
  backHref,
  onBack,
  title,
  leading,
  showBottomNav = false,
  contentClassName,
  frameClassName,
}: {
  children: ReactNode
  backHref?: string
  onBack?: () => void
  title?: ReactNode
  leading?: ReactNode | null
  showBottomNav?: boolean
  contentClassName?: string
  frameClassName?: string
}) {
  const hasHeader = Boolean(backHref || onBack || title || leading !== undefined)
  const back = (
    <span className='flex size-7 items-center justify-center rounded-full bg-white text-[#0F1419] shadow-[0_1px_2px_rgba(0,0,0,0.04)]'>
      <ArrowLeft className='size-[15px]' strokeWidth={2.2} />
    </span>
  )

  return (
    <div className='min-h-screen min-h-dvh bg-[#F5F6F8] sm:bg-[#e8e8e8] sm:px-6 sm:py-4' style={{ fontFamily: SPEC_FONT }}>
      <div
        className={cn(
          // 고정 높이(h-screen/h-dvh)를 써야 <main>이 남은 공간만 차지하고
          // 독립 스크롤 컨테이너로 동작한다. min-h 만 쓰면 frame 이 컨텐츠 길이에
          // 따라 무한히 늘어나 문서 전체가 스크롤되고, AppBottomNav 의
          // sticky 가 기준 스크롤 컨테이너에서 떨어져 하단 고정이 깨진다.
          'relative mx-auto flex h-screen h-dvh w-full flex-col overflow-hidden bg-[#F5F6F8] sm:h-[calc(100vh-2rem)] sm:max-w-[390px] sm:rounded-[32px] sm:shadow-[0_4px_24px_rgba(0,0,0,0.12)]',
          frameClassName,
        )}
      >
        {hasHeader ? (
          <header className='flex items-center gap-3 px-4 py-[14px]'>
            {leading !== undefined ? (
              leading ? <div className='shrink-0'>{leading}</div> : null
            ) : (
              <div className='shrink-0'>
                {onBack ? (
                  <button type='button' onClick={onBack} aria-label='뒤로'>{back}</button>
                ) : backHref ? (
                  <Link href={backHref} aria-label='뒤로'>{back}</Link>
                ) : null}
              </div>
            )}
            {title ? <div className='min-w-0 flex-1 truncate text-sm font-semibold text-[#0F1419]'>{title}</div> : null}
          </header>
        ) : null}

        <main className={cn('flex flex-1 flex-col overflow-y-auto', contentClassName)}>{children}</main>

        {/* shrink-0: main 이 남은 공간을 모두 차지하고 nav 는 항상 frame 하단에 고정. */}
        {showBottomNav ? (
          <div className='shrink-0'>
            <AppBottomNav />
          </div>
        ) : null}
      </div>
    </div>
  )
}
