'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, CircleDollarSign, RefreshCw } from 'lucide-react'

import { JarooShell } from '@/components/jaroo-shell'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * AI 트레이더 원장 — 트레이더별 계좌(paper-trade)와 거래 판단 기록(ai-trader journal).
 * 공개 데모(2026-11-20 사용자 결정). 데이터는 /api/ai-trader/ledger가 서버에서 모은다.
 */

type Judgment = {
  logId?: string
  at?: string
  loopAt?: string
  decision?: 'buy' | 'sell' | 'hold'
  symbol?: string | null
  quantity?: number | null
  priceKrw?: number | null
  reasonCode?: string
  rationale?: string
  fact?: Record<string, unknown>
  /** 저널은 평면 필드로 반환 — 구버전 중첩 형태도 흡수 */
  orderId?: string | null
  orderStatus?: string | null
  errorMessage?: string | null
  order?: { orderId?: string | null; orderStatus?: string | null; errorMessage?: string | null }
}

type Position = {
  symbol: string
  name?: string | null
  quantity: number
  avgPriceKrw: number
  basisKrw?: number
}

type Account = {
  cashKrw: number
  initialCashKrw?: number
  positionCount?: number
  investedBasisKrw?: number
  realizedPnlTotalKrw?: number
  feeTotalKrw?: number
}

type Trader = {
  slug: string
  displayName: string
  temperament?: string | null
  narrativeGoal?: string | null
  principles?: string[]
  accountId?: string | null
  account?: Account | null
  positions?: Position[]
  judgments?: Judgment[]
}

type LedgerPayload = { traders: Trader[]; generatedAt: string }

const won = (n?: number | null) =>
  n == null ? '–' : `${Math.round(n).toLocaleString('ko-KR')}원`
const atKst = (j?: { at?: string; loopAt?: string }) =>
  j?.at || j?.loopAt
    ? new Date((j?.at ?? j?.loopAt) as string).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''
const orderOf = (j: Judgment) => ({
  orderId: j.orderId ?? j.order?.orderId ?? null,
  orderStatus: j.orderStatus ?? j.order?.orderStatus ?? null,
  errorMessage: j.errorMessage ?? j.order?.errorMessage ?? null,
})

const decisionTone: Record<string, { label: string; cls: string }> = {
  buy: { label: '매수', cls: 'bg-[#FDECEC] text-[#C03636]' },
  sell: { label: '매도', cls: 'bg-[#E7F0FA] text-[#2563EB]' },
  hold: { label: '관망', cls: 'bg-[#F1F3F5] text-[#5A6473]' },
}

function DecisionBadge({ decision }: { decision?: string }) {
  const tone = decisionTone[decision ?? ''] ?? { label: decision ?? '?', cls: 'bg-[#F1F3F5] text-[#5A6473]' }
  return <span className={cn('rounded-[6px] px-2 py-0.5 text-[11.5px] font-bold', tone.cls)}>{tone.label}</span>
}

