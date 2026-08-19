import assert from 'node:assert/strict'
import test from 'node:test'
import { CREDIT_PACKS, DEEPSCAN_CREDIT_COST, PRO_PLAN, findCreditPack, findProduct, orderNameFor } from './products'

test('크레딧 팩 카탈로그가 유효하다', () => {
  assert.ok(CREDIT_PACKS.length >= 3)
  for (const pack of CREDIT_PACKS) {
    assert.equal(pack.type, 'credit_pack')
    assert.ok(pack.credits > 0)
    assert.ok(pack.amountKrw >= 1000)
    assert.match(pack.id, /^[a-z0-9_]+$/)
  }
  const ids = new Set(CREDIT_PACKS.map((pack) => pack.id))
  assert.equal(ids.size, CREDIT_PACKS.length)
})

test('Pro 플랜은 월 구독이다', () => {
  assert.equal(PRO_PLAN.type, 'pro_subscription')
  assert.equal(PRO_PLAN.amountKrw, 4900)
  assert.equal(PRO_PLAN.periodDays, 30)
})

test('findProduct/findCreditPack 조회', () => {
  assert.equal(findCreditPack('credit_300')?.credits, 300)
  assert.equal(findCreditPack('nope'), null)
  assert.equal(findProduct('pro_monthly'), PRO_PLAN)
  assert.equal(findProduct('unknown'), null)
})

test('주문명 생성', () => {
  assert.match(orderNameFor(CREDIT_PACKS[0]), /Jaroo/)
  assert.match(orderNameFor(PRO_PLAN), /Pro/)
})

test('딥스캔 크레딧 단가는 양수다', () => {
  assert.ok(DEEPSCAN_CREDIT_COST > 0)
})
