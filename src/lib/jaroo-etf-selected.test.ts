import test from 'node:test'
import assert from 'node:assert/strict'

import { etfAnalysis } from './jaroo-data'
import { homeHoldings } from './jaroo-home-data'
import {
  SELECTED_ETF_STORAGE_KEY,
  buildSelectedEtfAnalysis,
  persistSelectedEtfTarget,
  readSelectedEtfTarget,
  resolveSelectedEtfAnalysis,
} from './jaroo-etf-selected'

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

test('selected ETF analysis overlays holding fields instead of always using KODEX fixture', () => {
  const analysis = buildSelectedEtfAnalysis({
    kind: 'etf',
    name: 'TIGER 미국S&P500',
    shortName: 'TIGER S&P500',
    code: '360750',
    shares: '17주',
    averagePrice: '18,300원',
    evaluationAmount: '332,010원',
    market: 'ETF',
    badge: '수익 중',
    change: '+6.8%',
    pnl: '+21,090원',
  })

  assert.equal(analysis.header.name, 'TIGER 미국S&P500')
  assert.equal(analysis.header.code, '360750')
  assert.equal(analysis.hero.name, 'TIGER S&P500')
  assert.equal(analysis.hero.price, '332,010원')
  assert.equal(analysis.hero.change, '+6.8% 수익 중')
  assert.deepEqual(analysis.hero.stats, [
    { label: '보유수량', value: '17주' },
    { label: '평가금액', value: '332,010원' },
    { label: '평가손익', value: '+21,090원' },
  ])
  assert.equal(
    analysis.basicInfo.items.find((item) => item.label === '평균단가')?.value,
    '18,300원',
  )
  assert.notEqual(analysis.header.name, etfAnalysis.header.name)
})

test('selected ETF session handoff persists only ETF holdings and fallback remains static without selection', () => {
  const restoreWindow = installWindowMock()

  try {
    assert.equal(resolveSelectedEtfAnalysis(), etfAnalysis)
    assert.equal(persistSelectedEtfTarget(homeHoldings[0]), false)
    assert.equal(globalThis.window.sessionStorage.getItem(SELECTED_ETF_STORAGE_KEY), null)

    const etfHolding = homeHoldings.find((holding) => holding.kind === 'etf')
    assert.ok(etfHolding)
    assert.equal(persistSelectedEtfTarget(etfHolding), true)

    const target = readSelectedEtfTarget()
    assert.equal(target?.name, etfHolding.name)
    assert.equal(target?.code, etfHolding.code)
    assert.equal(resolveSelectedEtfAnalysis().header.name, etfHolding.name)
  } finally {
    restoreWindow()
  }
})
