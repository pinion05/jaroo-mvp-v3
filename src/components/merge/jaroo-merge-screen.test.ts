import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MergeResultRowCard } from './jaroo-merge-screen'
import {
  buildAppliedHomePortfolioRowsFromConfirmedHoldings,
  buildMergeRowsFromReviewRows,
  deriveAveragePriceFromCurrentPrice,
  fillMissingAveragePricesFromQuotes,
  markMissingAveragePriceErrors,
} from '@/lib/ocr-portfolio-apply'
import type { OcrReviewRow } from '@/lib/workflow-types'

function createReviewRow(overrides: Partial<OcrReviewRow> = {}): OcrReviewRow {
  return {
    id: overrides.id ?? 'review-1',
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-23.4%',
    evaluationAmount: '766,000원',
    averagePrice: ' ',
    resolvedName: '삼성전자',
    resolvedCode: '005930',
    resolvedTicker: '005930.KS',
    resolvedMarket: 'KOSPI',
    resolvedMarketTone: 'kospi',
    resolvedKind: 'stock',
    resolutionState: 'resolved',
    selectedCandidateId: 'candidate-1',
    sourceFileName: 'holding-1.png',
    ...overrides,
  }
}

test('deriveAveragePriceFromCurrentPrice는 현재가와 수익률로 평단을 역산한다', () => {
  assert.equal(deriveAveragePriceFromCurrentPrice(76600, -23.4), 76600 / 0.766)
  assert.equal(deriveAveragePriceFromCurrentPrice(150.2, 20), 150.2 / 1.2)
  assert.equal(deriveAveragePriceFromCurrentPrice(100, 0), 100)
  // rate이 없으면 현재가를 평단으로 쓰고, −100%(원금 전멸)이거나 가격이 유효하지 않으면 거절한다
  assert.equal(deriveAveragePriceFromCurrentPrice(100), 100)
  assert.equal(deriveAveragePriceFromCurrentPrice(100, -100), null)
  assert.equal(deriveAveragePriceFromCurrentPrice(0, 10), null)
  assert.equal(deriveAveragePriceFromCurrentPrice(-5, 10), null)
})

test('fillMissingAveragePricesFromQuotes은 평단 미보유 행에 현재가 역산값을 채운다', async () => {
  const fetcher = (async () => new Response(
    JSON.stringify({ data: { items: [{ market: 'KR', code: '005930', price: 76600, status: 'ok' }] } }),
    { status: 200 },
  )) as unknown as typeof fetch

  const [filled] = await fillMissingAveragePricesFromQuotes([
    createReviewRow({ averagePrice: '' }),
  ], fetcher)

  assert.equal(filled?.averagePrice, '100,000')
})

test('fillMissingAveragePricesFromQuotes은 시세 조회 실패 시 행을 그대로 둔다', async () => {
  const fetcher = (async () => new Response('{"error":"boom"}', { status: 500 })) as unknown as typeof fetch

  const [unchanged] = await fillMissingAveragePricesFromQuotes([
    createReviewRow({ averagePrice: '' }),
  ], fetcher)

  assert.equal(unchanged?.averagePrice, '')
})

test('fillMissingAveragePricesFromQuotes은 이미 평단이 있으면 조회하지 않는다', async () => {
  let fetched = false
  const fetcher = (async () => {
    fetched = true
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

  const [unchanged] = await fillMissingAveragePricesFromQuotes([
    createReviewRow({ averagePrice: '88,000원' }),
  ], fetcher)

  assert.equal(fetched, false)
  assert.equal(unchanged?.averagePrice, '88,000원')
})

test('markMissingAveragePriceErrors는 보강되지 못한 행만 제외 표시한다', () => {
  const [readyRow, errorRow] = markMissingAveragePriceErrors([
    { ...createMergeReadyRow(), averagePriceText: '100,000' },
    { ...createMergeReadyRow(), averagePriceText: '' },
  ])

  assert.equal(readyRow?.status, 'ready')
  assert.equal(errorRow?.status, 'error')
  assert.equal(errorRow?.errorCode, 'merge-average-price-missing')
})

function createMergeReadyRow() {
  return buildMergeRowsFromReviewRows([createReviewRow({ averagePrice: '88,000원' })])[0]!
}

test('buildMergeRowsFromReviewRows는 정규화할 수 없는 행을 error row로 남긴다', () => {
  const [errorRow] = buildMergeRowsFromReviewRows([
    createReviewRow({
      averagePrice: '',
      quantity: '',
      evaluationAmount: '',
      profitRate: '',
    }),
  ])

  assert.equal(errorRow?.status, 'error')
  assert.equal(errorRow?.errorCode, 'merge-normalization-failed')
})

test('buildAppliedHomePortfolioRowsFromConfirmedHoldings는 홈 호환 payload로 변환한다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([createReviewRow()])
  const [appliedRow] = buildAppliedHomePortfolioRowsFromConfirmedHoldings([mergeRow])

  assert.equal(appliedRow?.name, '삼성전자')
  assert.equal(appliedRow?.resolvedCode, '005930')
  assert.equal(appliedRow?.resolvedTicker, '005930.KS')
  assert.equal(appliedRow?.averagePriceCurrency, 'KRW')
})

test('buildAppliedHomePortfolioRowsFromConfirmedHoldings는 원화 평가금액에서 계산한 미국 종목 평단을 KRW로 보존한다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([
    createReviewRow({
      name: '바이두(ADR)',
      quantity: '22.729086주',
      profitRate: '+30.2%',
      evaluationAmount: '4,564,930원',
      averagePrice: '154,255.6806',
      resolvedName: 'Baidu, Inc.',
      resolvedTicker: 'BIDU',
      resolvedCode: undefined,
      resolvedMarket: 'US',
      resolvedMarketTone: 'nasdaq',
      resolvedKind: 'stock',
    }),
  ])
  const [appliedRow] = buildAppliedHomePortfolioRowsFromConfirmedHoldings([mergeRow])

  assert.equal(mergeRow?.averagePriceCurrency, 'KRW')
  assert.equal(appliedRow?.averagePriceCurrency, 'KRW')
  assert.equal(appliedRow?.averagePrice, '154,255.6806')
  assert.equal(appliedRow?.evaluationAmount, '4,564,930원')
})

