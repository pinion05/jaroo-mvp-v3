'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppBottomNav } from '@/components/app-bottom-nav'

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
  frameClassName,
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
  frameClassName?: string
}) {
  return (
    <div className='min-h-screen min-h-dvh bg-white text-foreground sm:bg-[color:var(--jaroo-canvas)] sm:px-6 sm:py-4'>
      <div className={cn('relative mx-auto flex min-h-screen min-h-dvh w-full flex-col overflow-hidden bg-white sm:min-h-[calc(100vh-2rem)] sm:max-w-[390px] sm:rounded-[32px] sm:border sm:border-white/70 sm:shadow-[0_20px_60px_rgba(12,68,124,0.18)]', frameClassName)}>
        <header className='sticky top-0 z-20 border-b border-[color:var(--jaroo-border)] bg-white/95 px-4 py-3 backdrop-blur'>
          <div className='flex items-center gap-3'>
            {leading !== undefined ? (
              leading ? <div className='shrink-0'>{leading}</div> : null
            ) : backHref ? (
              <Link
                href={backHref}
                className='flex size-9 items-center justify-center rounded-full bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-ink)] transition hover:bg-[color:var(--jaroo-accent)]'
                aria-label='뒤로 가기'
              >
                <ArrowLeft className='size-4' aria-hidden='true' />
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
          bottomNav ?? <AppBottomNav />
        ) : null}
      </div>
    </div>
  )
}
