'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ListChecks,
  ShieldAlert,
  Telescope,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { EtfDataNoticeCard } from '@/components/etf-data-notice-card'
import { BackControl, TodayBriefingCard } from '@/components/deepscan-loading-briefing-card'
import { SnapshotProvenanceBar } from '@/components/deepscan-inline-results'
import { financialToneClass, formatNumber, formatSignedPercent } from '@/components/deepscan-loading-utils'
import styles from '@/components/deepscan-loading-screen.module.css'
import { EtfAiCommitteeCard } from './etf-ai-committee-card'
import { EtfResultCardShell } from './etf-result-card-shell'
import {
  buildEtfCommitteeStatusUrl,
  buildEtfCommitteeUrl,
  buildEtfPageBriefingUrl,
  buildEtfPageProfileUrl,
  buildEtfPageState,
  createInitialEtfPageState,
  isNotAnEtfProfileStatus,
  parseEtfBriefingSnapshotResponse,
  parseEtfCommitteeResponse,
  parseEtfCommitteeStatusResponse,
  parseEtfProfileCacheInfo,
  parseEtfProfileResponse,
  resolveEtfPageTargetFromWindow,
  shouldContinueEtfCommitteePolling,
  type EtfCommitteeState,
  type EtfPageState,
} from './etf-page-model'
import type { EtfNoticeReason, EtfViewModel } from '@/lib/etf/etf-view-model'
import type { LoadingBriefingSnapshot } from '@/lib/deepscan-briefing-snapshot'
import { cn } from '@/lib/utils'

// 딥스캔 결과 화면(deepscan-loading-screen 셸 + TodayBriefingCard + 결과 카드 문법)과
// 같은 구조를 그대로 재사용한다 — ETF 버전은 시세 브리핑 + 상품 정보 + 사유 명시 카드로 구성.

const MARKET_LABEL: Record<string, string> = {
  kospi: 'KOSPI',
  kosdaq: 'KOSDAQ',
  us: 'US',
}

function formatShares(shares: number) {
  return `${formatNumber(shares)}주`
}

