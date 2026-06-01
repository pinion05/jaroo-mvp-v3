import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clearPersistedScreenshotUploadSession,
  normalizeStockName,
  parseOcrNumber,
  persistScreenshotUploadSession,
  readPersistedScreenshotUploadSession,
  SCREENSHOT_OCR_STORAGE_KEY,
} from './screenshot-ocr'

test('normalizeStockName removes #, whitespace, and decorative edge symbols', () => {
  assert.equal(normalizeStockName('  # 삼성 전자  '), '삼성전자')
  assert.equal(normalizeStockName('★ Tesla Inc. ★'), 'teslainc')
  assert.equal(normalizeStockName('▶  TIGER 미국 S&P500  ◀'), 'tiger미국s&p500')
})

test('parseOcrNumber prefers embedded percent values for OCR profit text', () => {
  assert.equal(parseOcrNumber('+20,347 (1.4%)'), 1.4)
  assert.equal(parseOcrNumber('-11,167 (5.7%)'), -5.7)
  assert.equal(parseOcrNumber('−19,964 (15.1%)'), -15.1)
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
