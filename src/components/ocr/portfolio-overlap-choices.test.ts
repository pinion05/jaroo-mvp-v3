import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'
import {
  DEFAULT_PORTFOLIO_OVERLAP_CHOICE,
  planPortfolioMerge,
  type ExistingPortfolioResolution,
  type PortfolioOverlapChoice,
  type PortfolioOverlapChoiceMap,
} from '@/lib/portfolio-merge'
import { PortfolioOverlapChoices } from './portfolio-overlap-choices'

function row(overrides: Partial<AppliedHomePortfolioRow> & Pick<AppliedHomePortfolioRow, 'name'>): AppliedHomePortfolioRow {
  return {
    quantity: '',
    profitRate: '',
    evaluationAmount: '',
    averagePrice: '',
    ...overrides,
  }
}

const samsung = () => row({ name: '삼성전자', resolvedName: '삼성전자', code: '005930', resolvedCode: '005930', quantity: '12', averagePrice: '71500', resolvedMarket: 'KOSPI' })
const kia = () => row({ name: '기아자동차', resolvedName: '기아자동차', code: '000270', resolvedCode: '000270', quantity: '3', averagePrice: '98000', resolvedMarket: 'KOSPI' })
const samsungIncoming = () => row({ ...samsung(), quantity: '7주', averagePrice: '88,100', profitRate: '-3.5%' })
const naverIncoming = () => row({ name: 'NAVER', resolvedName: 'NAVER', code: '035420', resolvedCode: '035420', quantity: '2주', averagePrice: '210,500', profitRate: '+1.9%', resolvedMarket: 'KOSPI' })

function render(
  plan: ReturnType<typeof planPortfolioMerge>,
  existingStatus: ExistingPortfolioResolution['status'] = 'server',
  onChange: (key: string, choice: PortfolioOverlapChoice) => void = () => {},
) {
  return renderToStaticMarkup(createElement(PortfolioOverlapChoices, { plan, existingStatus, onChange }))
}

test('첫 포트폴리오(보존할 기존 종목도 겹치는 종목도 없음)면 아무것도 그리지 않는다', () => {
  const plan = planPortfolioMerge([], [naverIncoming()])

  assert.equal(render(plan), '')
})

test('겹치는 종목에는 기존 값·이번 값과 처리 선택(기본은 새 값으로 갱신)을 보여준다', () => {
  const plan = planPortfolioMerge([samsung(), kia()], [samsungIncoming(), naverIncoming()], { 'code:005930': DEFAULT_PORTFOLIO_OVERLAP_CHOICE })
  const markup = render(plan)

  assert.match(markup, /aria-label="기존 포트폴리오 반영"/)
  assert.match(markup, /기존 포트폴리오와 1개 종목이 겹쳐요/)
  assert.match(markup, /새 종목 1개 추가 · 겹치는 종목 1개 · 기존 1개 그대로/)
  // 종목 식별 정보와 기존/이번 값. 평단은 출처(스토어 "71,500원"·DB "71500"·OCR "88,100")와 무관하게
  // 천 단위 구분 숫자로 맞춰 보여준다.
  assert.match(markup, /KOSPI · 005930/)
  assert.match(markup, /기존<\/span>12주 · 평단 71,500/)
  assert.match(markup, /이번<\/span>7주 · 평단 88,100/)
  // 라디오그룹 세 선택지, 선택된 항목은 하나.
  assert.match(markup, /role="radiogroup" aria-label="삼성전자 처리 방법"/)
  for (const label of ['새 값으로 갱신', '수량 합산', '기존 유지']) {
    assert.ok(markup.includes(label), label)
  }
  assert.equal(markup.split('aria-checked="true"').length - 1, 1)
  assert.match(markup, /class="jaroo-pfo-chip sel"[^>]*>새 값으로 갱신/)
  // 선택 결과 요약: 갱신이면 이번 값.
  assert.match(markup, /반영: <b>7주 · 평단 88,100<\/b>/)
  // 겹치지 않는 종목(기아)은 선택 목록에 나오지 않는다.
  assert.doesNotMatch(markup, /기아자동차 처리 방법/)
})

