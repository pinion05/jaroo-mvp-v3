import test from 'node:test'
import assert from 'node:assert/strict'

import {
  APPLIED_HOME_PORTFOLIO_STORAGE_KEY,
  buildHomeHoldingsFromOcrRows,
  buildHomeHoldingsFromPortfolioItems,
  homeHoldings,
  persistAppliedHomePortfolio,
  persistDeepScanTarget,
  readAppliedHomePortfolio,
  resolveDeepScanTargetServerSnapshot,
  resolveDeepScanTargetSession,
} from './jaroo-home-data'

function installWindowMock() {
  const storage = new Map<string, string>()

  const windowMock = {
    sessionStorage: {
      getItem(key: string) {
        return storage.has(key) ? storage.get(key) ?? null : null
      },
      setItem(key: string, value: string) {
        storage.set(key, value)
      },
      removeItem(key: string) {
        storage.delete(key)
      },
      clear() {
        storage.clear()
      },
    },
    dispatchEvent() {
      return true
    },
  }

  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: windowMock,
  })

  return () => {
    if (typeof originalWindow === 'undefined') {
      // @ts-expect-error test cleanup for missing browser globals
      delete globalThis.window
      return
    }

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: originalWindow,
    })
  }
}

test('applied home portfolio handoff는 raw storage에서 OCR evaluationAmount/profitRate를 제거하고 홈 placeholder만 남긴다', () => {
  const restoreWindow = installWindowMock()

  try {
    const ocrRow = {
      name: '마이크로소프트',
      quantity: '3주',
      profitRate: '+18.4%',
      evaluationAmount: '$3,450.00',
      averagePrice: '$972.11',
      resolvedName: 'Microsoft Corporation',
      resolvedTicker: 'MSFT',
      resolvedCode: 'US5949181045',
      resolvedMarket: 'NASDAQ',
      resolvedMarketTone: 'nasdaq',
      resolvedKind: 'stock',
    } as Parameters<typeof persistAppliedHomePortfolio>[0]['rows'][number] & {
      profitRate: string
      evaluationAmount: string
    }

    const persisted = persistAppliedHomePortfolio({
      broker: '테스트증권',
      rows: [ocrRow],
    })

    assert.equal(persisted, true)

    const rawSession = window.sessionStorage.getItem(APPLIED_HOME_PORTFOLIO_STORAGE_KEY)
    const parsedSession = rawSession ? JSON.parse(rawSession) : null
    const persistedRow = parsedSession?.rows?.[0] as Record<string, unknown> | undefined
    const session = readAppliedHomePortfolio()
    const [holding] = buildHomeHoldingsFromOcrRows(session?.rows ?? [])

    assert.equal(Object.hasOwn(persistedRow ?? {}, 'evaluationAmount'), false)
    assert.equal(Object.hasOwn(persistedRow ?? {}, 'profitRate'), false)
    assert.equal(session?.rows[0]?.averagePrice, '$972.11')
    assert.equal(holding?.averagePrice, '$972.11')
    assert.equal(holding?.evaluationAmount, undefined)
    assert.equal(holding?.change, '-')
    assert.equal(holding?.pnl, '-')
    assert.equal(holding?.metaLine, '티커 MSFT · 종목코드 US5949181045 · 평단 $972.11')
    assert.equal(holding?.metrics.some((metric) => metric.label === '수익률' && metric.value === '-'), true)
    assert.equal(holding?.metrics.some((metric) => metric.label === '평가 금액' && metric.value === '-'), true)
  } finally {
    restoreWindow()
  }
})

test('persistAppliedHomePortfolio는 averagePrice가 비어 있으면 OCR profit/evaluation으로 평단을 유도하지 않는다', () => {
  const restoreWindow = installWindowMock()

  try {
    const ocrRow = {
      name: '삼성전자',
      quantity: '10주',
      averagePrice: '   ',
      profitRate: '-23.4%',
      evaluationAmount: '766,000원',
      resolvedName: '삼성전자',
      resolvedCode: '005930',
      resolvedMarket: 'KOSPI',
      resolvedMarketTone: 'kospi',
      resolvedKind: 'stock',
    } as Parameters<typeof persistAppliedHomePortfolio>[0]['rows'][number] & {
      profitRate: string
      evaluationAmount: string
    }

    const persisted = persistAppliedHomePortfolio({
      broker: '테스트증권',
      rows: [ocrRow],
    })

    assert.equal(persisted, true)

    const rawSession = window.sessionStorage.getItem(APPLIED_HOME_PORTFOLIO_STORAGE_KEY)
    const parsedSession = rawSession ? JSON.parse(rawSession) : null
    const persistedRow = parsedSession?.rows?.[0] as Record<string, unknown> | undefined
    const session = readAppliedHomePortfolio()
    const [holding] = buildHomeHoldingsFromOcrRows(session?.rows ?? [])

    assert.equal(Object.hasOwn(persistedRow ?? {}, 'evaluationAmount'), false)
    assert.equal(Object.hasOwn(persistedRow ?? {}, 'profitRate'), false)
    assert.equal(persistedRow?.averagePrice, '')
    assert.equal(session?.rows[0]?.averagePrice, '')
    assert.equal(holding?.averagePrice, '-')
    assert.equal(holding?.evaluationAmount, undefined)
    assert.equal(holding?.change, '-')
    assert.equal(holding?.pnl, '-')
    assert.equal(holding?.centerScore, '-')
    assert.equal(holding?.metaLine, '종목코드 005930 · 평단 -')
    assert.deepEqual(holding?.metrics, [
      { label: '보유 수량', value: '10주', tone: 'neutral' },
      { label: '수익률', value: '-', tone: 'neutral' },
      { label: '평가 금액', value: '-', tone: 'neutral' },
      { label: '현재가', value: '-', tone: 'neutral' },
    ])
  } finally {
    restoreWindow()
  }
})

