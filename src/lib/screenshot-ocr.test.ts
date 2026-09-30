import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clearPersistedScreenshotUploadSession,
  computeAveragePrice,
  normalizeOcrProfitAmount,
  normalizeOcrProfitRate,
  normalizeStockName,
  parseOcrNumber,
  parseOcrProfitRate,
  persistScreenshotUploadSession,
  readPersistedScreenshotUploadSession,
  sanitizeOcrRows,
  SCREENSHOT_OCR_STORAGE_KEY,
} from './screenshot-ocr'

test('normalizeStockName removes #, whitespace, and decorative edge symbols', () => {
  assert.equal(normalizeStockName('  # 삼성 전자  '), '삼성전자')
  assert.equal(normalizeStockName('★ Tesla Inc. ★'), 'teslainc')
  assert.equal(normalizeStockName('▶  TIGER 미국 S&P500  ◀'), 'tiger미국s&p500')
})

test('parseOcrProfitRate prefers embedded percent values for OCR profit text', () => {
  assert.equal(parseOcrProfitRate('+20,347 (1.4%)'), 1.4)
  assert.equal(parseOcrProfitRate('-11,167 (5.7%)'), -5.7)
  assert.equal(parseOcrProfitRate('−19,964 (15.1%)'), -15.1)
})

test('parseOcrNumber does not mistake adjacent percent text for an amount', () => {
  assert.equal(parseOcrNumber('1,423,947원 (+1.4%)'), null)
  assert.equal(parseOcrNumber('1,423,947원'), 1423947)
})

test('signed 평가손익이 unsigned 괄호 수익률의 손실 부호를 결정한다', () => {
  assert.equal(normalizeOcrProfitAmount('-13,263원'), '-13263')
  assert.equal(normalizeOcrProfitRate('6.8%', '-13,263원'), '-6.8%')
  assert.equal(computeAveragePrice('3주', '6.8%', '181,137원', '-13,263원'), '64,800')
})

test('결합 손익 문자열에서 수익률 부호는 복원하고 나머지는 유도하지 않는다', () => {
  const [row] = sanitizeOcrRows([{
    name: 'SOOP',
    quantity: '3주',
    profitRate: '-13,263 (6.8%)',
  }])

  assert.equal(row?.profitRate, '-6.8%')
  assert.equal(row?.averagePrice, '')
  assert.equal(row?.evaluationAmount, '')
})

test('수동 입력 profitAmount·evaluationAmount는 정규화 없이 passthrough한다', () => {
  const [row] = sanitizeOcrRows([{
    name: 'KODEX 코스피',
    quantity: '35주',
    profitAmount: '+262,740원',
    profitRate: '12.7%',
    evaluationAmount: '2,320,500원',
  }])

  assert.equal(row?.profitAmount, '+262,740원')
  assert.equal(row?.profitRate, '+12.7%')
  assert.equal(row?.averagePrice, '')
})

test('수동 입력한 unsigned 평가손익은 명시적 수익률 부호를 상속한다', () => {
  const profitAmount = normalizeOcrProfitAmount('13,263원', '-6.8%')

  assert.equal(profitAmount, '-13263')
  assert.equal(computeAveragePrice('3주', '-6.8%', '181,137원', profitAmount), '64,800')
})

test('평가손익 없는 괄호 수익률은 기존처럼 양수로 해석한다', () => {
  assert.equal(normalizeOcrProfitRate('(6.8%)'), '6.8%')
  assert.equal(computeAveragePrice('1주', '(6.8%)', '106.8원'), '100')
})

test('평가손익이 없거나 원금이 유효하지 않으면 수익률 역산으로 fallback한다', () => {
  assert.equal(computeAveragePrice('3주', '-6.8%', '181,137원'), '64,784')
  assert.equal(computeAveragePrice('3주', '-6.8%', '181,137원', '300,000원'), '64,784')
})

test('손익금액 역산과 수익률 역산이 크게 어긋나면 평단을 계산하지 않는다', () => {
  // 손익금액 경로 원금 81,137 vs 수익률 경로 원금 194,379 — 잘못된 평단 방출 방어
  assert.equal(computeAveragePrice('3주', '-6.8%', '181,137원', '+100,000원'), '')
})

test('모델이 직접 판독한 평단(averagePrice)은 계산값보다 우선한다', () => {
  const [row] = sanitizeOcrRows([{
    name: '삼성전자',
    quantity: '12주',
    profitRate: '+8.2%',
    averagePrice: '71,500',
  }])

  assert.equal(row?.averagePrice, '71,500')
})

test('축소 스키마 행(name·quantity·profitRate)은 그대로 통과시킨다', () => {
  const [row] = sanitizeOcrRows([{
    name: '삼성전자',
    quantity: '12주',
    profitRate: '+8.2%',
  }])

  assert.equal(row?.name, '삼성전자')
  assert.equal(row?.quantity, '12주')
  assert.equal(row?.profitRate, '+8.2%')
  assert.equal(row?.averagePrice, '')
  assert.equal(row?.evaluationAmount, '')
  assert.equal(row?.profitAmount, undefined)
})

test('screenshot upload session survives a hard navigation fallback', () => {
  const values = new Map<string, string>()
  const previousWindow = globalThis.window

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value)
        },
        removeItem: (key: string) => {
          values.delete(key)
        },
      },
    },
  })

  try {
    persistScreenshotUploadSession({
      broker: '기타',
      uploads: [{ id: 'upload-1', fileName: 'capture.png', imageDataUrl: 'data:image/png;base64,abc' }],
    })

    assert.equal(values.has(SCREENSHOT_OCR_STORAGE_KEY), true)
    assert.deepEqual(readPersistedScreenshotUploadSession(), {
      broker: '기타',
      uploads: [{ id: 'upload-1', fileName: 'capture.png', imageDataUrl: 'data:image/png;base64,abc' }],
    })

    clearPersistedScreenshotUploadSession()
    assert.equal(readPersistedScreenshotUploadSession(), null)
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
})

test('readPersistedScreenshotUploadSession rejects malformed payloads', () => {
  const previousWindow = globalThis.window

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: () => JSON.stringify({
          broker: '기타',
          uploads: [{ id: 'upload-1', fileName: 'capture.txt', imageDataUrl: 'not-an-image' }],
        }),
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    },
  })

  try {
    assert.equal(readPersistedScreenshotUploadSession(), null)
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
})
