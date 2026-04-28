import type { HomeHolding } from '@/lib/jaroo-home-data'

type DeepScanNavigationCandidate = Pick<HomeHolding, 'kind'> & {
  actionHref?: string | null
}

export function shouldUseDeepScanLoadingHandoff(candidate: DeepScanNavigationCandidate) {
  return candidate.actionHref === '/deepscan' && (candidate.kind === 'stock' || candidate.kind === 'etf')
}

