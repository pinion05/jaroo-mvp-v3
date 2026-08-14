'use client'

import 'pretendard/dist/web/static/pretendard.css'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AppBottomNav } from '@/components/app-bottom-nav'

// 시안(design/) 전용 scoped 레이아웃. 루트 layout.tsx 의 PhoneFrame(390px 폰 박스)이
// 바깥 캔버스/폰 박스를 담당하므로, 여기서는 시안 폰트(Pretendard)/헤더를
// login/mypage/마이세부 화면에만 적용한다.
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

  // h-full: 루트 PhoneFrame(h-dvh 확정 높이)을 정확히 채운다 (jaroo-shell 과 동일).
  return (
    <div className={cn('relative flex h-full w-full flex-col', frameClassName)} style={{ fontFamily: SPEC_FONT }}>
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
  )
}
