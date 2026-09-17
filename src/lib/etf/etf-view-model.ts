// /etf 화면의 뷰모델 — 실데이터(quotes·profile·holding·metrics)를 화면 표기 문자열로 맵핑한다.
// 채울 수 없는 블록은 reason을 명시하는 notice로 내려가고, 페이지가
// EtfDataNoticeCard로 렌더한다 (스펙 2026-09-15 D7).
// 2단계(Task 9)부터 일봉 지표·구성종목은 실데이터 items로 내려온다.
// 표기 규칙: 평단·금액 정수 반올림, 손실 부호 −(U+2212), 천 단위 ko-KR 구분.

import type { EtfMetrics } from './etf-metrics'

export type EtfTab = 'overview' | 'holdings' | 'risk'
export type EtfValueTone = 'danger' | 'positive' | 'neutral'
export type EtfScenarioTone = 'positive' | 'primary' | 'warning'

export type EtfNoticeReason = 'source-absent' | 'source-pending' | 'planned'

export type EtfNotice = { reason: EtfNoticeReason; message: string }

export type EtfProfileJson = {
  schemaVersion: 'jaroo-etf-profile-v1'
  code: string
  name: string
  market: 'kospi' | 'kosdaq' | 'us'
  ok: true
  /** 미국 ETF는 'USD'(기본 KRW — 필드 부재 시 원화) */
  currency?: 'KRW' | 'USD'
  quote?: { changePct: number | null } | null
  product: {
    issuerName: string | null
    baseIndexName: string | null
    totalFeePct: number | null
    firstSettleDate: string | null
    aum: number | null
    nav: number | null
    deviationPct: number | null
  }
  returns: { m1: number | null; m3: number | null; m6: number | null; y1: number | null } | null
  holdings: Array<{ rank: number; code: string; name: string; weightPct: number; changePct: number | null }> | null
  daily: Array<{ date: string; close: number }> | null
}

export type EtfNoticeBlock = {
  notice: { reason: EtfNoticeReason; message: string }
  items: null
}

function noticeBlock(reason: EtfNoticeReason, message: string): EtfNoticeBlock {
  return { notice: { reason, message }, items: null }
}

const MINUS = '−'

const krw = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

// 미국 ETF 달러 표기 — 가격은 소수 2자리(미국 주식 관례)
const usd = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

type EtfMoneyFormatter = (value: number) => string

const moneyFormatter = (currency: EtfProfileJson['currency']): EtfMoneyFormatter =>
  currency === 'USD' ? usd : krw

const signedPct = (value: number) => `${value >= 0 ? '+' : MINUS}${Math.abs(value).toFixed(2)}%`

const trillionText = (aum: number, currency: EtfProfileJson['currency']) =>
  currency === 'USD'
    ? `${(aum / 1_000_000_000_000).toFixed(2)}조 달러`
    : `${(aum / 1_000_000_000_000).toFixed(1)}조원`

export type EtfHeroStat = { label: string; value: string }

export type EtfBasicInfoItem = { label: string; value: string }

export type EtfReturnItem = { label: string; value: string; tone: EtfValueTone }
export type EtfReturnsBlock = { notice: null; items: EtfReturnItem[] } | EtfNoticeBlock

// 구성 종목 집중도 헤드라인 — 상위 n개 비중 합계와 집중/분산 코멘트(이슈 #270 D3).
// 요약 캡션은 소수 1자리, 집중도도 소수 1자리로 반올림해 부동소수 오차를 없앤다.
export type EtfHoldingsHeadline = {
  concentrationPct: number // 0~100 (반올림 소수 1자리)
  concentrationText: string // '62.4%'
  concentrationCaptionText: string // '상위 10개 집중도'
  topSummaryText: string | null // '1위 삼성전자 21.3% · 2위 SK하이닉스 15.2%' — 0개면 null
  sourceText: string // '네이버 제공 기준' | 'Yahoo Finance 제공 기준'
  commentText: string // 집중/분산 코멘트
}

const HOLDINGS_HEADLINE_LIMIT = 10

export function buildHoldingsHeadline(
  holdings: NonNullable<EtfProfileJson['holdings']>,
  market: EtfProfileJson['market'],
): EtfHoldingsHeadline {
  const top = holdings.slice(0, HOLDINGS_HEADLINE_LIMIT)
  const rawSum = top.reduce((sum, holding) => sum + (Number.isFinite(holding.weightPct) ? holding.weightPct : 0), 0)
  const concentrationPct = Math.round(Math.max(0, Math.min(100, rawSum)) * 10) / 10
  const commentText =
    concentrationPct >= 60
      ? '상위 종목 비중이 높은 편이에요'
      : concentrationPct <= 40
        ? '고르게 분산돼 있어요'
        : '중간 정도로 분산돼 있어요'

  return {
    concentrationPct,
    concentrationText: `${concentrationPct.toFixed(1)}%`,
    concentrationCaptionText: `상위 ${top.length}개 집중도`,
    topSummaryText:
      top.length > 0
        ? top
            .slice(0, 2)
            .map((holding, index) => `${index + 1}위 ${holding.name} ${holding.weightPct.toFixed(1)}%`)
            .join(' · ')
        : null,
    sourceText: market === 'us' ? 'Yahoo Finance 제공 기준' : '네이버 제공 기준',
    commentText,
  }
}

