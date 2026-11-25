'use client'

import { formatComputedNumber, parseOcrNumber } from '@/lib/screenshot-ocr'
import type {
  ExistingPortfolioResolution,
  PortfolioMergePlan,
  PortfolioOverlap,
  PortfolioOverlapChoice,
} from '@/lib/portfolio-merge'

// 재적용 병합 안내 카드: 기존 포트폴리오에 그대로 둘 종목·새로 추가될 종목을 요약하고,
// 겹치는 종목은 종목별로 처리 방법(새 값으로 갱신 / 수량 합산 / 기존 유지)을 고르게 한다.
//
// /ocr(자체 <style> 클래스)과 /merge(Tailwind 유틸리티) 어디에 놓여도 같게 보이도록 Tailwind
// 유틸리티 대신 이 컴포넌트 안의 <style>로만 꾸민다. /ocr의 레이어 밖 재설정(.jaroo-ocr-page *)은
// cascade layer 안의 Tailwind 유틸리티보다 항상 우선하기 때문이다.

const OVERLAP_CHOICE_OPTIONS: ReadonlyArray<{ id: PortfolioOverlapChoice; label: string }> = [
  { id: 'update', label: '새 값으로 갱신' },
  { id: 'sum', label: '수량 합산' },
  { id: 'keep', label: '기존 유지' },
]

type PortfolioOverlapRow = Pick<
  PortfolioOverlap['existing'],
  'quantity' | 'averagePrice' | 'averagePriceCurrency' | 'resolvedMarket' | 'resolvedCode' | 'resolvedTicker'
>

function formatQuantity(value: string): string {
  const parsedValue = parseOcrNumber(value)
  return parsedValue === null ? value : `${formatComputedNumber(parsedValue)}주`
}

// 평단 표기는 출처마다 다르다 — 스토어를 거친 기존 행 "71,500원"·"$150.2", DB 행 "71500", OCR 행 "88,100".
// 나란히 놓였을 때 어긋나지 않게 숫자 부분만 천 단위 구분으로 맞춰 보여준다.
function formatAveragePrice(value: string, currency?: string): string {
  const trimmedValue = value.trim()
  const parsedValue = parseOcrNumber(trimmedValue)
  if (parsedValue === null) {
    return trimmedValue
  }

  const numberText = parsedValue.toLocaleString('ko-KR', { maximumFractionDigits: 4 })

  return currency === 'USD' ? `${numberText} USD` : numberText
}

function formatHoldingSummary(row: Pick<PortfolioOverlapRow, 'quantity' | 'averagePrice' | 'averagePriceCurrency'>): string {
  const quantityText = formatQuantity(row.quantity)
  const averagePriceText = formatAveragePrice(row.averagePrice, row.averagePriceCurrency)

  return averagePriceText ? `${quantityText} · 평단 ${averagePriceText}` : quantityText
}

function getIdentifierMeta(row: Pick<PortfolioOverlapRow, 'resolvedMarket' | 'resolvedCode' | 'resolvedTicker'>): string {
  return [row.resolvedMarket?.trim(), row.resolvedCode?.trim() || row.resolvedTicker?.trim()].filter(Boolean).join(' · ')
}

type PortfolioOverlapChoicesProps = {
  // 선택 상태는 plan.overlaps[*].choice에 이미 반영돼 있다(부모가 choices를 넘겨 만든 plan).
  plan: PortfolioMergePlan
  existingStatus: ExistingPortfolioResolution['status']
  onChange: (key: string, choice: PortfolioOverlapChoice) => void
}

