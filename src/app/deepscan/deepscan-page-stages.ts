import type { JarooDeepScanCommitteeAxis, JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'
import type { FindingProgress, LoadingPerformanceComment, LoadingStageKey } from '@/components/deepscan-loading-screen'

import type { DeepScanLoadingSequenceState, DeepScanLoadingStageArrivalState, LoadingFindingProgressMap } from './deepscan-page-types'
import { DEEPSCAN_MEMBER_STAGE_BY_KEY, DEEPSCAN_MEMBER_STAGE_BY_TITLE, loadingFindingAxisKeys, MAX_FINDING_TEXT_LENGTH } from './deepscan-page-types'

export function createDeepScanLoadingSequence(targetKey: string | null): DeepScanLoadingSequenceState {
  return {
    targetKey,
    firstSuccessObserved: false,
    visibleStageCount: 1,
    sequenceComplete: false,
  }
}

export function createDeepScanLoadingStageArrival(targetKey: string | null): DeepScanLoadingStageArrivalState {
  return {
    targetKey,
    stageKeys: [],
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function uniqueLoadingStageKeys(stageKeys: LoadingStageKey[]): LoadingStageKey[] {
  return stageKeys.filter((stageKey, index, values) => values.indexOf(stageKey) === index)
}

export function extractLoadingStageKeysFromCommitteeResults(results: unknown): LoadingStageKey[] {
  if (!isRecord(results)) {
    return []
  }

  return uniqueLoadingStageKeys(
    Object.keys(results)
      .map((memberKey) => DEEPSCAN_MEMBER_STAGE_BY_KEY[memberKey])
      .filter((stageKey): stageKey is LoadingStageKey => Boolean(stageKey)),
  )
}

export function extractLoadingStageKeysFromCommitteeAxes(committeeAxes: JarooDeepScanCommitteeAxis[] | undefined): LoadingStageKey[] {
  return uniqueLoadingStageKeys(
    (committeeAxes ?? [])
      .flatMap((axis) => axis.members)
      .filter((member) => member.status === 'success' || member.status === 'error')
      .map((member) => (member.memberKey ? DEEPSCAN_MEMBER_STAGE_BY_KEY[member.memberKey] : undefined) ?? DEEPSCAN_MEMBER_STAGE_BY_TITLE[member.title])
      .filter((stageKey): stageKey is LoadingStageKey => Boolean(stageKey)),
  )
}

export function compactFindingText(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }

  return normalized.length > MAX_FINDING_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_FINDING_TEXT_LENGTH - 1).trim()}…`
    : normalized
}

export function buildAxisFindingProgress(axis: JarooDeepScanCommitteeAxis | undefined): FindingProgress | null {
  if (!axis) {
    return null
  }

  const members = axis.members ?? []
  const completedMembers = members.filter((member) => member.status === 'success' && compactFindingText(member.reason))
  const pendingCount = members.filter((member) => member.status === 'pending').length
  const errorCount = members.filter((member) => member.status === 'error').length

  if (completedMembers.length === 0) {
    if (errorCount > 0 && pendingCount === 0) {
      return {
        badge: '재시도 필요',
        tone: 'warning',
        body: `${axis.label} 위원 응답을 아직 한 줄 요약으로 만들 수 없어요. 실패 슬롯을 확인하고 재시도가 필요합니다.`,
      }
    }

    return null
  }

  const leadMember = completedMembers[0]
  const extraCount = completedMembers.length - 1
  const memberSuffix = extraCount > 0 ? ` 외 ${extraCount}명` : ''

  return {
    badge: pendingCount > 0 ? `${completedMembers.length}/${members.length} 분석중` : '분석 완료',
    tone: pendingCount > 0 ? 'active' : 'done',
    body: `${leadMember.title}${memberSuffix}: ${compactFindingText(leadMember.reason)}`,
  }
}

export function buildLoadingFindingProgress(payload: JarooDeepScanPayload | null): LoadingFindingProgressMap | undefined {
  if (!payload) {
    return undefined
  }

  const progress: LoadingFindingProgressMap = {}

  loadingFindingAxisKeys.forEach((key, index) => {
    const axisProgress = buildAxisFindingProgress(payload.committee.axes[index])
    if (axisProgress) {
      progress[key] = axisProgress
    }
  })

  if (payload.metadata.llmCommittee?.status !== 'partial' && payload.sellNow.blockState === 'ok') {
    progress.decision = {
      badge: '분석 완료',
      tone: 'done',
      body: compactFindingText(payload.sellNow.realizedText) || compactFindingText(payload.portfolioSimulation.caption) || '즉시 매도 판단이 도착했어요.',
    }
  }

  return Object.keys(progress).length > 0 ? progress : undefined
}

export function buildLoadingPerformanceComment(payload: JarooDeepScanPayload | null): LoadingPerformanceComment | undefined {
  const comment = payload?.insights.items.find((item) => item.sourceLabel === '기업실적코멘트' || item.title === '기업실적코멘트')
  if (!comment?.body?.trim()) {
    return undefined
  }

  const lines = comment.body.split(/\n+/).map((line) => line.trim()).filter(Boolean)

  return {
    asOf: comment.date,
    body: comment.body,
    ...(comment.sourceBody?.trim() ? { fullBody: comment.sourceBody } : {}),
    ...(lines.length > 1 ? { lines } : {}),
  }
}

export function buildLoadingTradingVolume(payload: JarooDeepScanPayload | null) {
  const volume = payload?.insights.items.find((item) => item.sourceLabel === '거래량' || item.label === '거래량')
  if (!volume?.body?.trim()) {
    return undefined
  }

  return volume.body.replace(/^거래량\s*/u, '').replace(/\s*확인$/u, '').trim()
}

export function hasCollectedDeepScanEvidence(payload: JarooDeepScanPayload | null) {
  if (!payload) {
    return false
  }

  return payload.metadata.sourceRefs.some((ref) => ref.type === 'report' || ref.type === 'market')
    || payload.insights.items.length > 0
    || payload.committee.sourceRefs.some((ref) => ref.type === 'report' || ref.type === 'market')
}
