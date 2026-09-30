// 위원회 스냅샷 쓰래백 판정(순수 로직) — IO 없음, 테스트 대상.
//
// 배경(원인 분석 2026-09-09): 딥스캔 API는 5초 소프트데드라인 시점의 빈 껍데기
// 위원회(멤버 9명·의견 0개·status=partial)를 deepscan_snapshots에 저장하고,
// LLM 위원 결과는 크롤러 메모리에만 존재해 화면 폴링으로만 채워진다. 완성 결과가
// 스냅샷에 쓰래백되지 않아 재열람(캐시 히트) 시 항상 빈 껍데기가 렌더된다.
//
// 이 모듈은 committee-status 폴링이 'complete'를 받았을 때 기존 스냅샷에 병합해도
// 되는지(그리고 어떻게 병합하는지)를 결정한다. 규칙:
//   - 다음 axes가 기존보다 엄격히 더 많은 의견을 담을 때만 병합한다(가드).
//     동점·열세면 null — 폴링 재호출·재열람이 오히려 스냅샷을 퇴화시키지 않는다.
//   - 병합은 committee.axes와 metadata.llmCommittee.status만 바꾼다.
//     개인화 블록(보유 수량·평단 등)은 절대 손대지 않는다.

import type { JarooDeepScanCommitteeAxis, JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

type CommitteeMemberLike = {
  status?: unknown
  score?: unknown
  reason?: unknown
}

type CommitteeAxisLike = {
  members?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 응답을 낸 위원 수 — success이면서 점수나 사유를 하나라도 담고 있으면 응답으로 센다. */
export function countCommitteeOpinions(axes: unknown): number {
  if (!Array.isArray(axes)) return 0
  let count = 0
  for (const axis of axes) {
    if (!isRecord(axis)) continue
    const members = (axis as CommitteeAxisLike).members
    if (!Array.isArray(members)) continue
    for (const member of members) {
      if (!isRecord(member)) continue
      const typed = member as CommitteeMemberLike
      const hasContent = typed.score !== null && typed.score !== undefined
        ? true
        : typeof typed.reason === 'string' && typed.reason.trim().length > 0
      if (typed.status === 'success' && hasContent) {
        count += 1
      }
    }
  }
  return count
}

/** 병합 가능 판정 — 가드를 통과하면 병합 페이로드, 아니면 null(쓰기 생략). */
export function buildCommitteeWritebackPayload(
  existing: JarooDeepScanPayload,
  nextAxes: unknown,
): JarooDeepScanPayload | null {
  if (!Array.isArray(nextAxes) || nextAxes.length === 0) {
    return null
  }
  // 최소 구조 검증 — 멤버 배열을 가진 축이 하나 이상. 상세 검증은 저장 전
  // isCanonicalPayload가 담당한다.
  const shaped = nextAxes.filter((axis) => isRecord(axis) && Array.isArray((axis as CommitteeAxisLike).members))
  if (shaped.length === 0) {
    return null
  }

  const existingAxes = existing?.committee?.axes
  if (countCommitteeOpinions(shaped) <= countCommitteeOpinions(existingAxes)) {
    return null
  }

  const llmCommittee = existing.metadata?.llmCommittee
  if (!llmCommittee) {
    return null
  }

  return {
    ...existing,
    committee: {
      ...existing.committee,
      axes: shaped as JarooDeepScanCommitteeAxis[],
    },
    metadata: {
      ...existing.metadata,
      llmCommittee: {
        ...llmCommittee,
        status: 'complete',
        pending: 0,
      },
    },
  }
}
