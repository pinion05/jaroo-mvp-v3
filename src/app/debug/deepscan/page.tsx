'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import { getDeepScanTargetKey, type DeepScanTargetInput, type WorkflowInstrumentKind, type WorkflowMarketTone, type WorkflowMoneyCurrency } from '@/lib/workflow-types'

const STORAGE_KEY = 'jaroo:deepscan-target'
const TARGET_EVENT = 'jaroo:deepscan-target:updated'

type MarketOption = 'US' | 'KOSPI' | 'KOSDAQ' | 'ETF' | 'ETN'
type KindOption = WorkflowInstrumentKind

type DebugFormState = {
  ticker: string
  name: string
  averagePrice: string
  shares: string
  market: MarketOption
  kind: KindOption
  averagePriceCurrency: WorkflowMoneyCurrency
}

const DEFAULT_FORM: DebugFormState = {
  ticker: '005930',
  name: '삼성전자',
  averagePrice: '70000',
  shares: '10',
  market: 'KOSPI',
  kind: 'stock',
  averagePriceCurrency: 'KRW',
}

function parseNumber(value: string) {
  const normalized = value.replace(/,/g, '').replace(/[^0-9.-]/g, '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeTicker(value: string) {
  return value.trim().toUpperCase()
}

function marketToneFor(market: MarketOption): WorkflowMarketTone {
  if (market === 'US') return 'nasdaq'
  if (market === 'KOSDAQ') return 'kosdaq'
  if (market === 'ETF' || market === 'ETN') return 'etf'
  return 'kospi'
}

function currencyFor(market: MarketOption) {
  return market === 'US' ? 'USD' : 'KRW'
}

function formatAveragePrice(value: number, currency: WorkflowMoneyCurrency) {
  if (currency === 'USD') {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
  }

  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}원`
}

function buildSessionHolding(target: DeepScanTargetInput) {
  const averagePrice = formatAveragePrice(target.averagePrice, target.averagePriceCurrency ?? 'KRW')
  const shares = `${target.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}주`
  const identifierLabel = [target.ticker, target.code].filter(Boolean).join(' · ') || undefined

  return {
    id: 999001,
    kind: target.kind ?? 'stock',
    name: target.name,
    code: target.code,
    shortName: target.name,
    donutLabel: target.ticker ?? target.code ?? target.name,
    shares,
    averagePrice,
    averagePriceCurrency: target.averagePriceCurrency,
    evaluationAmount: undefined,
    market: target.market ?? 'US',
    marketTone: target.marketTone ?? marketToneFor(target.market === 'KOSDAQ' ? 'KOSDAQ' : target.market === 'ETF' ? 'ETF' : target.market === 'ETN' ? 'ETN' : target.market === 'US' ? 'US' : 'KOSPI'),
    identifierTicker: target.ticker,
    identifierCode: target.code,
    identifierLabel,
    badge: '개발 테스트',
    badgeTone: 'amber',
    cardTone: target.kind === 'etf' ? 'etf' : 'warning',
    change: '-',
    pnl: '-',
    signalTone: target.kind === 'etf' ? 'etf' : 'warning',
    centerScore: '-',
    centerScoreColor: '#FAC775',
    centerBadge: '개발 테스트',
    centerBadgeTone: 'amber',
    centerName: target.name,
    donutColor: '#2B6BE6',
    donutPercent: 1,
    heatmapWeight: '100%',
    heatmapBackground: '#2B6BE6',
    heatmapChange: '-',
    heatmapBadge: '개발 테스트',
    heatmapBadgeTone: 'amber',
    opinionLabel: '개발 테스트 입력',
    opinionText: 'debug/deepscan에서 직접 만든 단일 DeepScan 타깃입니다.',
    opinionBackground: '#f8f8f6',
    opinionBorder: 'transparent',
    opinionTextColor: '#555',
    metaLine: `티커 ${target.ticker ?? target.code ?? '-'} · 평단 ${averagePrice}`,
    metrics: [
      { label: '보유 수량', value: shares, tone: 'neutral' },
      { label: '수익률', value: '-', tone: 'neutral' },
      { label: '평가 금액', value: '-', tone: 'neutral' },
    ],
    actionLabel: '딥스캔',
    actionSubLabel: '개발 테스트',
    actionCredits: undefined,
    actionHref: '/deepscan',
  }
}

function readInitialFormFromUrl() {
  if (typeof window === 'undefined') return DEFAULT_FORM

  const params = new URLSearchParams(window.location.search)
  const market = params.get('market')?.toUpperCase()
  const resolvedMarket: MarketOption = market === 'KOSPI' || market === 'KOSDAQ' || market === 'ETF' || market === 'ETN' || market === 'US'
    ? market
    : DEFAULT_FORM.market
  const kind = params.get('kind')?.toLowerCase()
  const resolvedKind: KindOption = kind === 'stock' || kind === 'etf'
    ? kind
    : (resolvedMarket === 'ETF' || resolvedMarket === 'ETN' ? 'etf' : DEFAULT_FORM.kind)
  const currency = params.get('currency')?.toUpperCase()
  const resolvedCurrency: WorkflowMoneyCurrency = currency === 'KRW' || currency === 'USD'
    ? currency
    : currencyFor(resolvedMarket)

  return {
    ticker: normalizeTicker(params.get('ticker') ?? params.get('code') ?? DEFAULT_FORM.ticker),
    name: params.get('name')?.trim() || normalizeTicker(params.get('ticker') ?? params.get('code') ?? DEFAULT_FORM.name),
    averagePrice: params.get('avg') ?? params.get('averagePrice') ?? DEFAULT_FORM.averagePrice,
    shares: params.get('shares') ?? DEFAULT_FORM.shares,
    market: resolvedMarket,
    kind: resolvedKind,
    averagePriceCurrency: resolvedCurrency,
  }
}

export default function DebugDeepScanPage() {
  const router = useRouter()
  const setDeepScanTarget = useDeepScanStore((state) => state.setTarget)
  const clearDeepScan = useDeepScanStore((state) => state.clear)
  const [form, setForm] = useState<DebugFormState>(DEFAULT_FORM)
  const [error, setError] = useState<string | null>(null)
  const [didHydrate, setDidHydrate] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextForm = readInitialFormFromUrl()
      setForm(nextForm)
      setDidHydrate(true)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  const previewTarget = useMemo(() => {
    const averagePrice = parseNumber(form.averagePrice)
    const quantity = parseNumber(form.shares)
    const ticker = normalizeTicker(form.ticker)
    if (!ticker || averagePrice === null || quantity === null) return null

    return {
      ticker: /^\d{6}$/u.test(ticker) ? undefined : ticker,
      code: /^\d{6}$/u.test(ticker) ? ticker : undefined,
      market: form.market,
      marketTone: marketToneFor(form.market),
      kind: form.kind,
      name: form.name.trim() || ticker,
      quantity,
      averagePrice,
      averagePriceCurrency: form.averagePriceCurrency,
      identifierLabel: ticker,
    } satisfies DeepScanTargetInput
  }, [form])

  const updateField = <K extends keyof DebugFormState>(key: K, value: DebugFormState[K]) => {
    setForm((previous) => {
      if (key === 'market') {
        const nextMarket = value as MarketOption
        const nextKind = nextMarket === 'ETF' || nextMarket === 'ETN' ? 'etf' : previous.kind
        return {
          ...previous,
          market: nextMarket,
          kind: nextKind,
          averagePriceCurrency: currencyFor(nextMarket),
        }
      }

      return { ...previous, [key]: value }
    })
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!previewTarget) {
      setError('티커/코드, 평단가, 수량을 숫자로 입력해주세요.')
      return
    }

    clearDeepScan()
    setDeepScanTarget(previewTarget)

    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          holding: buildSessionHolding(previewTarget),
          selectedAt: new Date().toISOString(),
        }),
      )
      window.dispatchEvent(new Event(TARGET_EVENT))
    } catch {
      // Zustand target is already set. Session storage is only for reload resilience.
    }

    router.push('/deepscan')
  }

  const exampleUrl = didHydrate
    ? `/debug/deepscan?ticker=${encodeURIComponent(form.ticker || '005930')}&avg=${encodeURIComponent(form.averagePrice || '70000')}&shares=${encodeURIComponent(form.shares || '10')}&market=${form.market}&kind=${form.kind}`
    : '/debug/deepscan?ticker=005930&avg=70000&shares=10&market=KOSPI&kind=stock'

  return (
    <main className='min-h-dvh bg-[#F5F6F8] px-4 py-6 text-[#0F1419]'>
      <section className='mx-auto max-w-[520px] rounded-[28px] border border-[#E8EAEE] bg-white p-5 shadow-[0_8px_30px_rgba(15,20,25,.08)]'>
        <div className='mb-5'>
          <p className='text-[11px] font-bold tracking-[0.12em] text-[#2B6BE6]'>DEV ONLY</p>
          <h1 className='mt-1 text-[22px] font-bold tracking-[-0.03em]'>DeepScan 직접 실행</h1>
          <p className='mt-2 text-[13px] leading-5 text-[#5A6473]'>티커/코드와 평단가만 빠르게 넣어서 OCR·홈 단계를 건너뛰고 DeepScan 화면을 확인합니다.</p>
        </div>

        <form className='space-y-4' onSubmit={submit}>
          <label className='block'>
            <span className='mb-1.5 block text-[12px] font-semibold text-[#5A6473]'>티커 또는 6자리 코드</span>
            <input
              value={form.ticker}
              onChange={(event) => updateField('ticker', event.target.value)}
              placeholder='SPY 또는 005930'
              className='h-12 w-full rounded-[14px] border border-[#DDE2EA] bg-[#F8FAFC] px-3 text-[15px] font-semibold outline-none focus:border-[#2B6BE6]'
            />
          </label>

          <label className='block'>
            <span className='mb-1.5 block text-[12px] font-semibold text-[#5A6473]'>표시 이름</span>
            <input
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              placeholder='비워두면 티커 사용'
              className='h-12 w-full rounded-[14px] border border-[#DDE2EA] bg-[#F8FAFC] px-3 text-[15px] outline-none focus:border-[#2B6BE6]'
            />
          </label>

          <div className='grid grid-cols-2 gap-3'>
            <label className='block'>
              <span className='mb-1.5 block text-[12px] font-semibold text-[#5A6473]'>평단가</span>
              <input
                inputMode='decimal'
                value={form.averagePrice}
                onChange={(event) => updateField('averagePrice', event.target.value)}
                placeholder='450'
                className='h-12 w-full rounded-[14px] border border-[#DDE2EA] bg-[#F8FAFC] px-3 text-[15px] font-semibold outline-none focus:border-[#2B6BE6]'
              />
            </label>
            <label className='block'>
              <span className='mb-1.5 block text-[12px] font-semibold text-[#5A6473]'>수량</span>
              <input
                inputMode='decimal'
                value={form.shares}
                onChange={(event) => updateField('shares', event.target.value)}
                placeholder='10'
                className='h-12 w-full rounded-[14px] border border-[#DDE2EA] bg-[#F8FAFC] px-3 text-[15px] font-semibold outline-none focus:border-[#2B6BE6]'
              />
            </label>
          </div>

          <div className='grid grid-cols-3 gap-3'>
            <label className='block'>
              <span className='mb-1.5 block text-[12px] font-semibold text-[#5A6473]'>시장</span>
              <select
                value={form.market}
                onChange={(event) => updateField('market', event.target.value as MarketOption)}
                className='h-12 w-full rounded-[14px] border border-[#DDE2EA] bg-[#F8FAFC] px-2 text-[13px] font-semibold outline-none focus:border-[#2B6BE6]'
              >
                <option value='US'>US</option>
                <option value='KOSPI'>KOSPI</option>
                <option value='KOSDAQ'>KOSDAQ</option>
                <option value='ETF'>KR ETF</option>
                <option value='ETN'>KR ETN</option>
              </select>
            </label>
            <label className='block'>
              <span className='mb-1.5 block text-[12px] font-semibold text-[#5A6473]'>종류</span>
              <select
                value={form.kind}
                onChange={(event) => updateField('kind', event.target.value as KindOption)}
                className='h-12 w-full rounded-[14px] border border-[#DDE2EA] bg-[#F8FAFC] px-2 text-[13px] font-semibold outline-none focus:border-[#2B6BE6]'
              >
                <option value='stock'>단일종목</option>
                <option value='etf'>ETF/ETN</option>
              </select>
            </label>
            <label className='block'>
              <span className='mb-1.5 block text-[12px] font-semibold text-[#5A6473]'>통화</span>
              <select
                value={form.averagePriceCurrency}
                onChange={(event) => updateField('averagePriceCurrency', event.target.value as WorkflowMoneyCurrency)}
                className='h-12 w-full rounded-[14px] border border-[#DDE2EA] bg-[#F8FAFC] px-2 text-[13px] font-semibold outline-none focus:border-[#2B6BE6]'
              >
                <option value='USD'>USD</option>
                <option value='KRW'>KRW</option>
              </select>
            </label>
          </div>

          {error ? <p className='rounded-[12px] bg-[#FCEBEB] px-3 py-2 text-[12px] font-semibold text-[#A32D2D]'>{error}</p> : null}

          <button type='submit' className='h-13 w-full rounded-[16px] bg-[#2B6BE6] text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(43,107,230,.25)]'>
            DeepScan 열기
          </button>
        </form>

        <div className='mt-5 rounded-[16px] bg-[#F5F6F8] p-3'>
          <p className='text-[11px] font-semibold text-[#5A6473]'>현재 타깃 키</p>
          <p className='mt-1 break-all font-mono text-[11px] text-[#0F1419]'>{previewTarget ? getDeepScanTargetKey(previewTarget) : '입력 대기'}</p>
          <p className='mt-3 text-[11px] font-semibold text-[#5A6473]'>공유 가능한 개발 링크</p>
          <code className='mt-1 block break-all rounded-[10px] bg-white px-2 py-2 text-[11px] text-[#334155]'>{exampleUrl}</code>
        </div>
      </section>
    </main>
  )
}
