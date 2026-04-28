'use client'

import Link from 'next/link'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JarooShell } from '@/components/jaroo-shell'
import { type EtfScenarioTone, type EtfTab, type EtfValueTone } from '@/lib/jaroo-data'
import {
  getSelectedEtfServerSnapshot,
  getSelectedEtfSnapshot,
  resolveSelectedEtfAnalysisFromSnapshot,
  subscribeSelectedEtfSnapshot,
} from '@/lib/jaroo-etf-selected'
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

function scenarioToneClass(tone: EtfScenarioTone) {
  switch (tone) {
    case 'positive':
      return 'text-[color:var(--jaroo-success)]'
    case 'warning':
      return 'text-[#854F0B]'
    default:
      return 'text-[color:var(--jaroo-primary)]'
  }
}

function valueToneClass(tone: EtfValueTone) {
  switch (tone) {
    case 'positive':
      return 'text-[color:var(--jaroo-success)]'
    case 'danger':
      return 'text-[color:var(--jaroo-danger)]'
    default:
      return 'text-[color:var(--jaroo-ink)]'
  }
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

export default function EtfPage() {
  const [tab, setTab] = useState<EtfTab>('overview')
  const selectedEtfSnapshot = useSyncExternalStore(
    subscribeSelectedEtfSnapshot,
    getSelectedEtfSnapshot,
    getSelectedEtfServerSnapshot,
  )
  const etfAnalysis = useMemo(() => resolveSelectedEtfAnalysisFromSnapshot(selectedEtfSnapshot), [selectedEtfSnapshot])

  const handleTabChange = (nextTab: EtfTab) => {
    setTab(nextTab)
    requestAnimationFrame(() => scrollEtfContentToTop())
  }

  return (
    <JarooShell
      title={
        <div className='flex items-baseline gap-1.5'>
          <span className='truncate text-[14px] font-medium text-[color:var(--jaroo-ink)]'>{etfAnalysis.header.name}</span>
          <span className='text-[11px] font-normal text-[color:var(--jaroo-muted)]'>{etfAnalysis.header.code}</span>
        </div>
      }
      subtitle={`${etfAnalysis.header.issuer} · ${etfAnalysis.header.tracking}`}
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
            <p className='text-[11px] text-white/60'>{etfAnalysis.hero.eyebrow}</p>
            <h1 className='mt-1 text-[19px] font-medium text-white'>{etfAnalysis.hero.name}</h1>
            <p className='mt-1 text-[34px] leading-none font-medium text-white'>{etfAnalysis.hero.price}</p>
            <div className='mt-3 flex items-center gap-2'>
              <span className='text-[13px] font-medium text-[#F09595]'>{etfAnalysis.hero.change}</span>
              <span className='text-[11px] text-white/40'>·</span>
              <span className='text-[11px] text-white/65'>{etfAnalysis.hero.averagePrice}</span>
            </div>
            <div className='mt-5 grid grid-cols-3 gap-4'>
              {etfAnalysis.hero.stats.map((item) => (
                <div key={item.label}>
                  <p className='text-[10px] text-white/50'>{item.label}</p>
                  <p className='mt-1 text-[12px] font-medium text-white/90'>{item.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <button
            type='button'
            className='flex w-full items-center gap-2 rounded-[18px] bg-[color:var(--jaroo-success-ghost)] px-4 py-3 text-left'
          >
            <span className='size-2 rounded-full bg-[color:var(--jaroo-success)]' />
            <span className='flex-1 text-[12px] font-medium text-[color:#3B6D11]'>{etfAnalysis.momentum.label}</span>
            <Badge className='rounded-[8px] bg-[#C0DD97] px-2 py-0.5 text-[10px] font-medium text-[color:#3B6D11]'>
              {etfAnalysis.momentum.badge}
            </Badge>
          </button>

          <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
            <p className='text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>{etfAnalysis.scenario.eyebrow}</p>
            <div className='mt-3 flex items-end gap-3'>
              <div>
                <p className='text-[28px] leading-none font-medium text-[color:var(--jaroo-primary)]'>{etfAnalysis.scenario.wind}</p>
                <p className='mt-1 text-[12px] text-[color:var(--jaroo-primary)]'>{etfAnalysis.scenario.subtitle}</p>
              </div>
              <div className='ml-auto text-right'>
                <p className='text-[28px] leading-none font-medium text-[color:var(--jaroo-primary)]'>
                  {etfAnalysis.scenario.probability}
                </p>
                <p className='mt-1 text-[10px] text-[color:var(--jaroo-muted)]'>가능성</p>
              </div>
            </div>
            <div className='mt-4 h-1 rounded-full bg-[color:var(--jaroo-secondary)]'>
              <div
                className='h-full rounded-full bg-[color:var(--jaroo-primary)]'
                style={{ width: `${etfAnalysis.scenario.probabilityValue}%` }}
              />
            </div>
            <p className='mt-2 text-[11px] text-[color:var(--jaroo-muted)]'>{etfAnalysis.scenario.target}</p>
            <div className='mt-4 grid grid-cols-3 gap-2'>
              {etfAnalysis.scenario.options.map((option) => (
                <div
                  key={option.label}
                  className={cn(
                    'rounded-[14px] px-3 py-3 text-center',
                    option.active
                      ? 'border border-[color:#B5D4F4] bg-[color:#E6F1FB]'
                      : 'bg-[color:#F8F8F8]',
                  )}
                >
                  <p className={cn('text-[11px] font-medium', scenarioToneClass(option.tone))}>{option.label}</p>
                  <p className='mt-1 text-[10px] text-[color:var(--jaroo-muted)]'>{option.period}</p>
                  <p className={cn('mt-1 text-[12px] font-medium', scenarioToneClass(option.tone))}>{option.probability}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
            <p className='text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>{etfAnalysis.returns.eyebrow}</p>
            <div className='mt-3 grid grid-cols-4 gap-2'>
              {etfAnalysis.returns.items.map((item) => (
                <div key={item.label} className='rounded-[14px] bg-[color:#F8F8F8] px-2 py-3 text-center'>
                  <p className='text-[10px] text-[color:var(--jaroo-muted)]'>{item.label}</p>
                  <p className={cn('mt-1 text-[13px] font-medium', valueToneClass(item.tone))}>{item.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
            <p className='text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>{etfAnalysis.basicInfo.eyebrow}</p>
            <div className='mt-2'>
              {etfAnalysis.basicInfo.items.map((item) => (
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
        </TabsContent>

        <TabsContent value='holdings' className='mt-0 space-y-3'>
          <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
            <p className='text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>{etfAnalysis.sectorWeights.eyebrow}</p>
            <div className='mt-2'>
              {etfAnalysis.sectorWeights.items.map((item) => (
                <div
                  key={item.label}
                  className='flex items-center gap-2.5 border-b border-[color:var(--jaroo-border)] py-3 last:border-b-0'
                >
                  <span className='size-2 rounded-full' style={{ backgroundColor: item.tone }} />
                  <p className='min-w-0 flex-1 text-[12px] text-[color:#555]'>{item.label}</p>
                  <div className='h-1 flex-[1.8] rounded-full bg-[color:var(--jaroo-secondary)]'>
                    <div
                      className='h-full rounded-full'
                      style={{ width: `${item.barWidth}%`, backgroundColor: item.fillTone ?? item.tone }}
                    />
                  </div>
                  <p className='min-w-[38px] text-right text-[12px] font-medium text-[color:var(--jaroo-ink)]'>
                    {item.value}%
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <div>
            <p className='mb-2 px-0.5 text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>
              {etfAnalysis.topHoldings.eyebrow}
            </p>
            <Card className='overflow-hidden rounded-[24px] border border-[color:var(--jaroo-border)] p-0 shadow-none'>
              <div className='grid grid-cols-[26px,1fr,54px,64px] items-center gap-2 border-b border-[color:var(--jaroo-border)] bg-[color:#F8F8F8] px-4 py-3'>
                <span className='text-[10px] text-[color:var(--jaroo-muted)]'>#</span>
                <span className='text-[10px] text-[color:var(--jaroo-muted)]'>종목명</span>
                <span className='text-right text-[10px] text-[color:var(--jaroo-muted)]'>비중</span>
                <span className='text-right text-[10px] text-[color:var(--jaroo-muted)]'>등락률</span>
              </div>
              {etfAnalysis.topHoldings.items.map((item) => (
                <div
                  key={item.code}
                  className='grid grid-cols-[26px,1fr,54px,64px] items-center gap-2 border-b border-[color:var(--jaroo-border)] px-4 py-3 last:border-b-0'
                >
                  <span className='text-[11px] text-[color:#BBB]'>{item.rank}</span>
                  <div className='min-w-0'>
                    <p className='truncate text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{item.name}</p>
                    <p className='mt-0.5 text-[10px] text-[color:#BBB]'>{item.code}</p>
                  </div>
                  <span className='text-right text-[12px] font-medium text-[color:var(--jaroo-primary)]'>{item.weight}</span>
                  <span className={cn('text-right text-[11px]', valueToneClass(item.tone))}>{item.change}</span>
                </div>
              ))}
              <div className='border-t border-[color:var(--jaroo-border)] px-4 py-3 text-center text-[11px] text-[color:var(--jaroo-muted)]'>
                {etfAnalysis.topHoldings.summary}
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value='risk' className='mt-0 space-y-3'>
          <div>
            <p className='mb-2 px-0.5 text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>
              {etfAnalysis.riskMetrics.eyebrow}
            </p>
            <div className='grid grid-cols-2 gap-2'>
              {etfAnalysis.riskMetrics.items.map((item) => (
                <div key={item.label} className='rounded-[18px] bg-[color:#F8F8F8] p-4'>
                  <p className='text-[11px] text-[color:var(--jaroo-muted)]'>{item.label}</p>
                  <p className={cn('mt-1 text-[24px] font-medium', valueToneClass(item.tone))}>{item.value}</p>
                  <p className='mt-1 text-[10px] text-[color:var(--jaroo-muted)]'>{item.subtitle}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className='mb-2 px-0.5 text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>
              {etfAnalysis.peers.eyebrow}
            </p>
            <Card className='overflow-hidden rounded-[24px] border border-[color:var(--jaroo-border)] p-0 shadow-none'>
              <div className='grid grid-cols-[1fr,64px,60px] items-center gap-2 border-b border-[color:var(--jaroo-border)] bg-[color:#F8F8F8] px-4 py-3'>
                <span className='text-[10px] text-[color:var(--jaroo-muted)]'>ETF명</span>
                <span className='text-right text-[10px] text-[color:var(--jaroo-muted)]'>순자산</span>
                <span className='text-right text-[10px] text-[color:var(--jaroo-muted)]'>1년 수익</span>
              </div>
              {etfAnalysis.peers.items.map((item) => (
                <div
                  key={item.name}
                  className={cn(
                    'grid grid-cols-[1fr,64px,60px] items-center gap-2 border-b border-[color:var(--jaroo-border)] px-4 py-3 last:border-b-0',
                    item.current && 'bg-[color:#F0F7FF]',
                  )}
                >
                  <div className='min-w-0'>
                    <div className='flex items-center gap-1.5'>
                      <p className='truncate text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{item.name}</p>
                      {item.current ? (
                        <Badge className='rounded-[6px] bg-[color:#E6F1FB] px-1.5 py-0.5 text-[9px] font-medium text-[color:var(--jaroo-primary)]'>
                          현재
                        </Badge>
                      ) : null}
                    </div>
                    <p className='mt-0.5 text-[10px] text-[color:#BBB]'>{item.issuer}</p>
                  </div>
                  <span className='text-right text-[11px] text-[color:var(--jaroo-muted)]'>{item.aum}</span>
                  <span className='text-right text-[12px] font-medium text-[color:var(--jaroo-danger)]'>{item.return1y}</span>
                </div>
              ))}
            </Card>
          </div>

          <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
            <p className='text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>{etfAnalysis.dividendInfo.eyebrow}</p>
            <div className='mt-2'>
              {etfAnalysis.dividendInfo.items.map((item) => (
                <div
                  key={item.label}
                  className='flex items-center justify-between border-b border-[color:var(--jaroo-border)] py-2 last:border-b-0'
                >
                  <p className='text-[12px] text-[color:var(--jaroo-muted)]'>{item.label}</p>
                  <p className={cn('text-[12px] font-medium', valueToneClass(item.tone ?? 'neutral'))}>{item.value}</p>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </JarooShell>
  )
}
