'use client'

import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

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
  if (label === '높음') return { badge: 'bg-[#E8F5EE] text-[#1A9D55]', dot: 'bg-[#1A9D55]' }
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

export function DeepScanRecoveryForecastCard({ payload }: DeepScanRecoveryForecastCardProps) {
  const block = readRecoveryForecastForLoss(payload)
  if (!block) {
    return null
  }

  const tone = confidenceTone(block.confidenceText)
  const facts: ReadonlyArray<readonly [string, string]> = [
    ['회복 확률', block.recoveryProbabilityText || '--'],
    ['현재가', block.currentPriceText || '--'],
    ['평단가', block.targetPriceText || '--'],
    ['손실률', block.drawdownText || '--'],
  ]

  return (
    <article
      className='overflow-hidden rounded-[16px] border border-[#E8EAEE] bg-white shadow-[0_1px_3px_rgba(0,0,0,.04)]'
      aria-label='원금회수 예측'
    >
      <div className='flex items-center gap-3 border-b border-[#EFF1F4] px-4 py-4'>
        <div className='flex size-9 items-center justify-center rounded-[10px] bg-[#0F1419] text-[16px]'>🎯</div>
        <div className='flex-1'>
          <div className='text-[10px] text-[#97A0AE]'>손실 구간</div>
          <h2 className='text-[14px] font-bold text-[#0F1419]'>원금회수 예측</h2>
        </div>
        <span className={cn('rounded-[6px] px-2 py-1 text-[10px] font-bold', tone.badge)}>
          신뢰도 {block.confidenceText}
        </span>
      </div>

      <div className='px-4 py-5 text-center'>
        <div className='text-[10px] text-[#97A0AE]'>예상 회수 기간</div>
        <div className='mt-1 text-[28px] font-black leading-none text-[#0F1419]'>{block.expectedRecoveryDaysText || '--'}</div>
        <p className='mt-3 text-[12px] leading-5 text-[#5A6473]'>{block.summaryText}</p>
      </div>

      <div className='grid grid-cols-2 border-t border-[#EFF1F4]'>
        {facts.map(([label, value]) => (
          <div
            key={label}
            className='border-b border-r border-[#EFF1F4] px-4 py-3 last:border-r-0 [&:nth-child(2n)]:border-r-0 [&:nth-last-child(-n+2)]:border-b-0'
          >
            <div className='text-[10px] text-[#97A0AE]'>{label}</div>
            <div className='mt-1 text-[14px] font-bold text-[#0F1419]'>{value}</div>
          </div>
        ))}
      </div>

      {block.modelRows.length > 0 ? (
        <div className='border-t border-[#EFF1F4] px-4 py-4'>
          <div className='mb-3 text-[10px] text-[#97A0AE]'>모델별 회수 기간 비교</div>
          <div className='space-y-2'>
            {block.modelRows.map((row) => (
              <div key={row.label} className='flex items-center gap-2 text-[12px]'>
                <span className='size-2 shrink-0 rounded-full bg-[#0F1419]' />
                <span className='font-bold text-[#0F1419]'>{row.label}</span>
                <span className='text-[#5A6473]'>{row.recoveryDaysText}</span>
                {row.sampleText ? <span className='text-[10px] text-[#97A0AE]'>· {row.sampleText}</span> : null}
                <span className='ml-auto font-bold text-[#5A6473]'>{row.probabilityText}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className='border-t border-[#EFF1F4] px-4 py-3 text-[10px] leading-4 text-[#97A0AE]'>{block.disclaimer}</p>
    </article>
  )
}