export function PortfolioOverlapChoices({ plan, existingStatus, onChange }: PortfolioOverlapChoicesProps) {
  // 겹치는 종목도, 그대로 둘 기존 종목도 없으면(첫 포트폴리오) 보일 게 없다.
  if (plan.overlaps.length === 0 && plan.keptRowCount === 0) {
    return null
  }

  const summaryParts = [
    plan.addedRows.length > 0 ? `새 종목 ${plan.addedRows.length}개 추가` : null,
    plan.overlaps.length > 0 ? `겹치는 종목 ${plan.overlaps.length}개` : null,
    plan.keptRowCount > 0 ? `기존 ${plan.keptRowCount}개 그대로` : null,
  ].filter((part): part is string => part !== null)

  return (
    <section className='jaroo-pfo' aria-label='기존 포트폴리오 반영'>
      <style>{`
        .jaroo-pfo{background:#fff;border-radius:14px;border:.5px solid #E8EAEE;box-shadow:0 1px 3px rgba(0,0,0,.04);overflow:hidden;margin-bottom:12px;text-align:left;font-family:inherit;color:#0F1419}
        .jaroo-pfo *{box-sizing:border-box}
        .jaroo-pfo .jaroo-pfo-head{padding:14px 16px 11px}
        .jaroo-pfo .jaroo-pfo-title{font-size:13.5px;font-weight:600;color:#0F1419}
        .jaroo-pfo .jaroo-pfo-sub{font-size:11px;color:#97A0AE;margin-top:3px;line-height:1.45}
        .jaroo-pfo .jaroo-pfo-warn{margin:0 16px 12px;padding:9px 11px;border-radius:10px;background:#FFF8E8;border:.5px solid #F3D9A0;font-size:11px;line-height:1.5;color:#854F0B}
        .jaroo-pfo .jaroo-pfo-row{padding:12px 16px;border-top:.5px solid #EFF1F4}
        .jaroo-pfo .jaroo-pfo-name{font-size:13px;font-weight:600;color:#0F1419}
        .jaroo-pfo .jaroo-pfo-meta{font-size:10.5px;color:#97A0AE;margin-top:2px}
        .jaroo-pfo .jaroo-pfo-compare{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:7px;font-size:11.5px;color:#5A6473;font-variant-numeric:tabular-nums}
        .jaroo-pfo .jaroo-pfo-side-label{display:inline-block;margin-right:5px;padding:1px 6px;border-radius:5px;background:#EEF0F3;color:#5A6473;font-size:9.5px;font-weight:600}
        .jaroo-pfo .jaroo-pfo-options{display:flex;gap:6px;margin-top:9px}
        .jaroo-pfo .jaroo-pfo-chip{flex:1 1 0;min-width:0;padding:8px 4px;border-radius:10px;border:1px solid #E8EAEE;background:#fff;color:#5A6473;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .15s,border-color .15s,color .15s}
        .jaroo-pfo .jaroo-pfo-chip.sel{border-color:#2B6BE6;background:#E6F0FE;color:#2B6BE6}
        .jaroo-pfo .jaroo-pfo-result{margin-top:8px;font-size:11px;color:#5A6473}
        .jaroo-pfo .jaroo-pfo-result b{color:#0F1419;font-weight:600}
      `}</style>

      <div className='jaroo-pfo-head'>
        <div className='jaroo-pfo-title'>
          {plan.overlaps.length > 0
            ? `기존 포트폴리오와 ${plan.overlaps.length}개 종목이 겹쳐요`
            : '기존 포트폴리오에 함께 추가돼요'}
        </div>
        <div className='jaroo-pfo-sub'>{summaryParts.join(' · ')}</div>
      </div>

      {existingStatus === 'unavailable' ? (
        <div className='jaroo-pfo-warn' role='alert'>
          서버에서 기존 포트폴리오를 불러오지 못했어요. 이 기기에 보인 목록 기준으로 병합되고, 서버에는 저장하지 않아요.
        </div>
      ) : null}

      {plan.overlaps.map((overlap) => {
        const identifierMeta = getIdentifierMeta(overlap.incoming) || getIdentifierMeta(overlap.existing)

        return (
          <div className='jaroo-pfo-row' key={overlap.key}>
            <div className='jaroo-pfo-name'>{overlap.displayName}</div>
            {identifierMeta ? <div className='jaroo-pfo-meta'>{identifierMeta}</div> : null}
            <div className='jaroo-pfo-compare'>
              <div><span className='jaroo-pfo-side-label'>기존</span>{formatHoldingSummary(overlap.existing)}</div>
              <div><span className='jaroo-pfo-side-label'>이번</span>{formatHoldingSummary(overlap.incoming)}</div>
            </div>
            <div className='jaroo-pfo-options' role='radiogroup' aria-label={`${overlap.displayName} 처리 방법`}>
              {OVERLAP_CHOICE_OPTIONS.map((option) => {
                const selected = overlap.choice === option.id

                return (
                  <button
                    key={option.id}
                    type='button'
                    role='radio'
                    aria-checked={selected}
                    className={`jaroo-pfo-chip${selected ? ' sel' : ''}`}
                    onClick={() => {
                      if (!selected) {
                        onChange(overlap.key, option.id)
                      }
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <div className='jaroo-pfo-result'>반영: <b>{formatHoldingSummary(overlap.result)}</b></div>
          </div>
        )
      })}
    </section>
  )
}
