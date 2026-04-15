import type { DeepScanBlockMeta, JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

import type { DeepScanCanonicalTargetSession } from './deepscan-canonical'

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
      body: '선택한 종목의 canonical payload를 요청하고 있어요. 기존 heuristic 분석 문구는 표시하지 않습니다.',
      statusText: '로딩 중',
      score: 0,
      scoreLabel: 'Loading',
      scoreDelta: '불러오는 중',
      statusToneClass: 'text-[color:var(--jaroo-primary)]',
    }
  }

  return {
    headline: 'DeepScan을 불러오지 못했어요',
    body: `${targetSession.holding.name} canonical payload 요청에 실패했습니다. 잠시 후 다시 시도해주세요.`,
    statusText: '요청 실패',
    score: 0,
    scoreLabel: 'Error',
    scoreDelta: '오류',
    statusToneClass: 'text-[color:var(--jaroo-danger)]',
  }
}

export function getDeepScanBlockNotice(
  block: DeepScanBlockMeta,
  fallback: DeepScanBlockNotice,
): DeepScanBlockNotice {
  return {
    badge: block.blockState === 'error' ? 'Error' : block.blockState === 'blocked' ? 'Blocked' : fallback.badge,
    title: block.fallback?.label ?? fallback.title,
    body: block.error?.message ?? block.fallback?.reason ?? fallback.body,
  }
}
