import { etfAnalysis } from '@/lib/jaroo-data'
import type { HomeHolding } from '@/lib/jaroo-home-data'

export const SELECTED_ETF_STORAGE_KEY = 'jaroo:selected-etf-target'

export type SelectedEtfTarget = Pick<
  HomeHolding,
  | 'kind'
  | 'name'
  | 'code'
  | 'shortName'
  | 'shares'
  | 'averagePrice'
  | 'evaluationAmount'
  | 'market'
  | 'identifierTicker'
  | 'identifierCode'
  | 'identifierLabel'
  | 'badge'
  | 'change'
  | 'pnl'
>

function trimOrUndefined(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function selectedEtfCode(target: SelectedEtfTarget) {
  return trimOrUndefined(target.identifierCode)
    ?? trimOrUndefined(target.code)
    ?? trimOrUndefined(target.identifierTicker)
    ?? etfAnalysis.header.code
}

function selectedEtfEvaluation(target: SelectedEtfTarget) {
  return trimOrUndefined(target.evaluationAmount) ?? etfAnalysis.hero.price
}

function sanitizeSelectedEtfTarget(value: Partial<SelectedEtfTarget>): SelectedEtfTarget | null {
  if (value.kind !== 'etf' || typeof value.name !== 'string' || typeof value.shares !== 'string' || typeof value.averagePrice !== 'string') {
    return null
  }

  return {
    kind: 'etf',
    name: value.name,
    code: trimOrUndefined(value.code),
    shortName: typeof value.shortName === 'string' && value.shortName.trim() ? value.shortName : value.name,
    shares: value.shares,
    averagePrice: value.averagePrice,
    evaluationAmount: trimOrUndefined(value.evaluationAmount),
    market: typeof value.market === 'string' && value.market.trim() ? value.market : 'ETF',
    identifierTicker: trimOrUndefined(value.identifierTicker),
    identifierCode: trimOrUndefined(value.identifierCode),
    identifierLabel: trimOrUndefined(value.identifierLabel),
    badge: typeof value.badge === 'string' && value.badge.trim() ? value.badge : 'ETF',
    change: typeof value.change === 'string' && value.change.trim() ? value.change : etfAnalysis.hero.change,
    pnl: typeof value.pnl === 'string' && value.pnl.trim() ? value.pnl : '-',
  }
}

export function createSelectedEtfTarget(holding: HomeHolding): SelectedEtfTarget | null {
  if (holding.kind !== 'etf') {
    return null
  }

  return sanitizeSelectedEtfTarget(holding)
}

export function persistSelectedEtfTarget(holding: HomeHolding) {
  if (typeof window === 'undefined') {
    return false
  }

  const target = createSelectedEtfTarget(holding)
  if (!target) {
    return false
  }

  try {
    window.sessionStorage.setItem(SELECTED_ETF_STORAGE_KEY, JSON.stringify(target))
    return true
  } catch {
    return false
  }
}

export function getSelectedEtfSnapshot() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.sessionStorage.getItem(SELECTED_ETF_STORAGE_KEY)
}

export function getSelectedEtfServerSnapshot() {
  return null
}

export function subscribeSelectedEtfSnapshot(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === SELECTED_ETF_STORAGE_KEY) {
      onStoreChange()
    }
  }

  window.addEventListener('storage', handleStorage)
  return () => window.removeEventListener('storage', handleStorage)
}

export function readSelectedEtfTargetFromSnapshot(rawValue: string | null): SelectedEtfTarget | null {
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<SelectedEtfTarget>
    return sanitizeSelectedEtfTarget(parsed)
  } catch {
    return null
  }
}

export function readSelectedEtfTarget(): SelectedEtfTarget | null {
  return readSelectedEtfTargetFromSnapshot(getSelectedEtfSnapshot())
}

export function buildSelectedEtfAnalysis(target: SelectedEtfTarget) {
  const code = selectedEtfCode(target)
  const evaluationAmount = selectedEtfEvaluation(target)
  const averagePrice = trimOrUndefined(target.averagePrice) ?? etfAnalysis.hero.averagePrice
  const change = trimOrUndefined(target.change) ?? etfAnalysis.hero.change
  const pnl = trimOrUndefined(target.pnl) ?? '-'
  const tracking = trimOrUndefined(target.identifierLabel) ?? `${target.market} 선택 ETF`

  return {
    ...etfAnalysis,
    header: {
      ...etfAnalysis.header,
      name: target.name,
      code,
      issuer: target.market,
      tracking,
    },
    hero: {
      ...etfAnalysis.hero,
      name: target.shortName || target.name,
      price: evaluationAmount,
      change: `${change} ${target.badge}`.trim(),
      averagePrice: `평단 ${averagePrice}`,
      stats: [
        { label: '보유수량', value: target.shares },
        { label: '평가금액', value: evaluationAmount },
        { label: '평가손익', value: pnl },
      ],
    },
    scenario: {
      ...etfAnalysis.scenario,
      target: `현재 ${evaluationAmount} · 평단 ${averagePrice}`,
    },
    basicInfo: {
      ...etfAnalysis.basicInfo,
      items: [
        { label: '종목코드', value: code },
        { label: '보유수량', value: target.shares },
        { label: '평균단가', value: averagePrice },
        { label: '평가금액', value: evaluationAmount },
        { label: '평가손익', value: pnl },
        { label: '수익률', value: change },
        ...etfAnalysis.basicInfo.items,
      ],
    },
    peers: {
      ...etfAnalysis.peers,
      items: etfAnalysis.peers.items.map((item, index) => index === 0
        ? {
            ...item,
            name: target.shortName || target.name,
            issuer: target.market,
            return1y: change,
            current: true,
          }
        : { ...item, current: false }),
    },
  }
}

export function resolveSelectedEtfAnalysisFromSnapshot(rawValue: string | null) {
  const target = readSelectedEtfTargetFromSnapshot(rawValue)
  return target ? buildSelectedEtfAnalysis(target) : etfAnalysis
}

export function resolveSelectedEtfAnalysis() {
  return resolveSelectedEtfAnalysisFromSnapshot(getSelectedEtfSnapshot())
}
