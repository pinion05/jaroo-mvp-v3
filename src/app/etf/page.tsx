'use client'

import Link from 'next/link'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JarooShell } from '@/components/jaroo-shell'
import { buildEtfPageModel } from '@/lib/etf-page-data'
import { DEEPSCAN_TARGET_EVENT, readDeepScanTarget, type HomeHolding } from '@/lib/jaroo-home-data'

type EtfTab = 'overview' | 'holdings' | 'risk'

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

function EtfBottomFooter({ tab, onSwitch }: { tab: EtfTab; onSwitch: () => void }) {
  return (
    <div className='sticky bottom-0 z-20 border-t border-[color:var(--jaroo-border)] bg-white/95 px-4 py-3 backdrop-blur'>
      <div className='grid grid-cols-[1fr,1.35fr] gap-2'>
        <Button
          type='button'
          variant='outline'
          onClick={onSwitch}
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
  )
}

function PlaceholderCard({
  badge,
  title,
  body,
}: {
  badge: string
  title: string
  body: string
}) {
  return (
    <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
      <span className='inline-flex rounded-full bg-[color:var(--jaroo-secondary)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-muted)]'>
        {badge}
      </span>
      <p className='mt-3 text-sm font-semibold text-[color:var(--jaroo-ink)]'>{title}</p>
      <p className='mt-2 text-xs leading-5 text-[color:var(--jaroo-muted)]'>{body}</p>
    </Card>
  )
}

function subscribeEtfTarget(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  window.addEventListener(DEEPSCAN_TARGET_EVENT, onStoreChange)

  return () => {
    window.removeEventListener(DEEPSCAN_TARGET_EVENT, onStoreChange)
  }
}

function getEtfTargetSnapshot(): HomeHolding | null {
  const target = readDeepScanTarget()
  return target?.kind === 'etf' ? target : null
}

export default function EtfPage() {
  const [tab, setTab] = useState<EtfTab>('overview')
  const selectedHolding = useSyncExternalStore(subscribeEtfTarget, getEtfTargetSnapshot, () => null)

  const handleTabChange = (nextTab: EtfTab) => {
    setTab(nextTab)
    requestAnimationFrame(() => scrollEtfContentToTop())
  }

  const etfPage = useMemo(() => (selectedHolding ? buildEtfPageModel(selectedHolding) : null), [selectedHolding])

  if (!etfPage) {
    return (
      <JarooShell
        title='ETF 분석'
        backHref='/home'
        showBottomNav={false}
        mainClassName='px-4 pt-4 pb-6'
      >
        <PlaceholderCard
          badge='Empty'
          title='선택한 ETF가 없습니다'
          body='홈에서 ETF 카드를 선택한 뒤 다시 들어오면 실제 보유 정보가 이 화면에 반영돼요.'
        />
      </JarooShell>
    )
  }

  return (
    <JarooShell
      title={
        <div className='flex items-baseline gap-1.5'>
          <span className='truncate text-[14px] font-medium text-[color:var(--jaroo-ink)]'>{etfPage.title}</span>
          <span className='text-[11px] font-normal text-[color:var(--jaroo-muted)]'>{etfPage.code}</span>
        </div>
      }
      subtitle={etfPage.subtitle}
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
      bottomNav={<EtfBottomFooter tab={tab} onSwitch={() => handleTabChange(nextTabMap[tab])} />}
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
          <Card className='rounded-[26px] border-0 bg-[linear-gradient(135deg,var(--jaroo-primary-strong),var(--jaroo-primary))] p-5 text-white shadow-none'>
            <p className='text-[11px] text-white/60'>{etfPage.heroEyebrow}</p>
            <h1 className='mt-1 text-[19px] font-medium text-white'>{etfPage.heroName}</h1>
            <p className='mt-1 text-[34px] leading-none font-medium text-white'>{etfPage.heroPrice}</p>
            <div className='mt-3 flex items-center gap-2'>
              <span className='text-[13px] font-medium text-[#F09595]'>{etfPage.heroChange}</span>
              <span className='text-[11px] text-white/40'>·</span>
              <span className='text-[11px] text-white/65'>{etfPage.heroAveragePrice}</span>
            </div>
            <div className='mt-5 grid grid-cols-3 gap-4'>
              {etfPage.heroStats.map((item) => (
                <div key={item.label}>
                  <p className='text-[10px] text-white/50'>{item.label}</p>
                  <p className='mt-1 text-[12px] font-medium text-white/90'>{item.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
            <p className='text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>실제 선택값</p>
            <div className='mt-2'>
              {etfPage.overviewRows.map((item) => (
                <div
                  key={item.label}
                  className='flex items-center justify-between border-b border-[color:var(--jaroo-border)] py-2 last:border-b-0'
                >
                  <p className='text-[12px] text-[color:var(--jaroo-muted)]'>{item.label}</p>
                  <p className='text-[12px] font-medium text-[color:var(--jaroo-ink)]'>{item.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <PlaceholderCard
            badge='Pending'
            title='ETF 상세 분석 지표는 아직 연결 전입니다'
            body='현재 화면은 실제 선택한 ETF의 보유 정보만 반영합니다. 섹터 비중, 구성종목, 리스크, 배당 지표는 아직 실데이터 source에 연결되지 않았어요.'
          />
        </TabsContent>

        <TabsContent value='holdings' className='mt-0 space-y-3'>
          <PlaceholderCard
            badge='Pending'
            title='구성종목/섹터 데이터 연결 전'
            body='현재 선택한 ETF의 구성종목, 섹터 비중, 추적 지수 데이터는 아직 실데이터 API 또는 canonical source에 연결되지 않았어요.'
          />
        </TabsContent>

        <TabsContent value='risk' className='mt-0 space-y-3'>
          <PlaceholderCard
            badge='Pending'
            title='리스크/배당/비교 ETF 지표 연결 전'
            body='변동성, 추적오차, 배당, 동종 ETF 비교 지표는 아직 실제 선택 ETF 기준으로 계산되지 않습니다. 연결 전까지는 mock 수치를 숨깁니다.'
          />
        </TabsContent>
      </Tabs>
    </JarooShell>
  )
}
