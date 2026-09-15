// etf-history-store 순수 함수 계약 — DB IO(createClient 경로)는 서비스 롤
// 통합이라 여기서 다루지 않는다(deepscan-history-store와 같은 분리).
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isEtfLedgerPayload,
  resolveEtfPriceBasis,
  type EtfHistoryDetailRow,
} from './etf-history-store'
import type { EtfProfileJson } from './etf/etf-view-model'

const validProfile: EtfProfileJson = {
  schemaVersion: 'jaroo-etf-profile-v1',
  code: '069500',
  name: 'KODEX 200',
  market: 'kospi',
  ok: true,
  quote: { changePct: 0.82 },
  product: {
    issuerName: '삼성자산운용',
    baseIndexName: 'KOSPI 200',
    totalFeePct: 0.0146,
    firstSettleDate: '2015-08-12',
    aum: 4_800_000_000_000,
    nav: 41_050,
    deviationPct: 0.02,
  },
  returns: { m1: 1.2, m3: 3.4, m6: 6.7, y1: 12.3 },
  holdings: [{ rank: 1, code: '005930', name: '삼성전자', weightPct: 32.63, changePct: 1.1 }],
  daily: [
    { date: '2026-09-11', close: 40_900 },
    { date: '2026-09-12', close: 41_050 },
    { date: '2026-09-15', close: 41_380 },
  ],
}

test('isEtfLedgerPayload — jaroo-etf-profile-v1 계약을 통과한다', () => {
  assert.equal(isEtfLedgerPayload(validProfile), true)
})

test('isEtfLedgerPayload — 딥스캔 canonical payload를 거부한다(스키마 분리 가드)', () => {
  const deepscanPayload = { schemaVersion: 'jaroo-deepscan-v3', committee: [], consensus: {} }
  assert.equal(isEtfLedgerPayload(deepscanPayload), false)
})

test('isEtfLedgerPayload — ok=false·빈 코드·비ETF 시장을 거부한다', () => {
  assert.equal(isEtfLedgerPayload({ ...validProfile, ok: false }), false)
  assert.equal(isEtfLedgerPayload({ ...validProfile, code: '' }), false)
  assert.equal(isEtfLedgerPayload({ ...validProfile, market: 'nasdaq' }), false)
  assert.equal(isEtfLedgerPayload(null), false)
  assert.equal(isEtfLedgerPayload('jaroo-etf-profile-v1'), false)
})

test('resolveEtfPriceBasis — 마지막 일봉 종가를 기준가로 내린다', () => {
  assert.equal(resolveEtfPriceBasis(validProfile), 41_380)
})

test('resolveEtfPriceBasis — 일봉이 없거나 비정상이면 null', () => {
  assert.equal(resolveEtfPriceBasis({ ...validProfile, daily: null }), null)
  assert.equal(resolveEtfPriceBasis({ ...validProfile, daily: [] }), null)
  assert.equal(
    resolveEtfPriceBasis({ ...validProfile, daily: [{ date: '2026-09-15', close: Number.NaN }] }),
    null,
  )
})

test('EtfHistoryDetailRow — 원장 상세 계약이 payload를 EtfProfileJson으로 타입 좁힌다', () => {
  // 컴파일 타임 계약 확인 — payload가 뷰모델 입력으로 바로 쓰임을 보증한다.
  const row: EtfHistoryDetailRow = {
    id: '0d7f1c2a-3b4e-4f5a-8b6c-7d8e9f0a1b2c',
    targetKey: '069500',
    market: 'kospi',
    stockName: 'KODEX 200',
    targetInput: { code: '069500' },
    payload: validProfile,
    priceBasis: 41_380,
    chargedCredits: 0,
    scannedAt: '2026-09-15T09:30:00.000Z',
  }
  assert.equal(row.payload.schemaVersion, 'jaroo-etf-profile-v1')
})
