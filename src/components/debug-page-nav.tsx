'use client'

import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Camera,
  FileText,
  GitMerge,
  House,
  LayoutGrid,
  ScanSearch,
  ShieldCheck,
  UserRound,
} from 'lucide-react'

import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

const navItems: NavItem[] = [
  { href: '/home', label: '홈', icon: House },
  { href: '/deepscan', label: '딥스캔', icon: ScanSearch },
  { href: '/ocr', label: 'OCR', icon: FileText },
  { href: '/screenshot', label: '스크린샷', icon: Camera },
  { href: '/merge', label: '병합', icon: GitMerge },
  { href: '/sharecard', label: '공유카드', icon: LayoutGrid },
  { href: '/etf', label: 'ETF', icon: ShieldCheck },
  { href: '/mypage', label: '마이', icon: UserRound },
]

export function DebugPageNav() {
  const pathname = usePathname()
  const [canShowDebugNav, setCanShowDebugNav] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)')
    const updateVisibility = () => {
      setCanShowDebugNav(query.matches)
    }

    updateVisibility()
    query.addEventListener('change', updateVisibility)

    return () => {
      query.removeEventListener('change', updateVisibility)
    }
  }, [])

  if (!canShowDebugNav) {
    return null
  }

  if (pathname === '/screenshot' || pathname === '/ocr') {
    return null
  }

  return (
    <aside className='fixed top-1/2 left-4 z-50 hidden -translate-y-1/2 lg:block'>
      <div className='flex w-22 flex-col gap-2 rounded-3xl border border-white/70 bg-white/92 p-3 shadow-[0_18px_48px_rgba(15,23,40,0.16)] backdrop-blur'>
        <div className='px-1 pb-1 text-[11px] font-semibold tracking-[-0.01em] text-[color:var(--jaroo-muted)]'>
          DEBUG NAV
        </div>
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition',
                isActive
                  ? 'bg-[color:var(--jaroo-primary)] text-white shadow-[0_10px_24px_rgba(24,95,165,0.3)]'
                  : 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-ink)] hover:bg-[color:var(--jaroo-accent)]',
              )}
            >
              <Icon className='size-4' />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </aside>
  )
}