export default function AiTraderLedgerPage() {
  const [data, setData] = useState<LedgerPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai-trader/ledger', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok || body?.ok === false) {
        setError(body?.error?.message ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(body.data)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <JarooShell
      title={
        <span className='flex items-center gap-1.5'>
          <CircleDollarSign className='size-4' /> AI 트레이더 원장
        </span>
      }
      subtitle={
        data
          ? `판단은 캐릭터(LLM), 숫자는 원장이 진실 · ${atKst({ at: data.generatedAt })} 기준`
          : '판단은 캐릭터(LLM), 숫자는 원장이 진실'
      }
      backHref='/home'
      action={
        <button
          type='button'
          onClick={() => void load()}
          className='flex items-center gap-1.5 rounded-full border border-[#D5D8DD] bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-[#0F1419] transition-colors hover:bg-[#F0F1F3]'
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 새로고침
        </button>
      }
    >
      <div className='mx-auto max-w-5xl'>
        {error ? (
          <div className="rounded-[14px] border border-[#E8EAEE] bg-white p-6 text-[13.5px] leading-6 text-[#5A6473]">
            <p className="font-bold text-[#0F1419]">원장 서비스에 닿지 않습니다</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-[12.5px] text-[#97A0AE]">
              ai-trader(:3042)·paper-trade(:3041) 기동 후 새로고침하세요. 턴이 한 번도 돌지 않았다면 계좌만 있고 기록은 비어 있습니다.
            </p>
          </div>
        ) : null}

        {data && data.traders.length === 0 ? (
          <div className="rounded-[14px] border border-[#E8EAEE] bg-white p-6 text-[13.5px] text-[#5A6473]">
            등록된 트레이더가 없습니다 (ai-trader 레지스트리 비어 있음).
          </div>
        ) : null}

        <div className="space-y-5">
          {(data?.traders ?? []).map((t) => {
            const a = t.account
            return (
              <section key={t.slug} className="overflow-hidden rounded-[16px] border border-[#E8EAEE] bg-white">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#EFF1F4] px-5 py-4">
                  <h2 className="text-[15.5px] font-bold text-[#0F1419]">{t.displayName}</h2>
                  {t.temperament ? <Badge variant="secondary">{t.temperament}</Badge> : null}
                  {t.narrativeGoal ? <span className="text-[12px] text-[#97A0AE]">목표: {t.narrativeGoal}</span> : null}
                  <span className="ml-auto font-mono text-[11px] text-[#97A0AE]">{t.slug}</span>
                </div>

                <div className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_1.4fr]">
                  <div>
                    <p className="mb-2 text-[11px] font-bold tracking-wide text-[#97A0AE]">계좌 (paper-trade)</p>
                    {a ? (
                      <div className="space-y-1 text-[13px]">
                        <Row label="현금" value={won(a.cashKrw)} />
                        <Row label="투자 원금" value={won(a.investedBasisKrw ?? 0)} />
                        <Row
                          label="실현 손익"
                          value={
                            <span className={(a.realizedPnlTotalKrw ?? 0) >= 0 ? 'text-[color:var(--jaroo-profit)]' : 'text-[color:var(--jaroo-loss)]'}>
                              {won(a.realizedPnlTotalKrw ?? 0)}
                            </span>
                          }
                        />
                        <Row label="수수료 누적" value={won(a.feeTotalKrw ?? 0)} />
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-[#97A0AE]">계좌 없음 — bootstrap 필요</p>
                    )}
                    {(t.positions ?? []).length > 0 ? (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-[11px] font-bold tracking-wide text-[#97A0AE]">보유</p>
                        {(t.positions ?? []).map((p) => (
                          <div key={p.symbol} className="flex items-center gap-2 rounded-[8px] bg-[#F7F8FA] px-2.5 py-1.5 text-[12.5px]">
                            <span className="font-bold text-[#0F1419]">{p.name ?? p.symbol}</span>
                            <span className="font-mono text-[11px] text-[#97A0AE]">{p.symbol}</span>
                            <span className="ml-auto text-[#5A6473]">{p.quantity}주 · 평단 {won(p.avgPriceKrw)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-[#97A0AE]">
                      <BookOpen className="size-3.5" /> 거래 판단 기록 (최근 {t.judgments?.length ?? 0}건)
                    </p>
                    {(t.judgments ?? []).length === 0 ? (
                      <p className="text-[12.5px] text-[#97A0AE]">아직 판단 기록이 없습니다 — 첫 턴을 돌리면 채워집니다.</p>
                    ) : (
                      <ol className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                        {(t.judgments ?? []).map((j, idx) => {
                          const ord = orderOf(j)
                          return (
                          <li key={j.logId ?? idx} className="rounded-[10px] border border-[#EFF1F4] px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <DecisionBadge decision={j.decision} />
                              <span className="text-[13px] font-bold text-[#0F1419]">{j.symbol ?? '–'}</span>
                              {j.quantity != null && j.priceKrw != null ? (
                                <span className="text-[12px] text-[#5A6473]">{j.quantity}주 @ {won(j.priceKrw)}</span>
                              ) : null}
                              <span className="ml-auto text-[11px] text-[#97A0AE]">{atKst(j)}</span>
                            </div>
                            {j.rationale ? <p className="mt-1.5 text-[12.5px] leading-5 text-[#374151]">{j.rationale}</p> : null}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {j.reasonCode ? (
                                <span className="rounded-[5px] bg-[#F7F8FA] px-1.5 py-0.5 font-mono text-[10.5px] text-[#5A6473]">{j.reasonCode}</span>
                              ) : null}
                              {ord.orderStatus ? (
                                <span
                                  className={cn(
                                    'rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-semibold',
                                    ord.orderStatus === 'placed' || ord.orderStatus === 'filled' ? 'bg-[#E8F7EE] text-[#15803D]' : 'bg-[#FAEEDA] text-[#854F0B]',
                                  )}
                                >
                                  체결 {ord.orderStatus === 'placed' || ord.orderStatus === 'filled' ? '완료' : ord.orderStatus}
                                </span>
                              ) : null}
                              {ord.errorMessage ? (
                                <span className="text-[10.5px] text-[#854F0B]">{ord.errorMessage}</span>
                              ) : null}
                            </div>
                          </li>
                          )
                        })}
                      </ol>
                    )}
                  </div>
                </div>

                {t.principles && t.principles.length > 0 ? (
                  <details className="border-t border-[#EFF1F4] px-5 py-2.5">
                    <summary className="cursor-pointer text-[12px] font-semibold text-[#5A6473]">자기 원칙 {t.principles.length}개</summary>
                    <ul className="mt-2 space-y-1 pb-1">
                      {t.principles.map((p, i) => (
                        <li key={i} className="text-[12.5px] leading-5 text-[#374151]">· {p}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            )
          })}
        </div>
      </div>
    </JarooShell>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[#5A6473]">{label}</span>
      <span className="font-semibold text-[#0F1419]">{value}</span>
    </div>
  )
}
