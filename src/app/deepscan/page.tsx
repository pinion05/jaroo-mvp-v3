'use client'

import type { JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LineChart } from 'lucide-react'
import { DeepScanInlineResults } from '@/components/deepscan-inline-results'
import { DeepScanLoadingScreen, type LoadingStageKey } from '@/components/deepscan-loading-screen'
import { JarooShell } from '@/components/jaroo-shell'
import { fetchDeepScanCanonicalPayload, type DeepScanCanonicalTargetSession } from '@/lib/deepscan-canonical'
import { computePriceDriftPct, extractSnapshotPriceBasis } from '@/lib/deepscan-snapshot-policy'
import { type LoadingBriefingSnapshot } from '@/lib/deepscan-briefing-snapshot'
import { fetchLoadingProxyJson } from '@/lib/loading-fetch-retry'
import { resolveDeepScanPageCacheState } from '@/lib/deepscan-page-projection'
import { resolveDeepScanLoadingCurrentPrice } from '@/lib/deepscan-loading-current-price'
import { isDeepScanInlineResultsReady } from '@/lib/deepscan-loading-behavior'
import { resolveDeepScanHydratedTarget, shouldStartDeepScanRequestAfterHydration } from '@/lib/deepscan-target-hydration'
import { readAppliedHomePortfolio, resolveDeepScanTargetSession } from '@/lib/jaroo-home-data'
import { buildProfitIntroMention } from '@/lib/deepscan-intro-mention'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import { getDeepScanTargetKey } from '@/lib/workflow-types'

import {
  DEEPSCAN_STAGE_FILL_DELAY_MS,
  DEEPSCAN_STAGE_WAIT_MS,
  emptyDeepScanSteps,
  type DeepScanCommitteeStatusResponse,
  type DeepScanLoadingSequenceState,
  type DeepScanLoadingStageArrivalState,
  type HomeMarketTone,
  type LoadingQuickQuote,
  type QuotesCurrentProxyResponse,
  type TargetLoadingBriefingSnapshot,
  type TargetLoadingMarketSnapshot,
  type UsMarketIndicatorsProxyResponse,
} from './deepscan-page-types'

import {
  buildLoadingFindingProgress,
  buildLoadingPerformanceComment,
  buildLoadingTradingVolume,
  createDeepScanLoadingSequence,
  createDeepScanLoadingStageArrival,
  extractLoadingStageKeysFromCommitteeAxes,
  extractLoadingStageKeysFromCommitteeResults,
  hasCollectedDeepScanEvidence,
  uniqueLoadingStageKeys,
} from './deepscan-page-stages'

import {
  buildDeepScanTargetInputFromSession,
  buildLoadingBriefingSnapshotUrl,
  buildLoadingQuickQuoteUrl,
  buildUsLoadingMarketSnapshot,
  fetchHydrationUsdKrwRate,
  isDeepScanUsTarget,
  normalizeQuoteCurrency,
  selectLoadingQuickQuoteItem,
} from './deepscan-page-fetchers'

import { buildLoadingQuickFacts } from './deepscan-page-loading-facts'

