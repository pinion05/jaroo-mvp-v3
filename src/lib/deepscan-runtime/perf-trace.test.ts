import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'
import {
  collectDeepScanPayloadFieldStates,
  collectDeepScanQuickQuoteFieldStates,
  recordDeepScanCommitteeProgressPerf,
  recordDeepScanPayloadPerf,
  recordDeepScanQuickQuotePerf,
  resetDeepScanPerfTraceForTests,
  summarizeDeepScanPerfEvents,
} from './perf-trace'

function createPayload(overrides: Partial<JarooDeepScanPayload> = {}): JarooDeepScanPayload {
  const payload: JarooDeepScanPayload = {
    input: {
      instrument: {
        name: '한미반도체',
        code: '042700',
        ticker: '042700.KS',
        market: 'KR',
        kind: 'stock',
      },
      sourceContext: { from: 'holding' },
    },
    hero: {
      blockState: 'ok', sourceRefs: [], fallback: null, error: null,
      headline: '한미반도체 DeepScan 70점', body: 'body', statusText: '우세', score: 70, scoreLabel: '70점', scoreDelta: '+1',
    },
    committee: {
      blockState: 'ok', sourceRefs: [], fallback: null, error: null,
      axes: [{
        label: 'valuation', score: 70, scoreText: '70점', axisStatusText: 'ok', subtitle: 'sub', avgLabel: 'avg',
        members: [
          { shortLabel: 'valuation', title: '밸류', status: 'success', reason: 'ok', score: 70, scoreLabel: '70', tone: 'positive', iconTone: 'blue', confidence: 'medium' },
          { shortLabel: 'quality', title: '품질', status: 'pending', reason: null, score: null, scoreLabel: '대기', tone: 'neutral', iconTone: 'amber' },
        ],
      }],
    },
    insights: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, sectionLabel: '체크', items: [], summaryTags: [] },
    strategy: {
      blockState: 'ok', sourceRefs: [], fallback: null, error: null,
      weekSignal: '보유 유지', weekSignalTone: 'positive', weekBadgeText: '위원회 70점',
      scenarioLabel: '기본', scenarioProbability: '70%', scenarioPeriod: '약 3개월', scenarioCondition: '조건',
      currentPriceText: '120,000원', targetPriceText: '투자의견 데이타가 존재하지 않습니다.', scenarioDetails: ['detail'], otherScenarios: [], otherScenarioTags: [],
    },
    sellNow: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, realizedText: '없음', rows: [] },
    portfolioSimulation: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, beforeScore: 70, afterScore: 76, deltaLabel: '+6p', caption: 'caption' },
    metadata: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      version: 'test',
      degraded: false,
      debugId: 'deepscan:KR:042700',
      inputValidity: { valid: true },
      sourceRefs: [],
      blockStatus: { hero: 'ok', committee: 'ok', insights: 'ok', strategy: 'ok', sellNow: 'ok', portfolioSimulation: 'ok' },
      llmCommittee: { requestId: 'job-1', status: 'partial', completed: 1, pending: 1, errors: 0, softDeadlineMs: 25000 },
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

async function withPerfDir(run: (dir: string) => Promise<void>) {
  const originalDir = process.env.JAROO_DEEPSCAN_PERF_LOG_DIR
  const dir = await mkdtemp(join(tmpdir(), 'jaroo-perf-trace-test-'))
  process.env.JAROO_DEEPSCAN_PERF_LOG_DIR = dir
  resetDeepScanPerfTraceForTests()

  try {
    await run(dir)
  } finally {
    resetDeepScanPerfTraceForTests()
    if (originalDir === undefined) {
      delete process.env.JAROO_DEEPSCAN_PERF_LOG_DIR
    } else {
      process.env.JAROO_DEEPSCAN_PERF_LOG_DIR = originalDir
    }
    await rm(dir, { recursive: true, force: true })
  }
}

test('collectDeepScanPayloadFieldStates는 목표가 제공 없음과 대기/성공 상태를 구분한다', () => {
  const states = collectDeepScanPayloadFieldStates(createPayload())

  assert.deepEqual(states.find((state) => state.component === 'strategy' && state.field === 'targetPriceText'), {
    component: 'strategy',
    field: 'targetPriceText',
    status: 'confirmed_missing',
  })
  assert.equal(states.find((state) => state.field === 'member.valuation')?.status, 'ready')
  assert.equal(states.find((state) => state.field === 'member.quality')?.status, 'pending')
  assert.equal(states.find((state) => state.component === 'loadingQuickFacts' && state.field === 'analystConsensus')?.status, 'confirmed_missing')
  assert.equal(states.find((state) => state.component === 'loadingQuickFacts' && state.field === 'performanceComment')?.status, 'confirmed_missing')
})

test('collectDeepScanQuickQuoteFieldStates는 빠른 시장 체크 가격 위치 입력을 판정한다', () => {
  const states = collectDeepScanQuickQuoteFieldStates({
    ok: true,
    data: {
      items: [{
        code: '005930',
        name: '삼성전자',
        source: 'naver-finance',
        price: 264500,
        volume: 30970457,
        week52High: 299500,
        week52Low: 53500,
        currency: 'KRW',
      }],
    },
  })

  assert.equal(states.find((state) => state.field === 'quote.currentPrice')?.status, 'ready')
  assert.equal(states.find((state) => state.field === 'quote.tradingVolume')?.status, 'ready')
  assert.equal(states.find((state) => state.field === 'week52Position')?.status, 'ready')
})

