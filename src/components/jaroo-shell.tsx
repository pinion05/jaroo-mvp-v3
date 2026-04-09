'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ArrowLeft, FilePlus2, ScanSearch, GitMerge, House, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/screenshot', label: '추가', icon: FilePlus2 },
  { href: '/ocr', label: '검수', icon: ScanSearch },
  { href: '/merge', label: '병합', icon: GitMerge },
  { href: '/home', label: '홈', icon: House },
  { href: '/mypage', label: '마이', icon: UserRound },
]

export function JarooShell({
  title,
  subtitle,
  children,
  backHref,
  action,
  showBottomNav = true,
  leading,
  bottomNav,
  mainClassName,
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  backHref?: string
  action?: ReactNode
  showBottomNav?: boolean
  leading?: ReactNode | null
  bottomNav?: ReactNode
  mainClassName?: string
}) {
  const pathname = usePathname()

  return (
    <div className='min-h-screen bg-[color:var(--jaroo-canvas)] px-3 py-4 text-foreground sm:px-6'>
      <div className='relative mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[390px] flex-col overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-[0_20px_60px_rgba(12,68,124,0.18)]'>
        <header className='sticky top-0 z-20 border-b border-[color:var(--jaroo-border)] bg-white/95 px-4 py-3 backdrop-blur'>
          <div className='flex items-center gap-3'>
            {leading !== undefined ? (
              leading ? <div className='shrink-0'>{leading}</div> : null
            ) : backHref ? (
              <Link
                href={backHref}
                className='flex size-9 items-center justify-center rounded-full bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-ink)] transition hover:bg-[color:var(--jaroo-accent)]'
              >
                <ArrowLeft className='size-4' />
              </Link>
            ) : (
              <div className='flex size-9 items-center justify-center rounded-full bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]'>
                J
              </div>
            )}
            <div className='min-w-0 flex-1'>
              <div className='truncate text-sm font-semibold text-[color:var(--jaroo-ink)]'>{title}</div>
              {subtitle ? <div className='truncate text-xs text-[color:var(--jaroo-muted)]'>{subtitle}</div> : null}
            </div>
            {action ? <div className='shrink-0'>{action}</div> : null}
          </div>
        </header>

        <main
          data-slot='jaroo-shell-main'
          className={cn('flex-1 space-y-4 overflow-y-auto px-4 py-4', showBottomNav ? 'pb-24' : 'pb-6', mainClassName)}
        >
          {children}
        </main>

        {showBottomNav ? (
          bottomNav ?? (
            <nav className='sticky bottom-0 z-20 grid grid-cols-5 border-t border-[color:var(--jaroo-border)] bg-white/95 px-2 py-2 backdrop-blur'>
              {navItems.map((item) => {
                const Icon = item.icon
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition',
                      active
                        ? 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]'
                        : 'text-[color:var(--jaroo-muted)] hover:bg-[color:var(--jaroo-secondary)]',
                    )}
                  >
                    <Icon className={cn('size-4', active && 'text-[color:var(--jaroo-primary)]')} />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </nav>
          )
        ) : null}
      </div>
    </div>
  )
}
