import test from 'node:test'
import assert from 'node:assert/strict'

import { getFinancialValueTextClass, getFinancialValueTone } from './financial-value-tone'

test('금융 값의 부호를 수익·손실·중립 tone으로 구분한다', () => {
  assert.equal(getFinancialValueTone(12.3), 'profit')
  assert.equal(getFinancialValueTone('+12.3%'), 'profit')
  assert.equal(getFinancialValueTone(-7.5), 'loss')
  assert.equal(getFinancialValueTone('−7.5%'), 'loss')
  assert.equal(getFinancialValueTone(0), 'neutral')
  assert.equal(getFinancialValueTone('0.0%'), 'neutral')
  assert.equal(getFinancialValueTone('-'), 'neutral')
  assert.equal(getFinancialValueTone('계산 중'), 'neutral')
})

test('쉼표와 통화 단위가 있는 손익도 같은 규칙으로 판별한다', () => {
  assert.equal(getFinancialValueTone('+1,832,000원'), 'profit')
  assert.equal(getFinancialValueTone('-910,000원'), 'loss')
  assert.equal(getFinancialValueTone('−1,863,000원'), 'loss')
})

test('표시 class는 금융 전용 토큰을 사용하고 일반 성공·오류 토큰과 섞이지 않는다', () => {
  assert.equal(getFinancialValueTextClass('+12.3%'), 'text-[color:var(--jaroo-profit)]')
  assert.equal(getFinancialValueTextClass('-7.5%'), 'text-[color:var(--jaroo-loss)]')
  assert.equal(getFinancialValueTextClass('0%'), 'text-[color:var(--jaroo-muted)]')
})
