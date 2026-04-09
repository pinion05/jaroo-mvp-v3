'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { JarooShell } from '@/components/jaroo-shell'
import { mergeStocks, newStocks, type MergeChoiceId } from '@/lib/jaroo-data'
import { cn } from '@/lib/utils'

const defaultSelections = Object.fromEntries(mergeStocks.map((item) => [item.id, item.defaultChoice])) as Record<string, MergeChoiceId>

export default function MergePage() {
  const [selectedOptions, setSelectedOptions] = useState<Record<string, MergeChoiceId>>(defaultSelections)

  return (
    <JarooShell title='종목 병합 확인' backHref='/ocr' showBottomNav={false} mainClassName='space-y-3 px-3 py-3'>
      <Card className='rounded-[20px] border-0 bg-[color:var(--jaroo-accent)] px-4 py-3 shadow-none'>
        <p className='text-[13px] font-medium text-[color:var(--jaroo-primary-strong)]'>새 스크린샷에서 4개 종목을 읽었어요</p>
        <p className='mt-1 text-[12px] leading-6 text-[color:var(--jaroo-primary)]'>기존 종목과 겹치는 경우 어떻게 처리할지 선택해주세요. 새로운 종목은 자동으로 추가돼요.</p>
      </Card>

      <section className='space-y-2'>
        <p className='px-1 text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>기존 종목과 겹쳐요</p>
        <Card className='overflow-hidden rounded-[20px] border border-[color:var(--jaroo-border)] shadow-none'>
          {mergeStocks.map((item, itemIndex) => {
            const selectedChoice = selectedOptions[item.id]

            return (
              <div
                key={item.id}
                className={cn('px-4 py-4', itemIndex < mergeStocks.length - 1 && 'border-b border-[color:var(--jaroo-border)]')}
              >
                <div className='flex items-center gap-2'>
                  <p className='text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{item.name}</p>
                  <Badge className='rounded-md bg-[color:var(--jaroo-warning-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--jaroo-warning)] hover:bg-[color:var(--jaroo-warning-soft)]'>
                    {item.badge}
                  </Badge>
                </div>

                <div className='mt-3 flex gap-2'>
                  {item.options.map((option) => {
                    const isSelected = selectedChoice === option.id

                    return (
                      <button
                        key={option.id}
                        type='button'
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSelectedOptions((current) => ({
                            ...current,
                            [item.id]: option.id,
                          }))
                        }}
                        className={cn(
                          'flex-1 rounded-[16px] border px-3 py-3 text-left transition-colors',
                          isSelected
                            ? 'border-[color:var(--jaroo-primary)] bg-[color:var(--jaroo-accent)]'
                            : 'border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] hover:bg-[color:var(--jaroo-secondary)]',
                        )}
                      >
                        <span
                          className={cn(
                            'block text-[12px] font-medium',
                            isSelected ? 'text-[color:var(--jaroo-primary)]' : 'text-[color:var(--jaroo-ink)]',
                          )}
                        >
                          {option.label}
                        </span>
                        <span className='mt-1 block text-[10px] leading-5 text-[color:var(--jaroo-muted)]'>
                          {option.lines.map((line) => (
                            <span key={line} className='block'>
                              {line}
                            </span>
                          ))}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </Card>
      </section>

      <section className='space-y-2'>
        <p className='px-1 text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>새로 추가돼요</p>
        <Card className='overflow-hidden rounded-[20px] border border-[color:var(--jaroo-border)] shadow-none'>
          {newStocks.map((item, index) => (
            <div
              key={item.name}
              className={cn(
                'flex items-center justify-between gap-3 px-4 py-3',
                index < newStocks.length - 1 && 'border-b border-[color:var(--jaroo-border)]',
              )}
            >
              <div className='min-w-0 flex-1'>
                <p className='text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{item.name}</p>
                <p className='mt-0.5 text-[11px] text-[color:var(--jaroo-muted)]'>{item.detail}</p>
              </div>
              <Badge className='shrink-0 rounded-md bg-[color:var(--jaroo-success-soft)] px-2.5 py-1 text-[10px] font-medium text-[color:var(--jaroo-success)] hover:bg-[color:var(--jaroo-success-soft)]'>
                {item.badge}
              </Badge>
            </div>
          ))}
        </Card>
      </section>

      <div className='space-y-2 pt-1'>
        <Link
          href='/home'
          className={buttonVariants({
            className:
              'h-12 w-full rounded-[20px] bg-[color:var(--jaroo-primary)] text-[14px] font-medium text-white hover:bg-[color:var(--jaroo-primary-strong)]',
          })}
        >
          포트폴리오에 적용하기
        </Link>
        <Link
          href='/ocr'
          className={buttonVariants({
            variant: 'outline',
            className:
              'h-12 w-full rounded-[20px] border-[color:var(--jaroo-border)] bg-white text-[13px] font-normal text-[#555] hover:bg-white',
          })}
        >
          취소
        </Link>
      </div>
    </JarooShell>
  )
}
