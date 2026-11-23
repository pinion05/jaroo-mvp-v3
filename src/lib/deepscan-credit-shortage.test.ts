import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCreditShortageFacts } from '@/lib/deepscan-credit-shortage'
import { DEEPSCAN_CREDIT_COST } from '@/lib/payments/products'

test('buildCreditShortageFacts computes shortfall from server 402 detail', () => {
  const facts = buildCreditShortageFacts(10, 3)
  assert.equal(facts.cost, 10)
  assert.equal(facts.balance, 3)
  assert.equal(facts.shortfall, 7)
  assert.equal(facts.needText, '10크레딧')
  assert.equal(facts.haveText, '3크레딧')
  assert.equal(facts.shortfallText, '7크레딧')
})

test('buildCreditShortageFacts falls back to policy defaults when detail is missing', () => {
  const facts = buildCreditShortageFacts(null, null)
  assert.equal(facts.cost, DEEPSCAN_CREDIT_COST)
  assert.equal(facts.balance, 0)
  assert.equal(facts.shortfall, DEEPSCAN_CREDIT_COST)
  assert.equal(facts.haveText, '0크레딧')
  assert.ok(facts.body.includes(DEEPSCAN_CREDIT_COST.toLocaleString()))
})

test('buildCreditShortageFacts copy explains it is not an error and mentions retry', () => {
  const facts = buildCreditShortageFacts(10, 0)
  assert.equal(facts.headline, '크레딧이 살짝 모자라요')
  assert.ok(facts.body.includes('문제가 생긴 게 아니'))
  assert.ok(facts.body.includes('다시 분석'))
  // 부족분이 남은 상태(잔여 > 필요)처럼 잘못 계산되지 않는지
  const enough = buildCreditShortageFacts(10, 50)
  assert.equal(enough.shortfall, 0)
})