function EtfProductCard({ vm }: { vm: EtfViewModel }) {
  const stats = vm.hero.stats
  const hasDetail = vm.basicInfo.items.length > 0
  const headline = vm.header.tracking.replace(' 추종', '') || vm.header.issuer || '상품 정보 확인 중'

  return (
    <EtfResultCardShell eyebrow='상품 정보' title='기본 정보'>
      <div className='px-4 py-5 text-center'>
        <div className='text-[10px] text-[#97A0AE]'>기준지수</div>
        <div className='mt-1 text-[28px] font-black leading-none text-[#0F1419]'>{headline}</div>
        {vm.header.issuer ? <p className='mt-2 text-[12px] text-[#5A6473]'>{vm.header.issuer} 운용</p> : null}
      </div>

      {stats.length > 0 ? (
        <div className='grid grid-cols-3 border-t border-[#EFF1F4]'>
          {stats.map((item) => (
            <div key={item.label} className='border-r border-[#EFF1F4] px-3 py-3 last:border-r-0'>
              <div className='text-[10px] text-[#97A0AE]'>{item.label}</div>
              <div className='mt-1 text-[13px] font-bold text-[#0F1419]'>{item.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {hasDetail ? (
        <div className='border-t border-[#EFF1F4] px-4 py-4'>
          <div className='mb-1 text-[10px] text-[#97A0AE]'>상세 정보</div>
          <div className='divide-y divide-[#EFF1F4]'>
            {vm.basicInfo.items.map((item) => (
              <div key={item.label} className='flex items-center justify-between py-3 first:pt-2 last:pb-0'>
                <span className='text-[12px] text-[#97A0AE]'>{item.label}</span>
                <span className='text-[13px] font-bold text-[#0F1419]'>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </EtfResultCardShell>
  )
}

function EtfNoticeSection({
  eyebrow,
  reason,
  message,
  icon: Icon,
}: {
  eyebrow: string
  reason: EtfNoticeReason
  message: string
  icon: LucideIcon
}) {
  return <EtfDataNoticeCard eyebrow={eyebrow} reason={reason} message={message} icon={Icon} />
}

// 구성 종목 통합 카드 — 이슈 #270. 목표가(52주 위치) 자리를 구성 종목 요약+리스트로 교체.
// 문법은 기존 결과 카드 그대로: 중앙 강조 + 게이지 + 리스트 + 노트.
function EtfHoldingsSummaryCard({ vm }: { vm: EtfViewModel }) {
  if (vm.topHoldings.notice || !vm.topHoldings.items) {
    return (
      <EtfNoticeSection
        eyebrow='구성 종목'
        reason={vm.topHoldings.notice!.reason}
        message={vm.topHoldings.notice!.message}
        icon={ListChecks}
      />
    )
  }

  const items = vm.topHoldings.items
  const headline = vm.topHoldings.headline
  return (
    <EtfResultCardShell eyebrow='구성' title='구성 종목' badge={`상위 ${items.length}개`}>
      <div className='px-4 py-5 text-center'>
        <div className='text-[10px] text-[#97A0AE]'>{headline.concentrationCaptionText}</div>
        <div className='mt-1 text-[28px] font-black leading-none text-[#0F1419]'>{headline.concentrationText}</div>
        <div className='mx-auto mt-3 h-[5px] w-[200px] overflow-hidden rounded-full bg-[#EFF1F4]'>
          <div className='h-full rounded-full bg-[#2B6BE6]' style={{ width: `${headline.concentrationPct}%` }} />
        </div>
      </div>
      <div className='border-t border-[#EFF1F4] px-4 py-3'>
        <div className='space-y-3'>
          {items.map((holding) => (
            <div key={`${holding.rank}-${holding.code}`}>
              <div className='mb-1 flex items-center gap-2 text-[13px]'>
                <span className='size-2 shrink-0 rounded-full bg-[#2B6BE6]' />
                <span className='min-w-0 truncate font-bold text-[#0F1419]'>{holding.name}</span>
                <span className='shrink-0 text-[10px] text-[#97A0AE]'>{holding.code}</span>
                <span className='ml-auto shrink-0 font-bold text-[#5A6473]'>{holding.weightText}</span>
              </div>
              <div className='h-[5px] overflow-hidden rounded-full bg-[#EFF1F4]'>
                <div className='h-full rounded-full bg-[#2B6BE6]' style={{ width: `${holding.weightBarPct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className='border-t border-[#EFF1F4] px-4 py-3 text-[10px] leading-4 text-[#97A0AE]'>
        {headline.sourceText} · {headline.commentText}
      </p>
    </EtfResultCardShell>
  )
}

function EtfReturnsCard({ vm }: { vm: EtfViewModel }) {
  if (vm.returns.notice || !vm.returns.items) {
    return (
      <EtfNoticeSection
        eyebrow='기간별 수익률'
        reason={vm.returns.notice!.reason}
        message={vm.returns.notice!.message}
        icon={Telescope}
      />
    )
  }

  return (
    <EtfResultCardShell eyebrow='수익률' title='기간별 수익률'>
      <div className='grid grid-cols-4'>
        {vm.returns.items.map((item, index) => (
          <div key={item.label} className={cn('px-3 py-4', index < vm.returns.items!.length - 1 && 'border-r border-[#EFF1F4]')}>
            <div className='text-[10px] text-[#97A0AE]'>{item.label}</div>
            <div className={cn('mt-1 text-[13px] font-bold', financialToneClass(item.value))}>{item.value}</div>
          </div>
        ))}
      </div>
    </EtfResultCardShell>
  )
}

function EtfRiskCard({ vm }: { vm: EtfViewModel }) {
  if (vm.riskMetrics.notice || !vm.riskMetrics.items) {
    return (
      <EtfNoticeSection
        eyebrow='리스크 지표'
        reason={vm.riskMetrics.notice!.reason}
        message={vm.riskMetrics.notice!.message}
        icon={ShieldAlert}
      />
    )
  }

  const items = vm.riskMetrics.items
  return (
    <EtfResultCardShell eyebrow='리스크' title='리스크 지표'>
      <div className='grid grid-cols-2'>
        {items.map((item, index) => (
          <div
            key={item.label}
            className={cn(
              'border-[#EFF1F4] px-4 py-3',
              index % 2 === 0 && 'border-r',
              index < items.length - (items.length % 2 === 0 ? 2 : 1) && 'border-b',
            )}
          >
            <div className='text-[10px] text-[#97A0AE]'>{item.label}</div>
            <div className='mt-1 text-[14px] font-bold text-[#0F1419]'>{item.value}</div>
            <div className='mt-0.5 text-[10px] text-[#97A0AE]'>{item.subtitle}</div>
          </div>
        ))}
      </div>
    </EtfResultCardShell>
  )
}

function EtfShareCard() {
  return (
    <article className='rounded-[16px] bg-[#0F1419] px-4 py-[18px] text-white'>
      <h3 className='text-[14.5px] font-bold tracking-[-0.2px]'>분석 결과를 공유해보세요</h3>
      <p className='mt-1.5 text-[12px] leading-[1.65] text-white/60'>
        오늘 기준 시세와 상품 정보를 한 장의 카드로 정리해드려요.
      </p>
      <Link
        href='/sharecard'
        className='mt-3 flex w-full items-center justify-center rounded-[11px] bg-white px-3 py-[13px] text-[13.5px] font-bold text-[#0F1419] transition-colors active:scale-[0.99]'
      >
        결과 공유하기
      </Link>
      <Link
        href='/home'
        className='mt-2 flex w-full items-center justify-center rounded-[11px] bg-white/10 px-3 py-[11px] text-[12.5px] font-semibold text-white/85 transition-colors active:scale-[0.99]'
      >
        홈으로 가기
      </Link>
    </article>
  )
}

function EtfGuideStateCard({
  title,
  body,
  ctaLabel,
  ctaHref,
  onCta,
}: {
  title: string
  body: string
  ctaLabel: string
  ctaHref?: string
  onCta?: () => void
}) {
  const ctaClass =
    'mt-4 flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[#185fa5] text-[14px] font-extrabold text-white transition hover:bg-[#0c447c]'

  return (
    <article className='overflow-hidden rounded-[16px] border border-[#E8EAEE] bg-white shadow-[0_1px_3px_rgba(0,0,0,.04)]'>
      <div className='flex items-center gap-3 border-b border-[#EFF1F4] px-4 py-4'>
        <div className='flex size-9 items-center justify-center rounded-[10px] bg-[#0F1419] text-[12px] font-black text-white'>
          ETF
        </div>
        <div className='min-w-0 flex-1'>
          <div className='text-[10px] text-[#97A0AE]'>ETF 분석</div>
          <h2 className='text-[14px] font-bold text-[#0F1419]'>{title}</h2>
        </div>
      </div>
      <div className='px-4 py-4'>
        <p className='text-[13px] leading-6 text-[#5A6473]'>{body}</p>
        {ctaHref ? (
          <Link href={ctaHref} className={ctaClass}>
            {ctaLabel}
          </Link>
        ) : (
          <button type='button' onClick={onCta} className={ctaClass}>
            {ctaLabel}
          </button>
        )}
      </div>
    </article>
  )
}

function EtfReadyBody({
  vm,
  briefing,
  sharesText,
  market,
  committee,
  onCommitteeRetry,
}: {
  vm: EtfViewModel
  briefing: LoadingBriefingSnapshot
  sharesText: string | null
  market: 'kospi' | 'kosdaq' | 'us'
  committee: EtfCommitteeState
  onCommitteeRetry: () => void
}) {
  const quote = briefing.quote
  const changePct = quote?.changePct ?? null
  const volumeText = typeof quote?.volume === 'number' ? formatNumber(quote.volume) : null

  return (
    <>
      <section className={styles.intro} aria-label='ETF 분석 안내'>
        <p className={styles.introGreet}>
          {new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}
        </p>
        <h2 className={styles.introTitle}>
          ETF 흐름과 구성을<br />정리해드렸어요
        </h2>
        <p className={styles.introBody}>오늘 장 기준 시세와 상품·구성·리스크를 한 흐름으로 정리해드려요.</p>
      </section>

      <TodayBriefingCard
        currentPriceText={vm.hero.price}
        currentPriceCurrency={market === 'us' ? 'USD' : 'KRW'}
        averagePriceText={vm.hero.averagePrice ? vm.hero.averagePrice.replace('평단 ', '') : null}
        averagePriceCurrency={market === 'us' ? 'USD' : 'KRW'}
        sharesText={sharesText}
        profitRateText={null}
        profitAmountText={null}
        forceReady
        elapsedSeconds={600}
        briefingSnapshot={briefing}
        tradingVolumeText={volumeText}
      />

      {/* 결과 카드 묶음 — 카드 사이 12px 리듬 (브리핑 카드와도 동일 간격) */}
      <div className='mt-3 flex flex-col gap-3'>
        <EtfProductCard vm={vm} />

        {/* 이슈 #270 — 목표가(52주 위치) 자리를 구성 종목 통합 카드로 교체 */}
        <EtfHoldingsSummaryCard vm={vm} />

        {/* 국내 ETF만 — 시장·차트 팀 AI 위원 3명 분석 */}
        <EtfAiCommitteeCard committee={committee} onRetry={onCommitteeRetry} />

        <EtfReturnsCard vm={vm} />
        <EtfRiskCard vm={vm} />

        <EtfShareCard />
      </div>

      <p className='mt-3 px-2 pb-2 text-center text-[10px] leading-4 text-[#97A0AE]'>
        {market === 'us'
          ? '표시된 데이터는 Polygon·Yahoo Finance 기준 실데이터예요. 투자 권유나 수익 보장이 아닙니다.'
          : '표시된 데이터는 네이버 금융·위세리포트 기준 실데이터예요. 투자 권유나 수익 보장이 아닙니다.'}
      </p>
    </>
  )
}

export default function EtfPage() {
  const [state, setState] = useState<EtfPageState>({ phase: 'loading' })
  const [retryCount, setRetryCount] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const loadSeqRef = useRef(0)
  const targetRef = useRef<Parameters<typeof buildEtfPageState>[0] | null>(null)

  useEffect(() => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq

    const run = async () => {
      const target = resolveEtfPageTargetFromWindow()
      if (target.status !== 'ok') {
        targetRef.current = null
        if (loadSeqRef.current === seq) {
          setState(createInitialEtfPageState(target))
        }
        return
      }
      targetRef.current = target

      try {
        const [briefingResponse, profileResponse] = await Promise.all([
          fetch(buildEtfPageBriefingUrl(target.code, target.market), { cache: 'no-store' }),
          fetch(buildEtfPageProfileUrl(target.code), { cache: 'no-store' }),
        ])
        if (loadSeqRef.current !== seq) {
          return
        }
        if (isNotAnEtfProfileStatus(profileResponse.status)) {
          setState({ phase: 'invalid' })
          return
        }
        const [briefingBody, profileBody] = await Promise.all([
          briefingResponse.json().catch(() => null),
          profileResponse.json().catch(() => null),
        ])
        if (loadSeqRef.current !== seq) {
          return
        }
        setState(
          buildEtfPageState(
            target,
            parseEtfBriefingSnapshotResponse(briefingBody),
            parseEtfProfileResponse(profileBody),
            parseEtfProfileCacheInfo(profileBody),
          ),
        )
      } catch {
        if (loadSeqRef.current !== seq) {
          return
        }
        setState({ phase: 'error', message: '시세를 가져오지 못했어요. 잠시 후 다시 시도해주세요.' })
      }
    }

    void run()
  }, [retryCount])

  const retry = useCallback(() => {
    setState({ phase: 'loading' })
    setRetryCount((count) => count + 1)
  }, [])

  // 명시적 재분석('다시 분석하기') — 재열람 캐시를 무시하고 fresh 수집을 돈다.
  // ETF는 무과금이라 deepscan과 달리 크레딧 확인 다이얼로그가 없다.
  // 실패 시 지금 화면(캐시된 분석)을 그대로 유지한다.
  const handleExplicitRefresh = useCallback(() => {
    const target = targetRef.current
    if (!target || refreshing) return
    const seq = loadSeqRef.current
    setRefreshing(true)
    void (async () => {
      try {
        const [briefingResponse, profileResponse] = await Promise.all([
          fetch(buildEtfPageBriefingUrl(target.code, target.market), { cache: 'no-store' }),
          fetch(buildEtfPageProfileUrl(target.code, { refresh: true }), { cache: 'no-store' }),
        ])
        if (loadSeqRef.current !== seq || !profileResponse.ok) return
        const [briefingBody, profileBody] = await Promise.all([
          briefingResponse.json().catch(() => null),
          profileResponse.json().catch(() => null),
        ])
        if (loadSeqRef.current !== seq) return
        const next = buildEtfPageState(
          target,
          parseEtfBriefingSnapshotResponse(briefingBody),
          parseEtfProfileResponse(profileBody),
          parseEtfProfileCacheInfo(profileBody),
        )
        if (next.phase === 'ready') setState(next)
      } catch {
        // 갱신 실패 — 기존 분석 화면 유지
      } finally {
        if (loadSeqRef.current === seq) setRefreshing(false)
      }
    })()
  }, [refreshing])

  const ready = state.phase === 'ready' ? state : null
  const vm = ready?.vm
  const briefing = ready?.briefing
  const quote = briefing?.quote ?? null
  const changePct = quote?.changePct ?? null

  // AI 위원회(국내 ETF 전용) — 프로필 로드와 무관하게 비차단으로 띄운다.
  const [committee, setCommittee] = useState<EtfCommitteeState>({ phase: 'idle' })
  const [committeeRetryCount, setCommitteeRetryCount] = useState(0)
  const handleCommitteeRetry = useCallback(() => {
    setCommitteeRetryCount((count) => count + 1)
  }, [])

  const committeeCode = ready && ready.market !== 'us' ? vm?.header.code ?? null : null
  const committeeHolding = committeeCode ? ready?.holding ?? null : null

  useEffect(() => {
    if (!committeeCode) {
      setCommittee({ phase: 'idle' })
      return
    }

    let stopped = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let pollCount = 0
    const giveUp = 'AI 위원회 분석을 가져오지 못했어요. 잠시 후 다시 시도해주세요.'

    setCommittee({ phase: 'loading' })

    // partial 셸은 requestId로 완성될 때까지 4초 간격 폴링(딥스캔 위원회 패턴).
    const poll = (requestId: string) => {
      if (stopped || pollCount >= 20) return
      pollCount += 1
      pollTimer = setTimeout(() => {
        void (async () => {
          try {
            const response = await fetch(buildEtfCommitteeStatusUrl(requestId), { cache: 'no-store' })
            const body = await response.json().catch(() => null)
            if (stopped) return
            const next = parseEtfCommitteeStatusResponse(body)
            if (next) {
              setCommittee(next)
              if (shouldContinueEtfCommitteePolling(next)) poll(requestId)
            } else {
              setCommittee({ phase: 'error', message: giveUp })
            }
          } catch {
            if (!stopped) setCommittee({ phase: 'error', message: giveUp })
          }
        })()
      }, 4000)
    }

    void (async () => {
      try {
        const response = await fetch(
          buildEtfCommitteeUrl(committeeCode, committeeHolding),
          { cache: 'no-store' },
        )
        const body = await response.json().catch(() => null)
        if (stopped) return
        const next = parseEtfCommitteeResponse(body)
        setCommittee(next)
        if (shouldContinueEtfCommitteePolling(next) && next.phase === 'ready' && next.requestId) {
          poll(next.requestId)
        }
      } catch {
        if (!stopped) setCommittee({ phase: 'error', message: giveUp })
      }
    })()

    return () => {
      stopped = true
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [committeeCode, committeeHolding, committeeRetryCount])

  const headerName = vm?.header.name ?? 'ETF 분석'
  const headerTargetLine = vm
    ? [
        MARKET_LABEL[ready?.market ?? 'kospi'],
        vm.header.code,
        ready?.holding ? `보유 ${formatShares(ready.holding.shares)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '분석 대상 확인 중'

  return (
    <div className='flex h-full w-full justify-center bg-white'>
      <div className={cn(styles.loadingCard, 'w-full overflow-hidden')}>
        <header className={styles.topBar}>
          <div className={styles.topBarRow}>
            <BackControl backHref='/home' />
            <div className={styles.stockIdentity}>
              <h1 className={styles.stockName}>{headerName}</h1>
              <p className={styles.stockCode}>{headerTargetLine}</p>
            </div>
            <div className={styles.stockPriceBox}>
              <p className={styles.stockPrice}>{vm?.hero.price ?? '현재가 확인 중'}</p>
              <p className={cn(styles.stockChange, financialToneClass(changePct))}>
                <span className={styles.returnRateContext}>전일 대비</span> {changePct == null ? '확인 중' : formatSignedPercent(changePct)}
              </p>
            </div>
          </div>
        </header>

        <div className={styles.body}>
          {state.phase === 'loading' ? (
            <div className='flex min-h-[280px] items-center justify-center'>
              <p className='flex items-center gap-1.5 text-[12px] font-bold text-[#5A6473]'>
                <span className='size-[5px] animate-pulse rounded-full bg-[#185fa5]' />
                ETF 정보를 불러오는 중이에요
              </p>
            </div>
          ) : null}

          {state.phase === 'empty' ? (
            <EtfGuideStateCard
              title='분석할 ETF가 없습니다'
              body='홈에서 보유 중인 ETF 카드를 고르면 오늘 장 시세와 구성·리스크를 한 흐름으로 보여드려요.'
              ctaLabel='홈에서 ETF 선택하기'
              ctaHref='/home'
            />
          ) : null}

          {state.phase === 'invalid' ? (
            <EtfGuideStateCard
              title='한국 상장 ETF만 분석할 수 있어요'
              body='지금은 국내 ETF(6자리 코드)만 지원해요. 미국 ETF나 일반 주식은 딥스캔으로 분석할 수 있어요.'
              ctaLabel='홈으로 가기'
              ctaHref='/home'
            />
          ) : null}

          {state.phase === 'error' ? (
            <EtfGuideStateCard
              title='정보를 가져오지 못했어요'
              body={state.message}
              ctaLabel='다시 시도'
              onCta={retry}
            />
          ) : null}

          {ready && vm ? (
            <>
              {ready.restoredAt ? (
                <SnapshotProvenanceBar
                  scannedAt={ready.restoredAt}
                  driftPct={ready.analysisDriftPct}
                  onRefresh={handleExplicitRefresh}
                />
              ) : null}
              <EtfReadyBody
                vm={vm}
                briefing={ready.briefing}
                sharesText={ready.holding ? formatShares(ready.holding.shares) : null}
                market={ready.market}
                committee={committee}
                onCommitteeRetry={handleCommitteeRetry}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
