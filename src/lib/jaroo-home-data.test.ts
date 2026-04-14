import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHomeHoldingsFromOcrRows, persistAppliedHomePortfolio, readAppliedHomePortfolio } from './jaroo-home-data'

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

test('applied home portfolio handoff는 OCR evaluationAmount를 저장하지 않고 홈은 live quote placeholder로 다시 만든다', () => {
  const restoreWindow = installWindowMock()

  try {
    const persisted = persistAppliedHomePortfolio({
      broker: '테스트증권',
      rows: [{
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
      }],
    })

    assert.equal(persisted, true)

    const session = readAppliedHomePortfolio()
    const [holding] = buildHomeHoldingsFromOcrRows(session?.rows ?? [])

    assert.equal(session?.rows[0]?.evaluationAmount, '')
    assert.equal(session?.rows[0]?.averagePrice, '$972.11')
    assert.equal(holding?.averagePrice, '$972.11')
    assert.equal(holding?.evaluationAmount, undefined)
    assert.equal(holding?.change, '-')
    assert.equal(holding?.pnl, '-')
    assert.equal(holding?.metaLine, '티커 MSFT · 종목코드 US5949181045 · 평단 $972.11')
    assert.equal(holding?.metrics.some((metric) => metric.label === '평가 금액' && metric.value === '-'), true)
  } finally {
    restoreWindow()
  }
})
