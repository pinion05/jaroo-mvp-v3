'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, LoaderCircle, RefreshCcw, ScanSearch } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { JarooShell } from '@/components/jaroo-shell'
import { SCREENSHOT_OCR_STORAGE_KEY, sanitizeOcrRows, type OcrRow, type ScreenshotUploadSession } from '@/lib/screenshot-ocr'
import { cn } from '@/lib/utils'

type OcrRequestState = 'idle' | 'loading' | 'success' | 'error'

const statusLabel: Record<OcrRequestState, string> = {
  idle: '대기 중',
  loading: '분석 중',
  success: '인식 완료',
  error: '재시도 필요',
}

export default function OcrPage() {
  const [session, setSession] = useState<ScreenshotUploadSession | null>(null)
  const [rows, setRows] = useState<OcrRow[]>([])
  const [requestState, setRequestState] = useState<OcrRequestState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const rawSession = sessionStorage.getItem(SCREENSHOT_OCR_STORAGE_KEY)

    if (!rawSession) {
      setRequestState('error')
      setErrorMessage('먼저 /screenshot 에서 분석할 스크린샷을 선택해주세요.')
      return
    }

    try {
      const parsed = JSON.parse(rawSession) as Partial<ScreenshotUploadSession>

      if (typeof parsed.fileName !== 'string' || typeof parsed.imageDataUrl !== 'string' || typeof parsed.broker !== 'string') {
        throw new Error('invalid session')
      }

      setSession({
        fileName: parsed.fileName,
        imageDataUrl: parsed.imageDataUrl,
        broker: parsed.broker,
      })
    } catch {
      setRequestState('error')
      setErrorMessage('업로드 정보가 손상되었어요. 다시 스크린샷을 선택해주세요.')
    }
  }, [])

  const runOcr = useCallback(async (currentSession: ScreenshotUploadSession) => {
    setRequestState('loading')
    setErrorMessage('')

    try {
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(currentSession),
      })

      const payload = (await response.json().catch(() => null)) as
        | {
            rows?: unknown
            error?: string
          }
        | null

      if (!response.ok) {
        throw new Error(payload?.error || 'OCR 요청에 실패했어요.')
      }

      const nextRows = sanitizeOcrRows(payload?.rows)
      setRows(nextRows)
      setRequestState('success')
    } catch (error) {
      setRows([])
      setRequestState('error')
      setErrorMessage(error instanceof Error ? error.message : 'OCR 분석 중 문제가 발생했어요.')
    }
  }, [])

  useEffect(() => {
    if (!session) {
      return
    }

    void runOcr(session)
  }, [runOcr, session])

  const summaryText = useMemo(() => {
    if (requestState === 'loading') {
      return '스크린샷에서 종목을 읽는 중이에요'
    }

    if (requestState === 'success') {
      return `${rows.length}개 종목 인식 완료`
    }

    if (requestState === 'error') {
      return '인식 결과를 불러오지 못했어요'
    }

    return '업로드된 스크린샷을 준비 중이에요'
  }, [requestState, rows.length])

  return (
    <JarooShell title='종목 확인' backHref='/screenshot' showBottomNav={false} mainClassName='space-y-3'>
      <p className='text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>인식된 종목을 확인한 뒤 다음 단계로 진행하세요</p>

      {session ? (
        <Card className='overflow-hidden rounded-[24px] border border-[color:var(--jaroo-border)] bg-white shadow-none'>
          <div className='flex items-center gap-3 border-b border-[color:var(--jaroo-border)] px-4 py-3'>
            <div className='relative size-14 overflow-hidden rounded-2xl border border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)]'>
              <Image src={session.imageDataUrl} alt={session.fileName} fill unoptimized className='object-cover' />
            </div>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{session.fileName}</p>
              <p className='mt-0.5 text-[11px] text-[color:var(--jaroo-muted)]'>{session.broker} 화면 분석</p>
            </div>
            <ScanSearch className='size-4 text-[color:var(--jaroo-primary)]' />
          </div>

          <div className='flex items-center justify-between gap-3 bg-[color:var(--jaroo-secondary)] px-4 py-3'>
            <div className='flex min-w-0 items-center gap-2'>
              <div
                className={cn(
                  'flex size-[18px] items-center justify-center rounded-full',
                  requestState === 'success' && 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
                  requestState === 'loading' && 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]',
                  requestState === 'error' && 'bg-[color:var(--jaroo-warning-soft)] text-[#854F0B]',
                  requestState === 'idle' && 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
                )}
              >
                {requestState === 'loading' ? (
                  <LoaderCircle className='size-3 animate-spin' strokeWidth={2.5} />
                ) : requestState === 'error' ? (
                  <AlertTriangle className='size-3' strokeWidth={2.5} />
                ) : (
                  <Check className='size-3' strokeWidth={2.5} />
                )}
              </div>
              <p className='truncate text-[12px] font-medium text-[color:var(--jaroo-ink)]'>{summaryText}</p>
            </div>
            <p
              className={cn(
                'shrink-0 text-[11px] font-medium',
                requestState === 'success' && 'text-[color:var(--jaroo-success)]',
                requestState === 'loading' && 'text-[color:var(--jaroo-primary)]',
                requestState === 'error' && 'text-[#854F0B]',
                requestState === 'idle' && 'text-[color:var(--jaroo-muted)]',
              )}
            >
              {statusLabel[requestState]}
            </p>
          </div>
        </Card>
      ) : null}

      <Card className='overflow-hidden rounded-[24px] border border-[color:var(--jaroo-border)] bg-white shadow-none'>
        <div className='grid grid-cols-[1.6fr_1fr_1fr] gap-2 border-b border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-4 py-3 text-[11px] font-medium text-[color:var(--jaroo-muted)]'>
          <p>종목명</p>
          <p className='text-right'>보유 수량</p>
          <p className='text-right'>수익률</p>
        </div>

        {requestState === 'loading' ? (
          <div className='flex flex-col items-center justify-center gap-3 px-4 py-10 text-center'>
            <LoaderCircle className='size-5 animate-spin text-[color:var(--jaroo-primary)]' />
            <div>
              <p className='text-[13px] font-medium text-[color:var(--jaroo-ink)]'>OCR 분석 중</p>
              <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>스크린샷에서 종목명, 보유 수량, 수익률을 추출하고 있어요.</p>
            </div>
          </div>
        ) : null}

        {requestState === 'success' && rows.length > 0 ? (
          <div>
            {rows.map((item, index) => {
              const isLast = index === rows.length - 1

              return (
                <div
                  key={`${item.name}-${item.quantity}-${item.profitRate}-${index}`}
                  className={cn('grid grid-cols-[1.6fr_1fr_1fr] gap-2 px-4 py-3', !isLast && 'border-b border-[color:var(--jaroo-border)]')}
                >
                  <p className='min-w-0 truncate text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{item.name || '-'}</p>
                  <p className='truncate text-right text-[12px] text-[color:var(--jaroo-ink)]'>{item.quantity || '-'}</p>
                  <p className='truncate text-right text-[12px] font-medium text-[color:var(--jaroo-primary)]'>{item.profitRate || '-'}</p>
                </div>
              )
            })}
          </div>
        ) : null}

        {requestState === 'success' && rows.length === 0 ? (
          <div className='px-4 py-8 text-center'>
            <p className='text-[13px] font-medium text-[color:var(--jaroo-ink)]'>인식된 종목이 없어요</p>
            <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>종목 목록이 보이도록 스크린샷을 다시 선택해보세요.</p>
          </div>
        ) : null}

        {requestState === 'error' ? (
          <div className='px-4 py-8 text-center'>
            <p className='text-[13px] font-medium text-[#854F0B]'>OCR 분석에 실패했어요</p>
            <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>{errorMessage}</p>
          </div>
        ) : null}
      </Card>

      {requestState === 'error' ? (
        <div className='flex items-start gap-2 rounded-[20px] border border-[#FAC775] bg-[color:var(--jaroo-warning-soft)] px-4 py-3 text-[#854F0B]'>
          <AlertTriangle className='mt-0.5 size-4 shrink-0' />
          <p className='text-[12px] leading-6'>세션 정보가 없거나 OCR 응답이 유효하지 않았어요. 다시 업로드한 뒤 재시도해주세요.</p>
        </div>
      ) : null}

      {requestState !== 'loading' && session ? (
        <Button
          type='button'
          variant='outline'
          onClick={() => void runOcr(session)}
          className='h-12 w-full rounded-[20px] border-[color:#B5D4F4] bg-[color:var(--jaroo-accent)] text-[13px] font-medium text-[color:var(--jaroo-primary)] shadow-none hover:bg-[#d9eafb]'
        >
          <span className='flex items-center gap-2'>
            <RefreshCcw className='size-4' />
            OCR 다시 시도하기
          </span>
        </Button>
      ) : null}

      <Link
        href='/screenshot'
        className='flex items-center justify-center gap-2 rounded-[20px] border border-[#B5D4F4] bg-[color:var(--jaroo-accent)] px-4 py-3 text-center text-[12px] font-medium text-[color:var(--jaroo-primary)] transition hover:bg-[#d9eafb]'
      >
        <ScanSearch className='size-4' />
        <span>스크린샷 다시 선택하기</span>
      </Link>

      <Link
        href='/merge'
        aria-disabled={requestState !== 'success' || rows.length === 0}
        className={buttonVariants({
          className: cn(
            'h-12 w-full rounded-[20px] bg-[color:var(--jaroo-primary)] text-[14px] font-medium text-white hover:bg-[color:var(--jaroo-primary-strong)]',
            (requestState !== 'success' || rows.length === 0) && 'pointer-events-none opacity-45',
          ),
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
