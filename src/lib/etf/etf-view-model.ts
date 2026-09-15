// /etf 화면의 뷰모델 — 실데이터(quotes·profile·holding)를 화면 표기 문자열로 맵핑한다.
// 채울 수 없는 블록은 reason을 명시하는 notice 블록으로 내려가고, 페이지가
// EtfDataNoticeCard로 렌더한다 (스펙 2026-09-15 D7).
// 표기 규칙: 평단·금액 정수 반올림, 손실 부호 −(U+2212), 천 단위 ko-KR 구분.

export type EtfTab = 'overview' | 'holdings' | 'risk'
export type EtfValueTone = 'danger' | 'positive' | 'neutral'
export type EtfScenarioTone = 'positive' | 'primary' | 'warning'

export type EtfNoticeReason = 'source-absent' | 'source-pending' | 'planned'

export type EtfProfileJson = {
  schemaVersion: 'jaroo-etf-profile-v1'
  code: string
  name: string
  market: 'kospi' | 'kosdaq'
  ok: true
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

const signedPct = (value: number) => `${value >= 0 ? '+' : MINUS}${Math.abs(value).toFixed(2)}%`

const trillionText = (aum: number) => `${(aum / 1_000_000_000_000).toFixed(1)}조원`

export type EtfHeroStat = { label: string; value: string }

export type EtfBasicInfoItem = { label: string; value: string }

export type EtfViewModel = {
  header: { name: string; code: string; issuer: string; tracking: string }
  hero: {
    name: string
    price: string
    change: string
    averagePrice: string | null
    profitAmount: string | null
    stats: EtfHeroStat[]
  }
  momentum: { label: string; badge: string }
  scenario: EtfNoticeBlock
  returns: EtfNoticeBlock
  basicInfo: { items: EtfBasicInfoItem[] }
  sectorWeights: EtfNoticeBlock
  topHoldings: EtfNoticeBlock
  riskMetrics: EtfNoticeBlock
  peers: EtfNoticeBlock
  dividendInfo: EtfNoticeBlock
}

function buildHeroStats(product: EtfProfileJson['product']): EtfHeroStat[] {
  const stats: EtfHeroStat[] = []
  if (product.aum != null) stats.push({ label: '순자산', value: trillionText(product.aum) })
  if (product.totalFeePct != null) stats.push({ label: '총보수', value: `연 ${product.totalFeePct.toFixed(2)}%` })
  if (product.firstSettleDate) {
    stats.push({ label: '설정일', value: product.firstSettleDate.slice(0, 7).replace('-', '.') })
  }
  return stats
}

function buildBasicInfoItems(product: EtfProfileJson['product']): EtfBasicInfoItem[] {
  const items: EtfBasicInfoItem[] = []
  if (product.issuerName) items.push({ label: '운용사', value: product.issuerName })
  if (product.baseIndexName) items.push({ label: '기준지수', value: product.baseIndexName })
  if (product.nav != null) items.push({ label: 'NAV', value: krw(product.nav) })
  if (product.deviationPct != null) items.push({ label: 'NAV 괴리율', value: `${product.deviationPct.toFixed(2)}%` })
  return items
}

export function buildEtfViewModel(input: {
  profile: EtfProfileJson
  quote: { price: number; changePct: number; asOf?: string }
  holding: { shares: number; averagePrice: number } | null
}): EtfViewModel {
  const { profile, quote, holding } = input
  const product = profile.product

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
      price: krw(quote.price),
      change: signedPct(quote.changePct),
      averagePrice: holding ? `평단 ${krw(holding.averagePrice)}` : null,
      profitAmount: profit
        ? `${profit.amount >= 0 ? '+' : MINUS}${Math.abs(Math.round(profit.amount)).toLocaleString('ko-KR')}원`
        : null,
      stats: buildHeroStats(product),
    },
    momentum: {
      label: quote.changePct >= 0 ? '최근 거래일 상승 — 순풍' : '최근 거래일 하락 — 역풍',
      badge: quote.changePct >= 0 ? '↗' : '↘',
    },
    scenario: noticeBlock('source-absent', 'ETF에는 애널리스트 목표가·컨센서스가 없어요'),
    returns: noticeBlock('source-pending', '기간별 수익률은 일봉 데이터 연결 후 제공돼요'),
    basicInfo: { items: buildBasicInfoItems(product) },
    sectorWeights: noticeBlock('source-pending', '섹터 비중은 구성종목 매핑 준비 중이에요'),
    topHoldings: noticeBlock('source-pending', '구성종목은 데이터 연결 후 보여줘요'),
    riskMetrics: noticeBlock('source-pending', '리스크 지표는 일봉 데이터 연결 후 제공돼요'),
    peers: noticeBlock('planned', '유사 ETF 비교는 출시 후 제공될 예정이에요'),
    dividendInfo: noticeBlock('planned', '배당 정보는 출시 후 제공될 예정이에요'),
  }
}
