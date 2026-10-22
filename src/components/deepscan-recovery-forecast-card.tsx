'use client'

import type { JarooDeepScanPayload, JarooRecoveryPricePoint, JarooRecoverySimilarPatternSample } from '../../packages/contracts/src/deepscan'

import { Target } from 'lucide-react'
import { cn } from '@/lib/utils'

type DeepScanRecoveryForecastCardProps = {
  payload: JarooDeepScanPayload
}

function parsePercent(value: string | null | undefined) {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

// 신뢰도(높음/보통/낮음) → 색상 톤. core 엔진 confidence.level 매핑과 동일 어휘.
function confidenceTone(label: string | undefined | null) {
  if (label === '높음') return { badge: 'bg-[#EEF0F3] text-[#0F1419]', dot: 'bg-[#0F1419]' }
  if (label === '보통') return { badge: 'bg-[#E8F0FB] text-[#2B6BE6]', dot: 'bg-[#2B6BE6]' }
  return { badge: 'bg-[#F1F3F6] text-[#97A0AE]', dot: 'bg-[#97A0AE]' }
}

// 손실 구간(currentPrice < 평단가)이고 유효한 회복 예측이 있을 때만 의미가 있다.
// 수익 구간(이미 평단 도달)이거나 블록이 없으면 null 반환 → 렌더하지 않음.
export function readRecoveryForecastForLoss(payload: JarooDeepScanPayload) {
  const block = payload.recoveryForecast
  if (!block || block.blockState !== 'ok') {
    return null
  }
  const drawdown = parsePercent(block.drawdownText)
  if (drawdown === null || drawdown <= 0) {
    return null // 수익 구간(또는 손익제로) — 회복 예측 카드 미표시
  }
  return block
}

const RECOVERY_MODEL_SWATCH_COLORS = ['#E0942A', '#2B6BE6', '#7A5AF8'] as const
const RECOVERY_CHART_WIDTH = 320
const RECOVERY_CHART_HEIGHT = 132
const RECOVERY_CHART_MARGIN = { top: 8, right: 10, bottom: 16, left: 34 }

function compactPrice(value: number) {
  const trimDecimal = (text: string) => text.replace(/\.0$/u, '')
  if (value >= 100_000_000) return `${trimDecimal((value / 100_000_000).toFixed(1))}억`
  if (value >= 10_000) return `${trimDecimal((value / 10_000).toFixed(1))}만`
  return Math.round(value).toLocaleString('ko-KR')
}

function shortDate(value: string | null | undefined) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(5, 10).replace('-', '.') : ''
}

type RecoveryChartGeometry = {
  pricePath: string
  gridlines: Array<{ y: number; label: string }>
  dateTicks: Array<{ x: number; label: string }>
  targetY: number | null
  bands: Array<{ x: number; title: string }>
  currentDot: { x: number; y: number } | null
}