test('recordDeepScanPayloadPerf는 필드 상태 전이를 JSONL로 중복 없이 기록하고 요약한다', async () => {
  await withPerfDir(async (dir) => {
    const payload = createPayload()
    const firstEvents = await recordDeepScanPayloadPerf(payload, {
      now: new Date('2026-05-20T00:00:02.000Z'),
      startedAt: new Date('2026-05-20T00:00:00.000Z'),
      route: 'test',
    })
    const duplicateEvents = await recordDeepScanPayloadPerf(payload, { now: new Date('2026-05-20T00:00:05.000Z'), route: 'test' })

    assert.ok(firstEvents.some((event) => event.field === 'targetPriceText' && event.status === 'confirmed_missing'))
    assert.equal(firstEvents.find((event) => event.field === 'targetPriceText')?.elapsedMs, 2000)
    assert.equal(duplicateEvents.length, 0)

    const log = await readFile(join(dir, '2026-05-20.jsonl'), 'utf8')
    assert.match(log, /"requestId":"job-1"/)
    assert.match(log, /"field":"targetPriceText"/)

    const summary = await summarizeDeepScanPerfEvents({ limit: 1000 })
    assert.equal(summary.ok, true)
    assert.ok(summary.rankedTerminalFields.some((field) => field.component === 'strategy' && field.field === 'targetPriceText' && field.status === 'confirmed_missing'))
  })
})

test('recordDeepScanPayloadPerf는 위원회 requestId가 없으면 관측별 payload requestId로 분리 기록한다', async () => {
  await withPerfDir(async (dir) => {
    const payload = createPayload()
    payload.metadata.llmCommittee = undefined
    const firstEvents = await recordDeepScanPayloadPerf(payload, {
      now: new Date('2026-05-20T00:00:02.000Z'),
      startedAt: new Date('2026-05-20T00:00:00.000Z'),
      route: 'test',
    })
    const secondEvents = await recordDeepScanPayloadPerf(payload, {
      now: new Date('2026-05-20T00:00:05.000Z'),
      startedAt: new Date('2026-05-20T00:00:00.000Z'),
      route: 'test',
    })

    assert.ok(firstEvents.length > 0)
    assert.ok(secondEvents.length > 0)
    assert.notEqual(firstEvents[0]?.requestId, secondEvents[0]?.requestId)
    assert.equal(firstEvents[0]?.requestId, 'payload:deepscan:KR:042700:1779235202000')
    assert.equal(secondEvents[0]?.requestId, 'payload:deepscan:KR:042700:1779235205000')

    const log = await readFile(join(dir, '2026-05-20.jsonl'), 'utf8')
    assert.match(log, /"requestId":"payload:deepscan:KR:042700:1779235202000"/)
    assert.match(log, /"requestId":"payload:deepscan:KR:042700:1779235205000"/)
  })
})

test('recordDeepScanCommitteeProgressPerf는 polling마다 완료된 위원 member 시간을 분리 기록한다', async () => {
  await withPerfDir(async () => {
    await recordDeepScanCommitteeProgressPerf({
      requestId: 'job-2', status: 'partial', results: {}, pending: ['valuation', 'quality'], errors: [], completed: 0,
    }, { now: new Date('2026-05-20T00:00:00.000Z'), route: 'test-poll' })

    const events = await recordDeepScanCommitteeProgressPerf({
      requestId: 'job-2', status: 'partial', results: { valuation: { score: 72, confidence: 'medium' } }, pending: ['quality'], errors: [], completed: 1,
    }, { now: new Date('2026-05-20T00:00:03.000Z'), route: 'test-poll' })

    const valuation = events.find((event) => event.field === 'member.valuation' && event.status === 'ready')
    assert.equal(valuation?.elapsedMs, 3000)

    const summary = await summarizeDeepScanPerfEvents({ status: 'ready' })
    const memberSummary = summary.fields.find((field) => field.component === 'committee' && field.field === 'member.valuation')
    assert.equal(memberSummary?.p50Ms, 3000)
  })
})

test('recordDeepScanQuickQuotePerf는 빠른 시장 체크 quote readiness를 기록한다', async () => {
  await withPerfDir(async () => {
    const events = await recordDeepScanQuickQuotePerf({
      ok: true,
      data: {
        items: [{
          code: '005930',
          name: '삼성전자',
          source: 'naver-finance',
          price: 264500,
          volume: 30970457,
          week52High: 299500,
          week52Low: 53500,
          currency: 'KRW',
        }],
      },
    }, {
      now: new Date('2026-05-20T00:00:00.120Z'),
      startedAt: new Date('2026-05-20T00:00:00.000Z'),
      route: 'test-quote',
    })

    assert.equal(events.find((event) => event.field === 'week52Position')?.elapsedMs, 120)

    const summary = await summarizeDeepScanPerfEvents({ status: 'ready' })
    const week52Summary = summary.fields.find((field) => field.component === 'loadingQuickFacts' && field.field === 'week52Position')
    assert.equal(week52Summary?.p50Ms, 120)
  })
})
