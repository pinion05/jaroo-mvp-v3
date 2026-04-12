import test from 'node:test'
import assert from 'node:assert/strict'

import { DEEPSCAN_TARGET_STORAGE_KEY, readDeepScanTarget } from './jaroo-deepscan-target'

type WindowLike = {
  sessionStorage: Storage
}

function withSessionStorageValue(rawValue: string | null, callback: () => void) {
  const sessionStorage: Storage = {
    get length() {
      return rawValue === null ? 0 : 1
    },
    clear() {},
    getItem(key) {
      return key === DEEPSCAN_TARGET_STORAGE_KEY ? rawValue : null
    },
    key() {
      return null
    },
    removeItem() {},
    setItem() {},
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage } satisfies WindowLike,
  })

  try {
    callback()
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
}

test('손상된 deep scan target kind는 무시한다', () => {
  withSessionStorageValue(
    JSON.stringify({
      name: '잘못된 대상',
      kind: 'bond',
      market: 'NYSE',
      shares: '1',
      change: '+1%',
      averagePrice: '100',
    }),
    () => {
      assert.equal(readDeepScanTarget(), null)
    },
  )
})

test('유효한 deep scan target은 identifier label을 재구성한다', () => {
  withSessionStorageValue(
    JSON.stringify({
      name: 'Apple',
      kind: 'stock',
      market: 'NASDAQ',
      shares: '10',
      change: '+2%',
      averagePrice: '100',
      identifierTicker: ' AAPL ',
      identifierCode: ' ',
      identifierLabel: 'legacy',
    }),
    () => {
      assert.deepEqual(readDeepScanTarget(), {
        name: 'Apple',
        kind: 'stock',
        market: 'NASDAQ',
        shares: '10',
        change: '+2%',
        averagePrice: '100',
        evaluationAmount: undefined,
        identifierTicker: 'AAPL',
        identifierCode: undefined,
        identifierLabel: 'AAPL',
      })
    },
  )
})
