import type { HomeHolding } from '@/lib/jaroo-home-data'

type DeepScanNavigationCandidate = Pick<HomeHolding, 'kind'> & {
  actionHref?: string | null
}

export function shouldUseDeepScanLoadingHandoff(candidate: DeepScanNavigationCandidate) {
  if (candidate.kind === 'stock') {
    return candidate.actionHref === '/deepscan'
  }

  if (candidate.kind === 'etf') {
    return candidate.actionHref === '/deepscan' || candidate.actionHref === '/etf'
  }

  return false
}
