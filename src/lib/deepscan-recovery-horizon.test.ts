import test from 'node:test'
import assert from 'node:assert/strict'

import { buildRecoveryHorizonChips, RECOVERY_HORIZON_CHIP_ORDER } from './deepscan-recovery-horizon'

test('RECOVERY_HORIZON_CHIP_ORDER — 5버킷 고정 순서(3m→3y)와 라벨', () => {
  assert.deepEqual(RECOVERY_HORIZON_CHIP_ORDER.map(({ key }) => key), ['3m', '6m', '1y', '2y', '3y'])
  assert.deepEqual(RECOVERY_HORIZON_CHIP_ORDER.map(({ label }) => label), ['3개월', '6개월', '1년', '2년', '3년'])
})

test('전체 5버킷이 숫자면 5칩을 순서대로 반환 (KR 3년 계열)', () => {
  const chips = buildRecoveryHorizonChips({
    recoveryHorizonProbabilities: { '3m': 16.3, '6m': 28.5, '1y': 41.3, '2y': 61.8, '3y': 66.4 },
  })
  assert.equal(chips.length, 5)
  assert.deepEqual(chips.map(({ label }) => label), ['3개월', '6개월', '1년', '2년', '3년'])
  assert.deepEqual(chips.map(({ value }) => value), [16.3, 28.5, 41.3, 61.8, 66.4])
})

test('null 버킷은 필터링 — US 1년 계열은 3m/6m/1y만 (v4 카드와 동일 규칙)', () => {
  const chips = buildRecoveryHorizonChips({
    recoveryHorizonProbabilities: { '3m': 22.0, '6m': 38.4, '1y': 55.2, '2y': null, '3y': null },
  })
  assert.deepEqual(chips.map(({ key }) => key), ['3m', '6m', '1y'])
})

test('recoveryHorizonProbabilities가 없으면 빈 배열 — 구형 스냅샷·브리핑 프리뷰 폴백', () => {
  // 필드 자체가 없는 경우(LoadingBriefingRecoveryForecast)
  assert.deepEqual(buildRecoveryHorizonChips({}), [])
  // 명시적 null(구형 저장 스냅샷)
  assert.deepEqual(buildRecoveryHorizonChips({ recoveryHorizonProbabilities: null }), [])
  // 입력이 null/undefined인 경우
  assert.deepEqual(buildRecoveryHorizonChips(null), [])
  assert.deepEqual(buildRecoveryHorizonChips(undefined), [])
})

test('0% 버킷은 유효 숫자로 유지 — 확률 0도 정보다', () => {
  const chips = buildRecoveryHorizonChips({
    recoveryHorizonProbabilities: { '3m': 0, '6m': 3.1 },
  })
  assert.deepEqual(chips.map(({ key, value }) => [key, value]), [['3m', 0], ['6m', 3.1]])
})
