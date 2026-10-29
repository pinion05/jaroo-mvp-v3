'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  shouldDisplayDeepScanReadyResults,
  parseDeepScanEmphasisSegments,
  shouldShowDeepScanSummarySkeleton,
} from '@/lib/deepscan-loading-behavior'
import { buildDeepScanReturnRateDisplay } from '@/lib/deepscan-loading-metrics'
import { cn } from '@/lib/utils'
import styles from './deepscan-loading-screen.module.css'

// Re-export public types for external consumers
export type {
  FindingProgress,
  LoadingPerformanceComment,
  LoadingQuickFact,
  LoadingStageKey,
} from './deepscan-loading-types'

import type {
  DeepScanLoadingScreenProps,
  LoadingStageKey,
  NarrativeTone,
  TeamSummaryState,
} from './deepscan-loading-types'

import {
  TEAM_PRESENTATION_ORDER,
  TEAM_SEQUENCE_COMPLETE_SECONDS,
  TODAY_BRIEFING_ARRAY_COMPLETE_SECONDS,
  CONCLUSION_REVEAL_DELAY_AFTER_TEAMS_SECONDS,
  DEEPSCAN_CONSENSUS_EMPTY_STATE_TEXT,
} from './deepscan-loading-types'

import {
  buildLoadingStages,
  buildOrderedNarrativeCards,
  buildSequentialNarrativeCards,
  buildTeamBridgeState,
  buildTimelineNarrativeCards,
  buildVisibleNarrativeCards,
  calculateProfitAmount,
  calculateProfitRate,
  financialToneClass,
  formatElapsedTime,
  formatMoney,
  formatShares,
  formatSignedMoney,
  formatSignedPercent,
  formatTradingVolume,
  getCollapsedTeamSummaryText,
  getTeamSummaryState,
  hasDisplayValue,
  hasNarrativeLoadingSkeleton,
  areDeepScanCommitteeCardsSettled,
  isDeepScanConclusionReady,
  hashSummaryInput,
  isExchangeTradedProduct,
  isHiddenLoadingQuickFact,
  narrativeToneClass,
  normalizeSummaryText,
  parseNumericValue,
  shouldCollapseTeamSummaryText,
  startDeepScanMobileAutoScroll,
  buildNarrativeFallbackSummary,
} from './deepscan-loading-utils'

import { resolveDeepScanLoadingCurrentPrice } from '@/lib/deepscan-loading-current-price'
import { createTeamSummaryFetchCoordinator } from '@/lib/deepscan-team-summary-fetch'

import {
  BackControl,
  QuickFactCard,
  TodayBriefingCard,
  TodayRecoveryForecastBriefing,
} from './deepscan-loading-briefing-card'

// 팀 요약 클라이언트 타임아웃 — 서버 타임아웃(DEEPSCAN_TEAM_SUMMARY_TIMEOUT_MS, 기본 10s)보다
// 여유를 둬야 서버의 502 응답을 정상 경로로 받을 수 있다.
const TEAM_SUMMARY_FETCH_TIMEOUT_MS = 15_000

