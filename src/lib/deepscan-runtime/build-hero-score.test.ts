import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHeroScore, type DeepScanRawInput } from './build-payload'

// buildHeroScore 분모 정규화 계약(버그헌트 FM-2 파생 + TC-e2e-deepscan §9 관측 2).
//
// 결함: 위원 일부 실패 시에도 분모를 고정 100으로 나눠, 응답 위원의 점수가
// 미응답 위원 몫만큼 일괄 감소했다(예: 5/9 응답 × 평균 70점 → 39점). 이제 분모를
// "실제 응답 위원의 가중치 합"으로 정규화한다.

// build-payload 내부 타입 DeepScanAgentResult와 구조가 같은 테스트용 agent.
type UsAgentKey =
  | 'valuation' | 'growth' | 'profitability-quality' | 'financial-safety' | 'momentum'
  | 'estimate-revision' | 'ownership-flow' | 'event-risk' | 'portfolio-fit'

type UsAgent = {
  key: UsAgentKey
  label: string
  shortLabel: string
  score: number
  reason: string
  confidence: 'low' | 'medium' | 'high'
  verdict: 'positive' | 'neutral' | 'warning' | 'negative'
  iconTone: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal'
}

const WEIGHTS: Record<UsAgentKey, number> = {
  valuation: 14,
  growth: 12,
  'profitability-quality': 12,
  'financial-safety': 12,
  momentum: 10,
  'estimate-revision': 10,
  'ownership-flow': 8,
  'event-risk': 10,
  'portfolio-fit': 12,
}

function agent(key: UsAgentKey, score: number): UsAgent {
  return {
    key,
    label: key,
    shortLabel: key.slice(0, 3).toUpperCase(),
    score,
    reason: `${key} reason`,
    confidence: 'medium',
    verdict: score >= 55 ? 'positive' : 'warning',
    iconTone: 'blue',
  }
}

const ALL_KEYS = Object.keys(WEIGHTS) as UsAgentKey[]

test('buildHeroScore: 9인 전원 응답 시 기존 고정 분모 100 산식과 동일하다', () => {
  const agents = ALL_KEYS.map((key, index) => agent(key, index % 2 === 0 ? 80 : 40))
  const weightedTotal = agents.reduce((sum, a) => sum + WEIGHTS[a.key] * a.score, 0)
  assert.equal(buildHeroScore(agents), Math.max(0, Math.min(100, Math.round(weightedTotal / 100))))
})

test('buildHeroScore: 일부 응답 시 응답 위원 가중치 합으로 정규화해 계통이 축소되지 않는다', () => {
  // 전원 70점 응답 → 70점
  const all = ALL_KEYS.map((key) => agent(key, 70))
  assert.equal(buildHeroScore(all), 70)

  // 4명만 70점 응답(가중치 합 14+12+12+12=50): 과거엔 70×50/100=35로 축소.
  // 정규화 후에는 응답 위원 점수 그대로 70.
  const partial = [agent('valuation', 70), agent('growth', 70), agent('profitability-quality', 70), agent('financial-safety', 70)]
  assert.equal(buildHeroScore(partial), 70)

  // 응답 위원 점수가 섞여 있어도 응답 가중 평균이 나온다:
  // (80×14 + 40×12)/(14+12) = 1600/26 = 61.54 → 62 (전원 분모라면 21)
  const mixed = [agent('valuation', 80), agent('growth', 40)]
  assert.equal(buildHeroScore(mixed), 62)
})

test('buildHeroScore: 응답 위원이 없으면 0으로 안전하게 떨어진다', () => {
  assert.equal(buildHeroScore([]), 0)
})

// NOTE: DeepScanRawInput import는 빌드 타입 회귀 방지용 참조(사용처와 동일 모듈에서
// 함께 export되는 타입의 정합성 확인).
test('build-payload 모듈 타입 참조가 깨지지 않는다(컴파일 회귀 가드)', () => {
  const raw: DeepScanRawInput = { instrument: { ticker: 'AAPL' }, sourceContext: {} }
  assert.equal(raw.instrument.ticker, 'AAPL')
})
