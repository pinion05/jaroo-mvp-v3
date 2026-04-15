import test from 'node:test'
import assert from 'node:assert/strict'

import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

import {
  buildDeepScanCanonicalQuery,
  fetchDeepScanCanonicalPayload,
  isDeepScanPayloadReady,
  readBlockedReason,
} from './deepscan-canonical'

type DeepScanCanonicalTargetSession = Parameters<typeof buildDeepScanCanonicalQuery>[0]

function createTargetSession(overrides: Partial<DeepScanCanonicalTargetSession> = {}): DeepScanCanonicalTargetSession {
  return {
    holding: {
      name: '삼성전자',
      market: 'KOSPI',
      marketTone: 'kospi',
      code: '005930',
      identifierCode: 'KR7005930003',
      ticker: '005930.KS',
      identifierTicker: '005930-legacy',
      shares: '10주',
      averagePrice: '70,000원',
      evaluationAmount: '750,000원',
      ...overrides.holding,
    },
    selectedAt: '2026-04-15T15:00:00.000Z',
    ...overrides,
  }
}

function createCanonicalPayload(overrides: Partial<JarooDeepScanPayload> = {}): JarooDeepScanPayload {
  const payload: JarooDeepScanPayload = {
    input: {
      instrument: {
        name: '삼성전자',
        code: '005930',
        ticker: '005930.KS',
        market: 'KR',
        kind: 'stock',
      },
      holding: {
        shares: '10주',
        averagePrice: '70,000원',
        evaluationAmount: '750,000원',
      },
      selectedAt: '2026-04-15T15:00:00.000Z',
      sourceContext: {
        from: 'holding',
        sessionKey: 'session-1',
        appliedAt: '2026-04-15T15:00:00.000Z',
      },
    },
    hero: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      headline: 'headline',
      body: 'body',
      statusText: 'status',
      score: 7,
      scoreLabel: '7점',
      scoreDelta: '+1',
    },
    committee: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      axes: [],
    },
    insights: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      sectionLabel: 'insights',
      items: [],
      summaryTags: [],
    },
    strategy: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      weekSignal: 'signal',
      weekSignalTone: 'positive',
      weekBadgeText: 'badge',
      scenarioLabel: 'scenario',
      scenarioProbability: '60%',
      scenarioPeriod: '약 3개월',
      scenarioCondition: 'condition',
      currentPriceText: '80,000원',
      targetPriceText: '90,000원',
      scenarioDetails: [],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      realizedText: 'realized',
      rows: [],
    },
    portfolioSimulation: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      beforeScore: 42,
      afterScore: 45,
      deltaLabel: '+3p',
      caption: 'caption',
    },
    metadata: {
      generatedAt: '2026-04-15T15:00:00.000Z',
      version: 'test-v1',
      degraded: false,
      debugId: 'debug-1',
      inputValidity: { valid: true },
      sourceRefs: [],
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

  return {
    ...payload,
    ...overrides,
    metadata: {
      ...payload.metadata,
      ...overrides.metadata,
      blockStatus: {
        ...payload.metadata.blockStatus,
        ...overrides.metadata?.blockStatus,
      },
    },
  }
}

test('buildDeepScanCanonicalQuery는 canonical proxy whitelist 순서대로 query를 만든다', () => {
  const query = buildDeepScanCanonicalQuery(createTargetSession())

  assert.equal(
    query.toString(),
    'code=005930&ticker=005930.KS&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90&shares=10%EC%A3%BC&averagePrice=70%2C000%EC%9B%90&evaluationAmount=750%2C000%EC%9B%90&selectedAt=2026-04-15T15%3A00%3A00.000Z&from=home-handoff',
  )
})

test('buildDeepScanCanonicalQuery는 identifier fallback을 지원한다', () => {
  const query = buildDeepScanCanonicalQuery(createTargetSession({
    holding: {
      name: 'Apple',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      code: ' ',
      identifierCode: undefined,
      ticker: ' ',
      identifierTicker: 'AAPL',
      shares: '-',
      averagePrice: '',
      evaluationAmount: undefined,
    },
    selectedAt: undefined,
  }))

  assert.equal(query.toString(), 'ticker=AAPL&name=Apple&shares=-&from=home-handoff')
})

test('fetchDeepScanCanonicalPayload는 canonical body를 그대로 파싱해 반환한다', async () => {
  const payload = createCanonicalPayload()
  let calledUrl = ''
  let calledInit: RequestInit | undefined

  const fetched = await fetchDeepScanCanonicalPayload(createTargetSession(), async (input, init) => {
    calledUrl = String(input)
    calledInit = init
    return new Response(JSON.stringify(payload), {
      status: 422,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  })

  assert.equal(calledUrl, '/api/deepscan?code=005930&ticker=005930.KS&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90&shares=10%EC%A3%BC&averagePrice=70%2C000%EC%9B%90&evaluationAmount=750%2C000%EC%9B%90&selectedAt=2026-04-15T15%3A00%3A00.000Z&from=home-handoff')
  assert.deepEqual(calledInit, { cache: 'no-store' })
  assert.deepEqual(fetched, payload)
})

test('fetchDeepScanCanonicalPayload는 local proxy failure JSON을 canonical payload와 구분한다', async () => {
  const fetched = await fetchDeepScanCanonicalPayload(createTargetSession(), async () => new Response(JSON.stringify({
    ok: false,
    data: null,
    count: 0,
    error: {
      message: 'network down',
    },
  }), { status: 400 }))

  assert.equal(fetched, null)
})

test('isDeepScanPayloadReady는 meta 모양만 맞춘 불완전 payload를 거부한다', () => {
  const malformedPayload = {
    input: {
      instrument: {
        name: '삼성전자',
      },
    },
    hero: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
    },
    committee: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
    },
    insights: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
    },
    strategy: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
    },
    sellNow: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
    },
    portfolioSimulation: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
    },
    metadata: {
      generatedAt: '2026-04-15T15:00:00.000Z',
      version: 'test-v1',
      degraded: false,
      debugId: 'debug-1',
      inputValidity: { valid: true },
      sourceRefs: [],
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

  assert.equal(isDeepScanPayloadReady(malformedPayload), false)
})

test('isDeepScanPayloadReady는 blocked canonical payload도 render 가능한 payload로 인정한다', () => {
  const blockedPayload = createCanonicalPayload({
    hero: {
      blockState: 'blocked',
      sourceRefs: [],
      fallback: { used: true, reason: 'input-invalid', label: 'instrument code or ticker required' },
      error: { code: 'input-invalid', message: 'instrument code or ticker is required', retryable: false },
      headline: '입력 정보를 확인해주세요',
      body: 'DeepScan canonical payload를 만들려면 종목 코드 또는 티커가 필요합니다.',
      statusText: '입력 부족',
      score: 0,
      scoreLabel: 'N/A',
      scoreDelta: '0',
    },
    metadata: {
      errorCode: 'input-invalid',
      degraded: true,
      inputValidity: { valid: false, reason: 'instrument code or ticker is required', missing: ['instrument.code', 'instrument.ticker'] },
      blockStatus: {
        hero: 'blocked',
      },
    },
  })

  assert.equal(isDeepScanPayloadReady(blockedPayload), true)
  assert.equal(readBlockedReason(blockedPayload), 'input-invalid')
  assert.equal(isDeepScanPayloadReady({ ok: false, error: { message: 'network down' } }), false)
})
