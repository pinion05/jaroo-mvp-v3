import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSnapshotCacheAnnotatedPayload,
  computePriceDriftPct,
  extractSnapshotPriceBasis,
  isSnapshotFresh,
  resolveDeepScanSnapshotKey,
  DEEPSCAN_PRICE_DRIFT_ALERT_PCT,
  DEEPSCAN_SNAPSHOT_TTL_MS,
} from './deepscan-snapshot-policy'

test('resolveDeepScanSnapshotKey — KR 코드 우선, US 티커 대문자 정규화', () => {
  assert.equal(resolveDeepScanSnapshotKey({ code: '005930' }), '005930')
  assert.equal(resolveDeepScanSnapshotKey({ code: ' 005930 ' }), '005930')
  assert.equal(resolveDeepScanSnapshotKey({ ticker: 'aapl' }), 'AAPL')
  assert.equal(resolveDeepScanSnapshotKey({ code: '', ticker: 'NVDA' }), 'NVDA')
  assert.equal(resolveDeepScanSnapshotKey({}), null)
})

test('isSnapshotFresh — TTL 안이면 신선, 지나면 만료, 잘못된 시간은 만료', () => {
  const now = Date.parse('2026-09-04T12:00:00Z')
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString()
  const dayAndHourAgo = new Date(now - DEEPSCAN_SNAPSHOT_TTL_MS - 60 * 60 * 1000).toISOString()

  assert.equal(isSnapshotFresh(hourAgo, now), true)
  assert.equal(isSnapshotFresh(dayAndHourAgo, now), false)
  assert.equal(isSnapshotFresh('not-a-date', now), false)
})

test('extractSnapshotPriceBasis — 전략 블록 현재가 문구에서 숫자 추출', () => {
  assert.equal(extractSnapshotPriceBasis({ strategy: { currentPriceText: '250,500원' } } as never), 250500)
  assert.equal(extractSnapshotPriceBasis({ strategy: { currentPriceText: '$182.40' } } as never), 182.4)
  assert.equal(extractSnapshotPriceBasis({ strategy: { currentPriceText: '가격 정보 없음' } } as never), null)
  assert.equal(extractSnapshotPriceBasis(null), null)
  assert.equal(extractSnapshotPriceBasis({} as never), null)
})

test('computePriceDriftPct — 부호 유지, 기준 불가 시 null', () => {
  assert.equal(computePriceDriftPct(100, 106), 6)
  assert.equal(computePriceDriftPct(100, 94), -6)
  assert.equal(computePriceDriftPct(100, 100), 0)
  assert.equal(computePriceDriftPct(null, 100), null)
  assert.equal(computePriceDriftPct(100, null), null)
  assert.equal(computePriceDriftPct(0, 100), null)
  assert.equal(computePriceDriftPct(100, -5), null)
})

test('드리프트 임계값은 5% — 프로브 배너와 계약 일치', () => {
  assert.equal(DEEPSCAN_PRICE_DRIFT_ALERT_PCT, 5)
  assert.equal(Math.abs(computePriceDriftPct(100, 104.9)!) < DEEPSCAN_PRICE_DRIFT_ALERT_PCT, true)
  assert.equal(Math.abs(computePriceDriftPct(100, 105.1)!) >= DEEPSCAN_PRICE_DRIFT_ALERT_PCT, true)
})

test('buildSnapshotCacheAnnotatedPayload — 히트 표식을 얹되 원본은 오염하지 않는다', () => {
  const original = {
    strategy: { currentPriceText: '250,500원' },
    metadata: { generatedAt: '2026-09-04T00:00:00Z', version: 'test' },
  } as never as Parameters<typeof buildSnapshotCacheAnnotatedPayload>[0]
  const annotated = buildSnapshotCacheAnnotatedPayload(original, { scannedAt: '2026-09-04T09:00:00Z', chargedCredits: 10 })
  const annotatedZero = buildSnapshotCacheAnnotatedPayload(original, { scannedAt: '2026-09-04T09:00:00Z', chargedCredits: 0 })

  assert.deepEqual(annotated.metadata.deepScanCache, { hit: true, scannedAt: '2026-09-04T09:00:00Z', savedCredits: 10 })
  assert.equal(annotatedZero.metadata.deepScanCache?.savedCredits, undefined)
  assert.equal(original.metadata.deepScanCache, undefined) // 원본 불변
  assert.equal(annotated.strategy.currentPriceText, '250,500원') // 나머지 블록 보존
})
