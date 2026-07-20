'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { JarooShell } from '@/components/jaroo-shell'
import { getFinancialValueTextClass, getFinancialValueTone } from '@/lib/financial-value-tone'
import type { ShareCardStock, ShareCardWind } from '@/lib/jaroo-data'
import { sharePortfolioCard, shareStockCards } from '@/lib/jaroo-data'
import { cn } from '@/lib/utils'

type ShareTab = 'portfolio' | 'stock'

const tabs: Array<{ id: ShareTab; label: string }> = [
  { id: 'portfolio', label: '포트폴리오' },
  { id: 'stock', label: '종목별' },
]

const windClasses: Record<ShareCardWind, string> = {
  순풍: 'bg-[color:var(--jaroo-success-ghost)] text-[color:var(--jaroo-success)]',
  미풍: 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
  역풍: 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]',
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

function PortfolioShareCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
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
                <span className='size-2 rounded-full bg-[color:var(--jaroo-success)]' />
                <span className='text-xs font-medium text-[color:var(--jaroo-success)]'>{sharePortfolioCard.momentumLabel}</span>
                <Badge className='rounded-md bg-[color:var(--jaroo-success-ghost)] px-2 py-0.5 text-[10px] text-[color:var(--jaroo-success)]'>
                  {sharePortfolioCard.momentumDetail}
                </Badge>
              </div>
            </div>

            <div className='mt-4'>
              <p className='text-[10px] text-[color:var(--jaroo-muted)]'>총 손익</p>
              <p className={cn('mt-1 text-[30px] leading-none font-bold', getFinancialValueTextClass(sharePortfolioCard.totalPnl))}>
                {sharePortfolioCard.totalPnl}
              </p>
              <p className='mt-1 text-xs text-[color:var(--jaroo-muted)]'>{sharePortfolioCard.totalSummary}</p>
            </div>

            <div className='my-3 h-px bg-[color:var(--jaroo-border)]' />

            <div>
              {shareStockCards.map((stock) => (
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
              <span className='text-[10px] text-[color:var(--jaroo-muted)]/70'>{sharePortfolioCard.date}</span>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>{sharePortfolioCard.brand}</span>
            </div>
          </div>
        </Card>
      </div>
    </button>
  )
}

function StockPreviewCard({ stock }: { stock: ShareCardStock }) {
  return (
    <div className='rounded-[18px] bg-[color:var(--jaroo-secondary)] p-3.5'>
      <p className='mb-2 text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>미리보기</p>
      <Card className='gap-0 rounded-[18px] border border-[color:var(--jaroo-border)] bg-white py-0 shadow-none ring-0'>
        <div className='p-4'>
          <div className='flex items-center justify-between'>
            <span className='text-[13px] font-bold tracking-[-0.02em] text-[color:var(--jaroo-ink)]'>Jaroo.</span>
            <span className='text-[10px] text-[color:var(--jaroo-muted)]'>{sharePortfolioCard.date}</span>
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
            {sharePortfolioCard.brand}
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

  const selectedStock = selectedStockIndex === null ? null : shareStockCards[selectedStockIndex]
  const showFooter = activeTab === 'portfolio' || selectedStock !== null

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
                {shareStockCards.map((stock, index) => {
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

              {selectedStock ? <StockPreviewCard stock={selectedStock} /> : null}
            </section>
          )}
        </div>
      </div>
    </JarooShell>
  )
}
