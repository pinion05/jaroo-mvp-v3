import type { JarooDeepScanPayload, JarooDeepScanRecoveryForecastBlock } from '../../../../packages/contracts/src/deepscan'

import { DeepScanRecoveryForecastCard } from '@/components/deepscan-recovery-forecast-card'
import { fetchKrDailyPriceHistory } from '@/lib/kr-daily-price-history'
import { shapeRecoveryForecastBlock } from '@/lib/deepscan-runtime/build-payload'
import { buildRecoveryForecastFromPriceSeries } from '../../../../packages/deepscan-runtime-core/src/recovery-forecast.js'

// 원금회수 예측 카드(히어로 게이지 + 1년 차트 + 유사 패턴 밴드) 미리보기.
// 실제 스캔(로그인·크레딧·LLM 위원회) 없이 카드를 검증하기 위한 개발 하네스다 —
// 네이버 일봉 실데이터로 KR 운영 옵션과 동일하게 모델을 돌리고 실카드를 렌더한다.

const PREVIEW_TARGETS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '069500', name: 'KODEX 200' },
] as const

// build-payload의 KR_DAILY_RECOVERY_FORECAST_OPTIONS와 동일 값(개발 하네스 재현용).
const KR_DAILY_RECOVERY_FORECAST_OPTIONS = {
  returnParameters: {
    windowMode: 'full',
    requireDailyCadence: true,
    minReturnCount: 252,
  },
  similarPattern: {
    lookbackDays: 40,
    tolerancePct: 12,
    spacingDays: 20,
    minSampleSize: 3,
    horizonDays: 252,
  },
  simulation: {
    horizonDays: 252,
    pathCount: 5000,
  },
} as const

function resolvePreviewTargetPrice(series: ReadonlyArray<{ close: number }>) {
  const high = Math.max(...series.map((point) => point.close))
  const current = series[series.length - 1].close
  const rough = high * 0.82
  const target = rough > current ? rough : current * 1.15
  return Math.round(target / 1000) * 1000 || Math.round(target)
}

async function buildPreviewBlock(code: string, withHistory: boolean): Promise<JarooDeepScanRecoveryForecastBlock | null> {
  const series = await fetchKrDailyPriceHistory(code)
  if (series.length < 3) {
    return null
  }

  const currentPrice = series[series.length - 1].close
  const targetPrice = resolvePreviewTargetPrice(series)
  const forecast = buildRecoveryForecastFromPriceSeries(
    { currentPrice, targetPrice, primarySeries: series },
    {
      ...KR_DAILY_RECOVERY_FORECAST_OPTIONS,
      simulation: {
        ...KR_DAILY_RECOVERY_FORECAST_OPTIONS.simulation,
        seed: `kr-recovery:${code}:${currentPrice}:${targetPrice}`,
      },
    },
  )

  return shapeRecoveryForecastBlock({
    forecast,
    currentPrice,
    targetPrice,
    currency: 'KRW',
    recoverySourceRefs: [
      { type: 'holding', id: 'recovery-target-average-price', label: 'average price recovery target' },
      { type: 'market', id: 'naver-daily-price-history', label: 'Naver Finance daily price history' },
    ],
    primarySeries: withHistory ? series : null,
  })
}

export default async function DebugRecoveryCardPage() {
  const previews = await Promise.all(PREVIEW_TARGETS.map(async (target) => {
    try {
      const block = await buildPreviewBlock(target.code, true)
      return block ? { ...target, block } : null
    } catch {
      return null
    }
  }))

  let legacyBlock: JarooDeepScanRecoveryForecastBlock | null = null
  try {
    const shaped = await buildPreviewBlock(PREVIEW_TARGETS[0].code, false)
    // 구형 페이로드 시뮬레이션 — 수치/차트 필드가 없으면 텍스트 폴백으로만 렌더된다.
    if (shaped) {
      const legacy = structuredClone(shaped)
      delete legacy.currentPrice
      delete legacy.targetPrice
      delete legacy.expectedRecoveryDays
      delete legacy.recoveryProbabilityPct
      delete legacy.confidenceLevel
      delete legacy.priceHistory
      delete legacy.similarPatternSamples
      legacyBlock = legacy
    }
  } catch {
    legacyBlock = null
  }

  return (
    <main className='mx-auto flex max-w-[440px] flex-col gap-6 bg-[#F7F8FA] p-4'>
      <header className='text-[12px] leading-5 text-[#5A6473]'>
        <h1 className='text-[14px] font-bold text-[#0F1419]'>원금회수 예측 카드 프리뷰</h1>
        네이버 일봉 실데이터 · 운영 KR 옵션과 동일한 모델 파라미터로 렌더한 실카드. 평단가는 1년 고점 대비 데모 값.
      </header>
      {previews.map((preview) => (
        preview ? (
          <div key={preview.code} className='flex flex-col gap-1'>
            <div className='text-[10px] font-bold text-[#97A0AE]'>{preview.name}</div>
            <DeepScanRecoveryForecastCard payload={{ recoveryForecast: preview.block } as JarooDeepScanPayload} />
          </div>
        ) : null
      ))}
      {legacyBlock ? (
        <div className='flex flex-col gap-1'>
          <div className='text-[10px] font-bold text-[#97A0AE]'>구형 페이로드 폴백(차트 없이 · 게이지는 텍스트에서 복원)</div>
          <DeepScanRecoveryForecastCard payload={{ recoveryForecast: legacyBlock } as JarooDeepScanPayload} />
        </div>
      ) : null}
    </main>
  )
}