export type EtfHoldingItem = { rank: number; code: string; name: string; weightText: string; weightBarPct: number }
export type EtfHoldingsBlock =
  | { notice: null; items: EtfHoldingItem[]; summary: string; headline: EtfHoldingsHeadline }
  | { notice: EtfNotice; items: null; summary: null }

export type EtfRiskItem = { label: string; value: string; subtitle: string }
export type EtfRiskBlock = { notice: null; items: EtfRiskItem[] } | EtfNoticeBlock

// 시나리오 블록 = 52주 범위 위치(가중 목표가는 3단계 이관, 스펙 Self-Review 참조)
export type EtfScenario = {
  positionPct: number // 0=52주 저점, 100=52주 고점
  positionText: string // '34%'
  headline: string // '52주 중간 구간' 등
  highText: string
  lowText: string
  note: string // 애널리스트 목표가 부재 사유(D7) — 카드에 항상 표기
}
export type EtfScenarioBlock = { notice: null; scenario: EtfScenario } | EtfNoticeBlock

export type EtfViewModel = {
  header: { name: string; code: string; issuer: string; tracking: string }
  hero: {
    name: string
    price: string
    change: string | null
    averagePrice: string | null
    profitAmount: string | null
    stats: EtfHeroStat[]
  }
  momentum: { label: string; badge: string }
  scenario: EtfScenarioBlock
  returns: EtfReturnsBlock
  basicInfo: { items: EtfBasicInfoItem[] }
  sectorWeights: EtfNoticeBlock
  topHoldings: EtfHoldingsBlock
  riskMetrics: EtfRiskBlock
  peers: EtfNoticeBlock
  dividendInfo: EtfNoticeBlock
}

function buildHeroStats(product: EtfProfileJson['product'], currency: EtfProfileJson['currency']): EtfHeroStat[] {
  const stats: EtfHeroStat[] = []
  if (product.aum != null) stats.push({ label: '순자산', value: trillionText(product.aum, currency) })
  if (product.totalFeePct != null) stats.push({ label: '총보수', value: `연 ${product.totalFeePct.toFixed(2)}%` })
  if (product.firstSettleDate) {
    stats.push({ label: '설정일', value: product.firstSettleDate.slice(0, 7).replace('-', '.') })
  }
  return stats
}

function buildReturnsBlock(metrics: EtfMetrics | null | undefined): EtfReturnsBlock {
  if (!metrics) {
    return noticeBlock('source-pending', '기간별 수익률은 일봉이 1년치 쌓이면 계산해드려요')
  }

  const entries: Array<{ label: string; value: number | null }> = [
    { label: '1개월', value: metrics.returns.m1 },
    { label: '3개월', value: metrics.returns.m3 },
    { label: '6개월', value: metrics.returns.m6 },
    { label: '1년', value: metrics.returns.y1 },
  ]
  return {
    notice: null,
    items: entries.map(({ label, value }) => ({
      label,
      value: value == null ? '--' : signedPct(value),
      tone: value == null ? ('neutral' as const) : value >= 0 ? ('positive' as const) : ('danger' as const),
    })),
  }
}

function buildRiskBlock(metrics: EtfMetrics | null | undefined, money: EtfMoneyFormatter): EtfRiskBlock {
  if (!metrics) {
    return noticeBlock('source-pending', '리스크 지표는 일봉이 1년치 쌓이면 계산해드려요')
  }

  const vol = metrics.volatilityAnnPct
  const mdd = metrics.mddPct
  const sharpe = metrics.sharpe
  const week52 = metrics.week52
  return {
    notice: null,
    items: [
      {
        label: '연 변동성',
        value: vol == null ? '--' : `${vol.toFixed(1)}%`,
        subtitle: '일별 등락 기준 연율화',
      },
      {
        label: '최대낙폭 (MDD)',
        value: mdd == null ? '--' : `${MINUS}${Math.abs(mdd).toFixed(1)}%`,
        subtitle: '관찰 구간 최고가 대비',
      },
      {
        label: '샤프지수',
        value: sharpe == null ? '--' : sharpe.toFixed(2),
        subtitle: '무위험수익률 3.5% 가정',
      },
      {
        label: '52주 범위',
        value: week52 ? `${money(week52.low)} ~ ${money(week52.high)}` : '--',
        subtitle: '종가 기준 최저·최고',
      },
    ],
  }
}

