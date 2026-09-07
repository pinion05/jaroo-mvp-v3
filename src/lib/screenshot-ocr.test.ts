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

test('구형 결합 손익 문자열에서 손익금과 수익률을 복원한다', () => {
  const [row] = sanitizeOcrRows([{
    name: 'SOOP',
    quantity: '3주',
    profitRate: '-13,263 (6.8%)',
    evaluationAmount: '181,137원',
  }])

  assert.equal(row?.profitAmount, '-13263')
  assert.equal(row?.profitRate, '-6.8%')
  assert.equal(row?.averagePrice, '64,800')
})

test('평가손익이 있으면 반올림 수익률보다 정확한 원가를 사용한다', () => {
  const [row] = sanitizeOcrRows([{
    name: 'KODEX 코스피',
    quantity: '35주',
    profitAmount: '+262,740원',
    profitRate: '12.7%',
    evaluationAmount: '2,320,500원',
  }])

  assert.equal(row?.profitAmount, '+262740')
  assert.equal(row?.profitRate, '+12.7%')
  assert.equal(row?.averagePrice, '58,793')
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
    profitAmount: '+65,000원',
    profitRate: '+8.2%',
    evaluationAmount: '858,000원',
    averagePrice: '71,500',
  }])

  assert.equal(row?.averagePrice, '71,500')
})

test('직접 판독 평단과의 산술로 반전된 손익 부호를 교정한다', () => {
  const [row] = sanitizeOcrRows([{
    name: 'LG에너지솔루션',
    quantity: '2주',
    profitAmount: '+124,000원',
    profitRate: '+13.7%',
    evaluationAmount: '780,000원',
    averagePrice: '452,000',
  }])

  // eval(780,000) − qty(2)×평단(452,000) = −124,000 → 부호만 뒤집고 수익률 부호도 함께 정정
  assert.equal(row?.profitAmount, '-124000')
  assert.equal(row?.profitRate, '-13.7%')
})

test('평단보다 큰 딥로스 손실도 부호 교정 대상이다 (손실 > 평가금액은 정상)', () => {
  const [row] = sanitizeOcrRows([{
    name: '셀트리온헬스케어',
    quantity: '10주',
    profitAmount: '+630,000원',
    profitRate: '+74.6%',
    evaluationAmount: '215,000원',
    averagePrice: '84,500',
  }])

  // 원금 845,000 − 평가 215,000 = −630,000 — 손실이 평가금액보다 크지만 원금 이하므로 정상
  assert.equal(row?.profitAmount, '-630000')
  assert.equal(row?.profitRate, '-74.6%')
})

test('평단 산술 부호 교정은 통화가 섞이면 동작하지 않는다', () => {
  const [row] = sanitizeOcrRows([{
    name: 'AAPL',
    quantity: '15',
    profitAmount: '+770,000원',
    profitRate: '+23.1%',
    evaluationAmount: '4,100,000원',
    averagePrice: '$187.50',
  }])

  assert.equal(row?.profitAmount, '+770000')
})

test('평단 산술과 크기까지 어긋나면 손익금액을 불신해 비운다', () => {
  const [row] = sanitizeOcrRows([{
    name: '가상',
    quantity: '2주',
    profitAmount: '+124,000원',
    profitRate: '+13.7%',
    evaluationAmount: '780,000원',
    averagePrice: '500,000',
  }])

  // 파생 −220,000 vs 판독 +124,000 — 부호·크기 모두 불일치
  assert.equal(row?.profitAmount, '')
})

test('부호가 이미 정합이면 평단 산술 교정이 값을 바꾸지 않는다', () => {
  const [row] = sanitizeOcrRows([{
    name: '삼성바이오로직스',
    quantity: '3주',
    profitAmount: '+96,000원',
    profitRate: '+4.3%',
    evaluationAmount: '2,340,000원',
    averagePrice: '748,000',
  }])

  assert.equal(row?.profitAmount, '+96000')
  assert.equal(row?.profitRate, '+4.3%')
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
