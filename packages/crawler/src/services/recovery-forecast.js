// KR 원금회수 예측 어댑터.
// 단일 출처 원칙: 모델링은 packages/deepscan-runtime-core/src/recovery-forecast.js(US와 동일 엔진)를
// 재사용하고, 이 파일은 KR DeepScan evidence(holding 평단가 · 현재가 · 상대수익률 과거가)를
// core 입력으로 맵핑하는 얇은 어댑터 역할만 한다. 성형(블록 텍스트)은 웹 build-payload가
// US/KR 공통으로 담당하므로 여기서는 core의 raw forecast({status, models, consensus})만 반환한다.
// (기존 closed PR이 이 로직을 311행으로 재구현해 상태 enum 드리프트('ok' vs 'available')를
// 만들었음 — 본 패턴은 committee-llm.js 재사용과 동일한 크로스패키지 import 방식으로 드리프트 0.)

import { buildRecoveryForecastFromPriceSeries } from '../../../deepscan-runtime-core/src/recovery-forecast.js'

const RECOVERY_FORECAST_OPTIONS = {
  similarPattern: {
    lookbackDays: 40,
    tolerancePct: 12,
    spacingDays: 20,
    minSampleSize: 3,
  },
  simulation: {
    horizonDays: 252,
    pathCount: 5000,
  },
}

function unavailable(reason) {
  return {
    forecast: { status: 'unavailable', reason, models: {}, consensus: null },
    currentPrice: null,
    targetPrice: null,
  }
}

/**
 * KR DeepScan evidence로 원금회수 예측을 계산해 core의 raw forecast 요약을 반환한다.
 *
 * @param {object} input
 * @param {number} input.averagePrice - 보유 평단가(회복 목표가).
 * @param {number | null} [input.currentPrice] - 현재가. 없으면 priceHistory 마지막 가격으로 보강.
 * @param {Array<{ date: string | null, close: number }>} [input.priceHistory] - 상대수익률 과거 주가.
 * @param {string} [input.instrumentCode] - 결정론 seed용 종목 식별자.
 * @param {string} [input.instrumentName] - seed fallback.
 * @returns {{ forecast: object, currentPrice: number | null, targetPrice: number | null }}
 *   forecast 는 core raw 요약({status, reason, models, consensus}). currentPrice/targetPrice 는
 *   표시 성형을 위해 해석해 둔 값(실패 시 null).
 */
export function buildKrRecoveryForecast(input = {}) {
  try {
    const averagePrice = Number(input.averagePrice)
    const priceHistory = Array.isArray(input.priceHistory) ? input.priceHistory : []
    const lastClose = priceHistory.length > 0 ? Number(priceHistory.at(-1)?.close) : null
    const resolvedCurrentPrice = input.currentPrice != null && Number.isFinite(Number(input.currentPrice))
      ? Number(input.currentPrice)
      : (Number.isFinite(lastClose) ? lastClose : null)

    if (!Number.isFinite(averagePrice) || averagePrice <= 0) {
      return unavailable('평단가 정보가 없어 원금회수 예측을 계산할 수 없습니다.')
    }
    if (resolvedCurrentPrice === null || resolvedCurrentPrice <= 0) {
      return unavailable('현재가 정보가 없어 원금회수 예측을 계산할 수 없습니다.')
    }
    if (priceHistory.length < 3) {
      return unavailable('과거 주가 데이터가 부족해 원금회수 예측을 계산할 수 없습니다.')
    }

    const instrumentKey = input.instrumentCode ?? input.instrumentName ?? 'kr-recovery'
    const forecast = buildRecoveryForecastFromPriceSeries(
      {
        targetPrice: averagePrice,
        currentPrice: resolvedCurrentPrice,
        primarySeries: priceHistory,
      },
      {
        ...RECOVERY_FORECAST_OPTIONS,
        simulation: {
          ...RECOVERY_FORECAST_OPTIONS.simulation,
          seed: `kr-recovery:${instrumentKey}:${resolvedCurrentPrice}:${averagePrice}`,
        },
      },
    )
    return { forecast, currentPrice: resolvedCurrentPrice, targetPrice: averagePrice }
  } catch {
    return unavailable('원금회수 예측 모델 계산 중 오류가 발생했습니다.')
  }
}
