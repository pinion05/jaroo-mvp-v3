import type { DeepScanTargetInput } from './workflow-types'
import { getDeepScanTargetKey } from './workflow-types'

type ResolveDeepScanHydratedTargetInput = {
  currentTarget: DeepScanTargetInput | null
  hydratedTarget: DeepScanTargetInput
  loadUsdKrwRate: () => Promise<number | undefined>
}

type ResolveDeepScanStartAfterHydrationInput = {
  shouldStartRequest: boolean
  targetKey: string | null
  hydratedTargetKey: string | null
  /** 명시적 실행 의도(홈 종목카드 클릭 표식) — 없는 방문(재방문·기록 열람)은 자동 실행 금지 */
  explicitRunIntent: boolean
}

/** 하이드레이션 완료 후 시작 결정 — 유료 실행 계약(2026-11-09 실측 §5-A/B)의 순수 판정.
 *  - idle: 아직 시작 조건이 아니다(타깃 없음·하이드레이션 미완료·보여줄 payload 있음)
 *  - run-explicit: 명시적 클릭에서 이어진 방문 — 자동 실행(유료 가능)
 *  - run-readonly: 의도 없는 방문 — 읽기 전용(cacheOnly) 조회만 허용(과금 없음) */
export type DeepScanStartDecision = 'idle' | 'run-explicit' | 'run-readonly'

function normalizeIdentity(value: string | undefined) {
  const normalized = value?.trim().toUpperCase()
  return normalized || undefined
}

function isFinitePositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function hasSameInstrument(
  currentTarget: DeepScanTargetInput,
  hydratedTarget: DeepScanTargetInput,
) {
  const currentIdentifiers = [
    normalizeIdentity(currentTarget.code),
    normalizeIdentity(currentTarget.ticker),
  ].filter((value): value is string => Boolean(value))
  const hydratedIdentifiers = [
    normalizeIdentity(hydratedTarget.code),
    normalizeIdentity(hydratedTarget.ticker),
  ].filter((value): value is string => Boolean(value))

  if (currentIdentifiers.length > 0 && hydratedIdentifiers.length > 0) {
    return currentIdentifiers.some((identifier) => hydratedIdentifiers.includes(identifier))
  }

  return normalizeIdentity(currentTarget.name) === normalizeIdentity(hydratedTarget.name)
    && normalizeIdentity(currentTarget.market) === normalizeIdentity(hydratedTarget.market)
}

function preserveLiveTargetContext(
  currentTarget: DeepScanTargetInput | null,
  hydratedTarget: DeepScanTargetInput,
) {
  if (!currentTarget || !hasSameInstrument(currentTarget, hydratedTarget)) {
    return hydratedTarget
  }

  return {
    ...hydratedTarget,
    currentPrice: hydratedTarget.currentPrice ?? currentTarget.currentPrice,
    currentProfitRate: hydratedTarget.currentProfitRate ?? currentTarget.currentProfitRate,
    currentPriceCurrency: hydratedTarget.currentPriceCurrency ?? currentTarget.currentPriceCurrency,
    usdKrwRate: hydratedTarget.usdKrwRate ?? currentTarget.usdKrwRate,
  }
}

function needsUsdKrwRate(target: DeepScanTargetInput) {
  return target.marketTone === 'nasdaq'
    && target.averagePriceCurrency === 'KRW'
    && target.currentPriceCurrency === 'USD'
    && !isFinitePositiveNumber(target.usdKrwRate)
}

export async function resolveDeepScanHydratedTarget({
  currentTarget,
  hydratedTarget,
  loadUsdKrwRate,
}: ResolveDeepScanHydratedTargetInput) {
  const targetWithLiveContext = preserveLiveTargetContext(currentTarget, hydratedTarget)

  if (!needsUsdKrwRate(targetWithLiveContext)) {
    return targetWithLiveContext
  }

  const usdKrwRate = await loadUsdKrwRate()
  if (!isFinitePositiveNumber(usdKrwRate)) {
    return targetWithLiveContext
  }

  return {
    ...targetWithLiveContext,
    usdKrwRate,
  }
}

export type DeepScanHydrationApplicationInput = {
  currentTarget: DeepScanTargetInput | null
  nextTarget: DeepScanTargetInput
}

export type DeepScanHydrationApplication = {
  /** 스토어에 하이드레이션 타깃을 반영할 것인가(원샷 시드) */
  apply: boolean
  /** 시작 결정(startDecision) 잠금 해제에 쓸 타깃 키 */
  hydratedTargetKey: string | null
  /** 세션 거래정지 힌트를 현재 타깃에 적용해도 되는가(시드했거나 같은 종목일 때) */
  sessionHaltHintEligible: boolean
}

/** 하이드레이션 반영 결정 — 순수 함수.
 *
 * 계약(TC-BBSC-007 웨지 회귀): 하이드레이션은 '스토어가 비어 있을 때 한 번'만
 * 타깃을 시드한다(원샷). 이미 메모리 타깃이 있는 상태에서 같은 종목을 새 객체로
 * 덮어쓰면 target 참조가 매 이펙트 주기마다 바뀌고, [target]을 deps로 걸고 있는
 * 이펙트들(퀵시세·브리핑 스냅샷·정규 요청)이 무한 재실행(런 중 새로고침 시
 * 30초 만에 렌더러 RSS 1.8→3.7GB·평가 불응)되며 페이지가 웨지된다. 세션 복원
 * 값은 이미 시드된 값과 같으므로 다시 반영할 필요가 없다.
 */
export function resolveDeepScanHydrationApplication({
  currentTarget,
  nextTarget,
}: DeepScanHydrationApplicationInput): DeepScanHydrationApplication {
  const nextTargetKey = getDeepScanTargetKey(nextTarget)

  if (!currentTarget) {
    return { apply: true, hydratedTargetKey: nextTargetKey, sessionHaltHintEligible: true }
  }

  return {
    apply: false,
    hydratedTargetKey: getDeepScanTargetKey(currentTarget),
    sessionHaltHintEligible: hasSameInstrument(currentTarget, nextTarget),
  }
}

// 유료 실행 계약(2026-11-09 실측 §5-A/B): 하이드레이션이 타깃을 복원했다는
// 사실만으로 유료 파이프라인을 발사하지 않는다. 명시적 실행 의도(홈 종목카드
// "딥스캔 분석" 클릭)가 함께 있을 때만 run-explicit, 의도 없는 방문은
// run-readonly(스냅샷 미스 → 과금 없는 snapshot-miss → 확인 버튼으로 재실행).
export function resolveDeepScanStartAfterHydration({
  shouldStartRequest,
  targetKey,
  hydratedTargetKey,
  explicitRunIntent,
}: ResolveDeepScanStartAfterHydrationInput): DeepScanStartDecision {
  if (!shouldStartRequest || targetKey === null || hydratedTargetKey !== targetKey) {
    return 'idle'
  }
  return explicitRunIntent ? 'run-explicit' : 'run-readonly'
}
