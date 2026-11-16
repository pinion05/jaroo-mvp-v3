// 판단 서사 렌더러 — Phase 1: 결정론 템플릿. Phase 2: LLM①이 페르소나 카드 기반으로 대체.
// 규칙: 서사의 모든 숫자는 DecisionFact에서 온다(spec D2). 템플릿은 문장 꼴만 바꾼다.

import type { Character, Decision } from './domain.ts'

export function renderRationale(character: Character, decision: Decision): string {
  const voice = character.personaCard.voice[decision.kind === 'hold' ? 'hold' : decision.kind]
  const body = renderBody(decision)
  return `${voice} ${body}`
}

function pct(value: number | undefined | null): string {
  if (value === undefined || value === null) return '?'
  return `${(value * 100).toFixed(2)}%`
}

function won(value: number | undefined | null): string {
  if (value === undefined || value === null) return '?'
  return `${value.toLocaleString('ko-KR')}원`
}

function renderBody(decision: Decision): string {
  const f = decision.fact
  switch (decision.reasonCode) {
    case 'stop_loss':
      return `${decision.symbol} 평단 ${won(f.avgPriceKrw)} → 현재 ${won(f.currentPriceKrw)} (${pct(f.returnPct)}) — 손절 기준 ${pct(f.thresholdPct)} 도달, ${decision.quantity}주 전량 매도.`
    case 'take_profit':
      return `${decision.symbol} 평단 ${won(f.avgPriceKrw)} → 현재 ${won(f.currentPriceKrw)} (${pct(f.returnPct)}) — 익절 기준 ${pct(f.thresholdPct)} 도달, ${decision.quantity}주 전량 매도.`
    case 'dip_buy':
      return `${decision.symbol}이(가) 오늘 ${pct(f.changePct)} 하락 — 하락 매수 규칙 발동, ${won(f.currentPriceKrw)}에 ${decision.quantity}주 소량 매수 (목표물량 ${won(f.targetAmountKrw)}).`
    case 'allocation_buy':
      return `${decision.symbol} 배분 매수 — 총자산 ${won(f.equityKrw)}의 종목당 한도 ${won(f.targetAmountKrw)} 안에서 ${won(f.currentPriceKrw)}에 ${decision.quantity}주.`
    case 'frequency_gate':
      return `마지막 체결로부터 ${f.hoursSinceLastOrder}시간 — 매매 빈도 상한(주기 ${f.windowHours}시간)이 지나지 않아 ${decision.symbol} 신규 매수 보류.`
    case 'position_cap':
      return `보유 종목 수 ${f.positionCount}/${f.maxSymbols} 상한 도달 — ${decision.symbol} 신규 매수 없음.`
    case 'cap_below_minimum':
      return `${decision.symbol} 주가 ${won(f.currentPriceKrw)}이(가) 종목당 한도 ${won(f.targetAmountKrw)}을(를) 넘어 1주도 살 수 없다 — 오늘은 그림의 떡.`
    case 'insufficient_cash':
      return `${decision.symbol} 목표 물량 ${won(f.targetAmountKrw)}에 현금 ${won(f.cashKrw)}이(가) 못 미쳐 매수 보류.`
    case 'no_signal':
      if (decision.symbol === null) return `매수·매도 신호 없음 — 관망 (현금 ${won(f.cashKrw)}).`
      return `${decision.symbol} 오늘 ${pct(f.changePct)} — 하락 매수 조건(${pct(f.thresholdPct)} 이하) 미충족이라 오늘은 손 안 대기.`
    case 'quote_missing':
      return `${decision.symbol ?? '종목'} 시세 조회 실패 — 모르는 종목은 안 산다, 이번 루프 제외.`
  }
}