export default function DeepScanPage() {
  const target = useDeepScanStore((state) => state.target)
  const setDeepScanTarget = useDeepScanStore((state) => state.setTarget)
  const requestStatus = useDeepScanStore((state) => state.requestStatus)
  const errorMessage = useDeepScanStore((state) => state.errorMessage)
  const activePayload = useDeepScanStore((state) => state.activePayload)
  const activeTargetKey = useDeepScanStore((state) => state.activeTargetKey)
  const lastSuccessful = useDeepScanStore((state) => state.lastSuccessful)
  const startRequest = useDeepScanStore((state) => state.startRequest)
  // 명시적 재분석(스냅샷 캐시 무시) — 에포크 변경이 fetch effect를 재실행한다
  const [refreshEpoch, setRefreshEpoch] = useState(0)
  const pendingRefreshRef = useRef(false)
  const finishSuccess = useDeepScanStore((state) => state.finishSuccess)
  const updateActivePayload = useDeepScanStore((state) => state.updateActivePayload)
  const finishError = useDeepScanStore((state) => state.finishError)
  const abandonInFlight = useDeepScanStore((state) => state.abandonInFlight)
  const [loadingQuickQuote, setLoadingQuickQuote] = useState<LoadingQuickQuote | null>(null)
  const [loadingBriefingSnapshot, setLoadingBriefingSnapshot] = useState<TargetLoadingBriefingSnapshot | null>(null)
  const [loadingMarketSnapshot, setLoadingMarketSnapshot] = useState<TargetLoadingMarketSnapshot | null>(null)
  const [loadingSequence, setLoadingSequence] = useState<DeepScanLoadingSequenceState>(() => createDeepScanLoadingSequence(null))
  const [arrivedLoadingStages, setArrivedLoadingStages] = useState<DeepScanLoadingStageArrivalState>(() => createDeepScanLoadingStageArrival(null))
  const [displayedLoadingStages, setDisplayedLoadingStages] = useState<DeepScanLoadingStageArrivalState>(() => createDeepScanLoadingStageArrival(null))
  const [hydratedTargetKey, setHydratedTargetKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const hydrateTarget = async () => {
      const sessionTarget = resolveDeepScanTargetSession()
      const hydratedTarget = buildDeepScanTargetInputFromSession(sessionTarget)
      if (!hydratedTarget) {
        if (!cancelled) {
          setHydratedTargetKey(target ? getDeepScanTargetKey(target) : null)
        }
        return
      }

      const nextTarget = await resolveDeepScanHydratedTarget({
        currentTarget: target,
        hydratedTarget,
        loadUsdKrwRate: fetchHydrationUsdKrwRate,
      })

      if (!cancelled) {
        const nextTargetKey = getDeepScanTargetKey(nextTarget)
        if (!target || getDeepScanTargetKey(target) !== nextTargetKey) {
          setDeepScanTarget(nextTarget)
        }
        setHydratedTargetKey(nextTargetKey)
      }
    }

    void hydrateTarget()

    return () => {
      cancelled = true
    }
  }, [setDeepScanTarget, target])

  const targetKey = useMemo(() => (target ? getDeepScanTargetKey(target) : null), [target])
