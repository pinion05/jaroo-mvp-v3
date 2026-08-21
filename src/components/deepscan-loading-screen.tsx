'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import {
  shouldAdvanceDeepScanTimeline,
  shouldDisplayDeepScanReadyResults,
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
  committeeMembers,
  TEAM_SEQUENCE_COMPLETE_SECONDS,
} from './deepscan-loading-types'

import {
  buildCompletionState,
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
  hashSummaryInput,
  isExchangeTradedProduct,
  isHiddenLoadingQuickFact,
  memberStateClass,
  narrativeToneClass,
  normalizeSummaryText,
  parseNumericValue,
  shouldCollapseTeamSummaryText,
  startDeepScanMobileAutoScroll,
  buildNarrativeFallbackSummary,
} from './deepscan-loading-utils'

import { resolveDeepScanLoadingCurrentPrice } from '@/lib/deepscan-loading-current-price'

import {
  BackControl,
  QuickFactCard,
  TodayBriefingCard,
} from './deepscan-loading-briefing-card'

export function DeepScanLoadingScreen({
  name = '선택 종목',
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
  findingProgress,
  committeeAxes,
  quickFacts = [],
  performanceComment,
  evidenceCollected = false,
  visibleStageCount = 1,
  arrivedStageKeys = [],
  resultsReady = false,
  className,
  onBack,
  backHref = '/home',
  inlineResults,
  errorNotice,
  onRetry,
}: DeepScanLoadingScreenProps) {
  const isError = Boolean(errorNotice)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [teamSummaries, setTeamSummaries] = useState<Partial<Record<LoadingStageKey, TeamSummaryState>>>({})
  const [expandedTeamSummaries, setExpandedTeamSummaries] = useState<ReadonlySet<LoadingStageKey>>(() => new Set())
  const requestedTeamSummariesRef = useRef<Set<string>>(new Set())
  const teamBridgeRef = useRef<HTMLElement | null>(null)
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
    () => buildOrderedNarrativeCards(loadingStages, arrivedStageKeys),
    [arrivedStageKeys, loadingStages],
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
    () => buildSequentialNarrativeCards(timelineNarrativeCards, teamSummaries),
    [teamSummaries, timelineNarrativeCards],
  )
  const completionState = buildCompletionState(resultsReadyForDisplay, elapsedSeconds)
  const teamBridgeState = buildTeamBridgeState(elapsedSeconds, resultsReadyForDisplay)
  const isTeamBridgeVisible = Boolean(teamBridgeState)
  const shouldAdvanceTimeline = shouldAdvanceDeepScanTimeline({ resultsReadyForDisplay, elapsedSeconds, sequenceCompleteSeconds: TEAM_SEQUENCE_COMPLETE_SECONDS })
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

  useEffect(() => {
    const controller = new AbortController()
    let stopped = false

    teamSummaryRequests.forEach((request) => {
      const { teamKey, inputKey, requestKey } = request
      if (requestedTeamSummariesRef.current.has(requestKey)) {
        return
      }

      requestedTeamSummariesRef.current.add(requestKey)
      setTeamSummaries((previous) => ({
        ...previous,
        [teamKey]: { inputKey, status: 'loading' },
      }))

      fetch('/api/deepscan/team-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
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

          if (stopped || controller.signal.aborted) {
            return
          }

          setTeamSummaries((previous) => ({
            ...previous,
            [teamKey]: { inputKey, status: 'success', summary },
          }))
        })
        .catch(() => {
          if (stopped || controller.signal.aborted) {
            return
          }

          setTeamSummaries((previous) => ({
            ...previous,
            [teamKey]: { inputKey, status: 'error' },
          }))
        })
    })

    return () => {
      stopped = true
      controller.abort()
    }
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

      <div className={styles.body}>
        {isError ? (
          <section className={styles.errorCard} aria-label='딥스캔 오류'>
            <div className={styles.errorHead}>
              <span className={styles.errorIcon} aria-hidden='true'>!</span>
              <div>
                <span className={styles.errorEyebrow}>분석 요청 실패</span>
                <h2 className={styles.errorTitle}>{errorNotice?.title ?? 'DeepScan 데이터를 표시할 수 없어요'}</h2>
              </div>
            </div>
            <p className={styles.errorBody}>{errorNotice?.body ?? '분석 데이터 요청에 실패했습니다. 잠시 후 다시 시도해주세요.'}</p>
            <div className={styles.errorActions}>
              {onRetry ? (
                <button type='button' className={styles.errorRetryButton} onClick={onRetry}>다시 시도</button>
              ) : null}
              <Link href={backHref} className={styles.errorBackLink}>다른 종목 선택</Link>
            </div>
          </section>
        ) : (
          <>
        <section className={styles.intro} aria-label='딥스캔 안내'>
          <p className={styles.introGreet}>{new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}</p>
          <h2 className={styles.introTitle}>세 분석가가 {exchangeProduct ? 'ETF를' : '종목을'}<br />차례로 살펴보고 있어요</h2>
          <p className={styles.introBody}>{resultsReadyForDisplay ? '실제 응답이 도착했어요. 아래 결과 카드가 바로 이어집니다.' : '완료 신호가 오면 기다림 없이 이 화면 아래에 결과가 이어집니다.'}</p>
        </section>

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
          forceReady={resultsReadyForDisplay}
          briefingSnapshot={briefingSnapshot}
          tradingVolumeText={tradingVolumeText}
          consensus={consensusData}
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

        <section className={styles.narrativeStream} aria-label='분석가 진행 메시지'>
          {sequentialNarrativeCards.map((card) => {
            const {
              summaryReady,
              summaryLoading,
              summaryFailed,
              summaryText,
            } = getTeamSummaryState(card, teamSummaries)
            const fallbackSummaryText = buildNarrativeFallbackSummary(card, Boolean(summaryFailed))
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
              <article key={card.key} className={cn(styles.narrativeCard, cardSettled ? undefined : styles.narrativeCardPending)}>
                <div className={styles.narrativeHead}>
                  <span className={cn(styles.narrativeAvatar, card.placeholder && !card.teamKey ? styles.narrativeAvatarPending : undefined)} aria-hidden='true'>{card.placeholder && !card.teamKey ? <Loader2 className={styles.narrativeSpinner} aria-hidden /> : card.avatar}</span>
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
                      <p className={cn(styles.narrativeText, styles.narrativeTextSummarized)} id={summaryTextId}>{displaySummaryText}</p>
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

        {resultsReadyForDisplay ? (
          <section className={cn(styles.completionCard, styles.completionCardReady)} aria-label='완료 전환 상태'>
            <div className={styles.completionHead}>
              <span className={styles.completionIcon} aria-hidden='true'>✓</span>
              <div>
                <span className={styles.completionEyebrow}>{completionState.eyebrow}</span>
                <h2 className={styles.completionTitle}>{completionState.title}</h2>
              </div>
            </div>
            <p className={styles.completionBody}>{completionState.body}</p>
          </section>
        ) : null}

        <details className={styles.progressDetails}>
          <summary className={styles.progressDetailsSummary}>세부 진행 단계·분석 상태</summary>
          <div className={styles.stepsWrap} aria-label='분석 단계'>
            {[
              { label: '대상 종목 확인', state: 'done' },
              { label: '근거 데이터 수집', state: evidenceCollected ? 'done' : 'active' },
              { label: '세 팀 분석 대기', state: resultsReadyForDisplay ? 'done' : evidenceCollected ? 'active' : 'wait' },
              { label: '상세 리포트 연결', state: resultsReadyForDisplay ? 'done' : 'wait' },
            ].map((step, index) => {
              const isDone = step.state === 'done'
              const isActive = step.state === 'active'

              return (
                <div key={step.label} className={styles.stepRow}>
                  <div className={cn(styles.stepIcon, isDone && styles.stepDone, isActive && styles.stepActive, !isDone && !isActive && styles.stepWait)}>
                    {isDone ? <CheckCircle2 className={styles.stepSvg} aria-hidden /> : isActive ? <Loader2 className={styles.stepSvg} aria-hidden /> : index + 1}
                  </div>
                  <div className={cn(styles.stepLabel, isDone && styles.stepLabelDone, isActive && styles.stepLabelActive, !isDone && !isActive && styles.stepLabelWait)}>
                    {step.label}
                  </div>
                  {index === 2 ? <div className={styles.stepCount}>{resultsReadyForDisplay ? '완료' : `${committeeMembers.length}명 대기`}</div> : null}
                </div>
              )
            })}
          </div>

          <section className={styles.committeeWrap} aria-label='세 팀 분석 진행 상태'>
            <div className={styles.committeeTitle}>{resultsReadyForDisplay ? '세 팀 분석 완료' : '세 팀 분석 대기 중'}</div>
            <div className={styles.membersGrid}>
              {committeeMembers.map((member) => (
                <div key={member.key} className={styles.member}>
                  <div className={cn(styles.memberIcon, memberStateClass(resultsReadyForDisplay ? 'done' : member.state))}>
                    <member.Icon className={styles.memberSvgIcon} aria-hidden />
                  </div>
                  <div className={styles.memberName}>
                    {member.label.split('\n').map((line) => (
                      <span key={line}>
                        {line}
                        <br />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </details>

        {resultsReadyForDisplay && inlineResults ? <div className={styles.inlineResultsSlot}>{inlineResults}</div> : null}
          </>
        )}
        <p className={styles.privacy}>분석 결과는 투자 권유가 아닌 참고 자료입니다.</p>
      </div>
    </div>
  )
}
