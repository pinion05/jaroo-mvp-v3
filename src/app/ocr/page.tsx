'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Check, Plus } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { JarooShell } from '@/components/jaroo-shell'
import { ocrStocks } from '@/lib/jaroo-data'
import { cn } from '@/lib/utils'

type FormState = Record<
  string,
  {
    shares: string
    average: string
  }
>

const defaultEditingId = ocrStocks.find((item) => item.defaultEditing)?.id ?? ocrStocks[0]?.id ?? ''

function formatWon(value: string) {
  const numericValue = Number(value.replaceAll(',', ''))

  if (Number.isNaN(numericValue)) {
    return value
  }

  return new Intl.NumberFormat('ko-KR').format(numericValue)
}

export default function OcrPage() {
  const [stocks, setStocks] = useState(ocrStocks)
  const [activeEditId, setActiveEditId] = useState(defaultEditingId)
  const [formState, setFormState] = useState<FormState>(() =>
    Object.fromEntries(
      ocrStocks.map((item) => [
        item.id,
        {
          shares: item.editValues.shares,
          average: item.editValues.average,
        },
      ]),
    ),
  )

  const activeStock = useMemo(() => stocks.find((item) => item.id === activeEditId) ?? null, [activeEditId, stocks])

  const handleFieldChange = (id: string, field: 'shares' | 'average', value: string) => {
    setFormState((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [field]: value,
      },
    }))
  }

  const handleEditToggle = (id: string) => {
    setActiveEditId((current) => (current === id ? defaultEditingId : id))
  }

  const handleCancel = () => {
    if (!activeStock) {
      return
    }

    setFormState((current) => ({
      ...current,
      [activeStock.id]: {
        shares: activeStock.editValues.shares,
        average: activeStock.editValues.average,
      },
    }))
    setActiveEditId(defaultEditingId)
  }

  const handleSave = () => {
    if (!activeStock) {
      return
    }

    const values = formState[activeStock.id]

    setStocks((current) =>
      current.map((item) =>
        item.id === activeStock.id
          ? {
              ...item,
              shares: `${values.shares}주`,
              average: `${formatWon(values.average)}원`,
              editValues: {
                shares: values.shares,
                average: values.average,
              },
            }
          : item,
      ),
    )
    setActiveEditId(defaultEditingId)
  }

  return (
    <JarooShell title='종목 확인' backHref='/screenshot' showBottomNav={false} mainClassName='space-y-3'>
      <p className='text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>인식된 종목을 확인하고 틀린 부분은 수정해주세요</p>

      <Card className='overflow-hidden rounded-[24px] border border-[color:var(--jaroo-border)] shadow-none'>
        <div className='flex items-center justify-between gap-3 border-b border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-4 py-3'>
          <div className='flex min-w-0 items-center gap-2'>
            <div className='flex size-[18px] items-center justify-center rounded-full bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]'>
              <Check className='size-3' strokeWidth={2.5} />
            </div>
            <p className='truncate text-[12px] font-medium text-[color:var(--jaroo-ink)]'>3개 종목 인식 완료</p>
          </div>
          <p className='shrink-0 text-[11px] font-medium text-[color:var(--jaroo-success)]'>인식률 높음</p>
        </div>

        <div>
          {stocks.map((item, index) => {
            const isEditing = activeEditId === item.id
            const isWarning = item.status === 'warning'
            const isLastVisibleRow = index === stocks.length - 1

            return (
              <div key={item.id}>
                <div
                  className={cn(
                    'flex items-center gap-3 px-4 py-3',
                    !isEditing && !isLastVisibleRow && 'border-b border-[color:var(--jaroo-border)]',
                    isEditing && 'border-b border-[color:#B5D4F4]',
                    isWarning && 'opacity-70',
                  )}
                >
                  <div className='min-w-0 flex-1'>
                    <p className={cn('text-[13px] font-medium text-[color:var(--jaroo-ink)]', isWarning && 'text-[#854F0B]')}>
                      {item.name}
                    </p>
                    <p className='mt-0.5 text-[11px] text-[color:var(--jaroo-muted)]'>{item.shares}</p>
                  </div>

                  <div className='text-right'>
                    <p className='text-[12px] font-medium text-[color:var(--jaroo-ink)]'>{item.price}</p>
                    <p className='mt-0.5 text-[10px] text-[color:var(--jaroo-muted)]'>평단 {item.average}</p>
                    <button
                      type='button'
                      onClick={() => handleEditToggle(item.id)}
                      className={cn(
                        'mt-1 text-[11px] font-medium',
                        isEditing ? 'text-[#9aa7b7]' : 'text-[color:var(--jaroo-primary)]',
                      )}
                    >
                      {isEditing ? '수정 중' : isWarning ? '확인 필요' : '수정'}
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <div className='border-b border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-accent)]/55 px-4 py-3'>
                    <p className='text-[11px] font-medium text-[color:var(--jaroo-primary)]'>{item.name} 정보 수정</p>

                    <div className='mt-3 flex gap-2'>
                      <div className='flex-1 space-y-1.5'>
                        <label className='text-[10px] text-[color:var(--jaroo-muted)]'>보유 수량</label>
                        <Input
                          type='number'
                          inputMode='numeric'
                          value={formState[item.id]?.shares ?? ''}
                          onChange={(event) => handleFieldChange(item.id, 'shares', event.target.value)}
                          className='h-10 rounded-xl border-[color:#B5D4F4] bg-white px-3 text-[13px] text-[color:var(--jaroo-ink)] shadow-none focus-visible:border-[color:var(--jaroo-primary)] focus-visible:ring-[color:var(--jaroo-primary)]/15'
                        />
                      </div>
                      <div className='flex-1 space-y-1.5'>
                        <label className='text-[10px] text-[color:var(--jaroo-muted)]'>평균 단가 (원)</label>
                        <Input
                          type='number'
                          inputMode='numeric'
                          value={formState[item.id]?.average ?? ''}
                          onChange={(event) => handleFieldChange(item.id, 'average', event.target.value)}
                          className='h-10 rounded-xl border-[color:#B5D4F4] bg-white px-3 text-[13px] text-[color:var(--jaroo-ink)] shadow-none focus-visible:border-[color:var(--jaroo-primary)] focus-visible:ring-[color:var(--jaroo-primary)]/15'
                        />
                      </div>
                    </div>

                    <div className='mt-3 flex gap-2'>
                      <Button
                        type='button'
                        variant='outline'
                        onClick={handleCancel}
                        className='h-10 flex-1 rounded-xl border-[color:var(--jaroo-border)] bg-white text-[12px] text-[color:var(--jaroo-muted)] hover:bg-[color:var(--jaroo-secondary)]'
                      >
                        취소
                      </Button>
                      <Button
                        type='button'
                        onClick={handleSave}
                        className='h-10 flex-1 rounded-xl bg-[color:var(--jaroo-primary)] text-[12px] font-medium text-white hover:bg-[color:var(--jaroo-primary-strong)]'
                      >
                        저장
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      <div className='flex items-start gap-2 rounded-[20px] border border-[#FAC775] bg-[color:var(--jaroo-warning-soft)] px-4 py-3 text-[#854F0B]'>
        <AlertTriangle className='mt-0.5 size-4 shrink-0' />
        <p className='text-[12px] leading-6'>SK오션플랜트 종목명을 정확히 읽지 못했어요. 확인 후 수정해주세요.</p>
      </div>

      <Link
        href='/screenshot'
        className='flex items-center justify-center gap-2 rounded-[20px] border border-[#B5D4F4] bg-[color:var(--jaroo-accent)] px-4 py-3 text-center text-[12px] font-medium text-[color:var(--jaroo-primary)] transition hover:bg-[#d9eafb]'
      >
        <Plus className='size-4' />
        <span>스크린샷 추가 (다른 계좌 있으면)</span>
      </Link>

      <Link
        href='/merge'
        className={buttonVariants({
          className:
            'h-12 w-full rounded-[20px] bg-[color:var(--jaroo-primary)] text-[14px] font-medium text-white hover:bg-[color:var(--jaroo-primary-strong)]',
        })}
      >
        <span className='flex items-center gap-2'>
          <ArrowRight className='size-4' />
          분석 시작하기
        </span>
      </Link>

      <p className='text-center text-[10px] text-[#b8c0cb]'>개인정보는 분석 후 즉시 안전하게 파기됩니다</p>
    </JarooShell>
  )
}
