'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { JarooShell } from '@/components/jaroo-shell'
import { getFinancialValueTextClass, getFinancialValueTone } from '@/lib/financial-value-tone'
import type { HomeHolding } from '@/lib/holding-types'
import { applyCurrentQuotesToHomeHoldings, buildHomeCurrentQuoteQuery, type CurrentQuoteItem } from '@/lib/home-current-quotes'
import { fetchHomeQuoteResponseWithTimeout, HOME_QUOTE_FETCH_TIMEOUT_MS } from '@/lib/home-quote-bootstrap'
import type { ShareCardStock, ShareCardWind } from '@/lib/jaroo-data'
import {
  buildHomeHoldingsFromPortfolioItems,
  buildPortfolioItemsFromAppliedHomePortfolioRows,
  readAppliedHomePortfolio,
} from '@/lib/jaroo-home-data'
import { fetchPortfolio, shouldUsePortfolioSessionFallback } from '@/lib/portfolio-sync'
import { buildSharePortfolioCard, buildShareStockCards, type SharePortfolioCardModel } from '@/lib/sharecard-view-model'
import { cn } from '@/lib/utils'

type ShareTab = 'portfolio' | 'stock'

type ShareCardData = {
  holdings: HomeHolding[]
  usdKrwRate: number | null
}

type ShareCardPhase = 'loading' | 'ready' | 'empty' | 'logged-out'

const tabs: Array<{ id: ShareTab; label: string }> = [
  { id: 'portfolio', label: '포트폴리오' },
  { id: 'stock', label: '종목별' },
]

const windClasses: Record<ShareCardWind, string> = {
  순풍: 'bg-[color:var(--jaroo-profit-ghost)] text-[color:var(--jaroo-profit)]',
  미풍: 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
  역풍: 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]',
}

const momentumTextClasses: Record<ShareCardWind, string> = {
  순풍: 'text-[color:var(--jaroo-profit)]',
  미풍: 'text-[color:var(--jaroo-muted)]',
  역풍: 'text-[color:var(--jaroo-danger)]',
}

const momentumDotClasses: Record<ShareCardWind, string> = {
  순풍: 'bg-[color:var(--jaroo-profit)]',
  미풍: 'bg-[color:var(--jaroo-muted)]',
  역풍: 'bg-[color:var(--jaroo-danger)]',
}

async function fetchUsdKrwRate(): Promise<number | null> {
  try {
    const response = await fetchHomeQuoteResponseWithTimeout(
      fetch,
      '/api/market/fx/usd-krw',
      { cache: 'no-store' },
      HOME_QUOTE_FETCH_TIMEOUT_MS,
    )
    if (!response.ok) {
      return null
    }
    const payload = await response.json()
    const rate = Number(payload?.data?.rate)
    return Number.isFinite(rate) && rate > 0 ? rate : null
  } catch {
    return null
  }
}

async function fetchCurrentQuoteItems(quoteQuery: string): Promise<CurrentQuoteItem[]> {
  try {
    const response = await fetchHomeQuoteResponseWithTimeout(
      fetch,
      `/api/quotes/current?${quoteQuery}`,
      { cache: 'no-store' },
      HOME_QUOTE_FETCH_TIMEOUT_MS,
    )
    if (!response.ok) {
      return []
    }
    const payload = await response.json()
    return Array.isArray(payload?.data?.items) ? (payload.data.items as CurrentQuoteItem[]) : []
  } catch {
    return []
  }
}

function performanceBadgeClass(stock: ShareCardStock) {
  if (stock.rate === '거래 정지') {
    return 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]'
  }

  const tone = getFinancialValueTone(stock.rate)
  return tone === 'profit'
    ? 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]'
    : tone === 'loss'
      ? 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]'
      : 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]'
}

function ShareActionsFooter() {
  return (
    <div className='sticky bottom-0 z-20 border-t border-[color:var(--jaroo-border)] bg-white/95 px-4 py-3 backdrop-blur'>
      <div className='grid grid-cols-2 gap-2'>
        <Button className='h-11 rounded-[16px] bg-[color:var(--jaroo-primary)] text-sm font-semibold text-white hover:bg-[color:var(--jaroo-primary-strong)]'>
          공유하기
        </Button>
        <Button
          variant='secondary'
          className='h-11 rounded-[16px] bg-[color:var(--jaroo-secondary)] text-sm font-medium text-[color:var(--jaroo-muted)] hover:bg-[color:var(--jaroo-secondary)]/80'
        >
          카드 이미지 저장
        </Button>
      </div>
    </div>
  )
}

