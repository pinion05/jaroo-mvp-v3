'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { House, ScanLine, UserRound } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** 이 항목이 '활성'으로 보일 경로 접두사들 (퍼널 하위 화면 포함) */
  activePrefixes: string[]
  /** 중앙 강조 버튼(스캔) 여부 */
  emphasized?: boolean
}

/**
 * 앱 전체의 단일 네비게이션 소스. 모든 하단 탭바는 이 컴포넌트를 렌더한다.
 * 2026-08-26 개편: 퍼널 단계(검수·병합)와 컨텍스트 흐름(분석)을 탭에서 제외하고
 * 홈·스캔(퍼널 입구)·마이 3탭 + 중앙 강조로 축소했다.
 * 검수/병합은 퍼널 내 화면으로, 딥스캔은 홈 종목 카드로 진입한다.
 * (워치 출시 시 '워치' 탭 추가 예정 자리는 중앙 강조 좌우)
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/home', label: '홈', icon: House, activePrefixes: ['/home'] },
  { href: '/screenshot', label: '스캔', icon: ScanLine, activePrefixes: ['/screenshot', '/ocr', '/merge'], emphasized: true },
  { href: '/mypage', label: '마이', icon: UserRound, activePrefixes: ['/mypage'] },
]

function isActive(pathname: string, item: NavItem) {
  return item.activePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function AppBottomNav() {
  const pathname = usePathname()
  return (
    <nav aria-label='주요 화면' className='sticky bottom-0 z-20 flex border-t border-[#E8EAEE] bg-white/95 px-2 pt-[9px] pb-[11px] backdrop-blur'>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item)
        const Icon = item.icon
        if (item.emphasized) {
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className='flex flex-1 flex-col items-center gap-1 text-[10px] transition'
            >
              <span
                className={cn(
                  '-mt-[18px] flex size-[52px] items-center justify-center rounded-full',
                  active ? 'bg-[color:var(--jaroo-primary-strong)]' : 'bg-[color:var(--jaroo-primary)]',
                )}
                style={{ boxShadow: '0 4px 14px rgba(24, 95, 165, 0.35)' }}
              >
                <Icon className='size-[22px] text-white' aria-hidden='true' />
              </span>
              <span className={cn(active ? 'font-semibold text-[#0F1419]' : 'text-[#97A0AE]')}>{item.label}</span>
            </Link>
          )
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 pt-[13px] text-[10px] transition',
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
