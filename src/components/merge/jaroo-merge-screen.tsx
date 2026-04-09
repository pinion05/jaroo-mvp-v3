'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { JarooShell } from '@/components/jaroo-shell'
import { mergeStocks, newStocks, type MergeChoiceId } from '@/lib/jaroo-data'
import { persistAppliedHomePortfolio } from '@/lib/jaroo-home-data'
import { OCR_MERGE_RESULT_STORAGE_KEY, sanitizeOcrRows, type OcrRow } from '@/lib/screenshot-ocr'
import { cn } from '@/lib/utils'

const defaultSelections = Object.fromEntries(mergeStocks.map((item) => [item.id, item.defaultChoice])) as Record<string, MergeChoiceId>

type MergeResultRow = OcrRow & {
  fileName: string
}

type MergeResultSession = {
  broker: string
  rows: MergeResultRow[]
}

function MergeMetricChip({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className='rounded-[14px] bg-[color:var(--jaroo-secondary)] px-3 py-2'>
      <p className='text-[10px] text-[color:var(--jaroo-muted)]'>{label}</p>
      <p className={cn('mt-1 truncate text-[12px] font-semibold text-[color:var(--jaroo-ink)]', valueClassName)}>{value || '-'}</p>
    </div>
  )
}

function MergeResultRowCard({ row, isLast }: { row: MergeResultRow; isLast: boolean }) {
  return (
    <div className={cn('px-4 py-3', !isLast && 'border-b border-[color:var(--jaroo-border)]')}>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='truncate text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{row.name || '-'}</p>
          {row.fileName ? <p className='mt-0.5 truncate text-[10px] text-[color:var(--jaroo-muted)]'>{row.fileName}</p> : null}
        </div>
        <p className='shrink-0 text-[11px] font-medium text-[color:var(--jaroo-primary)]'>{row.profitRate || '-'}</p>
      </div>

      <div className='mt-3 grid grid-cols-2 gap-2'>
        <MergeMetricChip label='보유 수량' value={row.quantity} />
        <MergeMetricChip label='평가 금액' value={row.evaluationAmount} />
        <MergeMetricChip label='평균 단가' value={row.averagePrice} />
        <MergeMetricChip label='수익률' value={row.profitRate} valueClassName='text-[color:var(--jaroo-primary)]' />
      </div>
    </div>
  )
}

function readMergeResultSession(): MergeResultSession | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.sessionStorage.getItem(OCR_MERGE_RESULT_STORAGE_KEY)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<MergeResultSession>

    if (typeof parsed.broker !== 'string' || !Array.isArray(parsed.rows)) {
      return null
    }

    const rows = parsed.rows
      .map((item) => {
        const sanitizedRow = sanitizeOcrRows([
          {
            name: typeof item?.name === 'string' ? item.name : '',
            quantity: typeof item?.quantity === 'string' ? item.quantity : '',
            profitRate: typeof item?.profitRate === 'string' ? item.profitRate : '',
            evaluationAmount: typeof item?.evaluationAmount === 'string' ? item.evaluationAmount : '',
          },
        ])[0]

        if (!sanitizedRow) {
          return null
        }

        return {
          ...sanitizedRow,
          fileName: typeof item?.fileName === 'string' ? item.fileName : '',
        }
      })
      .filter((item): item is MergeResultRow => item !== null)

    return {
      broker: parsed.broker,
      rows,
    }
  } catch {
    return null
  }
}

export default function JarooMergeScreen() {
  const router = useRouter()
  const [selectedOptions, setSelectedOptions] = useState<Record<string, MergeChoiceId>>(defaultSelections)
  const [mergeResult] = useState<MergeResultSession | null>(() => readMergeResultSession())

  return (
    <JarooShell title='종목 병합 확인' backHref='/screenshot' showBottomNav={false} mainClassName='space-y-3 px-3 py-3'>
      <Card className='rounded-[20px] border-0 bg-[color:var(--jaroo-accent)] px-4 py-3 shadow-none'>
        <p className='text-[13px] font-medium text-[color:var(--jaroo-primary-strong)]'>
          {mergeResult ? `${mergeResult.broker} 화면에서 ${mergeResult.rows.length}개 종목을 확정했어요` : '새 스크린샷에서 4개 종목을 읽었어요'}
        </p>
        <p className='mt-1 text-[12px] leading-6 text-[color:var(--jaroo-primary)]'>
          {mergeResult
            ? 'OCR에서 확정한 최종 종목 목록이에요. 이후 병합 단계에 연결하기 전 확인용으로 보여줘요.'
            : '기존 종목과 겹치는 경우 어떻게 처리할지 선택해주세요. 새로운 종목은 자동으로 추가돼요.'}
        </p>
      </Card>

      {mergeResult ? (
        <section className='space-y-2'>
          <p className='px-1 text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>OCR 확정 결과</p>
          <Card className='overflow-hidden rounded-[20px] border border-[color:var(--jaroo-border)] shadow-none'>
            <div className='border-b border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-4 py-3'>
              <p className='text-[11px] font-medium text-[color:var(--jaroo-muted)]'>종목명, 보유 수량, 수익률, 평가 금액, 평균 단가를 함께 보여줘요</p>
            </div>
            {mergeResult.rows.map((row, index) => (
              <MergeResultRowCard
                key={`${row.name}-${row.quantity}-${row.profitRate}-${row.evaluationAmount}-${index}`}
                row={row}
                isLast={index === mergeResult.rows.length - 1}
              />
            ))}
          </Card>
        </section>
      ) : (
        <>
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
        </>
      )}

      <div className='space-y-2 pt-1'>
        <button
          type='button'
          onClick={() => {
            if (mergeResult) {
              persistAppliedHomePortfolio({
                broker: mergeResult.broker,
                rows: mergeResult.rows,
              })
            }

            router.push('/home')
          }}
          className={buttonVariants({
            className:
              'h-12 w-full rounded-[20px] bg-[color:var(--jaroo-primary)] text-[14px] font-medium text-white hover:bg-[color:var(--jaroo-primary-strong)]',
          })}
        >
          포트폴리오에 적용하기
        </button>
        <Link
          href='/screenshot'
          className={buttonVariants({
            variant: 'outline',
            className:
              'h-12 w-full rounded-[20px] border-[color:var(--jaroo-border)] bg-white text-[13px] font-normal text-[#555] hover:bg-white',
          })}
        >
          다시 업로드하기
        </Link>
      </div>
    </JarooShell>
  )
}
