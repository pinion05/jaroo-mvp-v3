'use client'

import { useEffect, useMemo } from 'react'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { JarooShell } from '@/components/jaroo-shell'
import { buildHomeCurrentQuoteQuery } from '@/lib/home-current-quotes'
import { hydratePortfolioItemsWithCurrentQuotes } from '@/lib/home-quote-bootstrap'
import { buildHomeHoldingsFromPortfolioItems, persistAppliedHomePortfolio, type AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'
import { computeAveragePrice } from '@/lib/screenshot-ocr'
import { useMergeStore } from '@/lib/stores/use-merge-store'
import { useOcrReviewStore } from '@/lib/stores/use-ocr-review-store'
import { usePortfolioStore } from '@/lib/stores/use-portfolio-store'
import {
  createMergeRowId,
  getApplicableConfirmedHoldings,
  toConfirmedHolding,
  toPortfolioNormalizedItem,
  type ConfirmedHolding,
  type MergeRow,
  type OcrReviewRow,
} from '@/lib/workflow-types'
import { cn } from '@/lib/utils'

function isMissingAveragePrice(value: string) {
  const normalizedValue = value.replace(/[−–—]/g, '-').trim()

  if (!normalizedValue) {
    return true
  }

  if (/^-+$/.test(normalizedValue)) {
    return true
  }

  return normalizedValue.toLowerCase().replace(/[./\s]/g, '') === 'na'
}

export function prepareMergeRowsForApply<T extends { averagePrice: string; quantity: string; profitRate: string; evaluationAmount: string }>(rows: T[]) {
  return rows.map((row) => {
    if (!isMissingAveragePrice(row.averagePrice)) {
      return { ...row }
    }

    return {
      ...row,
      averagePrice: computeAveragePrice(row.quantity, row.profitRate, row.evaluationAmount),
    }
  })
}

export function buildMergeRowsFromReviewRows(rows: OcrReviewRow[]): MergeRow[] {
  return rows.map((row) => {
    const preparedReviewRow = {
      ...row,
      averagePrice: isMissingAveragePrice(row.averagePrice)
        ? computeAveragePrice(row.quantity, row.profitRate, row.evaluationAmount)
        : row.averagePrice,
    }
    const confirmedHolding = toConfirmedHolding(preparedReviewRow)
    const mergeRow: MergeRow = {
      id: createMergeRowId(row.id, confirmedHolding.displayName),
      sourceRowId: row.id,
      status: 'ready',
      ...confirmedHolding,
    }

    if (row.resolutionState !== 'resolved') {
      return {
        ...mergeRow,
        status: 'error',
        errorCode: 'merge-upstream-review-incomplete',
        errorMessage: '이 행은 OCR 검수에서 아직 확정되지 않았어요. /ocr 로 돌아가 다시 확인해주세요.',
      }
    }

    if (!toPortfolioNormalizedItem(confirmedHolding)) {
      return {
        ...mergeRow,
        status: 'error',
        errorCode: 'merge-normalization-failed',
        errorMessage: '이 행은 홈 포트폴리오 형식으로 변환할 수 없어요. /ocr 로 돌아가 값을 다시 확인해주세요.',
      }
    }

    return mergeRow
  })
}

export function buildAppliedHomePortfolioRowsFromConfirmedHoldings(holdings: ConfirmedHolding[]): AppliedHomePortfolioRow[] {
  return holdings.map((holding) => ({
    name: holding.displayName,
    quantity: holding.quantityText,
    averagePrice: holding.averagePriceText,
    averagePriceCurrency: holding.averagePriceCurrency ?? (holding.marketTone === 'nasdaq' ? 'USD' : 'KRW'),
    code: holding.code,
    ticker: holding.ticker,
    resolvedName: holding.displayName,
    resolvedCode: holding.code,
    resolvedTicker: holding.ticker,
    resolvedMarket: holding.market,
    resolvedMarketTone: holding.marketTone,
    resolvedKind: holding.kind,
  }))
}

function MergeMetricChip({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className='rounded-[14px] bg-[color:var(--jaroo-secondary)] px-3 py-2'>
      <p className='text-[10px] text-[color:var(--jaroo-muted)]'>{label}</p>
      <p className={cn('mt-1 truncate text-[12px] font-semibold text-[color:var(--jaroo-ink)]', valueClassName)}>{value || '-'}</p>
    </div>
  )
}

export function MergeResultRowCard({ row, isLast }: { row: MergeRow; isLast: boolean }) {
  const resolvedIdentifier = [row.ticker, row.code].filter(Boolean).join(' · ')
  const resolvedMeta = [row.market, resolvedIdentifier].filter(Boolean).join(' · ')

  return (
    <div className={cn('px-4 py-3', !isLast && 'border-b border-[color:var(--jaroo-border)]')}>
      <div>
        <p className='truncate text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{row.displayName || '-'}</p>
        {resolvedMeta ? <p className='mt-1 truncate text-[10px] text-[color:var(--jaroo-muted)]'>{resolvedMeta}</p> : null}
      </div>

      <div className='mt-3 grid grid-cols-2 gap-2'>
        <MergeMetricChip label='보유 수량' value={row.quantityText} />
        <MergeMetricChip label='평가 금액' value={row.evaluationAmountText} />
        <MergeMetricChip label='평균 단가' value={row.averagePriceText} />
        <MergeMetricChip label='수익률' value={row.profitRateText} valueClassName='text-[color:var(--jaroo-primary)]' />
      </div>

      {row.status === 'error' ? (
        <div className='mt-3 rounded-[16px] border border-[#F5D185] bg-[#FFF8E8] px-3 py-2'>
          <div className='flex items-start gap-2'>
            <AlertTriangle className='mt-0.5 size-4 shrink-0 text-[#854F0B]' />
            <div className='min-w-0'>
              <p className='text-[11px] font-semibold text-[#854F0B]'>이 행은 적용에서 제외돼요</p>
              <p className='mt-1 text-[10px] leading-5 text-[#8A6520]'>{row.errorMessage || '/ocr 로 돌아가 이 종목을 다시 확인해주세요.'}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function JarooMergeScreen() {
  const router = useRouter()
  const reviewRows = useOcrReviewStore((state) => state.rows)
  const mergeRows = useMergeStore((state) => state.rows)
  const setMergeRows = useMergeStore((state) => state.setRows)
  const applyStatus = useMergeStore((state) => state.applyStatus)
  const applyError = useMergeStore((state) => state.errorMessage ?? '')
  const setApplyStatus = useMergeStore((state) => state.setApplyStatus)
  const markApplied = useMergeStore((state) => state.markApplied)
  const resetMergeState = useMergeStore((state) => state.resetForBackNav)
  const replacePortfolioItems = usePortfolioStore((state) => state.replaceItems)
  const setQuoteStatus = usePortfolioStore((state) => state.setQuoteStatus)

  useEffect(() => {
    if (mergeRows.length > 0) {
      return
    }

    if (reviewRows.length === 0) {
      router.replace('/ocr')
      return
    }

    setMergeRows(buildMergeRowsFromReviewRows(reviewRows))
  }, [mergeRows.length, reviewRows, router, setMergeRows])

  const applicableHoldings = useMemo(() => getApplicableConfirmedHoldings(mergeRows), [mergeRows])
  const normalizedItems = useMemo(
    () => applicableHoldings.map((holding) => toPortfolioNormalizedItem(holding)).filter((item): item is NonNullable<typeof item> => item !== null),
    [applicableHoldings],
  )
  const hasErrorRows = useMemo(() => mergeRows.some((row) => row.status === 'error'), [mergeRows])
  const applyButtonLabel = useMemo(() => {
    if (applyStatus === 'loading') {
      return '포트폴리오 적용 중...'
    }

    if (normalizedItems.length === 0) {
      return '적용 가능한 종목이 없어요'
    }

    return hasErrorRows
      ? `정상 종목 ${normalizedItems.length}개만 적용하기`
      : '포트폴리오에 적용하기'
  }, [applyStatus, hasErrorRows, normalizedItems.length])

  const handleBackToOcr = () => {
    resetMergeState()
    router.push('/ocr')
  }

  const handleApply = () => {
    if (applyStatus === 'loading') {
      return
    }

    if (normalizedItems.length === 0) {
      setApplyStatus('error', '적용 가능한 종목이 없어요. /ocr 로 돌아가 값을 다시 확인해주세요.')
      return
    }

    setApplyStatus('loading')

    try {
      const appliedAt = new Date().toISOString()
      const persisted = persistAppliedHomePortfolio({
        broker: 'OCR 적용 포트폴리오',
        rows: buildAppliedHomePortfolioRowsFromConfirmedHoldings(applicableHoldings),
        appliedAt,
      })

      if (!persisted) {
        throw new Error('홈 포트폴리오 저장에 실패했어요.')
      }

      const nextQuoteQuery = buildHomeCurrentQuoteQuery(buildHomeHoldingsFromPortfolioItems(normalizedItems))
      replacePortfolioItems(normalizedItems)
      setQuoteStatus('loading', null, nextQuoteQuery)
      void hydratePortfolioItemsWithCurrentQuotes(normalizedItems)
        .then((result) => {
          replacePortfolioItems(result.items)
          setQuoteStatus(result.quoteStatus, result.quoteErrorMessage, result.quoteQuery)
        })
        .catch(() => {
          setQuoteStatus('error', '현재 시세를 불러오지 못했어요. 다시 시도해주세요.', null)
        })
      markApplied(appliedAt)
      router.push('/home')
    } catch (error) {
      setApplyStatus('error', error instanceof Error ? error.message : '포트폴리오 저장에 실패했어요.')
    }
  }

  if (mergeRows.length === 0 && reviewRows.length === 0) {
    return null
  }

  return (
    <JarooShell
      title='종목 병합 확인'
      showBottomNav={false}
      mainClassName='space-y-3 px-3 py-3'
      leading={(
        <button
          type='button'
          onClick={handleBackToOcr}
          className='flex size-9 items-center justify-center rounded-full bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-ink)] transition hover:bg-[color:var(--jaroo-accent)]'
        >
          <ArrowLeft className='size-4' />
        </button>
      )}
    >
      <Card className='rounded-[20px] border-0 bg-[color:var(--jaroo-accent)] px-4 py-3 shadow-none'>
        <p className='text-[13px] font-medium text-[color:var(--jaroo-primary-strong)]'>OCR 검수 결과 {mergeRows.length}개 종목을 병합 대기 중이에요</p>
        <p className='mt-1 text-[12px] leading-6 text-[color:var(--jaroo-primary)]'>정상 행만 홈 포트폴리오에 반영돼요. 제외된 행은 카드 안 안내를 보고 /ocr 에서 다시 확인해주세요.</p>
      </Card>

      <section className='space-y-2'>
        <p className='px-1 text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>병합 예정 결과</p>
        <Card className='overflow-hidden rounded-[20px] border border-[color:var(--jaroo-border)] shadow-none'>
          <div className='border-b border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-4 py-3'>
            <p className='text-[11px] font-medium text-[color:var(--jaroo-muted)]'>종목명, 식별자, 보유 수량, 수익률, 평가 금액, 평균 단가를 함께 확인해요.</p>
          </div>
          {mergeRows.map((row, index) => (
            <MergeResultRowCard key={row.id} row={row} isLast={index === mergeRows.length - 1} />
          ))}
        </Card>
      </section>

      <div className='space-y-2 pt-1'>
        <button
          type='button'
          onClick={handleApply}
          disabled={applyStatus === 'loading' || normalizedItems.length === 0}
          className={buttonVariants({
            className:
              'h-12 w-full rounded-[20px] bg-[color:var(--jaroo-primary)] text-[14px] font-medium text-white hover:bg-[color:var(--jaroo-primary-strong)] disabled:pointer-events-none disabled:opacity-60',
          })}
        >
          {applyButtonLabel}
        </button>
        <button
          type='button'
          onClick={handleBackToOcr}
          className={buttonVariants({
            variant: 'outline',
            className:
              'h-12 w-full rounded-[20px] border-[color:var(--jaroo-border)] bg-white text-[13px] font-normal text-[#555] hover:bg-white',
          })}
        >
          /ocr 로 돌아가기
        </button>
        {applyError ? <p className='text-[11px] text-[#D54841]'>{applyError}</p> : null}
      </div>
    </JarooShell>
  )
}