function ShareLoadingState() {
  return (
    <div className='flex flex-1 items-center justify-center py-24'>
      <p className='text-[13px] text-[color:var(--jaroo-muted)]'>포트폴리오를 불러오는 중이에요…</p>
    </div>
  )
}

function ShareEmptyState({ loggedOut }: { loggedOut: boolean }) {
  return (
    <section className='flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center'>
      <p className='text-[15px] font-semibold text-[color:var(--jaroo-ink)]'>
        {loggedOut ? '로그인하고 포트폴리오를 공유해보세요' : '공유할 포트폴리오가 없어요'}
      </p>
      <p className='text-[13px] leading-relaxed text-[color:var(--jaroo-muted)]'>
        {loggedOut
          ? '로그인하면 내 보유 종목으로 공유 카드를 만들 수 있어요.'
          : '홈에서 증권 앱 스크린샷으로 종목을 등록하면 공유 카드를 만들 수 있어요.'}
      </p>
      <Link
        href={loggedOut ? '/login' : '/home'}
        className='mt-2 flex h-11 items-center justify-center rounded-[16px] bg-[color:var(--jaroo-primary)] px-6 text-sm font-semibold text-white transition hover:bg-[color:var(--jaroo-primary-strong)]'
      >
        {loggedOut ? '로그인하기' : '홈으로 가기'}
      </Link>
    </section>
  )
}

function PortfolioShareCard({
  card,
  stocks,
  selected,
  onSelect,
}: {
  card: SharePortfolioCardModel
  stocks: ShareCardStock[]
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button type='button' onClick={onSelect} className='w-full text-left'>
      <div
        className={cn(
          'relative overflow-hidden rounded-[24px] transition',
          selected && 'ring-2 ring-[color:var(--jaroo-primary)] ring-offset-2 ring-offset-white',
        )}
      >
        {selected ? (
          <span className='absolute top-3 right-3 z-10 flex size-6 items-center justify-center rounded-full bg-[color:var(--jaroo-primary)] text-xs font-bold text-white'>
            ✓
          </span>
        ) : null}
        <Card className='gap-0 rounded-[24px] border border-[color:var(--jaroo-border)] bg-white py-0 shadow-none ring-0'>
          <div className='p-5'>
            <div className='flex items-center justify-between gap-3'>
              <p className='text-[13px] font-bold tracking-[-0.02em] text-[color:var(--jaroo-ink)]'>Jaroo.</p>
              <div className='flex items-center gap-1.5'>
                <span className={cn('size-2 rounded-full', momentumDotClasses[card.momentumLabel])} />
                <span className={cn('text-xs font-medium', momentumTextClasses[card.momentumLabel])}>{card.momentumLabel}</span>
                <Badge className={cn('rounded-md px-2 py-0.5 text-[10px]', windClasses[card.momentumLabel])}>
                  {card.momentumDetail}
                </Badge>
              </div>
            </div>

            <div className='mt-4'>
              <p className='text-[10px] text-[color:var(--jaroo-muted)]'>총 손익</p>
              <p className={cn('mt-1 text-[30px] leading-none font-bold', getFinancialValueTextClass(card.totalPnl))}>
                {card.totalPnl}
              </p>
              <p className='mt-1 text-xs text-[color:var(--jaroo-muted)]'>{card.totalSummary}</p>
            </div>

            <div className='my-3 h-px bg-[color:var(--jaroo-border)]' />

            <div>
              {stocks.map((stock) => (
                <div
                  key={stock.name}
                  className='flex items-center gap-2 border-b border-[color:rgba(12,68,124,0.04)] py-2 last:border-b-0'
                >
                  <span className='size-1.5 rounded-full' style={{ backgroundColor: stock.dot }} />
                  <span className='flex-1 text-xs font-medium text-[color:var(--jaroo-ink)]'>{stock.name}</span>
                  <span
                    className={cn(
                      'min-w-[54px] text-right font-medium',
                      stock.rate === '거래 정지' ? 'text-[11px]' : 'text-xs',
                      getFinancialValueTextClass(stock.rate),
                    )}
                  >
                    {stock.rate}
                  </span>
                  <Badge className={cn('rounded-md px-2 py-0.5 text-[10px] font-medium', windClasses[stock.wind])}>
                    {stock.wind}
                  </Badge>
                </div>
              ))}
            </div>

            <div className='mt-3 flex items-center justify-between border-t border-[color:var(--jaroo-border)] pt-3'>
              <span className='text-[10px] text-[color:var(--jaroo-muted)]/70'>{card.date}</span>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>{card.brand}</span>
            </div>
          </div>
        </Card>
      </div>
    </button>
  )
}

