// 팀 요약 fetch 코디네이터(2026-10-06): 요약 요청은 스테이지 갱신(커미티 writeback 등)으로
// effect가 재실행돼도 진행 중 요청을 취소하면 안 된다 — 이전 구현은 공유 AbortController로
// 재실행 시 진행 중 fetch를 abort했고, abort된 요청은 상태를 'error'로조차 바꾸지 않아
// UI가 영구히 '요약 중'에 갇혔다(SNT에너지 딥스캔에서 재현). 같은 requestKey는 한 번만
// 발사하고, teamKey별 최신 requestKey만 결과 적용을 허용해 스테일 응답이 새 요청을 덮지 않게 한다.
export type TeamSummaryFetchCoordinator = {
  claimPendingRequests: <T extends { teamKey: string; requestKey: string }>(requests: readonly T[]) => T[]
  isLatestRequest: (teamKey: string, requestKey: string) => boolean
}

export function createTeamSummaryFetchCoordinator(): TeamSummaryFetchCoordinator {
  const firedRequestKeys = new Set<string>()
  const latestRequestKeyByTeam = new Map<string, string>()

  return {
    claimPendingRequests<T extends { teamKey: string; requestKey: string }>(requests: readonly T[]): T[] {
      const pendingRequests: T[] = []

      for (const request of requests) {
        latestRequestKeyByTeam.set(request.teamKey, request.requestKey)

        if (!firedRequestKeys.has(request.requestKey)) {
          firedRequestKeys.add(request.requestKey)
          pendingRequests.push(request)
        }
      }

      return pendingRequests
    },
    isLatestRequest(teamKey, requestKey) {
      return latestRequestKeyByTeam.get(teamKey) === requestKey
    },
  }
}
