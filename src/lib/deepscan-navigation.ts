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

  // ETN은 홈 카드가 항상 /deepscan으로 라우팅된다(jaroo-home-data 카드 빌드의
  // else 분기). 미확장 시 홈이 bare router.push('/deepscan')로 미끄러져 세션·
  // 스토어 미전달로 딥스캔이 빈 상태가 되는 실제 기능 회귀가 생긴다.
  if (candidate.kind === 'etn') {
    return candidate.actionHref === '/deepscan'
  }

  return false
}