function buildScenarioBlock(price: number, metrics: EtfMetrics | null | undefined, money: EtfMoneyFormatter): EtfScenarioBlock {
  const week52 = metrics?.week52
  if (!week52 || !(week52.high > week52.low) || !Number.isFinite(price)) {
    return noticeBlock('source-pending', '일봉 데이터가 부족해 52주 위치를 계산할 수 있어요')
  }

  const positionPct = Math.max(0, Math.min(100, ((price - week52.low) / (week52.high - week52.low)) * 100))
  const rounded = Math.round(positionPct)
  const headline = rounded >= 80 ? '52주 고점 근처' : rounded <= 20 ? '52주 저점 근처' : '52주 중간 구간'

  return {
    notice: null,
    scenario: {
      positionPct,
      positionText: `${rounded}%`,
      headline,
      highText: money(week52.high),
      lowText: money(week52.low),
      note: 'ETF엔 애널리스트 목표가가 없어 52주 범위 위치로 판단해요',
    },
  }
}

function buildHoldingsBlock(profile: EtfProfileJson): EtfHoldingsBlock {
  const holdings = profile.holdings
  if (!holdings || holdings.length === 0) {
    return { ...noticeBlock('source-pending', '구성종목은 소스 연결 후 보여줘요'), summary: null }
  }

  const top = holdings.slice(0, 10)
  const maxWeight = top[0]?.weightPct ?? 1
  return {
    notice: null,
    items: top.map((holding) => ({
      rank: holding.rank,
      code: holding.code,
      name: holding.name,
      weightText: `${holding.weightPct.toFixed(2)}%`,
      weightBarPct: maxWeight > 0 ? Math.round((holding.weightPct / maxWeight) * 100) : 0,
    })),
    summary: `상위 ${top.length}개 종목 · 네이버 제공 기준 · 구성등락률은 소스 준비 중`,
    headline: buildHoldingsHeadline(top, profile.market),
  }
}

function buildBasicInfoItems(product: EtfProfileJson['product'], money: EtfMoneyFormatter): EtfBasicInfoItem[] {
  const items: EtfBasicInfoItem[] = []
  if (product.issuerName) items.push({ label: '운용사', value: product.issuerName })
  if (product.baseIndexName) items.push({ label: '기준지수', value: product.baseIndexName })
  if (product.nav != null) items.push({ label: 'NAV', value: money(product.nav) })
  if (product.deviationPct != null) items.push({ label: 'NAV 괴리율', value: signedPct(product.deviationPct) })
  return items
}

export function buildEtfViewModel(input: {
  profile: EtfProfileJson
  quote: { price: number; changePct: number | null; asOf?: string }
  holding: { shares: number; averagePrice: number } | null
  metrics?: EtfMetrics | null
}): EtfViewModel {
  const { profile, quote, holding, metrics = null } = input
  const product = profile.product
  const currency = profile.currency
  const money = moneyFormatter(currency)

  const profit =
    holding && holding.averagePrice > 0
      ? {
          amount: (quote.price - holding.averagePrice) * holding.shares,
        }
      : null

  return {
    header: {
      name: profile.name,
      code: profile.code,
      issuer: product.issuerName ?? '',
      tracking: product.baseIndexName ? `${product.baseIndexName} 추종` : '',
    },
    hero: {
      name: profile.name,
      price: money(quote.price),
      change: quote.changePct == null ? null : signedPct(quote.changePct),
      averagePrice: holding ? `평단 ${money(holding.averagePrice)}` : null,
      profitAmount: profit
        ? currency === 'USD'
          ? `${profit.amount >= 0 ? '+' : MINUS}$${Math.abs(profit.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
          : `${profit.amount >= 0 ? '+' : MINUS}${Math.abs(Math.round(profit.amount)).toLocaleString('ko-KR')}원`
        : null,
      stats: buildHeroStats(product, currency),
    },
    momentum:
      quote.changePct == null
        ? { label: '최근 등락 정보를 가져오지 못했어요', badge: '·' }
        : {
            label: quote.changePct >= 0 ? '최근 거래일 상승 — 순풍' : '최근 거래일 하락 — 역풍',
            badge: quote.changePct >= 0 ? '↗' : '↘',
          },
    scenario: buildScenarioBlock(quote.price, metrics, money),
    returns: buildReturnsBlock(metrics),
    basicInfo: { items: buildBasicInfoItems(product, money) },
    sectorWeights: noticeBlock('source-pending', '섹터 비중은 구성종목 매핑 준비 중이에요'),
    topHoldings: buildHoldingsBlock(profile),
    riskMetrics: buildRiskBlock(metrics, money),
    peers: noticeBlock('planned', '유사 ETF 비교는 출시 후 제공될 예정이에요'),
    dividendInfo: noticeBlock('planned', '배당 정보는 출시 후 제공될 예정이에요'),
  }
}