test('buildAppliedHomePortfolioRowsFromConfirmedHoldings는 미국 종목의 명시되지 않은 달러 평단을 원화 평가금액만으로 KRW 처리하지 않는다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([
    createReviewRow({
      name: '테슬라',
      quantity: '10주',
      profitRate: '+20.0%',
      evaluationAmount: '4,200,000원',
      averagePrice: '300.50',
      resolvedName: 'Tesla, Inc.',
      resolvedTicker: 'TSLA',
      resolvedCode: undefined,
      resolvedMarket: 'US',
      resolvedMarketTone: 'nasdaq',
      resolvedKind: 'stock',
    }),
  ])
  const [appliedRow] = buildAppliedHomePortfolioRowsFromConfirmedHoldings([mergeRow])

  assert.equal(mergeRow?.averagePriceCurrency, undefined)
  assert.equal(appliedRow?.averagePriceCurrency, undefined)
  assert.equal(appliedRow?.averagePrice, '300.50')
})

test('MergeResultRowCard는 수익률 값을 한 번만 렌더링한다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([createReviewRow()])
  const markup = renderToStaticMarkup(createElement(MergeResultRowCard, { row: mergeRow, isLast: true }))

  assert.equal(markup.match(/-23\.4%/g)?.length, 1)
  assert.match(markup, /text-\[color:var\(--jaroo-loss\)\]/)
})

test('MergeResultRowCard는 양수 수익률에 국내식 수익 색상을 적용한다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([createReviewRow({ profitRate: '+12.3%' })])
  const markup = renderToStaticMarkup(createElement(MergeResultRowCard, { row: mergeRow, isLast: true }))

  assert.match(markup, /text-\[color:var\(--jaroo-profit\)\]/)
})

test('/merge 화면 적용도 기존 포트폴리오와 병합하고 업로드 세션을 정리한다(2026-11)', () => {
  const source = readFileSync(new URL('./jaroo-merge-screen.tsx', import.meta.url), 'utf8')
  const handleApplyBody = source.slice(source.indexOf('const handleApply = async'), source.indexOf('if (mergeRows.length === 0 && reviewRows.length === 0)'))

  // /ocr 과 같은 병합 적용 경로를 쓴다 — 이 화면에서 적용해도 기존 종목이 지워지지 않아야 한다.
  assert.ok(handleApplyBody.includes('resolveExistingPortfolioForMerge()'), '적용 시점에 기존 포트폴리오를 읽는다')
  assert.ok(handleApplyBody.includes('persistMergedAppliedPortfolio({ mergeRows, existing, overlapChoices, appliedAt })'), '병합 적용 함수로 저장한다')
  assert.ok(handleApplyBody.includes('syncMergedPortfolioAfterApply(existing, applyResult.plan.rows)'), '서버에는 병합 결과 전체를 보낸다')
  assert.ok(handleApplyBody.includes('replacePortfolioItems(applyResult.mergedItems)'), '스토어도 병합 결과로 교체한다')
  assert.ok(!source.includes('syncPortfolioToServer('), '이번 묶음만 보내는 옛 저장 호출이 없다')
  assert.match(source, /import \{ PortfolioOverlapChoices \} from '@\/components\/ocr\/portfolio-overlap-choices'/)
  assert.match(source, /plan=\{mergePlan\}/)

  // 적용 뒤 업로드 세션을 지운다 — 남으면 검수로 되돌아갔을 때 같은 이미지로 유료 OCR 이 다시 돈다.
  const appliedTail = handleApplyBody.slice(handleApplyBody.indexOf('markApplied(appliedAt)'))
  assert.ok(appliedTail.includes('clearPersistedScreenshotUploadSession()'), '적용 뒤 업로드 세션 저장소를 지운다')
  assert.ok(appliedTail.includes('useOcrUploadStore.getState().clear()'), '적용 뒤 업로드 store를 지운다')
})