export function DeepScanLoadingScreen({
  name = '선택 종목',
  introMention,
  identifier,
  market,
  instrumentKind,
  shares,
  averagePrice,
  averagePriceCurrency = 'KRW',
  currentPrice,
  currentPriceCurrency = averagePriceCurrency,
  usdKrwRate,
  tradingVolume,
  currentProfitRate,
  snapshotProfitRate,
  briefingSnapshot,
  payloadRecoveryForecast,
  findingProgress,
  committeeAxes,
  quickFacts = [],
  performanceComment,
  visibleStageCount = 1,
  arrivedStageKeys = [],
  resultsReady = false,
  snapshotCacheHit = false,
  snapshotScannedAt,
  className,
  onBack,
  backHref = '/home',
  inlineResults,
  errorNotice,
  onRetry,
  errorPrimaryAction,
  headerNotice,
}: DeepScanLoadingScreenProps) {
  const isError = Boolean(errorNotice)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [teamsSettledAtSeconds, setTeamsSettledAtSeconds] = useState<number | null>(null)
  const [prevCommitteeCardsSettled, setPrevCommitteeCardsSettled] = useState(false)
  const [teamSummaries, setTeamSummaries] = useState<Partial<Record<LoadingStageKey, TeamSummaryState>>>({})
  const [expandedTeamSummaries, setExpandedTeamSummaries] = useState<ReadonlySet<LoadingStageKey>>(() => new Set())
  const teamSummaryFetchCoordinatorRef = useRef(createTeamSummaryFetchCoordinator())
  const teamBridgeRef = useRef<HTMLElement | null>(null)
  const narrativeStreamRef = useRef<HTMLElement | null>(null)
  const targetLine = [identifier, market].filter(Boolean).join(' · ')
  const exchangeProduct = isExchangeTradedProduct(market, instrumentKind)
  const sharesText = formatShares(shares)
  const averagePriceText = formatMoney(averagePrice, averagePriceCurrency)
  const currentPriceText = formatMoney(currentPrice, currentPriceCurrency)
  const tradingVolumeText = formatTradingVolume(tradingVolume)
  const snapshotCurrentPrice = briefingSnapshot?.quote?.currentPrice ?? undefined
  const effectiveCurrentPrice = resolveDeepScanLoadingCurrentPrice({
    quickQuoteCurrentPrice: parseNumericValue(currentPrice),
    briefingCurrentPrice: snapshotCurrentPrice,
  })
  const canCalculatePositionInOneCurrency = currentPriceCurrency === averagePriceCurrency
  const profitRateText = formatSignedPercent(
    (canCalculatePositionInOneCurrency ? calculateProfitRate({ currentPrice: effectiveCurrentPrice, averagePrice }) : null)
      ?? currentProfitRate,
  )
  const profitAmountText = formatSignedMoney(
    canCalculatePositionInOneCurrency ? calculateProfitAmount({ currentPrice: effectiveCurrentPrice, averagePrice, shares }) : null,
    currentPriceCurrency,
  )
  const returnRateDisplay = buildDeepScanReturnRateDisplay({
    currentProfitRate: profitRateText ?? undefined,
    snapshotProfitRate,
  })
  const displayQuickFacts = useMemo(() => quickFacts.filter(hasDisplayValue), [quickFacts])
  const standaloneQuickFacts = useMemo(
    () => displayQuickFacts.filter((fact) => !isHiddenLoadingQuickFact(fact)),
    [displayQuickFacts],
  )
  const consensusQuickFact = displayQuickFacts.find((fact) => Boolean(fact.consensus))
  const consensusData = consensusQuickFact?.consensus
  const briefingDailyCloses = useMemo(
    () => (briefingSnapshot?.daily ?? []).map((row) => row.close),
    [briefingSnapshot?.daily],
  )
  const loadingStages = useMemo(
    () => buildLoadingStages({
      displayQuickFacts,
      findingProgress,
      performanceComment,
      committeeAxes,
      currentPriceText,
      tradingVolumeText,
      exchangeProduct,
    }),
    [committeeAxes, currentPriceText, displayQuickFacts, exchangeProduct, findingProgress, performanceComment, tradingVolumeText],
  )
  const orderedNarrativeCards = useMemo(
    // 종결된 캐시/오류 응답에서 일부 팀 도착 이벤트가 누락되어도 결과를 영원히 숨기지 않는다.
    () => buildOrderedNarrativeCards(loadingStages, resultsReady && elapsedSeconds >= TEAM_SEQUENCE_COMPLETE_SECONDS ? TEAM_PRESENTATION_ORDER : arrivedStageKeys),
    [arrivedStageKeys, elapsedSeconds, loadingStages, resultsReady],
  )
  const teamSummaryRequests = useMemo(
    () => loadingStages.flatMap((card) => {
      const teamKey = card.teamKey
      if (!teamKey || !card.summarizable || !card.body.trim()) {
        return []
      }

      const inputKey = hashSummaryInput(card.body)
      const requestScopeKey = `${market ?? 'unknown'}:${instrumentKind ?? 'unknown'}:${exchangeProduct ? 'etf' : 'stock'}`

      return [{
        teamKey,
        inputKey,
        requestKey: `${requestScopeKey}:${teamKey}:${inputKey}`,
        cardKey: card.key,
        analystName: card.analystName,
        body: card.body,
      }]
    }),
    [exchangeProduct, instrumentKind, loadingStages, market],
  )
  const visibleNarrativeCards = useMemo(
    () => buildVisibleNarrativeCards(orderedNarrativeCards, visibleStageCount),
    [orderedNarrativeCards, visibleStageCount],
  )
  const resultsReadyForDisplay = shouldDisplayDeepScanReadyResults(resultsReady)
  const timelineNarrativeCards = useMemo(
    () => buildTimelineNarrativeCards(orderedNarrativeCards, elapsedSeconds, resultsReadyForDisplay),
    [elapsedSeconds, orderedNarrativeCards, resultsReadyForDisplay],
  )
  const sequentialNarrativeCards = useMemo(
    () => buildSequentialNarrativeCards(timelineNarrativeCards, teamSummaries, resultsReadyForDisplay),
    [resultsReadyForDisplay, teamSummaries, timelineNarrativeCards],
  )
  const committeeCardsSettled = areDeepScanCommitteeCardsSettled({
    resultsReady: resultsReadyForDisplay,
    cards: sequentialNarrativeCards,
    teamSummaries,
  })
  // 위원(세 팀) 카드가 완전히 렌더링된 최초 시점을 기록한다(2026-10-29). 종합 결론은 이 시점
  // +n초(브리핑 배열 완료와 비교해 늦은 쪽)에 공개된다 — 스캔 시작 기준 81초 절대 게이트가
  // 아니라 위원 컴포넌트 완성 기준 상대 시점. 렌더 중 상태 조정(React 공식 패턴 — You Might
  // Not Need an Effect)으로 기록하고, 미완으로 되돌아가면(재스캔) 초기화해 순서를 다시 지킨다.
  if (committeeCardsSettled !== prevCommitteeCardsSettled) {
    setPrevCommitteeCardsSettled(committeeCardsSettled)
    setTeamsSettledAtSeconds(committeeCardsSettled && teamsSettledAtSeconds === null ? elapsedSeconds : null)
  }
  const inlineResultsReady = isDeepScanConclusionReady({
    teamsSettledAtSeconds,
    elapsedSeconds,
    arrayCompleteSeconds: TODAY_BRIEFING_ARRAY_COMPLETE_SECONDS,
  })
  // AI 위원(세 팀) 카드가 하나씩 공개될 때마다 그 카드로 화면을 내린다(2026-10-29 사용자 지시).
  // 브리핑 배열·팀 브리지와 같은 모바일 오토스크롤 헬퍼를 재사용한다 — 새 카드 행이 등장할 때와
  // 스켈래톤이 내용으로 채워질 때(렌더된 행 수·확정 카드 수 변화) 마지막 카드 하단을 뷰에 맞춘다.
  const settledCommitteeCardCount = sequentialNarrativeCards.filter(
    (card) => !hasNarrativeLoadingSkeleton(card, teamSummaries, resultsReadyForDisplay),
  ).length
  useEffect(() => {
    if (sequentialNarrativeCards.length <= 0) {
      return undefined
    }

    const cardNodes = narrativeStreamRef.current?.querySelectorAll<HTMLElement>('[data-narrative-card]')
    const target = cardNodes?.item(sequentialNarrativeCards.length - 1) ?? null
    return startDeepScanMobileAutoScroll(target)
  }, [sequentialNarrativeCards.length, settledCommitteeCardCount])
  const teamBridgeState = buildTeamBridgeState(elapsedSeconds, resultsReadyForDisplay)
  const isTeamBridgeVisible = Boolean(teamBridgeState)
  // 브리핑 배열의 순차 공개(5초 리듬)는 결과가 언제 도착하든 시퀀스가 끝날 때까지
  // 재생되어야 한다(2026-10-28 사용자 지시 — 캐시 재사용·빠른 완료 모두 해당).
  // 타임라인은 시퀀스 완료 시각까지 항상 진행하고, 아이템 forceReady는 시퀀스
  // 완료 전에는 켜지 않는다. 상태바(completionState)·브리지 억제는 기존 그대로.
  // 위원 카드가 81초 이후에 완성되는 흐름에서는 종합 결론 공개(+n초)까지 타이머를 연장한다.
  const shouldAdvanceTimeline = elapsedSeconds < TEAM_SEQUENCE_COMPLETE_SECONDS
    || (teamsSettledAtSeconds !== null && elapsedSeconds < teamsSettledAtSeconds + CONCLUSION_REVEAL_DELAY_AFTER_TEAMS_SECONDS)
  const progressPct = resultsReadyForDisplay ? 100 : Math.min(92, 12 + elapsedSeconds * 7)
  const activeNarrativeCard = sequentialNarrativeCards.findLast((card) => !card.placeholder) ?? sequentialNarrativeCards.at(-1) ?? visibleNarrativeCards.at(-1) ?? orderedNarrativeCards[0]
  const progressLabel = resultsReadyForDisplay
    ? '상세 결과 준비 완료'
    : teamBridgeState
      ? teamBridgeState.statusText
    : activeNarrativeCard.placeholder
      ? '분석가 응답을 기다리는 중…'
      : `${activeNarrativeCard.analystName}가 살펴보는 중…`

  useEffect(() => {
    if (!shouldAdvanceTimeline) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1)
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [shouldAdvanceTimeline])

  useEffect(() => (
    isTeamBridgeVisible
      ? startDeepScanMobileAutoScroll(teamBridgeRef.current)
      : undefined
  ), [isTeamBridgeVisible])

  // 팀 요약 fetch: 스테이지가 갱신돼도 진행 중 요청을 취소하지 않는다. 이전 구현은 effect
  // 재실행 시 공유 AbortController로 진행 중 fetch를 abort했고, abort된 요청은 상태를
  // 'error'로조차 바꾸지 않아 UI가 영구히 '요약 중'에 갇혔다. 발사 중복은 코디네이터가 막고,
  // 같은 팀에 새 요청이 들어오면 이전 요청의 결과는 파기한다. 실패 확정은 서버 타임아웃(10s
  // 기본)보다 여윈 개별 요청 타임아웃으로만 한다 — 실패 시 '요약 생략'으로 전환된다.
  useEffect(() => {
    const pendingRequests = teamSummaryFetchCoordinatorRef.current.claimPendingRequests(teamSummaryRequests)

    pendingRequests.forEach((request) => {
      const { teamKey, inputKey, requestKey } = request

      setTeamSummaries((previous) => ({
        ...previous,
        [teamKey]: { inputKey, status: 'loading' },
      }))

      fetch('/api/deepscan/team-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TEAM_SUMMARY_FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          teamKey: request.cardKey,
          teamName: request.analystName,
          body: request.body,
          market,
          instrumentKind: exchangeProduct ? 'etf' : 'stock',
        }),
      })
        .then(async (response) => {
          const body = await response.json().catch(() => null) as { ok?: boolean; summary?: unknown } | null
          const summary = body?.ok === true ? normalizeSummaryText(body.summary) : null
          if (!response.ok || !summary) {
            throw new Error('team summary unavailable')
          }

          if (!teamSummaryFetchCoordinatorRef.current.isLatestRequest(teamKey, requestKey)) {
            return
          }

          setTeamSummaries((previous) => ({
            ...previous,
            [teamKey]: { inputKey, status: 'success', summary },
          }))
        })
        .catch(() => {
          if (!teamSummaryFetchCoordinatorRef.current.isLatestRequest(teamKey, requestKey)) {
            return
          }

          setTeamSummaries((previous) => ({
            ...previous,
            [teamKey]: { inputKey, status: 'error' },
          }))
        })
    })
  }, [exchangeProduct, market, teamSummaryRequests])

  return (
    <div className={cn(styles.loadingCard, className)}>
      <header className={styles.topBar}>
        <div className={styles.topBarRow}>
          <BackControl onBack={onBack} backHref={backHref} />
          <div className={styles.stockIdentity}>
            <h1 className={styles.stockName}>{name}</h1>
            <p className={styles.stockCode}>{[targetLine, sharesText ? `보유 ${sharesText}` : null].filter(Boolean).join(' · ') || '분석 대상 확인 중'}</p>
          </div>
          <div className={styles.stockPriceBox}>
            <p className={styles.stockPrice}>{currentPriceText ?? '현재가 확인 중'}</p>
            <p className={cn(styles.stockChange, financialToneClass(returnRateDisplay.current))}>
              <span className={styles.returnRateContext}>현재가 기준</span>{' '}
              {returnRateDisplay.current ?? '계산 중'}
            </p>
            {returnRateDisplay.snapshot ? (
              <p className={styles.snapshotReturnRate}>
                촬영 당시 <strong className={financialToneClass(returnRateDisplay.snapshot)}>{returnRateDisplay.snapshot}</strong>
              </p>
            ) : null}
          </div>
        </div>
        <div className={cn(styles.headerProgress, isError ? styles.headerProgressError : resultsReadyForDisplay ? styles.headerProgressDone : undefined)} aria-label={isError ? '딥스캔 실패' : resultsReadyForDisplay ? '딥스캔 완료' : '딥스캔 진행 중'}>
          <span className={styles.headerProgressText}>{isError ? '분석 요청에 실패했어요' : progressLabel}</span>
          <span className={styles.headerProgressTrack} aria-hidden='true'>
            <span className={styles.headerProgressFill} style={{ width: `${isError ? 100 : progressPct}%` }} />
          </span>
          <span className={styles.headerProgressTime}>{isError ? '실패' : resultsReadyForDisplay ? '완료' : formatElapsedTime(elapsedSeconds)}</span>
        </div>
      </header>

      {headerNotice ? <div className={cn(styles.body, styles.headerNoticeSlot)}>{headerNotice}</div> : null}

      <div className={styles.body}>
        {isError ? (
          <section className={styles.errorCard} aria-label='딥스캔 오류'>
            <div className={styles.errorHead}>
              <span className={styles.errorIcon} aria-hidden='true'>!</span>
              <div>
                <span className={styles.errorEyebrow}>
                  {errorNotice?.badge && errorNotice.badge !== '오류' ? errorNotice.badge : '분석 요청 실패'}
                </span>
                <h2 className={styles.errorTitle}>{errorNotice?.title ?? 'DeepScan 데이터를 표시할 수 없어요'}</h2>
              </div>
            </div>
            <p className={styles.errorBody}>{errorNotice?.body ?? '분석 데이터 요청에 실패했습니다. 잠시 후 다시 시도해주세요.'}</p>
            <div className={styles.errorActions}>
              {errorPrimaryAction ? (
                <Link href={errorPrimaryAction.href} className={styles.errorRetryButton}>{errorPrimaryAction.label}</Link>
              ) : onRetry ? (
                <button type='button' className={styles.errorRetryButton} onClick={onRetry}>다시 시도</button>
              ) : null}
              <Link href={backHref} className={styles.errorBackLink}>다른 종목 선택</Link>
            </div>
          </section>
        ) : (
          <>
        <section className={styles.intro} aria-label='딥스캔 안내'>
          <p className={styles.introGreet}>{new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}</p>
          {introMention ? (
            <h2 className={styles.introTitle}>{introMention}</h2>
          ) : (
            <h2 className={styles.introTitle}>세 분석가가 {exchangeProduct ? 'ETF를' : '종목을'}<br />차례로 살펴보고 있어요</h2>
          )}
          <p className={styles.introBody}>{resultsReadyForDisplay ? (snapshotCacheHit ? '저장해둔 분석 결과를 불러왔어요. 아래 결과 카드가 바로 이어집니다.' : '실제 응답이 도착했어요. 아래 결과 카드가 바로 이어집니다.') : '완료 신호가 오면 기다림 없이 이 화면 아래에 결과가 이어집니다.'}</p>
        </section>

        {/* 목표가 미제공 종목 — 결과가 확정된 뒤에도 항목을 통째로 숨기지 않고 스캘래톤 →
            '증권사 목표가가 아직 없어요' 안내로 마무리한다(2026-10-29 사용자 지시).
            로딩 중(데이터 도착 가능)에는 null이라 스캘래톤이 유지되고, ETF는 기존대로 미표시. */}
        <TodayBriefingCard
          currentPriceText={currentPriceText}
          currentPriceCurrency={currentPriceCurrency}
          averagePriceText={averagePriceText}
          averagePriceCurrency={averagePriceCurrency}
          usdKrwRate={usdKrwRate}
          sharesText={sharesText}
          profitRateText={profitRateText}
          profitAmountText={profitAmountText}
          elapsedSeconds={elapsedSeconds}
          forceReady={resultsReadyForDisplay && elapsedSeconds >= TEAM_SEQUENCE_COMPLETE_SECONDS}
          briefingSnapshot={briefingSnapshot}
          tradingVolumeText={tradingVolumeText}
          consensus={consensusData}
          consensusPendingSkeleton={!exchangeProduct}
          consensusEmptyState={resultsReadyForDisplay && !exchangeProduct ? DEEPSCAN_CONSENSUS_EMPTY_STATE_TEXT : null}
          dailyCloses={briefingDailyCloses}
          seedKey={identifier}
        />

        {standaloneQuickFacts.length > 0 ? (
          <section className={styles.quickFactsCard} aria-label='수집된 빠른 근거'>
            {standaloneQuickFacts.map((fact) => <QuickFactCard key={fact.key} fact={fact} />)}
          </section>
        ) : null}

        <section ref={teamBridgeRef} className={cn(styles.teamBridgeCard, teamBridgeState ? styles.teamBridgeCardShow : styles.teamBridgeCardDone)} aria-label='세 팀 분석 전환 상태' aria-hidden={teamBridgeState ? undefined : true}>
          <p className={styles.teamBridgeText}>시세는 다 봤어요. 이제 <b>세 팀이 더 깊이</b> 분석하는 중이에요.</p>
          <div className={styles.teamBridgeProgress}>
            <span className={styles.teamBridgeSpinner} aria-hidden='true' />
            <span className={styles.teamBridgeStatus}>{teamBridgeState?.statusText ?? '세 팀이 의견을 정리하는 중…'}</span>
            <span className={styles.teamBridgeTime}>{teamBridgeState?.remainingText ?? '0:00'}</span>
          </div>
        </section>

        <section ref={narrativeStreamRef} className={styles.narrativeStream} aria-label='분석가 진행 메시지'>
          {sequentialNarrativeCards.map((card) => {
            const {
              summaryReady,
              summaryLoading,
              summaryFailed,
              summaryText,
            } = getTeamSummaryState(card, teamSummaries)
            const fallbackSummaryText = buildNarrativeFallbackSummary(card, Boolean(summaryFailed), resultsReadyForDisplay)
            const resolvedSummaryText = summaryText ?? fallbackSummaryText
            const summaryCollapsible = Boolean(summaryText && shouldCollapseTeamSummaryText(summaryText))
            const summaryExpanded = Boolean(card.teamKey && expandedTeamSummaries.has(card.teamKey))
            const displaySummaryText = summaryText && summaryCollapsible && !summaryExpanded ? getCollapsedTeamSummaryText(summaryText) : resolvedSummaryText
            const summaryTextId = `team-summary-${card.key}`
            const showSummarySkeleton = shouldShowDeepScanSummarySkeleton({ placeholder: card.placeholder, resolvedSummaryText })
            const cardSettled = resultsReadyForDisplay || card.complete
            const statusLabel = summaryReady ? '요약 완료' : summaryLoading ? '요약 중' : summaryFailed ? '요약 생략' : cardSettled && !card.complete ? '확인 가능한 정보' : card.statusLabel
            const statusTone = summaryReady ? 'positive' : summaryLoading ? 'info' : summaryFailed ? 'warning' : cardSettled && !card.complete ? 'info' : card.statusTone
            const tags = [
              ...card.tags,
              card.summarizable
                ? { text: summaryReady ? '요약 완료' : summaryFailed ? '요약 생략' : '요약 중', tone: summaryReady ? 'positive' as const : summaryFailed ? 'warning' as const : 'info' as const }
                : null,
            ].filter((tag): tag is { text: string; tone: NarrativeTone } => Boolean(tag))

            return (
              <article key={card.key} data-narrative-card={card.key} className={cn(styles.narrativeCard, cardSettled ? undefined : styles.narrativeCardPending)}>
                <div className={styles.narrativeHead}>
                  <span className={cn(styles.narrativeAvatar, card.placeholder && !card.teamKey ? styles.narrativeAvatarPending : undefined)} aria-hidden='true'>{card.placeholder && !card.teamKey ? <Loader2 className={styles.narrativeSpinner} aria-hidden /> : typeof card.avatar === 'string' || card.avatar == null ? card.avatar : <card.avatar className='size-[18px]' aria-hidden />}</span>
                  <div className={styles.narrativeNameWrap}>
                    <strong>{card.placeholder && !card.teamKey ? <span className={styles.narrativeTitleSkeleton} aria-hidden='true' /> : card.analystName}</strong>
                    <span>{card.placeholder && !card.teamKey ? <span className={styles.narrativeDescriptionSkeleton} aria-hidden='true' /> : card.description}</span>
                  </div>
                  <span className={cn(styles.narrativeStatus, narrativeToneClass(statusTone))}>{statusLabel}</span>
                </div>
                <div className={styles.narrativeBubble}>
                  {card.placeholder || showSummarySkeleton ? (
                    <div className={styles.narrativeTextSkeleton} aria-hidden='true'>
                      <span />
                    </div>
                  ) : (
                    <div className={styles.narrativeSummaryTextWrap}>
                      <p className={cn(styles.narrativeText, styles.narrativeTextSummarized)} id={summaryTextId}>{parseDeepScanEmphasisSegments(displaySummaryText ?? '').map((segment, index) => segment.bold
                        ? <strong key={index} className={styles.narrativeTextStrong}>{segment.text}</strong>
                        : <Fragment key={index}>{segment.text}</Fragment>)}</p>
                      {summaryCollapsible && card.teamKey ? (
                        <button
                          type='button'
                          className={styles.narrativeSummaryAppendixToggle}
                          aria-expanded={summaryExpanded}
                          aria-controls={summaryTextId}
                          onClick={() => {
                            setExpandedTeamSummaries((previous) => {
                              const next = new Set(previous)
                              if (next.has(card.teamKey!)) {
                                next.delete(card.teamKey!)
                              } else {
                                next.add(card.teamKey!)
                              }
                              return next
                            })
                          }}
                        >
                          <span>{summaryExpanded ? '상세 해석 접기' : '상세 해석 펼치기'}</span>
                          <span className={styles.narrativeSummaryAppendixIcon} aria-hidden='true'>{summaryExpanded ? '⌃' : '⌄'}</span>
                        </button>
                      ) : null}
                    </div>
                  )}
                  <div className={styles.narrativeTags}>
                    {tags.map((tag) => (
                      <span key={`${card.key}-${tag.text}`} className={cn(styles.narrativeTag, narrativeToneClass(tag.tone))}>{tag.text}</span>
                    ))}
                  </div>
                </div>
              </article>
            )
          })}
        </section>

        {(() => {
          // 원금회수 예측 — 기존 '실제 분석 결과가 도착했어요'(완료 카드) 자리의 독립 컴포넌트.
          // 브리핑 배열에서 빼고 이 위치로 이동(2026-10-28 사용자 지시). payload 블록이 최우선,
          // 로딩 중에는 브리핑 스냅샷 프리뷰. 수익 구간(평단 이상)은 미표시.
          const recoverySource = payloadRecoveryForecast && payloadRecoveryForecast.blockState === 'ok'
            ? payloadRecoveryForecast
            : briefingSnapshot?.recoveryForecast ?? null
          if (!recoverySource) {
            return null
          }
          const recoveryCurrent = payloadRecoveryForecast?.currentPrice
          const recoveryTarget = payloadRecoveryForecast?.targetPrice
          if (payloadRecoveryForecast && (recoveryCurrent == null || recoveryTarget == null || recoveryCurrent >= recoveryTarget)) {
            return null
          }
          // 공개 순서: 브리핑 배열 전체(스캘래톤 포함) 공개가 끝나고 → 위원(세 팀) 카드가 완전히
          // 렌더링된 뒤에 등장한다(2026-10-29 — 81초 절대 게이트를 배열 완료·위원 완성 시점 기준
          // 상대 게이트로 교체). 종합 결론은 이 카드 뒤 n초 뒤에 이어진다.
          if (!resultsReadyForDisplay || teamsSettledAtSeconds === null || elapsedSeconds < Math.max(TODAY_BRIEFING_ARRAY_COMPLETE_SECONDS, teamsSettledAtSeconds)) {
            return null
          }
          // 완료 카드 자리 — 브리핑 배열과 같은 개인 카드 컨테이너(todayBriefingCard)로 감싼다.
          // 배열 밖으로 옮겨온 뒤 카드 없이 내용이 바로 깔리는 문제 수정(2026-10-28 사용자 지시).
          return (
            <section className={styles.todayBriefingCard} aria-label='원금회수 예측'>
              <div className={styles.todayBriefList}>
                <TodayRecoveryForecastBriefing at={0} elapsedSeconds={0} forceReady recovery={recoverySource} />
              </div>
            </section>
          )
        })()}

        {inlineResultsReady && inlineResults ? <div className={styles.inlineResultsSlot}>{inlineResults}</div> : null}
          </>
        )}
        <p className={styles.privacy}>분석 결과는 투자 권유가 아닌 참고 자료입니다.</p>
      </div>
    </div>
  )
}
