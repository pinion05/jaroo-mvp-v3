import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { EtfAiCommitteeCard } from './etf-ai-committee-card'
import type { EtfCommitteeState } from './etf-page-model'

function render(committee: EtfCommitteeState): string {
  return renderToStaticMarkup(createElement(EtfAiCommitteeCard, { committee, onRetry: () => undefined }))
}

const readyState: Extract<EtfCommitteeState, { phase: 'ready' }> = {
  phase: 'ready',
  axisLabel: '지수/가격 흐름',
  axisStatusText: 'LLM 위원 3/3명 반영',
  requestId: 'req-1',
  status: 'complete',
  scannedAt: null,
  members: [
    { memberKey: 'trend', title: '지수/가격 흐름', status: 'success', score: 60, scoreLabel: '60', reason: '최근 1개월 +2.16% 흐름이 우상향이에요.' },
    { memberKey: 'consensusMomentum', title: '시장 신호/정보 밀도', status: 'pending', score: null, scoreLabel: '고민중...', reason: '이 위원은 추가 LLM 응답을 기다리는 중입니다.' },
    { memberKey: 'priceLocation', title: '가격 위치', status: 'error', score: null, scoreLabel: 'Error', reason: null },
  ],
}

test('EtfAiCommitteeCard renders nothing for idle (US ETF 등 카드 미표시)', () => {
  assert.equal(render({ phase: 'idle' }), '')
})

test('EtfAiCommitteeCard renders skeleton rows while loading', () => {
  const markup = render({ phase: 'loading' })

  assert.match(markup, /AI 위원회/)
  assert.match(markup, /시장·차트 팀/)
  assert.match(markup, /분석 중/)
  assert.match(markup, /animate-pulse/)
})

test('EtfAiCommitteeCard renders member rows with reasons and status labels', () => {
  const markup = render(readyState)

  assert.match(markup, /3명 분석/)
  assert.match(markup, /LLM 위원 3\/3명 반영/)
  assert.match(markup, /지수\/가격 흐름/)
  assert.match(markup, /최근 1개월 \+2.16% 흐름이 우상향이에요\./)
  assert.match(markup, /고민중\.\.\./)
  assert.match(markup, /응답 실패/)
  // 에러 위원의 영문 scoreLabel('Error')은 노출하지 않는다
  assert.doesNotMatch(markup, />Error</)
})

test('EtfAiCommitteeCard renders disabled and error notices with retry affordance', () => {
  const disabled = render({ phase: 'disabled', message: 'AI 위원회가 준비 중이에요. 잠시 후 다시 시도해주세요.' })
  assert.match(disabled, /준비 중/)
  assert.match(disabled, /AI 위원회가 준비 중이에요/)
  assert.doesNotMatch(disabled, /<button/)

  const error = render({ phase: 'error', message: 'AI 위원회 분석을 가져오지 못했어요.' })
  assert.match(error, /일시 오류/)
  assert.match(error, /다시 시도/)
})
