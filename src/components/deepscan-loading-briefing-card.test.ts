import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMarketMeaning } from '@/lib/deepscan-market-meaning'

// '오늘 시장 속에서는?' 문구 매트릭스 — 시장 방향(상승/하락/혼조/횡보) × 종목 방향 × 격차.
// 2026-11-02 확장: 기존 5분기에서 24분기로. 특히 시장 상승+종목 하락(코스피 +1.5%·내 종목
// −10.24% 사례)이 '덜 따라온 상태예요'로 표시되던 뉘양스 오류를 '시장 대비 약세' 계열로 교정.

test('로딩 상태 — 지표가 아직 없을 때', () => {
  assert.equal(buildMarketMeaning(null, null, null), '내 종목의 장중 등락률을 확인하는 중이에요.')
  assert.equal(buildMarketMeaning(1.2, 0.4, null), '내 종목의 장중 등락률을 확인하는 중이에요.')
  assert.equal(buildMarketMeaning(null, null, 1.2), '시장 지수와 내 종목 흐름을 맞춰 보는 중이에요.')
})

test('시장 상승 × 종목 상승 — 격차와 크기별 5단계', () => {
  // 급등(≥5%)이며 시장을 앞섬
  assert.equal(buildMarketMeaning(1.5, 1.3, 7.2), '시장 오르는 흐름을 앞서며 크게 뛰고 있어요.')
  // 큰 격차(≥3%p)로 앞섬
  assert.equal(buildMarketMeaning(1.5, 1.3, 4.9), '시장보다 한층 강하게 오르고 있어요.')
  // 유의미 격차(≥0.5%p)로 앞섬
  assert.equal(buildMarketMeaning(1.5, 1.3, 2.4), '시장보다 앞서 오르고 있어요.')
  // 비슷하게 따라감
  assert.equal(buildMarketMeaning(1.5, 1.3, 1.6), '시장 오름세를 곧잘 따라가고 있어요.')
  // 오르긴 했지만 시장을 못 따라감
  assert.equal(buildMarketMeaning(4.0, 3.8, 1.0), '시장 오르는 흐름을 다 따라가지 못했어요.')
})

test('시장 상승 × 종목 하락/제자리 — 시장 대비 약세 계열 (2026-11-02 사례 교정)', () => {
  // 유저 제보 사례: 코스피 +1.5%·코스닥 +1.3%·내 종목 −10.24%
  assert.equal(
    buildMarketMeaning(1.5, 1.3, -10.24),
    '시장이 오르는 동안 혼자 크게 내려갔어요. 시장 대비 뚜렷한 약세예요.',
  )
  // 완만한 하락(급락 미만)
  assert.equal(
    buildMarketMeaning(1.5, 1.3, -2.1),
    '시장은 오르는데 혼자 내려가고 있어요. 시장 대비 약세예요.',
  )
  // 제자리(±0.2% 이내)
  assert.equal(buildMarketMeaning(1.5, 1.3, 0.1), '시장은 오르는데 내 종목은 제자리에 있어요.')
})

test('시장 하락 — 역행 강세·방어·동반 하락·약세 4단계', () => {
  // 역행 강세
  assert.equal(buildMarketMeaning(-1.2, -1.0, 2.4), '시장이 내리는 가운데 거꾸로 오르고 있어요. 시장 대비 강세예요.')
  // 제자리 = 방어
  assert.equal(buildMarketMeaning(-1.2, -1.0, 0.0), '시장이 내리는 동안에도 잘 버티고 있어요.')
  // 시장보다 덜 내림
  assert.equal(buildMarketMeaning(-1.4, -1.2, -0.5), '시장 하락 속에서도 비교적 버티고 있어요.')
  // 동반 하락
  assert.equal(buildMarketMeaning(-1.2, -1.0, -1.0), '시장 하락을 함께 받고 있어요.')
  // 시장보다 더 크게 하락
  assert.equal(buildMarketMeaning(-1.2, -1.0, -2.0), '시장 하락을 더 크게 받고 있어요.')
  // 큰 격차(≥3%p)로 하락
  assert.equal(
    buildMarketMeaning(-1.2, -1.0, -10.24),
    '시장보다 훨씬 크게 내려가고 있어요. 시장 대비 약세예요.',
  )
})

test('혼조장 — 두 지수가 반대 방향일 때 평균 대신 방향 갈림을 안내', () => {
  assert.equal(buildMarketMeaning(1.5, -1.3, 2.0), '지수마다 방향이 갈린 날이에요. 내 종목은 오르는 쪽이에요.')
  assert.equal(buildMarketMeaning(1.5, -1.3, -2.0), '지수마다 방향이 갈린 날이에요. 내 종목은 내리는 쪽이에요.')
  assert.equal(buildMarketMeaning(1.5, -1.3, 0.0), '지수마다 방향이 갈린 날이에요. 내 종목은 제자리예요.')
})

test('시장 횡보 — 종목 방향×크기별 5분기', () => {
  assert.equal(buildMarketMeaning(0.1, 0.0, 1.4), '조용한 시장에서 혼자 오르고 있어요.')
  assert.equal(buildMarketMeaning(0.1, 0.0, 0.5), '조용한 시장에서 살짝 오르고 있어요.')
  assert.equal(buildMarketMeaning(0.1, 0.0, 0.0), '시장도 내 종목도 조용한 흐름이에요.')
  assert.equal(buildMarketMeaning(0.1, 0.0, -0.5), '조용한 시장에서 살짝 내려가고 있어요.')
  assert.equal(buildMarketMeaning(0.1, 0.0, -1.4), '조용한 시장에서 혼자 내려가고 있어요.')
})

test('지표 1개만 있어도 방향 판정이 동작한다', () => {
  assert.equal(buildMarketMeaning(1.5, null, -6.0), '시장이 오르는 동안 혼자 크게 내려갔어요. 시장 대비 뚜렷한 약세예요.')
  assert.equal(buildMarketMeaning(null, -1.0, 0.0), '시장이 내리는 동안에도 잘 버티고 있어요.')
})

test('경계값 — 제자리 판정(±0.2)과 혼조 판정은 문턱에서 갈린다', () => {
  // 종목 +0.2는 '오르는 쪽', +0.2 미만은 제자리
  assert.equal(buildMarketMeaning(1.5, 1.3, 0.21), '시장 오르는 흐름을 다 따라가지 못했어요.')
  assert.equal(buildMarketMeaning(1.5, 1.3, 0.2), '시장은 오르는데 내 종목은 제자리에 있어요.')
  assert.equal(buildMarketMeaning(0.0, 0.1, 0.21), '조용한 시장에서 살짝 오르고 있어요.')
  assert.equal(buildMarketMeaning(0.0, 0.1, 0.19), '시장도 내 종목도 조용한 흐름이에요.')
  // 혼조 판정: 두 지수 부호 반대지만 한쪽이 ±0.2 미만이면 혼조 아님(횡보·상승 흐름)
  assert.equal(buildMarketMeaning(1.5, -0.1, 2.0), '시장보다 앞서 오르고 있어요.')
})
