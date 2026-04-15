import test from 'node:test'
import assert from 'node:assert/strict'

import { DEEP_SCAN_BLOCK_STATES, JAROO_DEEP_SCAN_TOP_LEVEL_KEYS, type JarooDeepScanPayload } from '../packages/contracts/src/deepscan.ts'

const samplePayload: JarooDeepScanPayload = {
  input: {
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KOSPI',
      kind: 'stock',
    },
    holding: {
      shares: '10주',
      averagePrice: '70,000원',
      evaluationAmount: '700,000원',
    },
    selectedAt: '2026-04-15T12:00:00.000Z',
    sourceContext: {
      from: 'ocr',
      sessionKey: 'session-1',
      appliedAt: '2026-04-15T12:00:01.000Z',
    },
  },
  hero: {
    headline: '핵심 시그널',
    body: '요약 본문',
    statusText: '관망',
    score: 67,
    scoreLabel: '67점',
    scoreDelta: '+4',
    blockState: 'ok',
    sourceRefs: [{ type: 'holding', id: 'holding-1' }],
    fallback: null,
    error: null,
  },
  committee: {
    axes: [
      {
        label: '실적',
        score: 64,
        scoreText: '64점',
        axisStatusText: '중립',
        subtitle: '최근 분기 기준',
        avgLabel: '평균 64점',
        members: [
          {
            shortLabel: 'A',
            title: '애널리스트',
            reason: '실적 추정 유지',
            score: 64,
            scoreLabel: '64점',
            tone: 'neutral',
            iconTone: 'slate',
          },
        ],
      },
    ],
    blockState: 'ok',
    sourceRefs: [{ type: 'report', id: 'report-1' }],
    fallback: null,
    error: null,
  },
  insights: {
    sectionLabel: '핵심 인사이트',
    items: [
      {
        sourceType: 'news',
        sourceLabel: '뉴스',
        date: '2026-04-15',
        label: '속보',
        title: '핵심 제목',
        body: '핵심 본문',
      },
    ],
    summaryTags: ['실적', '수급'],
    blockState: 'ok',
    sourceRefs: [{ type: 'news', id: 'news-1' }],
    fallback: null,
    error: null,
  },
  strategy: {
    weekSignal: '보유',
    weekSignalTone: 'neutral',
    weekBadgeText: '중립',
    scenarioLabel: '기본 시나리오',
    scenarioProbability: '55%',
    scenarioPeriod: '1주',
    scenarioCondition: '거래량 유지',
    currentPriceText: '70,000원',
    targetPriceText: '73,000원',
    scenarioDetails: ['실적 추정 안정'],
    otherScenarios: [
      {
        label: '상방',
        probability: '25%',
        condition: '수급 개선',
      },
    ],
    otherScenarioTags: ['보수적'],
    blockState: 'ok',
    sourceRefs: [{ type: 'market', id: 'market-1' }],
    fallback: null,
    error: null,
  },
  sellNow: {
    realizedText: '지금 매도 시 수익률 +2%',
    rows: [
      {
        label: '예상 수익',
        value: '+14,000원',
        tag: '기본',
        tagTone: 'neutral',
        valueTone: 'positive',
        emphasis: 'high',
      },
    ],
    blockState: 'ok',
    sourceRefs: [{ type: 'holding', id: 'holding-1' }],
    fallback: null,
    error: null,
  },
  portfolioSimulation: {
    beforeScore: 61,
    afterScore: 66,
    deltaLabel: '+5',
    caption: '집중도 완화',
    blockState: 'ok',
    sourceRefs: [{ type: 'system', id: 'simulation-1' }],
    fallback: null,
    error: null,
  },
  metadata: {
    generatedAt: '2026-04-15T12:00:05.000Z',
    version: '2026-04-15',
    degraded: false,
    debugId: 'debug-1',
    inputValidity: {
      valid: true,
      raw: {
        instrument: '삼성전자',
      },
    },
    sourceRefs: [{ type: 'system', id: 'meta-1' }],
    blockStatus: {
      hero: 'ok',
      committee: 'ok',
      insights: 'ok',
      strategy: 'ok',
      sellNow: 'ok',
      portfolioSimulation: 'ok',
    },
  },
}

test('JarooDeepScanPayload exposes canonical top-level blocks', () => {
  assert.deepEqual(JAROO_DEEP_SCAN_TOP_LEVEL_KEYS, [
    'input',
    'hero',
    'committee',
    'insights',
    'strategy',
    'sellNow',
    'portfolioSimulation',
    'metadata',
  ])

  assert.deepEqual(Object.keys(samplePayload), JAROO_DEEP_SCAN_TOP_LEVEL_KEYS)
})

test('major blocks share common meta fields and metadata keeps structured input validity', () => {
  assert.deepEqual(DEEP_SCAN_BLOCK_STATES, ['ok', 'error', 'blocked'])

  for (const blockKey of ['hero', 'committee', 'insights', 'strategy', 'sellNow', 'portfolioSimulation'] as const) {
    const block = samplePayload[blockKey]
    assert.ok(DEEP_SCAN_BLOCK_STATES.includes(block.blockState))
    assert.ok(Array.isArray(block.sourceRefs))
    assert.equal('fallback' in block, true)
    assert.equal('error' in block, true)
  }

  assert.deepEqual(Object.keys(samplePayload.metadata.inputValidity).sort(), ['raw', 'valid'])
})
