'use client'

import 'pretendard/dist/web/static/pretendard.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, FilePlus2, ScanSearch, GitMerge, House, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// 시안(design/) 전용 scoped 프레임. 글로벌 --jaroo-* 토큰을 건드리지 않고
// 시안의 팔레트/폰트(Pretendard)를 이 3화면(login/mypage/마이세부)에만 적용한다.
const SPEC_FONT = "-apple-system, 'Pretendard', sans-serif"

// 앱 실제 라우트(5). 시안 하단탭은 4(홈/포트폴리오/분석/마이)이지만,
// 네비게이션 일관성을 위해 앱의 실제 라우트를 시안 탭바 스타일로 렌더한다.
const SPEC_NAV = [
  { href: '/screenshot', label: '추가', icon: FilePlus2 },
  { href: '/ocr', label: '검수', icon: ScanSearch },
  { href: '/merge', label: '병합', icon: GitMerge },
  { href: '/home', label: '홈', icon: House },
  { href: '/mypage', label: '마이', icon: UserRound },
]

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
  const pathname = usePathname()
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
          'relative mx-auto flex min-h-screen min-h-dvh w-full flex-col overflow-hidden bg-[#F5F6F8] sm:min-h-[calc(100vh-2rem)] sm:max-w-[390px] sm:rounded-[32px] sm:shadow-[0_4px_24px_rgba(0,0,0,0.12)]',
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

        {showBottomNav ? (
          <nav className='sticky bottom-0 z-20 flex border-t border-[#E8EAEE] bg-white/95 px-2 pt-[9px] pb-[11px] backdrop-blur'>
            {SPEC_NAV.map((item) => {
              const active = pathname === item.href
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn('flex flex-1 flex-col items-center gap-1 text-[10px] transition', active ? 'font-semibold text-[#0F1419]' : 'text-[#97A0AE]')}
                >
                  <Icon className='size-[18px]' />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
        ) : null}
      </div>
    </div>
  )
}