test('수량 합산을 고르면 합산 결과가 선택돼 보인다', () => {
  const choices: PortfolioOverlapChoiceMap = { 'code:005930': 'sum' }
  const plan = planPortfolioMerge([samsung()], [samsungIncoming()], choices)
  const markup = render(plan)

  assert.match(markup, /class="jaroo-pfo-chip sel"[^>]*>수량 합산/)
  assert.match(markup, /반영: <b>19주 · 평단 77,616<\/b>/)
})

test('기존 유지를 고르면 기존 값이 그대로 반영돼 보인다', () => {
  const plan = planPortfolioMerge([samsung()], [samsungIncoming()], { 'code:005930': 'keep' })
  const markup = render(plan)

  assert.match(markup, /class="jaroo-pfo-chip sel"[^>]*>기존 유지/)
  assert.match(markup, /반영: <b>12주 · 평단 71,500<\/b>/)
})

test('기존 행의 평단 표기(화폐 기호·단위·USD)는 이번 행과 같은 모양으로 맞춰 보여준다', () => {
  const existingWon = row({ ...samsung(), averagePrice: '71,500원' })
  const plan = planPortfolioMerge([existingWon], [samsungIncoming()])
  assert.match(render(plan), /기존<\/span>12주 · 평단 71,500/)

  const existingUsd = row({
    name: 'AAPL',
    resolvedName: 'AAPL',
    ticker: 'AAPL',
    resolvedTicker: 'AAPL',
    quantity: '2',
    averagePrice: '$150.2',
    averagePriceCurrency: 'USD',
  })
  const incomingUsd = row({ ...existingUsd, quantity: '3주', averagePrice: '150.20', profitRate: '+1%' })
  const markup = render(planPortfolioMerge([existingUsd], [incomingUsd]))

  assert.match(markup, /기존<\/span>2주 · 평단 150.2 USD/)
  assert.match(markup, /이번<\/span>3주 · 평단 150.2 USD/)
})

test('겹치는 종목이 없어도 둘 기존 종목이 있으면 추가 요약만 보여준다', () => {
  const plan = planPortfolioMerge([kia()], [naverIncoming()])
  const markup = render(plan)

  assert.match(markup, /기존 포트폴리오에 함께 추가돼요/)
  assert.match(markup, /새 종목 1개 추가 · 기존 1개 그대로/)
  assert.doesNotMatch(markup, /radiogroup/)
})

test('서버에서 기존 포트폴리오를 못 읽은 상태면 경고를 함께 보여준다', () => {
  const plan = planPortfolioMerge([samsung()], [samsungIncoming()])
  const markup = render(plan, 'unavailable')

  assert.match(markup, /role="alert"/)
  assert.match(markup, /불러오지 못했어요/)
  assert.doesNotMatch(render(plan, 'server'), /role="alert"/)
})

test('행의 값이 런타임에 비어 있어도(undefined) 화면이 깨지지 않고 렌더된다', () => {
  const sparseExisting = { ...samsung(), averagePrice: undefined } as unknown as AppliedHomePortfolioRow
  const sparseIncoming = { ...samsungIncoming(), quantity: undefined, averagePrice: undefined } as unknown as AppliedHomePortfolioRow
  const plan = planPortfolioMerge([sparseExisting, kia()], [sparseIncoming])
  const markup = render(plan)

  // 평단이 없으면 수량만 보여 주고, 수량·평단이 모두 없으면 빈 요약이 된다.
  assert.match(markup, /기존<\/span>12주/)
  assert.match(markup, /기존 포트폴리오와 1개 종목이 겹쳐요/)
  assert.match(markup, /삼성전자 처리 방법/)
})
