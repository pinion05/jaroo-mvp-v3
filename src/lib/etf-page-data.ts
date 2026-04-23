import type { HomeHolding } from '@/lib/jaroo-home-data'

export type EtfPageHeroStat = {
  label: string
  value: string
}

export type EtfPageInfoRow = {
  label: string
  value: string
}

export type EtfPageModel = {
  title: string
  code: string
  subtitle: string
  heroEyebrow: string
  heroName: string
  heroPrice: string
  heroChange: string
  heroAveragePrice: string
  heroStats: EtfPageHeroStat[]
  overviewRows: EtfPageInfoRow[]
}

function readMetricValue(holding: HomeHolding, label: string) {
  return holding.metrics.find((metric) => metric.label === label)?.value
}

function cleanDisplayValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized || '-'
}

function resolveHoldingCode(holding: HomeHolding) {
  return cleanDisplayValue(holding.identifierCode ?? holding.code ?? holding.identifierTicker ?? holding.identifierLabel)
}

function resolveCurrentPriceText(holding: HomeHolding) {
  return cleanDisplayValue(readMetricValue(holding, '현재가'))
}

function resolveEvaluationAmountText(holding: HomeHolding) {
  return cleanDisplayValue(holding.evaluationAmount ?? readMetricValue(holding, '평가 금액'))
}

function resolvePnlText(holding: HomeHolding) {
  return cleanDisplayValue(holding.pnl)
}

export function buildEtfPageModel(holding: HomeHolding): EtfPageModel {
  return {
    title: holding.name,
    code: resolveHoldingCode(holding),
    subtitle: `${cleanDisplayValue(holding.market)} · 실제 보유 ETF 반영`,
    heroEyebrow: 'ETF 보유 현황',
    heroName: holding.name,
    heroPrice: resolveCurrentPriceText(holding),
    heroChange: cleanDisplayValue(holding.change),
    heroAveragePrice: `평단 ${cleanDisplayValue(holding.averagePrice)}`,
    heroStats: [
      { label: '보유 수량', value: cleanDisplayValue(holding.shares) },
      { label: '평가 금액', value: resolveEvaluationAmountText(holding) },
      { label: '손익', value: resolvePnlText(holding) },
    ],
    overviewRows: [
      { label: '종목 코드', value: resolveHoldingCode(holding) },
      { label: '시장', value: cleanDisplayValue(holding.market) },
      { label: '보유 수량', value: cleanDisplayValue(holding.shares) },
      { label: '평단', value: cleanDisplayValue(holding.averagePrice) },
      { label: '평가 금액', value: resolveEvaluationAmountText(holding) },
      { label: '수익률', value: cleanDisplayValue(holding.change) },
      { label: '손익', value: resolvePnlText(holding) },
    ],
  }
}
