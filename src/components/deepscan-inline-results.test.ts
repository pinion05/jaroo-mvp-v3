import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DeepScanInlineResults } from './deepscan-inline-results'
import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

function basePayload(): JarooDeepScanPayload {
  return {
    input: { instrument: { name: 'LG디스플레이', code: '034220', market: 'KOSPI' }, holding: { shares: '16주', averagePrice: '14,240원' }, sourceContext: { from: 'holding' } },
    hero: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, headline: '거의 본전이에요', body: '상승 여력이 남아 있어 조금 더 지켜볼 수 있어요.', statusText: '강세', score: 68, scoreLabel: '68점', scoreDelta: '+3' },
    committee: {
      blockState: 'ok', sourceRefs: [], fallback: null, error: null,
      axes: [{
        label: '시장', score: null, scoreText: 'N/A', axisStatusText: '부분 응답', subtitle: '일부 위원 대기', avgLabel: '부분',
        members: [
          { shortLabel: '가격', title: '가격 위치', status: 'success', reason: '현재 가격은 52주 중상단에 있고 단기 추세는 우상향이에요.', score: 70, scoreLabel: '70점', tone: 'positive', iconTone: 'blue' },
          { shortLabel: '평단', title: '평단 격차', status: 'error', reason: null, score: null, scoreLabel: 'N/A', tone: 'neutral', iconTone: 'red', error: { kind: 'llm-upstream-error', message: '응답 실패', attempts: 1 } },
          { shortLabel: '트렌드', title: '트렌드', status: 'pending', reason: '대기 중', score: null, scoreLabel: 'N/A', tone: 'neutral', iconTone: 'amber' },
        ],
      }],
    },
    insights: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, sectionLabel: '핵심 인사이트', items: [{ sourceType: 'market', sourceLabel: '거래량', date: '2026-06-02', label: '거래량', title: '거래량', body: '어제의 1.4배' }], summaryTags: ['거래량'] },
    strategy: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, weekSignal: '보유 유지', weekSignalTone: 'positive', weekBadgeText: '관찰', scenarioLabel: '보유 유지', scenarioProbability: '62%', scenarioPeriod: '1–2주', scenarioCondition: '목표가 도달 시 분할 매도', currentPriceText: '14,185원', targetPriceText: '17,500원', scenarioDetails: [], otherScenarios: [{ label: '추가 매수', probability: '23%', condition: '−10% 도달 시 평단 낮추기' }, { label: '손절', probability: '15%', condition: '추세 이탈 시 검토' }], otherScenarioTags: [] },
    sellNow: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, rows: [], realizedText: '지금 팔면 손실이 작아요.' },
    portfolioSimulation: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, beforeScore: 50, afterScore: 55, deltaLabel: '+5p', caption: '보유 유지' },
    metadata: { generatedAt: '2026-06-02T00:00:00.000Z', version: 'test', degraded: true, debugId: 'debug', inputValidity: { valid: true }, sourceRefs: [{ type: 'market', id: 'quote' }], blockStatus: { hero: 'ok', committee: 'ok', insights: 'ok', strategy: 'ok', sellNow: 'ok', portfolioSimulation: 'ok' }, llmCommittee: { requestId: 'r1', status: 'partial', completed: 1, pending: 1, errors: 1 } },
  }
}

test('DeepScanInlineResults renders v7 team/conclusion stream with degraded real payload', () => {
  const markup = renderToStaticMarkup(createElement(DeepScanInlineResults, { payload: basePayload() }))

  assert.match(markup, /딥스캔 v7 실제 결과/)
  assert.match(markup, /시장·차트 팀/)
  assert.match(markup, /일부 실패/)
  assert.match(markup, /1개 근거/)
  assert.match(markup, /1개 대기/)
  assert.match(markup, /1개 준비 중/)
  assert.match(markup, /세 팀의 의견을 모았어요/)
  assert.match(markup, /보유 유지/)
  assert.match(markup, /62%/)
  assert.match(markup, /상승 여력/)
})

test('DeepScanInlineResults falls back when committee and strategy blocks are unavailable', () => {
  const payload = basePayload()
  payload.committee = { ...payload.committee, blockState: 'error', error: { code: 'committee-error', message: '위원회 실패' }, axes: [] }
  payload.strategy = { ...payload.strategy, blockState: 'blocked', fallback: { used: true, label: '전략 원천 차단' }, otherScenarios: [] }
  const markup = renderToStaticMarkup(createElement(DeepScanInlineResults, { payload }))

  assert.match(markup, /위원회 실패/)
  assert.match(markup, /관망/)
  assert.match(markup, /전략 원천 차단/)
})