test('readAppliedHomePortfolio는 raw storage에 섞인 OCR profit/evaluation으로 평단을 재계산하지 않는다', () => {
  const restoreWindow = installWindowMock()

  try {
    window.sessionStorage.setItem(
      APPLIED_HOME_PORTFOLIO_STORAGE_KEY,
      JSON.stringify({
        broker: '테스트증권',
        rows: [{
          name: '삼성전자',
          quantity: '10주',
          averagePrice: ' ',
          profitRate: '-23.4%',
          evaluationAmount: '766,000원',
          resolvedCode: '005930',
          resolvedMarket: 'KOSPI',
          resolvedMarketTone: 'kospi',
          resolvedKind: 'stock',
        }],
      }),
    )

    const session = readAppliedHomePortfolio()
    const [holding] = buildHomeHoldingsFromOcrRows(session?.rows ?? [])

    assert.equal(session?.rows[0]?.averagePrice, '')
    assert.equal(Object.hasOwn(session?.rows[0] ?? {}, 'evaluationAmount'), false)
    assert.equal(Object.hasOwn(session?.rows[0] ?? {}, 'profitRate'), false)
    assert.equal(holding?.averagePrice, '-')
    assert.equal(holding?.change, '-')
    assert.equal(holding?.pnl, '-')
    assert.equal(holding?.metaLine, '종목코드 005930 · 평단 -')
  } finally {
    restoreWindow()
  }
})

test('home holdings builder는 applied row에 섞여 들어온 OCR evaluation/profit를 무시하고 live quote placeholder로 시작한다', () => {
  const leakedAppliedRow = {
    name: '삼성전자',
    quantity: '10주',
    averagePrice: '80,000원',
    resolvedName: '삼성전자',
    resolvedCode: '005930',
    resolvedMarket: 'KOSPI',
    resolvedMarketTone: 'kospi',
    resolvedKind: 'stock',
    evaluationAmount: '999,999원',
    profitRate: '+24.9%',
  } as Parameters<typeof buildHomeHoldingsFromOcrRows>[0][number] & {
    evaluationAmount: string
    profitRate: string
  }

  const [holding] = buildHomeHoldingsFromOcrRows([leakedAppliedRow])

  assert.equal(holding?.averagePrice, '80,000원')
  assert.equal(holding?.evaluationAmount, undefined)
  assert.equal(holding?.change, '-')
  assert.equal(holding?.pnl, '-')
  assert.equal(holding?.centerScore, '-')
  assert.equal(holding?.heatmapChange, undefined)
  assert.equal(holding?.metaLine, '종목코드 005930 · 평단 80,000원')
  assert.deepEqual(holding?.metrics, [
    { label: '보유 수량', value: '10주', tone: 'neutral' },
    { label: '수익률', value: '-', tone: 'neutral' },
    { label: '평가 금액', value: '-', tone: 'neutral' },
    { label: '현재가', value: '-', tone: 'neutral' },
  ])
})

test('home holdings builder preserves portfolio-store live quote fields on remount', () => {
  const [holding] = buildHomeHoldingsFromPortfolioItems([
    {
      name: '삼성전자',
      code: '005930',
      market: 'KOSPI',
      marketTone: 'kospi',
      kind: 'stock',
      quantity: 10,
      averagePrice: 80000,
      averagePriceCurrency: 'KRW',
      currentPrice: 85200,
      currentPriceCurrency: 'KRW',
      currentProfitRate: 6.5,
      evaluationAmount: undefined,
      identifierLabel: '005930',
    },
  ])

  assert.equal(holding?.averagePrice, '80,000원')
  assert.equal(holding?.evaluationAmount, '852,000원')
  assert.equal(holding?.change, '+6.5%')
  assert.equal(holding?.pnl, '+52,000원')
  assert.equal(holding?.badge, '수익 중')
  assert.match(holding?.metaLine ?? '', /현재가 85,200원/)
  assert.deepEqual(holding?.metrics, [
    { label: '보유 수량', value: '10주', tone: 'neutral' },
    { label: '수익률', value: '+6.5%', tone: 'positive' },
    { label: '평가 금액', value: '852,000원', tone: 'neutral' },
    { label: '현재가', value: '85,200원', tone: 'neutral' },
  ])
})

