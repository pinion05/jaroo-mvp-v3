// 분석 기록 탭 병합 모델 — 두 원장(deepscan·etf)의 타임라인 정규화 계약.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { etfMarketLabel, mergeAnalysisHistory } from './analysis-history'

const stockRow = (id: string, scannedAt: string, overrides = {}) => ({
  id,
  targetKey: '005930',
  market: 'kospi',
  stockName: '삼성전자',
  targetInput: { instrument: { code: '005930' } },
  scannedAt,
  ...overrides,
})

const etfRow = (id: string, scannedAt: string, overrides = {}) => ({
  id,
  targetKey: '069500',
  market: 'kospi',
  stockName: 'KODEX 200',
  targetInput: { code: '069500' },
  scannedAt,
  ...overrides,
})

test('mergeAnalysisHistory — scannedAt 내림차순으로 두 원장을 섞는다', () => {
  const merged = mergeAnalysisHistory(
    [stockRow('s1', '2026-09-15T01:00:00.000Z'), stockRow('s2', '2026-09-14T01:00:00.000Z')],
    [etfRow('e1', '2026-09-15T03:00:00.000Z'), etfRow('e2', '2026-09-13T01:00:00.000Z')],
  )
  assert.deepEqual(
    merged.map((row) => row.id),
    ['e1', 's1', 's2', 'e2'],
  )
})

test('mergeAnalysisHistory — kind·etfCode 정규화(주식은 etfCode null, ETF는 targetKey)', () => {
  const [etf, stock] = mergeAnalysisHistory([stockRow('s1', '2026-09-15T01:00:00.000Z')], [
    etfRow('e1', '2026-09-15T02:00:00.000Z'),
  ])
  assert.equal(stock.kind, 'stock')
  assert.equal(stock.etfCode, null)
  assert.equal(etf.kind, 'etf')
  assert.equal(etf.etfCode, '069500')
})

test('mergeAnalysisHistory — 빈 원장 조합도 안전하다', () => {
  assert.deepEqual(mergeAnalysisHistory([], []), [])
  assert.equal(mergeAnalysisHistory([], [etfRow('e1', '2026-09-15T01:00:00.000Z')]).length, 1)
})

test('etfMarketLabel — kospi/kosdaq을 한국어 라벨로, 없으면 대시', () => {
  assert.equal(etfMarketLabel('kospi'), '코스피')
  assert.equal(etfMarketLabel('kosdaq'), '코스닥')
  assert.equal(etfMarketLabel(null), '—')
})

test('etfMarketLabel — 미국 ETF 행은 "미국" 라벨', () => {
  assert.equal(etfMarketLabel('us'), '미국')
})
