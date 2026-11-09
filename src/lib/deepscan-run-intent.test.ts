import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEEPSCAN_RUN_INTENT_MAX_AGE_MS,
  DEEPSCAN_RUN_INTENT_STORAGE_KEY,
  clearDeepScanRunIntent,
  markDeepScanRunIntent,
  readDeepScanRunIntent,
} from './deepscan-run-intent'

/** node 환경에 sessionStorage가 없으므로 인메모리 가짜 저장소를 깔아 상태를 시뮬레이션한다. */
function installFakeSessionStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  const fake = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
  ;(globalThis as { window?: unknown; sessionStorage?: unknown }).window = { sessionStorage: fake }
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = fake
  return {
    raw: () => store.get(DEEPSCAN_RUN_INTENT_STORAGE_KEY) ?? null,
    uninstall: () => {
      delete (globalThis as { window?: unknown }).window
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage
    },
  }
}

test('명시적 클릭 표식을 남기면 신선한 방문으로 판정한다', () => {
  const storage = installFakeSessionStorage()
  try {
    const markedAt = 1_000_000
    assert.equal(markDeepScanRunIntent(markedAt), true)
    assert.equal(readDeepScanRunIntent(markedAt + 1_000), true)
    assert.equal(storage.raw(), String(markedAt))
  } finally {
    storage.uninstall()
  }
})

// §5-B 회귀: 클릭 없이 방문만 하면(재방문·직접 URL) 표식이 없어 자동 유료 실행이 금지된다.
test('표식 없는 방문(재방문)은 실행 의도로 판정하지 않는다', () => {
  const storage = installFakeSessionStorage()
  try {
    assert.equal(readDeepScanRunIntent(Date.now()), false)
    assert.equal(storage.raw(), null)
  } finally {
    storage.uninstall()
  }
})

// 원샷 의미: 30초 창을 넘긴 오래된 표식(클릭 후 다른 곳을 돌아온 방문)은 의도로 보지 않는다.
test('표식은 30초 창을 넘기면 만료된다(과거 이력이 재방문을 유료 실행으로 바꾸지 않는다)', () => {
  const storage = installFakeSessionStorage()
  try {
    const markedAt = 1_000_000
    markDeepScanRunIntent(markedAt)
    assert.equal(readDeepScanRunIntent(markedAt + DEEPSCAN_RUN_INTENT_MAX_AGE_MS), true)
    assert.equal(readDeepScanRunIntent(markedAt + DEEPSCAN_RUN_INTENT_MAX_AGE_MS + 1), false)
  } finally {
    storage.uninstall()
  }
})

test('clear는 표식을 소멸시켜 이후 방문을 읽기 전용으로 만든다', () => {
  const storage = installFakeSessionStorage()
  try {
    markDeepScanRunIntent()
    clearDeepScanRunIntent()
    assert.equal(readDeepScanRunIntent(Date.now()), false)
    assert.equal(storage.raw(), null)
  } finally {
    storage.uninstall()
  }
})

// 실패 주입: 세션 저장소 접근이 불가능한 환경(SSR·쿼타 초과)에서도 판정은
// '의도 없음'(안전 방향=과금 없음)으로 떨어져야 한다.
test('세션 저장소 접근 불가 환경에서는 의도 없음(안전 방향)으로 판정한다', () => {
  const throwingStorage = {
    getItem: () => {
      throw new Error('quota exceeded')
    },
    setItem: () => {
      throw new Error('quota exceeded')
    },
    removeItem: () => {
      throw new Error('quota exceeded')
    },
  }
  ;(globalThis as { window?: unknown }).window = { sessionStorage: throwingStorage }

  assert.equal(markDeepScanRunIntent(), false)
  assert.equal(readDeepScanRunIntent(), false)

  delete (globalThis as { window?: unknown }).window
})
