'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FilePlus2, ScanSearch, GitMerge, House, LineChart, UserRound } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

/**
 * 앱 전체의 단일 네비게이션 소스. 모든 하단 탭바는 이 컴포넌트를 렌더한다.
 * 항목을 바꾸면 전 앱에 자동 반영된다 (페이지마다 네비가 갈라지는 것을 방지).
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/screenshot', label: '추가', icon: FilePlus2 },
  { href: '/ocr', label: '검수', icon: ScanSearch },
  { href: '/merge', label: '병합', icon: GitMerge },
  { href: '/home', label: '홈', icon: House },
  { href: '/deepscan', label: '분석', icon: LineChart },
  { href: '/mypage', label: '마이', icon: UserRound },
]

export function AppBottomNav() {
  const pathname = usePathname()
  return (
    <nav aria-label='주요 화면' className='sticky bottom-0 z-20 flex border-t border-[#E8EAEE] bg-white/95 px-2 pt-[9px] pb-[11px] backdrop-blur'>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 text-[10px] transition',
              active ? 'font-semibold text-[#0F1419]' : 'text-[#97A0AE]',
            )}
          >
            <Icon className='size-[18px]' aria-hidden='true' />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