function StockPreviewCard({ stock, date }: { stock: ShareCardStock; date: string }) {
  return (
    <div className='rounded-[18px] bg-[color:var(--jaroo-secondary)] p-3.5'>
      <p className='mb-2 text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>미리보기</p>
      <Card className='gap-0 rounded-[18px] border border-[color:var(--jaroo-border)] bg-white py-0 shadow-none ring-0'>
        <div className='p-4'>
          <div className='flex items-center justify-between'>
            <span className='text-[13px] font-bold tracking-[-0.02em] text-[color:var(--jaroo-ink)]'>Jaroo.</span>
            <span className='text-[10px] text-[color:var(--jaroo-muted)]'>{date}</span>
          </div>

          <div className='mt-4 flex items-center gap-2'>
            <span className='size-2 rounded-full' style={{ backgroundColor: stock.dot }} />
            <span className='text-base font-semibold text-[color:var(--jaroo-ink)]'>{stock.name}</span>
            <span className='text-[10px] text-[color:var(--jaroo-muted)]'>{stock.market}</span>
            <Badge className={cn('ml-auto rounded-md px-2 py-0.5 text-[10px] font-medium', performanceBadgeClass(stock))}>
              {stock.status}
            </Badge>
          </div>

          <div className='mt-4'>
            <p className='text-[11px] text-[color:var(--jaroo-muted)]'>손익</p>
            <p className={cn('mt-1 text-[30px] leading-none font-bold', getFinancialValueTextClass(stock.amount))}>
              {stock.amount}
            </p>
            <p className={cn('mt-1 text-sm font-medium', getFinancialValueTextClass(stock.rate))}>{stock.rate}</p>
          </div>

          <div className='my-3 h-px bg-[color:var(--jaroo-border)]' />

          <div className='flex items-start justify-between gap-3'>
            <div>
              <p className='text-[10px] text-[color:var(--jaroo-muted)]'>보유 수량</p>
              <p className='mt-1 text-xs font-medium text-[color:var(--jaroo-ink)]'>{stock.quantity}</p>
            </div>
            <div className='text-center'>
              <p className='text-[10px] text-[color:var(--jaroo-muted)]'>평균 단가</p>
              <p className='mt-1 text-xs font-medium text-[color:var(--jaroo-ink)]'>{stock.averagePrice}</p>
            </div>
            <div className='text-right'>
              <p className='text-[10px] text-[color:var(--jaroo-muted)]'>모멘텀</p>
              <p className='mt-1 text-xs font-medium text-[color:var(--jaroo-ink)]'>{stock.wind}</p>
            </div>
          </div>

          <div className='mt-4 border-t border-[color:var(--jaroo-border)] pt-3 text-right text-[10px] text-[color:var(--jaroo-muted)]'>
            jaroo.kr
          </div>
        </div>
      </Card>
    </div>
  )
}

