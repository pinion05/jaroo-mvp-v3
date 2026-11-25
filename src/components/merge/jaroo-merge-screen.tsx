'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { PortfolioOverlapChoices } from '@/components/ocr/portfolio-overlap-choices'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { JarooShell } from '@/components/jaroo-shell'
import { buildHomeCurrentQuoteQuery } from '@/lib/home-current-quotes'
import { hydratePortfolioItemsWithCurrentQuotes } from '@/lib/home-quote-bootstrap'
import { getFinancialValueTextClass } from '@/lib/financial-value-tone'
import {
  buildAppliedHomePortfolioRowsFromConfirmedHoldings,
  buildMergeRowsFromReviewRows,
  fillMissingAveragePricesFromQuotes,
  markMissingAveragePriceErrors,
  persistMergedAppliedPortfolio,
} from '@/lib/ocr-portfolio-apply'
import { buildHomeHoldingsFromPortfolioItems } from '@/lib/jaroo-home-data'
import {
  exceedsPortfolioRowLimit,
  planPortfolioMerge,
  type ExistingPortfolioResolution,
  type PortfolioOverlapChoice,
} from '@/lib/portfolio-merge'
import { resolveExistingPortfolioForMerge, syncMergedPortfolioAfterApply } from '@/lib/portfolio-sync'
import { MAX_PORTFOLIO_ROWS } from '@/lib/portfolio-validation'
import { clearPersistedScreenshotUploadSession } from '@/lib/screenshot-ocr'
import { useMergeStore } from '@/lib/stores/use-merge-store'
import { useOcrReviewStore } from '@/lib/stores/use-ocr-review-store'
import { useOcrUploadStore } from '@/lib/stores/use-ocr-upload-store'
import { usePortfolioStore } from '@/lib/stores/use-portfolio-store'
import {
  getApplicableConfirmedHoldings,
  toPortfolioNormalizedItem,
  type MergeRow,
} from '@/lib/workflow-types'
import { cn } from '@/lib/utils'

// 적용 후 홈 이동 전 시세 프리페치 상한 — OCR 적용 흐름과 같은 값(2026-10-29).
const MERGE_APPLY_QUOTE_PREFETCH_CAP_MS = 2_500