// 스펙 spec_v7 §4 인트로 멘트(손익 5단계). 판정 = 손익액 ÷ 전체 포트폴리오 평가액(즉시 데이터, 금액 미표시).
  // 분모 우선순위: ① 적용 포트폴리오 세션(OCR 평가액 합산) ② 서버 포트폴리오 합산(재방문 세션 부재 폴백).
  // 둘 다 없으면 null → 기존 안내 문구.
  const introSessionTotal = useMemo(
    () => (readAppliedHomePortfolio()?.rows ?? []).reduce((sum, row) => sum + (parseOcrNumber(row.evaluationAmount ?? '') ?? 0), 0),
    [],
  )
  const [introPortfolioTotal, setIntroPortfolioTotal] = useState<number | null>(null)
  useEffect(() => {
    if (introSessionTotal > 0) {
      setIntroPortfolioTotal(introSessionTotal)
      return
    }
    let cancelled = false
    void fetch('/api/portfolio')
      .then((response) => (response.ok ? (response.json() as Promise<{ rows?: Array<{ evaluation_amount: number | null; average_price: number | null; quantity: number | null }> }>) : null))
      .then((body) => {
        if (cancelled || !body?.rows?.length) {
          return
        }
        const total = body.rows.reduce(
          (sum, row) => sum + (row.evaluation_amount ?? (row.average_price ?? 0) * (row.quantity ?? 0)),
          0,
        )
        if (total > 0) {
          setIntroPortfolioTotal(total)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [introSessionTotal])
  const introMention = useMemo(() => {
    if (!target || target.kind === 'etf' || introPortfolioTotal === null) {
      return null
    }
    const costBasis = target.quantity * target.averagePrice
    const evaluation = target.evaluationAmount ?? (typeof target.currentPrice === 'number' ? target.currentPrice * target.quantity : undefined)
    if (!Number.isFinite(costBasis) || costBasis <= 0 || typeof evaluation !== 'number' || !Number.isFinite(evaluation)) {
      return null
    }
    return buildProfitIntroMention({ name: target.name, profitAmount: evaluation - costBasis, portfolioTotal: introPortfolioTotal })
  }, [introPortfolioTotal, target])
  const targetKeyRef = useRef(targetKey)
  const requestSeed = useMemo<DeepScanCanonicalTargetSession | null>(
    () =>
      target
        ? {
            holding: {
              name: target.name,
              code: target.code,
              identifierCode: target.code,
              ticker: target.ticker,
              identifierTicker: target.ticker,
              shares: String(target.quantity),
              averagePrice: String(target.averagePrice),
              averagePriceCurrency: target.averagePriceCurrency,
              currentPrice: typeof target.currentPrice === 'number' ? String(target.currentPrice) : undefined,
              currentPriceCurrency: target.currentPriceCurrency,
              currentProfitRate: typeof target.currentProfitRate === 'number' ? String(target.currentProfitRate) : undefined,
              evaluationAmount: typeof target.evaluationAmount === 'number' ? String(target.evaluationAmount) : undefined,
              usdKrwRate: typeof target.usdKrwRate === 'number' ? String(target.usdKrwRate) : undefined,
              market: target.market ?? target.marketTone?.toUpperCase() ?? '미확인',
              marketTone: (target.marketTone ?? (target.kind === 'etf' ? 'etf' : 'kospi')) as HomeMarketTone,
              kind: target.kind,
            },
            selectedAt: undefined,
          }
        : null,
    [target],
  )
  const { payload, fetchState, shouldStartRequest } = resolveDeepScanPageCacheState({
    hasTarget: Boolean(target),
    targetKey,
    requestStatus,
    activePayload,
    activeTargetKey,
    lastSuccessful,
  })
  useEffect(() => {
    targetKeyRef.current = targetKey
  }, [targetKey])
  const markDeepScanLoadingSuccess = useCallback((successTargetKey: string | null) => {
    if (!successTargetKey) {
      return
    }

    setLoadingSequence((previous) => {
      if (previous.targetKey !== successTargetKey) {
        return {
          ...createDeepScanLoadingSequence(successTargetKey),
          firstSuccessObserved: true,
        }
      }

      if (previous.firstSuccessObserved) {
        return previous
      }

      return {
        ...previous,
        firstSuccessObserved: true,
      }
    })
  }, [])
  const appendArrivedLoadingStageKeys = useCallback((successTargetKey: string | null, stageKeys: LoadingStageKey[]) => {
    if (!successTargetKey || stageKeys.length === 0) {
      return
    }

    setArrivedLoadingStages((previous) => {
      const previousKeys = previous.targetKey === successTargetKey ? previous.stageKeys : []
      const nextStageKeys = uniqueLoadingStageKeys([...previousKeys, ...stageKeys])
      if (previous.targetKey === successTargetKey && nextStageKeys.length === previous.stageKeys.length) {
        return previous
      }

      return {
        targetKey: successTargetKey,
        stageKeys: nextStageKeys,
      }
    })
  }, [])

  useEffect(() => {
    if (!loadingSequence.targetKey || !loadingSequence.firstSuccessObserved || loadingSequence.sequenceComplete) {
      return undefined
    }

    const sequenceTargetKey = loadingSequence.targetKey
    if (loadingSequence.visibleStageCount === 1) {
      const timeoutId = window.setTimeout(() => {
        setLoadingSequence((previous) => (
          previous.targetKey === sequenceTargetKey && previous.visibleStageCount === 1
            ? { ...previous, visibleStageCount: 2 }
            : previous
        ))
      }, DEEPSCAN_STAGE_WAIT_MS)

      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    if (loadingSequence.visibleStageCount === 2) {
      const timeoutId = window.setTimeout(() => {
        setLoadingSequence((previous) => (
          previous.targetKey === sequenceTargetKey && previous.visibleStageCount === 2
            ? { ...previous, visibleStageCount: 3 }
            : previous
        ))
      }, DEEPSCAN_STAGE_WAIT_MS)

      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    if (loadingSequence.visibleStageCount === 3) {
      const timeoutId = window.setTimeout(() => {
        setLoadingSequence((previous) => (
          previous.targetKey === sequenceTargetKey && previous.visibleStageCount === 3
            ? { ...previous, sequenceComplete: true }
            : previous
        ))
      }, DEEPSCAN_STAGE_WAIT_MS)

      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    return undefined
  }, [loadingSequence.firstSuccessObserved, loadingSequence.sequenceComplete, loadingSequence.targetKey, loadingSequence.visibleStageCount])

  useEffect(() => {
    if (!targetKey || arrivedLoadingStages.targetKey !== targetKey) {
      return undefined
    }

    const displayedStageKeys = displayedLoadingStages.targetKey === targetKey ? displayedLoadingStages.stageKeys : []
    if (
      displayedStageKeys.length >= arrivedLoadingStages.stageKeys.length
      || displayedStageKeys.length >= loadingSequence.visibleStageCount
    ) {
      return undefined
    }

    const nextStageKey = arrivedLoadingStages.stageKeys[displayedStageKeys.length]
    if (!nextStageKey) {
      return undefined
    }

    const releaseTargetKey = targetKey
    const timeoutId = window.setTimeout(() => {
      if (targetKeyRef.current !== releaseTargetKey) {
        return
      }

      setDisplayedLoadingStages((previous) => {
        const previousKeys = previous.targetKey === releaseTargetKey ? previous.stageKeys : []
        if (previousKeys.includes(nextStageKey)) {
          return previous
        }

        return {
          targetKey: releaseTargetKey,
          stageKeys: uniqueLoadingStageKeys([...previousKeys, nextStageKey]),
        }
      })
    }, DEEPSCAN_STAGE_FILL_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [arrivedLoadingStages.stageKeys, arrivedLoadingStages.targetKey, displayedLoadingStages.stageKeys, displayedLoadingStages.targetKey, loadingSequence.visibleStageCount, targetKey])

  useEffect(() => {
    if (!shouldStartDeepScanRequestAfterHydration({
      shouldStartRequest,
      targetKey,
      hydratedTargetKey,
    })) {
      return
    }

    startRequest()
  }, [hydratedTargetKey, shouldStartRequest, startRequest, targetKey])

  useEffect(() => {
    const quickQuoteUrl = buildLoadingQuickQuoteUrl(target)
    if (!quickQuoteUrl || !targetKey) {
      return
    }

    const requestedTargetKey = targetKey
    const controller = new AbortController()

    const run = async () => {
      const result = await fetchLoadingProxyJson<NonNullable<QuotesCurrentProxyResponse['data']>>(quickQuoteUrl, {
        signal: controller.signal,
      })
      if (!result.ok || controller.signal.aborted) {
        return
      }

      const item = selectLoadingQuickQuoteItem({ ok: true, data: result.data }, target)
      if (!item) {
        return
      }

      setLoadingQuickQuote({
        targetKey: requestedTargetKey,
        ...(typeof item.price === 'number' && Number.isFinite(item.price)
          ? { currentPrice: item.price }
          : {}),
        ...(typeof item.volume === 'number' && Number.isFinite(item.volume)
          ? { tradingVolume: item.volume }
          : {}),
        ...(typeof item.week52High === 'number' && Number.isFinite(item.week52High)
          ? { week52High: item.week52High }
          : {}),
        ...(typeof item.week52Low === 'number' && Number.isFinite(item.week52Low)
          ? { week52Low: item.week52Low }
          : {}),
        ...(normalizeQuoteCurrency(item.currency)
          ? { currentPriceCurrency: normalizeQuoteCurrency(item.currency) }
          : {}),
      })
    }

    void run()

    return () => {
      controller.abort()
    }
  }, [markDeepScanLoadingSuccess, target, targetKey])

  useEffect(() => {
    const snapshotUrl = buildLoadingBriefingSnapshotUrl(target)
    if (!snapshotUrl || !targetKey || loadingBriefingSnapshot?.targetKey === targetKey) {
      return
    }

    const requestedTargetKey = targetKey
    const controller = new AbortController()

    const run = async () => {
      // Retry with backoff: briefing snapshot is crawler-backed and can 502
      // transiently when Polygon.io rate-limits (429). Without retries the
      // chart / one-month / volume cards stay stuck in their loading fallback.
      const result = await fetchLoadingProxyJson<LoadingBriefingSnapshot>(snapshotUrl, {
        signal: controller.signal,
      })
      if (!result.ok || controller.signal.aborted) {
        return
      }

      setLoadingBriefingSnapshot({
        ...result.data,
        targetKey: requestedTargetKey,
      })
    }

    void run()

    return () => {
      controller.abort()
    }
  }, [loadingBriefingSnapshot?.targetKey, target, targetKey])

  useEffect(() => {
    if (!isDeepScanUsTarget(target) || !targetKey || loadingMarketSnapshot?.targetKey === targetKey) {
      return undefined
    }

    const requestedTargetKey = targetKey
    const controller = new AbortController()

    const run = async () => {
      const result = await fetchLoadingProxyJson<NonNullable<UsMarketIndicatorsProxyResponse['data']>>('/api/market/us-indicators', {
        signal: controller.signal,
      })
      if (!result.ok || controller.signal.aborted) {
        return
      }

      const snapshot = buildUsLoadingMarketSnapshot({ ok: true, data: result.data }, requestedTargetKey)
      if (snapshot) {
        setLoadingMarketSnapshot(snapshot)
      }
    }

    void run()

    return () => {
      controller.abort()
    }
  }, [loadingMarketSnapshot?.targetKey, target, targetKey])

  useEffect(() => {
    if (!requestSeed || !targetKey || requestStatus !== 'loading') {
      return
    }

    const requestedTargetKey = targetKey
    const controller = new AbortController()
    let settled = false

    const run = async () => {
      try {
        const nextPayload = await fetchDeepScanCanonicalPayload(
          requestSeed,
          (input, init) => fetch(input, { ...init, signal: controller.signal }),
          { refresh: pendingRefreshRef.current },
        )
        pendingRefreshRef.current = false

        if (controller.signal.aborted || targetKeyRef.current !== requestedTargetKey) {
          return
        }

        settled = true

        if (!nextPayload) {
          finishError('DeepScan 데이터를 표시할 수 없어요. 잠시 후 다시 시도해주세요.')
          return
        }

        markDeepScanLoadingSuccess(requestedTargetKey)
        if (!nextPayload.metadata.llmCommittee?.requestId) {
          appendArrivedLoadingStageKeys(requestedTargetKey, extractLoadingStageKeysFromCommitteeAxes(nextPayload.committee.axes))
        }
        finishSuccess(nextPayload)
      } catch (error) {
        if (controller.signal.aborted || targetKeyRef.current !== requestedTargetKey) {
          return
        }

        settled = true
        finishError(error instanceof Error ? error.message : 'DeepScan 데이터를 표시할 수 없어요. 잠시 후 다시 시도해주세요.')
      }
    }

    void run()

    return () => {
      controller.abort()

      if (!settled) {
        abandonInFlight()
      }
    }
  }, [abandonInFlight, appendArrivedLoadingStageKeys, finishError, finishSuccess, markDeepScanLoadingSuccess, refreshEpoch, requestSeed, requestStatus, targetKey])

  useEffect(() => {
    const llmCommittee = payload?.metadata.llmCommittee
    const needsPartialPolling = llmCommittee?.status === 'partial'
    const needsCompleteArrivalLookup = llmCommittee?.status === 'complete' && arrivedLoadingStages.targetKey !== targetKey
    if (fetchState !== 'success' || !payload || !targetKey || !llmCommittee?.requestId || (!needsPartialPolling && !needsCompleteArrivalLookup)) {
      return
    }

    const requestedTargetKey = targetKey
    let stopped = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const response = await fetch(`/api/deepscan/committee-status?requestId=${encodeURIComponent(llmCommittee.requestId)}`, { cache: 'no-store' })
        const body = (await response.json()) as DeepScanCommitteeStatusResponse

        if (stopped || !body.ok || body.requestId !== llmCommittee.requestId) {
          return
        }

        if (body.status === 'partial' || body.status === 'complete') {
          markDeepScanLoadingSuccess(requestedTargetKey)
          appendArrivedLoadingStageKeys(
            requestedTargetKey,
            extractLoadingStageKeysFromCommitteeResults(body.results).length > 0
              ? extractLoadingStageKeysFromCommitteeResults(body.results)
              : extractLoadingStageKeysFromCommitteeAxes(body.committeeAxes),
          )
        }

        updateActivePayload((currentPayload: JarooDeepScanPayload) => {
          const currentCommittee = currentPayload.metadata.llmCommittee
          if (currentCommittee?.requestId !== llmCommittee.requestId) {
            return currentPayload
          }

          const nextStatus = body.status === 'not_found'
            ? 'error'
            : body.status === 'complete' || body.status === 'partial' || body.status === 'error'
            ? body.status
            : currentCommittee.status
          const nextPending = body.status === 'not_found'
            ? 0
            : Array.isArray(body.pending) ? body.pending.length : currentCommittee.pending
          const nextErrors = body.status === 'not_found'
            ? Math.max(currentCommittee.errors, 1)
            : Array.isArray(body.errors) ? body.errors.length : currentCommittee.errors

          return {
            ...currentPayload,
            committee: Array.isArray(body.committeeAxes)
              ? {
                  ...currentPayload.committee,
                  axes: body.committeeAxes,
                }
              : currentPayload.committee,
            metadata: {
              ...currentPayload.metadata,
              llmCommittee: {
                ...currentCommittee,
                status: nextStatus,
                completed: typeof body.completed === 'number' ? body.completed : currentCommittee.completed,
                pending: nextPending,
                errors: nextErrors,
                softDeadlineMs: body.softDeadlineMs ?? currentCommittee.softDeadlineMs,
              },
            },
          }
        })

        if (body.status === 'partial') {
          timeoutId = setTimeout(poll, 2500)
        }
      } catch {
        if (!stopped) {
          timeoutId = setTimeout(poll, 5000)
        }
      }
    }

    timeoutId = setTimeout(poll, 1500)

    return () => {
      stopped = true
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [appendArrivedLoadingStageKeys, arrivedLoadingStages.targetKey, fetchState, markDeepScanLoadingSuccess, payload, targetKey, updateActivePayload])

  const scrollContentToTop = () => {
    const container = document.querySelector<HTMLElement>("[data-slot='jaroo-shell-main']")
    container?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 명시적 재분석 — 스냅샷 캐시를 무시하고 새 스캔(크레딧 사용)을 돈다
  const handleExplicitRefresh = useCallback(() => {
    if (requestStatus === 'loading') return
    if (!window.confirm('다시 분석할까요? 딥스캔 크레딧이 사용돼요.')) return
    pendingRefreshRef.current = true
    setRefreshEpoch((epoch) => epoch + 1)
    startRequest()
  }, [requestStatus, startRequest])

  const handleRetry = useCallback(() => {
    setLoadingSequence(createDeepScanLoadingSequence(targetKey))
    setArrivedLoadingStages(createDeepScanLoadingStageArrival(targetKey))
    setDisplayedLoadingStages(createDeepScanLoadingStageArrival(targetKey))
    startRequest()
    scrollContentToTop()
  }, [startRequest, targetKey])


  const missingTargetTitle = '분석할 종목이 없습니다'

  if (!requestSeed) {
    return (
      <JarooShell
        title='DeepScan'
        subtitle='종목을 선택하면 세 팀이 바로 분석해요'
        backHref='/home'
        showBottomNav={false}
        frameClassName='w-full'
        mainClassName='space-y-3 bg-white px-3.5 pt-3.5 pb-6'
      >
        {/* DeepScan 로딩/결과 화면(deepscan-loading-screen.module.css 의 --ds-* 토큰)과 같은 리포트 문법:
            12px 카드 + 0.5px 헤어라인 보더 + 15~16px/700~800 타이포 + 절제된 그림자. 영문 워드마크(START GUIDE·3 STEP) 제거. */}
        <section className='rounded-[12px] border-[0.5px] border-[#d7e8f7] bg-[linear-gradient(135deg,rgba(244,248,252,0.98),rgba(255,255,255,0.98))] p-3.5 shadow-[0_8px_20px_rgba(28,85,133,0.05)]'>
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='flex items-center gap-1.5 text-[12px] font-extrabold text-[#185fa5]'>
                <span className='size-[5px] animate-pulse rounded-full bg-[#185fa5]' />
                대기 화면
              </p>
              <h1 className='mt-1.5 text-[16px] font-extrabold leading-[1.3] tracking-[-0.01em] text-[#111]'>
                {missingTargetTitle}
              </h1>
            </div>
            <div className='grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#e6f1fb] text-[#185fa5]'>
              <LineChart className='size-[18px]' aria-hidden />
            </div>
          </div>

          <p className='mt-2 text-[13px] leading-[1.6] text-[#555]'>
            홈에서 분석할 대상을 선택하면 가격 위치, 핵심 근거, 세 팀 판단을 한 흐름으로 보여드려요.
          </p>

          <div className='mt-3 grid grid-cols-3 gap-2'>
            {[
              ['52주', '위치'],
              ['핵심', '근거'],
              ['세 팀', '판단'],
            ].map(([top, bottom]) => (
              <div key={top} className='rounded-[8px] border-[0.5px] border-[#eee] bg-white px-2 py-2'>
                <p className='text-[13px] font-bold leading-none text-[#111]'>{top}</p>
                <p className='mt-1 text-[10px] font-semibold text-[#aaa]'>{bottom}</p>
              </div>
            ))}
          </div>
        </section>

        <section className='rounded-[12px] border-[0.5px] border-[#eee] bg-white p-3.5'>
          <h2 className='text-[15px] font-bold tracking-[-0.01em] text-[#111]'>이렇게 시작하면 됩니다</h2>
          <div className='mt-1 divide-y divide-[#eee]'>
            {emptyDeepScanSteps.map((step, index) => {
              const Icon = step.icon

              return (
                <div key={step.label} className='flex items-start gap-2.5 py-2.5 first:pt-2 last:pb-0'>
                  <span className='grid size-7 shrink-0 place-items-center rounded-[8px] bg-[#e6f1fb] text-[#185fa5]'>
                    <Icon className='size-3.5' aria-hidden />
                  </span>
                  <div className='min-w-0'>
                    <p className='text-[13px] font-bold text-[#111]'>{step.label}</p>
                    <p className='mt-0.5 text-[11px] leading-[1.5] text-[#aaa]'>{step.body}</p>
                  </div>
                  <span className='ml-auto shrink-0 pt-0.5 text-[11px] font-bold text-[#aaa]'>{index + 1}</span>
                </div>
              )
            })}
          </div>
        </section>

        <Link
          href='/home'
          className='flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[#185fa5] text-[14px] font-extrabold text-white transition hover:bg-[#0c447c]'
        >
          홈에서 종목 선택하기
        </Link>
      </JarooShell>
    )
  }

  const isCommitteeHydrating = fetchState === 'success' && payload?.metadata.llmCommittee?.status === 'partial'
  const rawResultsReady = isDeepScanInlineResultsReady({
    fetchState,
    hasPayload: Boolean(payload),
    isCommitteeHydrating,
  })
  const resultsReady = rawResultsReady
  const visibleStageCount = resultsReady ? 3 : loadingSequence.targetKey === targetKey ? loadingSequence.visibleStageCount : 1
  const arrivedStageKeys = displayedLoadingStages.targetKey === targetKey ? displayedLoadingStages.stageKeys : []
  const loadingFindingProgress = buildLoadingFindingProgress(payload)
  const loadingPerformanceComment = buildLoadingPerformanceComment(payload)
  const activeLoadingQuickQuote = loadingQuickQuote?.targetKey === targetKey ? loadingQuickQuote : null
  const activeLoadingBaseBriefingSnapshot = loadingBriefingSnapshot?.targetKey === targetKey ? loadingBriefingSnapshot : null
  const activeLoadingMarketSnapshot = loadingMarketSnapshot?.targetKey === targetKey ? loadingMarketSnapshot : null
  const activeLoadingBriefingSnapshot: TargetLoadingBriefingSnapshot | null = (() => {
    if (!activeLoadingBaseBriefingSnapshot && !activeLoadingMarketSnapshot) {
      return null
    }

    return {
      ...(activeLoadingBaseBriefingSnapshot ?? {}),
      targetKey: targetKey ?? activeLoadingBaseBriefingSnapshot?.targetKey ?? activeLoadingMarketSnapshot?.targetKey ?? '',
      market: {
        ...(activeLoadingBaseBriefingSnapshot?.market ?? {}),
        ...(activeLoadingMarketSnapshot?.market ?? {}),
      },
    }
  })()
  const loadingTradingVolume = activeLoadingBriefingSnapshot?.quote?.volume ?? activeLoadingQuickQuote?.tradingVolume ?? buildLoadingTradingVolume(payload)
  const loadingPayloadCurrentPrice = parseOcrNumber(payload?.strategy.currentPriceText ?? '')
  const loadingCurrentPrice = resolveDeepScanLoadingCurrentPrice({
    payloadCurrentPrice: loadingPayloadCurrentPrice,
    quickQuoteCurrentPrice: activeLoadingQuickQuote?.currentPrice,
    targetCurrentPrice: target?.currentPrice,
    briefingCurrentPrice: activeLoadingBriefingSnapshot?.quote?.currentPrice,
  })

  // 스냅샷 캐시 표식 + 가격 드리프트 프로브 — 무료 시세로 '재분석이 필요한 정도'를 감지한다
  const snapshotCacheInfo = payload?.metadata.deepScanCache ?? null
  const snapshotPriceBasis = extractSnapshotPriceBasis(payload)
  const snapshotPriceDriftPct =
    snapshotCacheInfo?.hit && snapshotPriceBasis != null && loadingCurrentPrice != null
      ? computePriceDriftPct(snapshotPriceBasis, loadingCurrentPrice)
      : null
  const loadingCurrentPriceCurrency = target?.currentPriceCurrency
    ?? normalizeQuoteCurrency(activeLoadingBriefingSnapshot?.quote?.currency ?? undefined)
    ?? activeLoadingQuickQuote?.currentPriceCurrency
    ?? (requestSeed.holding.market === 'US' ? 'USD' : undefined)
  const loadingQuickFacts = buildLoadingQuickFacts(payload, activeLoadingQuickQuote, activeLoadingBriefingSnapshot, requestSeed.holding.name, requestSeed.holding.market, requestSeed.holding.kind)
  const evidenceCollected = hasCollectedDeepScanEvidence(payload)
  const requestErrorNotice = {
    badge: '오류',
    title: 'DeepScan 데이터를 표시할 수 없어요',
    body: errorMessage ?? '분석 데이터 요청에 실패했습니다. 잠시 후 다시 시도해주세요.',
  }

  const identifier = [requestSeed.holding.ticker, requestSeed.holding.code]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(' · ')

  return (
    <div className='flex h-full w-full justify-center bg-white'>
      <DeepScanLoadingScreen
        className='w-full overflow-hidden'
        name={requestSeed.holding.name}
        introMention={introMention}
        identifier={identifier}
        market={requestSeed.holding.market}
        instrumentKind={target?.kind}
        shares={target?.quantity}
        averagePrice={target?.averagePrice}
        averagePriceCurrency={target?.averagePriceCurrency}
        currentPrice={loadingCurrentPrice}
        currentPriceCurrency={loadingCurrentPriceCurrency}
        usdKrwRate={target?.usdKrwRate}
        tradingVolume={loadingTradingVolume}
        currentProfitRate={target?.currentProfitRate}
        snapshotProfitRate={target?.snapshotProfitRate}
        briefingSnapshot={activeLoadingBriefingSnapshot}
        findingProgress={loadingFindingProgress}
        committeeAxes={payload?.committee.axes}
        quickFacts={loadingQuickFacts}
        performanceComment={loadingPerformanceComment}
        evidenceCollected={evidenceCollected}
        visibleStageCount={visibleStageCount}
        arrivedStageKeys={arrivedStageKeys}
        resultsReady={resultsReady}
        inlineResults={resultsReady && payload ? <DeepScanInlineResults
            payload={payload}
            requestSeed={requestSeed}
            target={target}
            snapshotCacheInfo={snapshotCacheInfo}
            snapshotPriceDriftPct={snapshotPriceDriftPct}
            onExplicitRefresh={handleExplicitRefresh}
          /> : null}
        errorNotice={fetchState === 'error' ? requestErrorNotice : null}
        onRetry={handleRetry}
        backHref='/home'
      />
    </div>
  )
}