// 1년 가격 계열 + 유사 패턴 샘플을 SVG 좌표로 변환한다. 모델이 실제로 본 데이터를
// 그대로 그리므로 "모델의 근거"가 차트로 드러난다.
function buildRecoveryChartGeometry(input: {
  priceHistory: ReadonlyArray<JarooRecoveryPricePoint>
  samples: ReadonlyArray<JarooRecoverySimilarPatternSample> | undefined
  targetPrice: number
}): RecoveryChartGeometry | null {
  const points = input.priceHistory
  if (points.length < 3) {
    return null
  }

  const innerWidth = RECOVERY_CHART_WIDTH - RECOVERY_CHART_MARGIN.left - RECOVERY_CHART_MARGIN.right
  const innerHeight = RECOVERY_CHART_HEIGHT - RECOVERY_CHART_MARGIN.top - RECOVERY_CHART_MARGIN.bottom
  const closes = points.map((point) => point.close)
  const rawMin = Math.min(...closes, input.targetPrice)
  const rawMax = Math.max(...closes, input.targetPrice)
  const pad = (rawMax - rawMin) * 0.06 || rawMax * 0.02
  const yMin = rawMin - pad
  const yMax = rawMax + pad
  const xAt = (index: number) => RECOVERY_CHART_MARGIN.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth)
  const yAt = (close: number) => RECOVERY_CHART_MARGIN.top + innerHeight - ((close - yMin) / (yMax - yMin)) * innerHeight

  const pricePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)},${yAt(point.close).toFixed(1)}`)
    .join(' ')

  const gridlineCount = 3
  const gridlines = Array.from({ length: gridlineCount }, (_, index) => {
    const value = yMax - ((yMax - yMin) * index) / (gridlineCount - 1)
    return { y: yAt(value), label: compactPrice(value) }
  })

  const dateTickCount = Math.min(3, points.length)
  const dateTicks = Array.from({ length: dateTickCount }, (_, index) => {
    const pointIndex = Math.round((index / (dateTickCount - 1)) * (points.length - 1))
    return { x: xAt(pointIndex), label: shortDate(points[pointIndex]?.date) }
  })

  const bands = points
    .map((point, index) => {
      const matched = input.samples?.find((sample) => sample.date && point.date && sample.date === point.date)
      if (!matched || !matched.date) {
        return null
      }
      const recoveredText = matched.recovered && matched.recoveryDays !== null
        ? `약 ${Math.round(matched.recoveryDays)}일 만에 회복`
        : '1년(252거래일) 내 미회복'
      return {
        x: xAt(index),
        title: `유사 패턴 · ${matched.date} · 당시 하락 ${Math.round(matched.drawdownPct)}% → ${recoveredText}`,
      }
    })
    .filter((band): band is { x: number; title: string } => band !== null)

  const lastPoint = points[points.length - 1]
  return {
    pricePath,
    gridlines,
    dateTicks,
    targetY: yAt(input.targetPrice),
    bands,
    currentDot: { x: xAt(points.length - 1), y: yAt(lastPoint.close) },
  }
}

export function DeepScanRecoveryForecastCard({ payload }: DeepScanRecoveryForecastCardProps) {
  const block = readRecoveryForecastForLoss(payload)
  if (!block) {
    return null
  }

  const tone = confidenceTone(block.confidenceText)
  const probabilityPct = block.recoveryProbabilityPct ?? parsePercent(block.recoveryProbabilityText)
  const targetPrice = block.targetPrice ?? null
  const geometry = block.priceHistory && targetPrice !== null
    ? buildRecoveryChartGeometry({ priceHistory: block.priceHistory, samples: block.similarPatternSamples, targetPrice })
    : null
  const facts: ReadonlyArray<readonly [string, string]> = [
    ['현재가', block.currentPriceText || '--'],
    ['평단가', block.targetPriceText || '--'],
    ['손실률', block.drawdownText || '--'],
    ...(probabilityPct === null ? [['1년 내 도달 비율', block.recoveryProbabilityText || '--'] as const] : []),
  ]

  return (
    <article
      className='overflow-hidden rounded-[16px] border border-[#E8EAEE] bg-white shadow-[0_1px_3px_rgba(0,0,0,.04)]'
      aria-label='원금회수 예측'
    >
      <div className='flex items-center gap-3 border-b border-[#EFF1F4] px-4 py-4'>
        <div className='flex size-9 items-center justify-center rounded-[10px] bg-[#0F1419] text-white'><Target className='size-[16px]' aria-hidden /></div>
        <div className='flex-1'>
          <div className='text-[10px] text-[#97A0AE]'>손실 구간</div>
          <h2 className='text-[14px] font-bold text-[#0F1419]'>원금회수 예측</h2>
        </div>
        <span className={cn('rounded-[6px] px-2 py-1 text-[10px] font-bold', tone.badge)}>
          신뢰도 {block.confidenceText}
        </span>
      </div>

      <div className='flex flex-wrap items-end gap-x-8 gap-y-3 px-4 py-5' aria-live='polite'>
        <div className='min-w-[160px] flex-1'>
          <div className='text-[10px] text-[#97A0AE]'>평단 도달 예상 기간</div>
          <div className='mt-1 text-[28px] font-black leading-none text-[#0F1419]'>{block.expectedRecoveryDaysText || '--'}</div>
        </div>
        {probabilityPct !== null ? (
          <div className='w-[136px]'>
            <div className='text-[10px] text-[#97A0AE]'>1년 내 도달 비율</div>
            <div className='mt-1 text-[22px] font-black leading-none text-[#0F1419]'>{Math.max(probabilityPct, 0).toFixed(1)}%</div>
            <div
              className='mt-2 h-1.5 overflow-hidden rounded-full bg-[#F1F3F6]'
              role='img'
              aria-label={`1년 내 도달 비율 ${probabilityPct.toFixed(1)}%`}
            >
              <div className='h-full rounded-full bg-[#2B6BE6]' style={{ width: `${Math.min(100, Math.max(1.5, probabilityPct))}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <p className='border-t border-[#EFF1F4] px-4 py-3 text-[12px] leading-5 text-[#5A6473]'>{block.summaryText}</p>

      {geometry ? (
        <div className='border-t border-[#EFF1F4] px-4 py-4'>
          <div className='flex flex-wrap items-baseline justify-between gap-1'>
            <span className='text-[10px] font-bold text-[#5A6473]'>최근 1년 종가와 유사 과거 패턴</span>
            <span className='flex gap-2 text-[10px] text-[#97A0AE]'>
              <span className='flex items-center gap-1'><span className='h-[2px] w-3 rounded bg-[#0F1419]' aria-hidden />종가</span>
              <span className='flex items-center gap-1'><span className='h-0 w-3 border-t-2 border-dashed border-[#2B6BE6]' aria-hidden />평단가</span>
              <span className='flex items-center gap-1'><span className='size-2 rounded-[2px] border border-[#E0942A] bg-[#F0A73B]/40' aria-hidden />유사 패턴</span>
            </span>
          </div>
          <svg
            className='mt-2 w-full'
            viewBox={`0 0 ${RECOVERY_CHART_WIDTH} ${RECOVERY_CHART_HEIGHT}`}
            role='img'
            aria-label='최근 1년 종가 차트. 파란 점선은 평단가, 호밍색 표시는 유사 과거 패턴 구간이다.'
          >
            {geometry.gridlines.map((line) => (
              <g key={`grid-${line.label}`}>
                <line x1={RECOVERY_CHART_MARGIN.left} x2={RECOVERY_CHART_WIDTH - RECOVERY_CHART_MARGIN.right} y1={line.y} y2={line.y} stroke='#F1F3F6' strokeWidth='1' />
                <text x={RECOVERY_CHART_MARGIN.left - 4} y={line.y + 3} textAnchor='end' fontSize='8' fill='#97A0AE'>{line.label}</text>
              </g>
            ))}
            {geometry.dateTicks.map((tick) => (
              <text key={`date-${tick.label}-${tick.x}`} x={tick.x} y={RECOVERY_CHART_HEIGHT - 4} textAnchor='middle' fontSize='8' fill='#97A0AE'>{tick.label}</text>
            ))}
            {geometry.bands.map((band) => (
              <rect key={`band-${band.x}`} x={band.x - 3} y={RECOVERY_CHART_MARGIN.top} width='6' height={RECOVERY_CHART_HEIGHT - RECOVERY_CHART_MARGIN.top - RECOVERY_CHART_MARGIN.bottom} rx='1.5' fill='#F0A73B' fillOpacity='0.28' stroke='#E0942A' strokeWidth='0.5'>
                <title>{band.title}</title>
              </rect>
            ))}
            {geometry.targetY !== null ? (
              <g>
                <line x1={RECOVERY_CHART_MARGIN.left} x2={RECOVERY_CHART_WIDTH - RECOVERY_CHART_MARGIN.right} y1={geometry.targetY} y2={geometry.targetY} stroke='#2B6BE6' strokeWidth='1.2' strokeDasharray='4 3' />
                <text x={RECOVERY_CHART_WIDTH - RECOVERY_CHART_MARGIN.right} y={geometry.targetY - 3} textAnchor='end' fontSize='8' fontWeight='700' fill='#2B6BE6'>평단 {compactPrice(targetPrice ?? 0)}</text>
              </g>
            ) : null}
            <path d={geometry.pricePath} fill='none' stroke='#0F1419' strokeWidth='1.4' />
            {geometry.currentDot ? (
              <circle cx={geometry.currentDot.x} cy={geometry.currentDot.y} r='3' fill='#C13030' stroke='#FFFFFF' strokeWidth='1.2'>
                <title>{`현재가 ${block.currentPriceText}`}</title>
              </circle>
            ) : null}
          </svg>
        </div>
      ) : null}

      <div className='grid grid-cols-3 border-t border-[#EFF1F4]'>
        {facts.map(([label, value]) => (
          <div key={label} className='border-b border-r border-[#EFF1F4] px-4 py-3 last:border-r-0 [&:nth-child(3n)]:border-r-0 [&:last-child]:border-b-0'>
            <div className='text-[10px] text-[#97A0AE]'>{label}</div>
            <div className='mt-1 text-[14px] font-bold text-[#0F1419]'>{value}</div>
          </div>
        ))}
      </div>

      {block.modelRows.length > 0 ? (
        <div className='border-t border-[#EFF1F4] px-4 py-4'>
          <div className='mb-3 text-[10px] text-[#97A0AE]'>모델별 도달 기간 · 비율</div>
          <div className='space-y-3'>
            {block.modelRows.map((row, index) => {
              const probability = parsePercent(row.probabilityText)
              const swatch = RECOVERY_MODEL_SWATCH_COLORS[index % RECOVERY_MODEL_SWATCH_COLORS.length]
              return (
                <div key={row.label} className='text-[12px]'>
                  <div className='flex items-center gap-2'>
                    <span className='size-2 shrink-0 rounded-full' style={{ backgroundColor: swatch }} aria-hidden />
                    <span className='font-bold text-[#0F1419]'>{row.label}</span>
                    <span className='text-[#5A6473]'>{row.recoveryDaysText}</span>
                    {row.sampleText ? <span className='text-[10px] text-[#97A0AE]'>· {row.sampleText}</span> : null}
                    <span className='ml-auto font-bold text-[#5A6473]'>{row.probabilityText}</span>
                  </div>
                  <div className='mt-1.5 h-1 overflow-hidden rounded-full bg-[#F1F3F6]'>
                    <div className='h-full rounded-full' style={{ width: `${Math.min(100, Math.max(2, probability ?? 0))}%`, backgroundColor: swatch }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <p className='border-t border-[#EFF1F4] px-4 py-3 text-[10px] leading-4 text-[#97A0AE]'>{block.disclaimer}</p>
    </article>
  )
}