test('applied home portfolio handoff는 미국 종목 OCR 평단의 KRW 통화 맥락을 보존한다', () => {
  const restoreWindow = installWindowMock()

  try {
    const ocrRow = {
      name: '페이팔',
      quantity: '46.934557주',
      profitRate: '-15.5%',
      evaluationAmount: '3,156,013원',
      averagePrice: '79,577.3278',
      resolvedName: 'PayPal Holdings, Inc.',
      resolvedTicker: 'PYPL',
      resolvedCode: 'US70450Y1038',
      resolvedMarket: 'NASDAQ',
      resolvedMarketTone: 'nasdaq',
      resolvedKind: 'stock',
    } as Parameters<typeof persistAppliedHomePortfolio>[0]['rows'][number] & {
      profitRate: string
      evaluationAmount: string
    }

    const persisted = persistAppliedHomePortfolio({
      broker: '테스트증권',
      rows: [ocrRow],
    })

    assert.equal(persisted, true)

    const session = readAppliedHomePortfolio()
    const [holding] = buildHomeHoldingsFromOcrRows(session?.rows ?? [])

    assert.equal(session?.rows[0]?.averagePriceCurrency, 'KRW')
    assert.equal(holding?.averagePriceCurrency, 'KRW')
    assert.equal(holding?.averagePrice, '79,577.3278원')
    assert.equal(holding?.metaLine, '티커 PYPL · 종목코드 US70450Y1038 · 평단 79,577.3278원')
  } finally {
    restoreWindow()
  }
})

test('deepscan server snapshot helper는 storage가 있어도 placeholder를 유지하고 client snapshot은 session target을 읽는다', () => {
  const restoreWindow = installWindowMock()

  try {
    const persisted = persistDeepScanTarget(homeHoldings[0])

    assert.equal(persisted, true)

    const serverSnapshot = resolveDeepScanTargetServerSnapshot()
    const clientSnapshot = resolveDeepScanTargetSession()

    assert.equal(serverSnapshot.holding.name, '종목 미선택')
    assert.equal(serverSnapshot.viewModel.holding.name, '종목 미선택')
    assert.equal(clientSnapshot.holding.name, homeHoldings[0].name)
    assert.equal(clientSnapshot.viewModel.holding.name, homeHoldings[0].name)
  } finally {
    restoreWindow()
  }
})

test('deepscan client snapshot은 explicit target이 없으면 applied home portfolio의 기본 종목으로 fallback한다', () => {
  const restoreWindow = installWindowMock()

  try {
    const persisted = persistAppliedHomePortfolio({
      broker: '테스트증권',
      rows: [
        {
          name: '삼성전자',
          quantity: '10주',
          averagePrice: '80,000원',
          resolvedName: '삼성전자',
          resolvedCode: '005930',
          resolvedMarket: 'KOSPI',
          resolvedMarketTone: 'kospi',
          resolvedKind: 'stock',
        },
      ],
    })

    assert.equal(persisted, true)

    const snapshot = resolveDeepScanTargetSession()

    assert.equal(snapshot.holding.name, '삼성전자')
    assert.equal(snapshot.holding.code, '005930')
    assert.equal(snapshot.viewModel.holding.name, '삼성전자')
  } finally {
    restoreWindow()
  }
})

test('home holdings builder maps manual KR/US market selections to home market tones', () => {
  const [krHolding, usHolding] = buildHomeHoldingsFromOcrRows([
    {
      name: '삼성전자',
      quantity: '10주',
      averagePrice: '80,000원',
      resolvedName: '삼성전자',
      resolvedCode: '005930',
      resolvedMarket: 'KR',
      resolvedKind: 'stock',
    },
    {
      name: '팔란티어',
      quantity: '3주',
      averagePrice: '$95.00',
      resolvedName: 'Palantir Technologies Inc.',
      resolvedTicker: 'PLTR',
      resolvedMarket: 'US',
      resolvedKind: 'stock',
    },
  ])

  assert.equal(krHolding?.market, 'KR')
  assert.equal(krHolding?.marketTone, 'kospi')
  assert.equal(usHolding?.market, 'US')
  assert.equal(usHolding?.marketTone, 'nasdaq')
})

test('ETF and ETN home actions enter DeepScan so the loading transition can mount', () => {
  const [etfHolding, etnHolding] = buildHomeHoldingsFromPortfolioItems([
    {
      name: 'KODEX 200',
      code: '069500',
      market: 'ETF',
      marketTone: 'etf',
      kind: 'etf',
      quantity: 100,
      averagePrice: 101400,
      averagePriceCurrency: 'KRW',
    },
    {
      name: '삼성 인버스 코스피 200 선물 ETN',
      code: '530092',
      market: 'ETN',
      marketTone: 'etf',
      kind: 'etf',
      quantity: 10,
      averagePrice: 12000,
      averagePriceCurrency: 'KRW',
    },
  ])

  assert.equal(etfHolding?.actionLabel, 'ETF 분석')
  assert.equal(etfHolding?.actionHref, '/deepscan')
  assert.equal(etnHolding?.actionLabel, 'ETF 분석')
  assert.equal(etnHolding?.actionHref, '/deepscan')
  assert.equal(homeHoldings.find((holding) => holding.market === 'ETF')?.actionHref, '/deepscan')
})