export default function ShareCardPage() {
  const [activeTab, setActiveTab] = useState<ShareTab>('portfolio')
  const [selectedPortfolioCard, setSelectedPortfolioCard] = useState(0)
  const [selectedStockIndex, setSelectedStockIndex] = useState<number | null>(null)
  const [phase, setPhase] = useState<ShareCardPhase>('loading')
  const [data, setData] = useState<ShareCardData | null>(null)

  useEffect(() => {
    let active = true

    void (async () => {
      const result = await fetchPortfolio()
      if (!active) {
        return
      }

      // 홈과 같은 정책: 로그인 상태면 DB가 단일 소스, 로그아웃/일시 오류만 세션 캐시로 폴백.
      let rows = result.status === 'rows' ? result.rows : null
      if (!rows && shouldUsePortfolioSessionFallback(result)) {
        rows = readAppliedHomePortfolio()?.rows ?? null
      }

      const items = rows ? buildPortfolioItemsFromAppliedHomePortfolioRows(rows) : []
      if (items.length === 0) {
        setPhase(result.status === 'logged-out' ? 'logged-out' : 'empty')
        return
      }

      const baseHoldings = buildHomeHoldingsFromPortfolioItems(items)
      const quoteQuery = buildHomeCurrentQuoteQuery(baseHoldings)

      if (!quoteQuery) {
        setData({ holdings: baseHoldings, usdKrwRate: null })
        setPhase('ready')
        return
      }

      const hasUsHoldings = baseHoldings.some((holding) => holding.marketTone === 'nasdaq' || Boolean(holding.identifierTicker))
      const [usdKrwRate, quoteItems] = await Promise.all([
        hasUsHoldings ? fetchUsdKrwRate() : Promise.resolve(null),
        fetchCurrentQuoteItems(quoteQuery),
      ])
      if (!active) {
        return
      }

      // 시세/환율 실패는 관용 — 스냅샷 기반 카드라도 그린다(홈 정책과 동일).
      const okQuoteItems = quoteItems.filter((item) => item.status === 'ok' && typeof item.price === 'number')
      const holdings = applyCurrentQuotesToHomeHoldings(baseHoldings, okQuoteItems, {
        usdKrwRate: hasUsHoldings ? usdKrwRate : null,
      })

      setData({ holdings, usdKrwRate: hasUsHoldings ? usdKrwRate : null })
      setPhase('ready')
    })()

    return () => {
      active = false
    }
  }, [])

  const stockCards = useMemo(() => (data ? buildShareStockCards(data.holdings) : []), [data])
  const portfolioCard = useMemo(
    () => (data ? buildSharePortfolioCard(data.holdings, { usdKrwRate: data.usdKrwRate }) : null),
    [data],
  )

  const selectedStock = selectedStockIndex !== null && selectedStockIndex < stockCards.length ? stockCards[selectedStockIndex] : null
  const showFooter = phase === 'ready' && (activeTab === 'portfolio' || selectedStock !== null)

  return (
    <JarooShell
      title='결과 공유하기'
      leading={
        <Link
          href='/home'
          className='flex size-7 items-center justify-center rounded-full bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)] transition hover:bg-[color:var(--jaroo-accent)]'
        >
          <ArrowLeft className='size-3.5' />
        </Link>
      }
      showBottomNav={showFooter}
      bottomNav={<ShareActionsFooter />}
    >
      <div className='-mx-4 -my-4 flex min-h-full flex-col'>
        {phase === 'ready' && portfolioCard ? (
          <>
            <div className='sticky top-[-1rem] z-10 border-b border-[color:var(--jaroo-border)] bg-white'>
              <div className='grid grid-cols-2'>
                {tabs.map((tab) => {
                  const active = activeTab === tab.id

                  return (
                    <button
                      key={tab.id}
                      type='button'
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'border-b-2 px-4 py-3 text-center text-[13px] transition',
                        active
                          ? 'border-[color:var(--jaroo-primary)] font-medium text-[color:var(--jaroo-primary)]'
                          : 'border-transparent text-[color:var(--jaroo-muted)]/70',
                      )}
                    >
                      {tab.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className='flex-1 px-4 py-4'>
              {activeTab === 'portfolio' ? (
                <section className='space-y-3'>
                  <p className='text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>포트폴리오 공유 카드</p>
                  <PortfolioShareCard
                    card={portfolioCard}
                    stocks={stockCards}
                    selected={selectedPortfolioCard === 0}
                    onSelect={() => setSelectedPortfolioCard(0)}
                  />
                </section>
              ) : (
                <section className='space-y-4'>
                  <p className='text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>
                    종목을 선택하면 공유 카드를 미리볼 수 있어요
                  </p>

                  <div className='space-y-1.5'>
                    {stockCards.map((stock, index) => {
                      const selected = selectedStockIndex === index

                      return (
                        <button
                          key={stock.name}
                          type='button'
                          onClick={() => setSelectedStockIndex(index)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-[18px] border bg-white px-3 py-3 text-left transition',
                            selected
                              ? 'border-[color:var(--jaroo-primary)] bg-[color:var(--jaroo-accent)]/30 ring-1 ring-[color:var(--jaroo-primary)]'
                              : 'border-[color:var(--jaroo-border)] hover:bg-[color:var(--jaroo-secondary)]/70',
                          )}
                        >
                          <span className='size-2 rounded-full' style={{ backgroundColor: stock.dot }} />

                          <div className='min-w-0 flex-1'>
                            <p className='text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{stock.name}</p>
                            <p className='mt-0.5 text-[11px] text-[color:var(--jaroo-muted)]'>
                              {stock.market} · {stock.quantity}
                            </p>
                          </div>

                          <span
                            className={cn(
                              stock.rate === '거래 정지' ? 'text-[11px]' : 'text-[13px]',
                              'font-medium',
                              getFinancialValueTextClass(stock.rate),
                            )}
                          >
                            {stock.rate}
                          </span>

                          <span
                            className={cn(
                              'flex size-5 items-center justify-center rounded-full border text-[11px] font-medium transition',
                              selected
                                ? 'border-[color:var(--jaroo-primary)] bg-[color:var(--jaroo-primary)] text-white'
                                : 'border-[color:var(--jaroo-border)] text-transparent',
                            )}
                          >
                            ✓
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {selectedStock ? <StockPreviewCard stock={selectedStock} date={portfolioCard.date} /> : null}
                </section>
              )}
            </div>
          </>
        ) : phase === 'loading' ? (
          <ShareLoadingState />
        ) : (
          <ShareEmptyState loggedOut={phase === 'logged-out'} />
        )}
      </div>
    </JarooShell>
  )
}
