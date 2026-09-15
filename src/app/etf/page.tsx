'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EtfDataNoticeCard } from '@/components/etf-data-notice-card'
import { JarooShell } from '@/components/jaroo-shell'
import {
  buildEtfPageProfileUrl,
  buildEtfPageQuoteUrl,
  buildEtfPageState,
  createInitialEtfPageState,
  isNotAnEtfProfileStatus,
  parseEtfProfileResponse,
  parseEtfQuoteResponse,
  resolveEtfPageTargetFromWindow,
  type EtfPageState,
} from './etf-page-model'
import { getFinancialValueTextClass } from '@/lib/financial-value-tone'
import { type EtfTab, type EtfViewModel } from '@/lib/etf/etf-view-model'
import { cn } from '@/lib/utils'

const tabs: Array<{ id: EtfTab; label: string }> = [
  { id: 'overview', label: '개요' },
  { id: 'holdings', label: '구성' },
  { id: 'risk', label: '리스크' },
]

const nextTabMap: Record<EtfTab, EtfTab> = {
  overview: 'holdings',
  holdings: 'risk',
  risk: 'overview',
}

const nextLabelMap: Record<EtfTab, string> = {
  overview: '구성 보기 →',
  holdings: '리스크 보기 →',
  risk: '개요 보기 →',
}

function scrollEtfContentToTop() {
  if (typeof document === 'undefined') return

  const scrollContainer = document.querySelector<HTMLElement>("[data-slot='jaroo-shell-main']")
  scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' })
}

function EtfStatusCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-5 text-center shadow-none'>
      <p className='text-[14px] font-medium text-[color:var(--jaroo-ink)]'>{title}</p>
      <p className='mt-2 text-[12px] leading-relaxed text-[color:var(--jaroo-muted)]'>{body}</p>
      <Link
        href='/home'
        className={buttonVariants({
          className:
            'mt-4 inline-flex h-11 rounded-[14px] bg-[color:var(--jaroo-primary)] px-4 text-[13px] font-semibold text-white hover:bg-[color:var(--jaroo-primary-strong)]',
        })}
      >
        홈으로 가기
      </Link>
    </Card>
  )
}

