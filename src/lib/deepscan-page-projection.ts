import type { DeepScanBlockMeta, JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

import type { DeepScanCanonicalTargetSession } from './deepscan-canonical'
import type { DeepScanResultCacheEntry, WorkflowAsyncStatus } from './workflow-types'

export type DeepScanPageFetchState = 'idle' | 'loading' | 'success' | 'error'

export type DeepScanPageHeader = {
  name: string
  identifierText: string
}

export type DeepScanHeroCard = {
  headline: string
  body: string
  statusText: string
  score: number
  scoreLabel: string
  scoreDelta: string
  statusToneClass: string
}

export type DeepScanBlockNotice = {
  badge: string
  title: string
  body: string
}

type DeepScanPageCacheInput = {
  hasTarget: boolean
  targetKey: string | null
  requestStatus: WorkflowAsyncStatus
  activePayload: JarooDeepScanPayload | null
  activeTargetKey: string | null
  lastSuccessful: DeepScanResultCacheEntry | null
}

type DeepScanPageCacheResolution = {
  payload: JarooDeepScanPayload | null
  fetchState: DeepScanPageFetchState
  shouldStartRequest: boolean
}

export function resolveDeepScanPageCacheState({
  hasTarget,
  targetKey,
  requestStatus,
  activePayload,
  activeTargetKey,
  lastSuccessful,
}: DeepScanPageCacheInput): DeepScanPageCacheResolution {
  const currentPayload = targetKey && activeTargetKey === targetKey ? activePayload : null
  const reusablePayload = targetKey && lastSuccessful?.targetKey === targetKey ? lastSuccessful.payload : null
  const payload = requestStatus === 'success' ? currentPayload : requestStatus === 'idle' ? (currentPayload ?? reusablePayload) : null

  const fetchState: DeepScanPageFetchState = !hasTarget
    ? 'idle'
    : requestStatus === 'loading'
      ? 'loading'
      : requestStatus === 'error'
        ? 'error'
        : payload
          ? 'success'
          : 'idle'

  return {
    payload,
    fetchState,
    shouldStartRequest: hasTarget && requestStatus !== 'loading' && requestStatus !== 'error' && !payload,
  }
}

const DEEP_SCAN_BLOCK_LABELS = {
  hero: '핵심 요약',
  committee: 'AI 분석 결과',
  insights: '인사이트',
  strategy: '전략',
  sellNow: '지금 팔면',
  portfolioSimulation: '포트폴리오 변화',
} as const

function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function buildIdentifierText(values: Array<string | undefined>, fallback?: string) {
  const uniqueValues = values.filter((value, index, current): value is string => {
    const normalized = normalizeText(value)
    return Boolean(normalized) && current.findIndex((candidate) => normalizeText(candidate) === normalized) === index
  })

  if (uniqueValues.length > 0) {
    return uniqueValues.join(' · ')
  }

  return normalizeText(fallback) ?? '코드 미확인'
}

function resolveHeroStatusToneClass(payload: JarooDeepScanPayload) {
  if (payload.hero.blockState === 'error') {
    return 'text-[color:var(--jaroo-danger)]'
  }

  if (payload.hero.blockState === 'blocked' || !payload.metadata.inputValidity.valid) {
    return 'text-[color:var(--jaroo-warning)]'
  }

  if (payload.hero.score >= 67) {
    return 'text-[color:var(--jaroo-success)]'
  }

  if (payload.hero.score >= 55) {
    return 'text-[color:var(--jaroo-primary)]'
  }

  return 'text-[color:var(--jaroo-warning)]'
}

export function buildDeepScanPageHeader(
  targetSession: DeepScanCanonicalTargetSession,
  payload: JarooDeepScanPayload | null,
): DeepScanPageHeader {
  const instrument = payload?.input.instrument

  return {
    name: instrument?.name ?? targetSession.holding.name,
    identifierText: buildIdentifierText(
      [
        instrument?.ticker,
        instrument?.code,
        targetSession.holding.ticker,
        targetSession.holding.identifierTicker,
        targetSession.holding.code,
        targetSession.holding.identifierCode,
      ],
      instrument?.market ?? targetSession.holding.market,
    ),
  }
}

export function buildDeepScanHeroCard(
  targetSession: DeepScanCanonicalTargetSession,
  fetchState: DeepScanPageFetchState,
  payload: JarooDeepScanPayload | null,
): DeepScanHeroCard {
  if (payload) {
    return {
      headline: payload.hero.headline,
      body: payload.hero.body,
      statusText: payload.hero.statusText,
      score: payload.hero.score,
      scoreLabel: payload.hero.scoreLabel,
      scoreDelta: payload.hero.scoreDelta,
      statusToneClass: resolveHeroStatusToneClass(payload),
    }
  }

  if (fetchState === 'loading' || fetchState === 'idle') {
    return {
      headline: `${targetSession.holding.name} DeepScan을 불러오는 중`,
      body: '선택한 종목의 표준 분석 데이터를 요청하고 있어요. 임시 분석 문구는 표시하지 않습니다.',
      statusText: '로딩 중',
      score: 0,
      scoreLabel: '로딩 중',
      scoreDelta: '불러오는 중',
      statusToneClass: 'text-[color:var(--jaroo-primary)]',
    }
  }

  return {
    headline: 'DeepScan을 불러오지 못했어요',
    body: `${targetSession.holding.name} 표준 분석 데이터 요청에 실패했습니다. 잠시 후 다시 시도해주세요.`,
    statusText: '요청 실패',
    score: 0,
    scoreLabel: '오류',
    scoreDelta: '오류',
    statusToneClass: 'text-[color:var(--jaroo-danger)]',
  }
}

export function getDeepScanBlockNotice(
  block: DeepScanBlockMeta,
  fallback: DeepScanBlockNotice,
): DeepScanBlockNotice {
  return {
    badge: block.blockState === 'error' ? '오류' : block.blockState === 'blocked' ? '보류' : fallback.badge,
    title: block.fallback?.label ?? fallback.title,
    body: block.error?.message ?? block.fallback?.reason ?? fallback.body,
  }
}

export function buildDeepScanPartialSuccessNotice(payload: JarooDeepScanPayload | null): DeepScanBlockNotice | null {
  if (!payload) {
    return null
  }

  const degradedBlocks = Object.entries(payload.metadata.blockStatus)
    .filter(([, blockState]) => blockState !== 'ok')
    .map(([key]) => DEEP_SCAN_BLOCK_LABELS[key as keyof typeof DEEP_SCAN_BLOCK_LABELS])
    .filter(Boolean)

  if (degradedBlocks.length === 0) {
    return null
  }

  const summary = degradedBlocks.length > 1
    ? `${degradedBlocks.slice(0, -1).join(', ')}, ${degradedBlocks.at(-1)}`
    : degradedBlocks[0]

  return {
    badge: 'Partial',
    title: '일부 분석 결과만 표시 중이에요',
    body: `${summary} 블록은 오류 또는 보완 필요 상태로 표시됩니다.`,
  }
}