// 저장 API 의 종목 상한(portfolio-validation). 병합 결과가 이보다 크면 저장이 통째로 거절되므로 적용 전에 막는다.
const PORTFOLIO_ROW_LIMIT_MESSAGE = `포트폴리오는 최대 ${MAX_PORTFOLIO_ROWS}개 종목까지예요. 기존 종목을 정리한 뒤 다시 시도해주세요.`

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
        <MergeMetricChip label='수익률' value={row.profitRateText} valueClassName={getFinancialValueTextClass(row.profitRateText)} />
      </div>

      {row.status === 'error' ? (
        <div className='mt-3 rounded-[16px] border border-[#F5D185] bg-[#FFF8E8] px-3 py-2'>
          <div className='flex items-start gap-2'>
            <AlertTriangle className='mt-0.5 size-4 shrink-0 text-[#854F0B]' />
            <div className='min-w-0'>
              <p className='text-[11px] font-semibold text-[#854F0B]'>이 행은 적용에서 제외돼요</p>
              <p className='mt-1 text-[10px] leading-5 text-[#8A6520]'>{row.errorMessage || '종목 확인으로 돌아가 이 종목을 다시 확인해주세요.'}</p>
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
  // 재적용 병합: 기존 포트폴리오(null = 아직 못 읽음)와 겹치는 종목별 처리 선택(종목 키 → 갱신/합산/유지).
  const [existingPortfolio, setExistingPortfolio] = useState<ExistingPortfolioResolution | null>(null)
  const [overlapChoices, setOverlapChoices] = useState<Record<string, PortfolioOverlapChoice>>({})

  useEffect(() => {
    if (mergeRows.length > 0) {
      return
    }

    if (reviewRows.length === 0) {
      router.replace('/ocr')
      return
    }

    let isCancelled = false
    setApplyStatus('loading')

    // 평단이 화면에 없는 행은 현재 시세로 역산해 채운 뒤 병합 행을 만든다(스키마 축소, 2026-09-29).
    void (async () => {
      const filledRows = await fillMissingAveragePricesFromQuotes(reviewRows)
      const nextMergeRows = markMissingAveragePriceErrors(buildMergeRowsFromReviewRows(filledRows))

      if (isCancelled) {
        return
      }

      setMergeRows(nextMergeRows)
      setApplyStatus('idle')
    })()

    return () => {
      isCancelled = true
    }
  }, [mergeRows.length, reviewRows, router, setApplyStatus, setMergeRows])

  // 병합 행이 생기면 기존 포트폴리오를 읽어 겹치는 종목 선택 UI를 준비한다. 적용 때 한 번 더 읽는다.
  useEffect(() => {
    if (mergeRows.length === 0) {
      return
    }

    let cancelled = false
    void resolveExistingPortfolioForMerge().then((resolution) => {
      if (!cancelled) {
        setExistingPortfolio(resolution)
      }
    })

    return () => {
      cancelled = true
    }
  }, [mergeRows.length])

  // 이번 묶음을 "기존 포트폴리오 + 이번 묶음"으로 병합했을 때의 미리보기(겹치는 종목 선택 UI용).
  const incomingRowsForMerge = useMemo(
    () => buildAppliedHomePortfolioRowsFromConfirmedHoldings(getApplicableConfirmedHoldings(mergeRows)),
    [mergeRows],
  )
  const mergePlan = useMemo(
    () => (existingPortfolio ? planPortfolioMerge(existingPortfolio.rows, incomingRowsForMerge, overlapChoices) : null),
    [existingPortfolio, incomingRowsForMerge, overlapChoices],
  )
  const exceedsRowLimit = mergePlan ? exceedsPortfolioRowLimit(mergePlan.rows.length) : false

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

  const handleApply = async () => {
    if (applyStatus === 'loading') {
      return
    }

    if (normalizedItems.length === 0) {
      setApplyStatus('error', '적용 가능한 종목이 없어요. 값을 다시 확인해주세요.')
      return
    }

    setApplyStatus('loading')

    try {
      const appliedAt = new Date().toISOString()
      // 기존 포트폴리오(로그인: 서버, 비로그인: 이 탭)와 병합한다. 적용 시점에 다시 읽어 다른 기기의 변경을 반영한다.
      const existing = await resolveExistingPortfolioForMerge()
      const applyResult = persistMergedAppliedPortfolio({ mergeRows, existing, overlapChoices, appliedAt })
      const overRowLimit = exceedsPortfolioRowLimit(applyResult.plan.rows.length)

      if (!applyResult.persisted) {
        throw new Error(overRowLimit ? PORTFOLIO_ROW_LIMIT_MESSAGE : '홈 포트폴리오 저장에 실패했어요.')
      }

      // 서버에는 병합 결과 전체를 보낸다(저장 RPC는 전체 교체). 기존 목록을 서버에서 못 읽었으면 보내지 않는다.
      syncMergedPortfolioAfterApply(existing, applyResult.plan.rows)

      const nextQuoteQuery = buildHomeCurrentQuoteQuery(buildHomeHoldingsFromPortfolioItems(applyResult.mergedItems))
      replacePortfolioItems(applyResult.mergedItems)
      setQuoteStatus('loading', null, nextQuoteQuery)
      // 시세 프리페치(2026-10-29): 완료 또는 상한까지 홈 이동을 잠깐 미뤄 홈 첫 프레임의
      // '- · -' 임시값 갭을 없앤다. OCR 적용 흐름(page.tsx)과 같은 패턴.
      await Promise.race([
        hydratePortfolioItemsWithCurrentQuotes(applyResult.mergedItems)
          .then((result) => {
            replacePortfolioItems(result.items)
            setQuoteStatus(result.quoteStatus, result.quoteErrorMessage, result.quoteQuery)
          })
          .catch(() => {
            setQuoteStatus('error', '현재 시세를 불러오지 못했어요. 다시 시도해주세요.', null)
          }),
        new Promise<void>((resolve) => {
          setTimeout(resolve, MERGE_APPLY_QUOTE_PREFETCH_CAP_MS)
        }),
      ])
      markApplied(appliedAt)
      // 적용 뒤 업로드 세션을 지운다. /ocr 은 언마운트 때 정리하지만 이 화면에서 적용하면 /ocr 이
      // 언마운트되지 않아 세션이 남고, 검수로 되돌아가면 같은 이미지로 유료 OCR 이 다시 돌았다.
      clearPersistedScreenshotUploadSession()
      useOcrUploadStore.getState().clear()
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
        <p className='mt-1 text-[12px] leading-6 text-[color:var(--jaroo-primary)]'>정상 행만 홈 포트폴리오에 반영돼요. 제외된 행은 카드 안 안내를 보고 다시 확인해주세요.</p>
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

      {mergePlan && existingPortfolio ? (
        <PortfolioOverlapChoices
          plan={mergePlan}
          existingStatus={existingPortfolio.status}
          onChange={(key, choice) => setOverlapChoices((current) => ({ ...current, [key]: choice }))}
        />
      ) : null}

      <div className='space-y-2 pt-1'>
        <button
          type='button'
          onClick={handleApply}
          disabled={applyStatus === 'loading' || normalizedItems.length === 0 || existingPortfolio === null || exceedsRowLimit}
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
          종목 확인으로 돌아가기
        </button>
        {applyError ? <p className='text-[11px] text-[#D54841]'>{applyError}</p> : null}
        {!applyError && exceedsRowLimit ? <p className='text-[11px] text-[#D54841]'>{PORTFOLIO_ROW_LIMIT_MESSAGE}</p> : null}
        {!applyError && !exceedsRowLimit && mergeRows.length > 0 && existingPortfolio === null ? (
          <p className='text-[11px] text-[color:var(--jaroo-muted)]'>기존 포트폴리오를 불러오고 있어요</p>
        ) : null}
      </div>
    </JarooShell>
  )
}