function EtfHeroCard({ vm }: { vm: EtfViewModel }) {
  return (
    <Card className='rounded-[26px] border-0 bg-[linear-gradient(135deg,var(--jaroo-primary-strong),var(--jaroo-primary))] p-5 text-white shadow-none'>
      <p className='text-[11px] text-white/60'>ETF 분석</p>
      <h1 className='mt-1 text-[19px] font-medium text-white'>{vm.hero.name}</h1>
      <p className='mt-1 text-[34px] leading-none font-medium text-white'>{vm.hero.price}</p>
      <div className='mt-3 flex flex-wrap items-center gap-2'>
        {vm.hero.change ? (
          <span className={cn('rounded-[8px] bg-white/95 px-2 py-1 text-[13px] font-medium', getFinancialValueTextClass(vm.hero.change))}>
            {vm.hero.change}
          </span>
        ) : null}
        {vm.hero.averagePrice ? <span className='text-[11px] text-white/65'>{vm.hero.averagePrice}</span> : null}
        {vm.hero.profitAmount ? <span className='text-[11px] text-white/65'>· {vm.hero.profitAmount}</span> : null}
      </div>
      {vm.hero.stats.length ? (
        <div className='mt-5 grid grid-cols-3 gap-4'>
          {vm.hero.stats.map((item) => (
            <div key={item.label}>
              <p className='text-[10px] text-white/50'>{item.label}</p>
              <p className='mt-1 text-[12px] font-medium text-white/90'>{item.value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  )
}

function EtfMomentumRow({ momentum }: { momentum: EtfViewModel['momentum'] }) {
  const toneClass =
    momentum.badge === '↗'
      ? 'text-[color:var(--jaroo-profit)]'
      : momentum.badge === '↘'
        ? 'text-[color:var(--jaroo-danger)]'
        : 'text-[color:var(--jaroo-muted)]'

  return (
    <div className='flex w-full items-center gap-2 rounded-[18px] bg-[color:var(--jaroo-secondary)] px-4 py-3'>
      <span className={cn('size-2 rounded-full', momentum.badge === '↗' ? 'bg-[color:var(--jaroo-profit)]' : 'bg-[color:var(--jaroo-muted)]')} />
      <span className={cn('flex-1 text-[12px] font-medium', toneClass)}>{momentum.label}</span>
      <Badge className='rounded-[8px] bg-white px-2 py-0.5 text-[10px] font-medium text-[color:var(--jaroo-ink)]'>
        {momentum.badge}
      </Badge>
    </div>
  )
}

function EtfReadyContent({ vm }: { vm: EtfViewModel }) {
  const [tab, setTab] = useState<EtfTab>('overview')

  const handleTabChange = (nextTab: EtfTab) => {
    setTab(nextTab)
    requestAnimationFrame(() => scrollEtfContentToTop())
  }

  const subtitle = [vm.header.issuer, vm.header.tracking].filter(Boolean).join(' · ')

  return (
    <JarooShell
      title={
        <div className='flex items-baseline gap-1.5'>
          <span className='truncate text-[14px] font-medium text-[color:var(--jaroo-ink)]'>{vm.header.name}</span>
          <span className='text-[11px] font-normal text-[color:var(--jaroo-muted)]'>{vm.header.code}</span>
        </div>
      }
      subtitle={subtitle || undefined}
      backHref='/home'
      showBottomNav
      action={
        <Link
          href='/sharecard'
          className={buttonVariants({
            variant: 'outline',
            className:
              'h-8 rounded-[10px] border-[color:#B5D4F4] bg-[color:#E6F1FB] px-3 text-[11px] font-medium text-[color:var(--jaroo-primary)] hover:bg-[color:#D9EAFB]',
          })}
        >
          공유
        </Link>
      }
      bottomNav={
        <div className='sticky bottom-0 z-20 border-t border-[color:var(--jaroo-border)] bg-white/95 px-4 py-3 backdrop-blur'>
          <div className='grid grid-cols-[1fr,1.35fr] gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => handleTabChange(nextTabMap[tab])}
              className='h-12 rounded-[16px] border-[color:var(--jaroo-border)] bg-white text-[13px] font-medium text-[color:var(--jaroo-muted)] hover:bg-[color:var(--jaroo-secondary)]'
            >
              {nextLabelMap[tab]}
            </Button>
            <Link
              href='/sharecard'
              className={buttonVariants({
                className:
                  'h-12 rounded-[16px] bg-[color:var(--jaroo-primary)] px-4 text-[13px] font-semibold text-white hover:bg-[color:var(--jaroo-primary-strong)]',
              })}
            >
              결과 공유하기
            </Link>
          </div>
        </div>
      }
    >
      <Tabs value={tab} onValueChange={(value) => handleTabChange(value as EtfTab)} className='gap-4'>
        <div className='sticky top-0 z-10 -mx-4 border-b border-[color:var(--jaroo-border)] bg-white/95 px-4 backdrop-blur'>
          <TabsList variant='line' className='grid h-auto w-full grid-cols-3 rounded-none bg-transparent p-0'>
            {tabs.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className='rounded-none border-b-2 border-transparent px-0 py-3 text-[13px] font-normal text-[color:var(--jaroo-muted)] after:hidden data-active:border-[color:var(--jaroo-primary)] data-active:font-medium data-active:text-[color:var(--jaroo-primary)]'
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value='overview' className='mt-0 space-y-3'>
          <EtfHeroCard vm={vm} />
          <EtfMomentumRow momentum={vm.momentum} />
          <EtfDataNoticeCard
            eyebrow='추천 시나리오'
            reason={vm.scenario.notice.reason}
            message={vm.scenario.notice.message}
          />
          <EtfDataNoticeCard eyebrow='기간별 수익률' reason={vm.returns.notice.reason} message={vm.returns.notice.message} />
          <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
            <p className='text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>기본 정보</p>
            {vm.basicInfo.items.length ? (
              <div className='mt-2'>
                {vm.basicInfo.items.map((item) => (
                  <div
                    key={item.label}
                    className='flex items-center justify-between border-b border-[color:var(--jaroo-border)] py-2 last:border-b-0'
                  >
                    <p className='text-[12px] text-[color:var(--jaroo-muted)]'>{item.label}</p>
                    <p className='text-[12px] font-medium text-[color:var(--jaroo-ink)]'>{item.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className='mt-2 text-[12px] text-[color:var(--jaroo-muted)]'>상품 정보를 가져오지 못했어요.</p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value='holdings' className='mt-0 space-y-3'>
          <EtfDataNoticeCard
            eyebrow='섹터 비중'
            reason={vm.sectorWeights.notice.reason}
            message={vm.sectorWeights.notice.message}
          />
          <EtfDataNoticeCard
            eyebrow='구성종목 Top 10'
            reason={vm.topHoldings.notice.reason}
            message={vm.topHoldings.notice.message}
          />
        </TabsContent>

        <TabsContent value='risk' className='mt-0 space-y-3'>
          <EtfDataNoticeCard
            eyebrow='리스크 지표'
            reason={vm.riskMetrics.notice.reason}
            message={vm.riskMetrics.notice.message}
          />
          <EtfDataNoticeCard
            eyebrow='유사 ETF 비교'
            reason={vm.peers.notice.reason}
            message={vm.peers.notice.message}
          />
          <EtfDataNoticeCard
            eyebrow='배당 정보'
            reason={vm.dividendInfo.notice.reason}
            message={vm.dividendInfo.notice.message}
          />
        </TabsContent>
      </Tabs>
    </JarooShell>
  )
}

export default function EtfPage() {
  const [state, setState] = useState<EtfPageState>({ phase: 'loading' })
  const [retryCount, setRetryCount] = useState(0)
  const loadSeqRef = useRef(0)

  useEffect(() => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq

    const run = async () => {
      const target = resolveEtfPageTargetFromWindow()
      if (target.status !== 'ok') {
        if (loadSeqRef.current === seq) {
          setState(createInitialEtfPageState(target))
        }
        return
      }

      try {
        const [quotesResponse, profileResponse] = await Promise.all([
          fetch(buildEtfPageQuoteUrl(target.code), { cache: 'no-store' }),
          fetch(buildEtfPageProfileUrl(target.code), { cache: 'no-store' }),
        ])
        if (loadSeqRef.current !== seq) {
          return
        }
        if (isNotAnEtfProfileStatus(profileResponse.status)) {
          setState({ phase: 'invalid' })
          return
        }
        const [quotesBody, profileBody] = await Promise.all([
          quotesResponse.json().catch(() => null),
          profileResponse.json().catch(() => null),
        ])
        if (loadSeqRef.current !== seq) {
          return
        }
        setState(
          buildEtfPageState(target, parseEtfQuoteResponse(quotesBody, target.code), parseEtfProfileResponse(profileBody)),
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

  if (state.phase === 'ready') {
    return <EtfReadyContent vm={state.vm} />
  }

  if (state.phase === 'loading') {
    return (
      <JarooShell title='ETF 분석' backHref='/home' showBottomNav={false}>
        <div className='flex min-h-[320px] items-center justify-center'>
          <p className='text-[13px] text-[color:var(--jaroo-muted)]'>ETF 정보를 불러오는 중이에요…</p>
        </div>
      </JarooShell>
    )
  }

  if (state.phase === 'empty') {
    return (
      <JarooShell title='ETF 분석' backHref='/home' showBottomNav={false}>
        <EtfStatusCard
          title='분석할 ETF가 선택되지 않았어요'
          body='홈에서 보유 중인 ETF 카드의 "ETF 분석"을 누르면 구성·리스크를 분석해요.'
        />
      </JarooShell>
    )
  }

  if (state.phase === 'invalid') {
    return (
      <JarooShell title='ETF 분석' backHref='/home' showBottomNav={false}>
        <EtfStatusCard
          title='한국 상장 ETF만 분석할 수 있어요'
          body='지금은 국내 ETF(6자리 코드)만 지원해요. 미국 ETF나 일반 주식은 딥스캔을 이용해주세요.'
        />
      </JarooShell>
    )
  }

  return (
    <JarooShell title='ETF 분석' backHref='/home' showBottomNav={false}>
      <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-5 text-center shadow-none'>
        <p className='text-[14px] font-medium text-[color:var(--jaroo-ink)]'>{state.message}</p>
        <Button
          type='button'
          onClick={retry}
          className='mt-4 h-11 rounded-[14px] bg-[color:var(--jaroo-primary)] px-4 text-[13px] font-semibold text-white hover:bg-[color:var(--jaroo-primary-strong)]'
        >
          다시 시도
        </Button>
      </Card>
    </JarooShell>
  )
}
