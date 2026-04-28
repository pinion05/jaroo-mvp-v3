import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEEP_SCAN_BLOCK_STATES,
  JAROO_DEEP_SCAN_TOP_LEVEL_KEYS,
  type DeepScanSourceType,
  type JarooDeepScanCommitteeMember,
  type JarooDeepScanInputInstrument,
  type JarooDeepScanInputSourceContext,
  type JarooDeepScanInputValidity,
  type JarooDeepScanPayload as BarrelJarooDeepScanPayload,
  type JarooDeepScanSellNowRow,
  type JarooInstrumentKind,
} from '../packages/contracts/src/index'
import {
  DEEP_SCAN_BLOCK_STATES as directDeepScanBlockStates,
  JAROO_DEEP_SCAN_TOP_LEVEL_KEYS as directTopLevelKeys,
} from '../packages/contracts/src/deepscan'

type Assert<T extends true> = T

type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false

type ExpectedInputValidity =
  | {
      valid: true
      raw?: unknown
      reason?: never
      missing?: never
    }
  | {
      valid: false
      reason: string
      missing?: string[]
      raw?: unknown
    }

type _BarrelPayloadMatchesDirect = Assert<
  IsExact<BarrelJarooDeepScanPayload, import('../packages/contracts/src/deepscan').JarooDeepScanPayload>
>
type _InputInstrumentKindUsesSharedType = Assert<
  IsExact<JarooDeepScanInputInstrument['kind'], JarooInstrumentKind | undefined>
>
type _InputSourceContextFromUsesSourceDomain = Assert<
  IsExact<JarooDeepScanInputSourceContext['from'], DeepScanSourceType>
>
type _CommitteeMemberToneIsFinite = Assert<
  IsExact<JarooDeepScanCommitteeMember['tone'], 'positive' | 'neutral' | 'warning'>
>
type _CommitteeMemberIconToneIsFinite = Assert<
  IsExact<JarooDeepScanCommitteeMember['iconTone'], 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal'>
>
type _SellNowRowTagToneIsFinite = Assert<
  IsExact<JarooDeepScanSellNowRow['tagTone'], 'positive' | 'danger' | undefined>
>
type _SellNowRowValueToneIsFinite = Assert<
  IsExact<JarooDeepScanSellNowRow['valueTone'], 'danger' | undefined>
>
type _SellNowRowEmphasisIsBoolean = Assert<IsExact<JarooDeepScanSellNowRow['emphasis'], boolean | undefined>>

type _InputValidityAvoidsContradictoryStates = Assert<IsExact<JarooDeepScanInputValidity, ExpectedInputValidity>>

const EXPECTED_TOP_LEVEL_KEYS = [
  'input',
  'hero',
  'committee',
  'insights',
  'strategy',
  'sellNow',
  'portfolioSimulation',
  'recoveryForecast',
  'metadata',
] as const

const CONTENT_BLOCK_KEYS = ['hero', 'committee', 'insights', 'strategy', 'sellNow', 'portfolioSimulation', 'recoveryForecast'] as const

const samplePayload: BarrelJarooDeepScanPayload = {
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
            status: 'success',
            reason: '실적 추정 유지',
            score: 64,
            scoreLabel: '64점',
            tone: 'neutral',
            iconTone: 'blue',
            confidence: 'medium',
            error: null,
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
    weekSignalTone: 'text-[color:var(--jaroo-warning)]',
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
        label: '종목 코드',
        value: '005930',
        tag: '확인',
        tagTone: 'positive',
        emphasis: true,
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
  recoveryForecast: {
    blockState: 'ok',
    sourceRefs: [],
    fallback: null,
    error: null,
    status: 'low_confidence',
    expectedRecoveryDays: 58,
    expectedRecoveryPeriodLabel: '약 3개월',
    probabilityWithinOneYear: 61.1,
    confidence: 'medium',
    confidenceLabel: '보통',
    divergenceRatio: 0.42,
    disclaimer: '데이터 분석 기반 참고 정보이며 투자 권유나 수익 보장이 아닙니다.',
    models: [
      { id: 'similarPattern', label: '유사 패턴 통계', weight: 0.4, status: 'ok', medianDays: 96, p25Days: 70, p75Days: 120, probabilityWithinOneYear: 60.3, sampleCount: 12 },
      { id: 'gbm', label: 'GBM', weight: 0.3, status: 'ok', medianDays: 57, p25Days: 40, p75Days: 90, probabilityWithinOneYear: 58.2, sampleCount: 5000 },
      { id: 'jumpDiffusion', label: 'Jump-Diffusion', weight: 0.3, status: 'ok', medianDays: 60, p25Days: 42, p75Days: 95, probabilityWithinOneYear: 63.9, sampleCount: 5000 },
    ],
    dataQuality: {
      sampleCount: 120,
      historyDays: 121,
      similarPatternSamples: 12,
      missingInputs: [],
      notes: ['test recovery forecast'],
    },
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
      recoveryForecast: 'ok',
    },
  },
}

test('deepscan barrel re-exports canonical constants', () => {
  assert.equal(DEEP_SCAN_BLOCK_STATES, directDeepScanBlockStates)
  assert.equal(JAROO_DEEP_SCAN_TOP_LEVEL_KEYS, directTopLevelKeys)
})

test('JarooDeepScanPayload exposes canonical top-level blocks', () => {
  assert.deepEqual(JAROO_DEEP_SCAN_TOP_LEVEL_KEYS, EXPECTED_TOP_LEVEL_KEYS)
  assert.deepEqual(Object.keys(samplePayload), JAROO_DEEP_SCAN_TOP_LEVEL_KEYS)
})

test('major blocks share common meta fields and metadata keeps structured input validity', () => {
  assert.deepEqual(DEEP_SCAN_BLOCK_STATES, ['ok', 'error', 'blocked'])

  for (const blockKey of CONTENT_BLOCK_KEYS) {
    const block = samplePayload[blockKey]
    assert.ok(DEEP_SCAN_BLOCK_STATES.includes(block.blockState))
    assert.ok(Array.isArray(block.sourceRefs))
    assert.equal('fallback' in block, true)
    assert.equal('error' in block, true)
  }

  assert.deepEqual(Object.keys(samplePayload.metadata.inputValidity).sort(), ['raw', 'valid'])
})
