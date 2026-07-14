import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DeepScanRecoveryForecastCard, readRecoveryForecastForLoss } from './deepscan-recovery-forecast-card'
import type { JarooDeepScanPayload, JarooDeepScanRecoveryForecastBlock } from '../../packages/contracts/src/deepscan'

function baseRecoveryBlock(overrides: Partial<JarooDeepScanRecoveryForecastBlock> = {}): JarooDeepScanRecoveryForecastBlock {
  return {
    blockState: 'ok',
    sourceRefs: [],
    fallback: null,
    error: null,
    statusText: '원금회수 예측',
    summaryText: '평단 ₩28,000 회복까지 약 74일로 추정돼요.',
    expectedRecoveryDaysText: '약 74일',
    recoveryProbabilityText: '61.1%',
    confidenceText: '보통',
    currentPriceText: '₩20,050',
    targetPriceText: '₩28,000',
    drawdownText: '28.4%',
    modelRows: [
      { label: '유사 패턴', recoveryDaysText: '96일', probabilityText: '60.3%', sampleText: '63건' },
      { label: 'GBM', recoveryDaysText: '57일', probabilityText: '58.2%' },
      { label: 'Jump-Diffusion', recoveryDaysText: '60일', probabilityText: '63.9%' },
    ],
    disclaimer: '데이터 분석 기반 참고 정보이며 투자 권유나 수익 보장이 아닙니다.',
    ...overrides,
  }
}

function payloadWithRecovery(block: JarooDeepScanRecoveryForecastBlock | null): JarooDeepScanPayload {
  const payload = {
    input: { instrument: { name: '코칩', code: '126730', market: 'KR' } },
  } as unknown as JarooDeepScanPayload
  if (block) {
    ;(payload as unknown as Record<string, unknown>).recoveryForecast = block
  }
  return payload
}

test('readRecoveryForecastForLoss returns the block for a loss position (positive drawdown)', () => {
  const block = readRecoveryForecastForLoss(payloadWithRecovery(baseRecoveryBlock()))
  assert.ok(block)
  assert.equal(block?.expectedRecoveryDaysText, '약 74일')
})

test('readRecoveryForecastForLoss hides the card for a profit position (non-positive drawdown)', () => {
  assert.equal(readRecoveryForecastForLoss(payloadWithRecovery(baseRecoveryBlock({ drawdownText: '-7.1%', summaryText: '현재가가 이미 평단 이상이라 원금회수 목표에 도달한 상태입니다.' }))), null)
})

test('readRecoveryForecastForLoss hides the card at break-even (0% drawdown)', () => {
  assert.equal(readRecoveryForecastForLoss(payloadWithRecovery(baseRecoveryBlock({ drawdownText: '0.0%' }))), null)
})

test('readRecoveryForecastForLoss hides the card when the block is blocked', () => {
  assert.equal(readRecoveryForecastForLoss(payloadWithRecovery(baseRecoveryBlock({ blockState: 'blocked' }))), null)
})

test('readRecoveryForecastForLoss hides the card when recoveryForecast is absent', () => {
  assert.equal(readRecoveryForecastForLoss(payloadWithRecovery(null)), null)
})

test('DeepScanRecoveryForecastCard renders the recovery forecast for a loss-making holding', () => {
  const markup = renderToStaticMarkup(createElement(DeepScanRecoveryForecastCard, { payload: payloadWithRecovery(baseRecoveryBlock()) }))
  assert.match(markup, /원금회수 예측/)
  assert.match(markup, /도달 사례 기준 기간/)
  assert.match(markup, /약 74일/)
  assert.match(markup, /1년 내 도달 비율/)
  assert.match(markup, /61\.1%/)
  assert.match(markup, /신뢰도 보통/)
  assert.doesNotMatch(markup, /예상 회수 기간/)
  assert.match(markup, /유사 패턴/)
  assert.match(markup, /투자 권유/)
})

test('DeepScanRecoveryForecastCard renders nothing for a profit position', () => {
  const markup = renderToStaticMarkup(createElement(DeepScanRecoveryForecastCard, {
    payload: payloadWithRecovery(baseRecoveryBlock({ drawdownText: '-7.1%' })),
  }))
  assert.equal(markup, '')
})
