import test from 'node:test'
import assert from 'node:assert/strict'

import type { AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'
import { aggregateResolvedOcrReviewRows } from '@/lib/ocr-review-aggregation'
import {
  DEFAULT_PORTFOLIO_OVERLAP_CHOICE,
  exceedsPortfolioRowLimit,
  getPortfolioMergeKey,
  planPortfolioMerge,
  resolvePortfolioOverlapChoice,
  toExistingPortfolioResolution,
} from '@/lib/portfolio-merge'
import { MAX_PORTFOLIO_ROWS } from '@/lib/portfolio-validation'

function row(overrides: Partial<AppliedHomePortfolioRow> & Pick<AppliedHomePortfolioRow, 'name'>): AppliedHomePortfolioRow {
  return {
    quantity: '',
    profitRate: '',
    evaluationAmount: '',
    averagePrice: '',
    ...overrides,
  }
}

// 서버(DB)에서 읽은 행: 수량은 단위 없는 문자열, 수익률은 저장되지 않아 비어 있다.
function dbRow(name: string, code: string, quantity: string, averagePrice: string, overrides: Partial<AppliedHomePortfolioRow> = {}) {
  return row({
    name,
    resolvedName: name,
    code,
    resolvedCode: code,
    quantity,
    averagePrice,
    resolvedMarket: 'KOSPI',
    resolvedMarketTone: 'kospi',
    resolvedKind: 'stock',
    averagePriceCurrency: 'KRW',
    ...overrides,
  })
}

// 이번 검수에서 확정한 행: 수량에 "주" 단위가 붙고 수익률이 있다.
function incomingRow(
  name: string,
  code: string,
  quantity: string,
  averagePrice: string,
  profitRate: string,
  overrides: Partial<AppliedHomePortfolioRow> = {},
) {
  return row({
    name,
    resolvedName: name,
    code,
    resolvedCode: code,
    quantity,
    averagePrice,
    profitRate,
    resolvedMarket: 'KOSPI',
    resolvedMarketTone: 'kospi',
    resolvedKind: 'stock',
    averagePriceCurrency: 'KRW',
    ...overrides,
  })
}

const samsung = () => dbRow('삼성전자', '005930', '12', '71500')
const kia = () => dbRow('기아자동차', '000270', '3', '98000')

test('겹치는 종목이 없으면 기존 순서를 그대로 두고 새 종목을 뒤에 붙인다', () => {
  const existingRows = [samsung(), kia()]
  const naver = incomingRow('NAVER', '035420', '2주', '210,500', '+1.9%')
  const plan = planPortfolioMerge(existingRows, [naver])

  assert.deepEqual(plan.rows, [...existingRows, naver])
  assert.equal(plan.rows[0], existingRows[0])
  assert.deepEqual(plan.overlaps, [])
  assert.deepEqual(plan.addedRows, [naver])
  assert.equal(plan.keptRowCount, 2)
})

test('겹치는 종목은 선택이 없으면 이번 값으로 갱신되고 기존 자리에 남는다', () => {
  const existingRows = [samsung(), kia()]
  const incoming = incomingRow('삼성전자', '005930', '7주', '88,100', '-3.5%')
  const plan = planPortfolioMerge(existingRows, [incoming])

  assert.equal(plan.rows.length, 2)
  assert.equal(plan.rows[0], incoming)
  assert.equal(plan.rows[0]?.quantity, '7주')
  assert.equal(plan.rows[0]?.averagePrice, '88,100')
  assert.equal(plan.rows[1], existingRows[1])
  assert.equal(plan.overlaps.length, 1)
  assert.equal(plan.overlaps[0]?.key, 'code:005930')
  assert.equal(plan.overlaps[0]?.displayName, '삼성전자')
  assert.equal(plan.overlaps[0]?.choice, 'update')
  assert.equal(plan.overlaps[0]?.result, plan.rows[0])
  assert.deepEqual(plan.addedRows, [])
  assert.equal(plan.keptRowCount, 1)
})

test('기존 유지를 고르면 이번 값을 쓰지 않는다', () => {
  const existing = samsung()
  const incoming = incomingRow('삼성전자', '005930', '7주', '88,100', '-3.5%')
  const plan = planPortfolioMerge([existing], [incoming], { 'code:005930': 'keep' })

  assert.deepEqual(plan.rows, [existing])
  assert.equal(plan.overlaps[0]?.choice, 'keep')
  assert.equal(plan.overlaps[0]?.result, existing)
})

test('수량 합산: 수량을 더하고 평단은 수량 가중평균, 수익률은 원금 가중이다', () => {
  const plan = planPortfolioMerge([incomingRow('삼성전자', '005930', '12주', '71,500', '+8.4%', { evaluationAmount: '1,000', profitAmount: '+100' })], [
    incomingRow('삼성전자', '005930', '7주', '88,100', '-3.5%', { evaluationAmount: '2,000', profitAmount: '-50' }),
  ], { 'code:005930': 'sum' })

  const result = plan.overlaps[0]?.result
  // 12×71,500 + 7×88,100 = 1,474,700 / 19 = 77,615.8
  assert.equal(result?.quantity, '19')
  assert.equal(result?.averagePrice, '77,616')
  // (858,000×8.4 + 616,700×(−3.5)) / 1,474,700 = +3.42
  assert.equal(result?.profitRate, '+3.4%')
  assert.equal(result?.evaluationAmount, '3,000')
  assert.equal(result?.profitAmount, '+50')
  assert.equal(result?.averagePriceCurrency, 'KRW')
  assert.deepEqual(plan.rows, [result])
  assert.equal(plan.overlaps[0]?.choice, 'sum')
})

test('수량 합산: DB 에서 읽은 기존 행(수익률 없음)이면 수익률은 이번 값을 쓴다', () => {
  const plan = planPortfolioMerge([samsung()], [incomingRow('삼성전자', '005930', '7주', '88,100', '-3.5%')], { 'code:005930': 'sum' })

  assert.equal(plan.overlaps[0]?.result.quantity, '19')
  assert.equal(plan.overlaps[0]?.result.averagePrice, '77,616')
  assert.equal(plan.overlaps[0]?.result.profitRate, '-3.5%')
})

test('수량 합산: 평단 화폐가 다르면 가격은 더하지 않고 이번 값으로 둔다', () => {
  const existingUsd = row({
    name: 'AAPL',
    resolvedName: 'AAPL',
    ticker: 'AAPL',
    resolvedTicker: 'AAPL',
    quantity: '2',
    averagePrice: '150.2',
    averagePriceCurrency: 'USD',
    resolvedMarket: 'US',
    resolvedMarketTone: 'nasdaq',
    resolvedKind: 'stock',
  })
  const incomingKrw = row({
    ...existingUsd,
    quantity: '3주',
    averagePrice: '200,000',
    averagePriceCurrency: 'KRW',
    profitRate: '+1%',
  })
  const plan = planPortfolioMerge([existingUsd], [incomingKrw], { 'ticker:AAPL': 'sum' })

  assert.equal(plan.overlaps[0]?.result.quantity, '5')
  assert.equal(plan.overlaps[0]?.result.averagePrice, '200,000')
  assert.equal(plan.overlaps[0]?.result.averagePriceCurrency, 'KRW')
  assert.equal(plan.overlaps[0]?.result.profitRate, '+1%')
})

test('수량 합산: 기존 행에 평단이 없으면 수량만 더하고 평단은 이번 값이다', () => {
  const plan = planPortfolioMerge([dbRow('삼성전자', '005930', '12', '')], [incomingRow('삼성전자', '005930', '7주', '88,100', '-3.5%')], {
    'code:005930': 'sum',
  })

  assert.equal(plan.overlaps[0]?.result.quantity, '19')
  assert.equal(plan.overlaps[0]?.result.averagePrice, '88,100')
})

test('겹치는 종목 선택은 종목마다 독립적으로 적용된다', () => {
  const existingRows = [samsung(), kia(), dbRow('KB금융', '105560', '20', '82300')]
  const plan = planPortfolioMerge(existingRows, [
    incomingRow('삼성전자', '005930', '7주', '88,100', '-3.5%'),
    incomingRow('기아자동차', '000270', '5주', '100,000', '+2%'),
    incomingRow('NAVER', '035420', '2주', '210,500', '+1.9%'),
  ], { 'code:005930': 'sum', 'code:000270': 'keep' })

  // 삼성전자는 합산(12+7), 기아는 기존 유지(3), KB금융은 이번 묶음에 없어 그대로, NAVER 는 새로 추가.
  assert.deepEqual(plan.rows.map((item) => [item.name, item.quantity]), [
    ['삼성전자', '19'],
    ['기아자동차', '3'],
    ['KB금융', '20'],
    ['NAVER', '2주'],
  ])
  assert.deepEqual(plan.overlaps.map((overlap) => overlap.choice), ['sum', 'keep'])
  assert.deepEqual(plan.addedRows.map((item) => item.name), ['NAVER'])
  assert.equal(plan.keptRowCount, 1)
})

test('겹치는 종목 선택은 종목 키(코드 → 티커 → 정규화 이름)로 맞춘다', () => {
  assert.equal(getPortfolioMergeKey(dbRow('삼성전자', '005930', '1', '1')), 'code:005930')
  assert.equal(getPortfolioMergeKey(incomingRow('삼성전자보통주', '005930', '2주', '1', '0%')), 'code:005930')
  assert.equal(getPortfolioMergeKey(row({ name: 'Apple', ticker: 'AAPL' })), 'ticker:AAPL')
  assert.equal(getPortfolioMergeKey(row({ name: ' Naver ' })), getPortfolioMergeKey(row({ name: 'NAVER' })))

  // 이름·표기가 달라도 코드가 같으면 같은 종목이다.
  const plan = planPortfolioMerge([dbRow('삼성전자', '005930', '12', '71500')], [incomingRow('삼성전자보통주', '005930', '7주', '88,100', '-3.5%')])
  assert.equal(plan.overlaps.length, 1)
  assert.equal(plan.overlaps[0]?.displayName, '삼성전자보통주')
})

test('겹치는 종목 선택 키는 묶음 안 계좌 집계의 키와 같다', () => {
  // 같은 규칙을 쓰므로 "한 번에 올린 묶음"과 "나눠 올린 재적용"이 같은 종목을 같다고 본다.
  const reviewRows = [
    { id: 'a:0', name: '삼성전자', resolvedName: '삼성전자', resolvedCode: '005930', quantity: '12주', profitRate: '+8.4%', averagePrice: '71,500', evaluationAmount: '', resolutionState: 'resolved' },
  ] as unknown as Parameters<typeof aggregateResolvedOcrReviewRows>[0]
  const [aggregated] = aggregateResolvedOcrReviewRows(reviewRows)

  assert.equal(getPortfolioMergeKey(aggregated), getPortfolioMergeKey(dbRow('삼성전자', '005930', '12', '71500')))
})

test('검수에서 제외된 종목은 이번 묶음에 없으므로 기존 종목이 그대로 남는다', () => {
  const existingRows = [samsung(), kia()]
  const plan = planPortfolioMerge(existingRows, [incomingRow('삼성전자', '005930', '7주', '88,100', '-3.5%')], { 'code:005930': 'keep' })

  assert.deepEqual(plan.rows, existingRows)
})

test('기존 목록에 같은 종목이 중복돼 있으면 첫 행만 병합 대상으로 삼는다', () => {
  const plan = planPortfolioMerge([samsung(), samsung(), kia()], [incomingRow('삼성전자', '005930', '7주', '88,100', '-3.5%')], { 'code:005930': 'sum' })

  assert.deepEqual(plan.rows.map((item) => item.quantity), ['19', '12', '3'])
  assert.equal(plan.overlaps.length, 1)
  assert.equal(plan.keptRowCount, 2)
})

test('이번 묶음에 같은 종목이 두 번 있으면 앞의 행만 쓴다', () => {
  const plan = planPortfolioMerge([], [
    incomingRow('삼성전자', '005930', '7주', '88,100', '-3.5%'),
    incomingRow('삼성전자', '005930', '9주', '90,000', '+1%'),
  ])

  assert.equal(plan.rows.length, 1)
  assert.equal(plan.rows[0]?.quantity, '7주')
})

test('선택이 없거나 알 수 없는 값이면 기본 선택(새 값으로 갱신)이다', () => {
  assert.equal(DEFAULT_PORTFOLIO_OVERLAP_CHOICE, 'update')
  assert.equal(resolvePortfolioOverlapChoice({}, 'code:005930'), 'update')
  assert.equal(resolvePortfolioOverlapChoice({ 'code:005930': 'nope' } as never, 'code:005930'), 'update')
  assert.equal(resolvePortfolioOverlapChoice({ 'code:005930': 'sum' }, 'code:005930'), 'sum')
  assert.equal(resolvePortfolioOverlapChoice({ 'code:005930': 'keep' }, 'code:005930'), 'keep')
})

test('fetchPortfolio 결과를 기존 포트폴리오 출처로 해석한다', () => {
  const localRows = [samsung()]

  // 200 + 행 / 200 + 빈 배열: DB가 단일 소스다(빈 DB를 세션 행으로 되살리지 않는다).
  assert.deepEqual(toExistingPortfolioResolution({ status: 'rows', rows: [kia()] }, localRows), { status: 'server', rows: [kia()] })
  assert.deepEqual(toExistingPortfolioResolution({ status: 'empty' }, localRows), { status: 'server', rows: [] })
  // 비로그인: 탭 로컬 행이 전부다.
  assert.deepEqual(toExistingPortfolioResolution({ status: 'logged-out' }, localRows), { status: 'session', rows: localRows })
  // 서버 오류: 로컬 행으로 병합하되 unavailable이라 서버 교체 저장은 하지 않는다.
  assert.deepEqual(toExistingPortfolioResolution({ status: 'error' }, localRows), { status: 'unavailable', rows: localRows })
})

test('저장 API 종목 상한을 넘었는지 판정한다', () => {
  assert.equal(exceedsPortfolioRowLimit(MAX_PORTFOLIO_ROWS), false)
  assert.equal(exceedsPortfolioRowLimit(MAX_PORTFOLIO_ROWS + 1), true)
})
