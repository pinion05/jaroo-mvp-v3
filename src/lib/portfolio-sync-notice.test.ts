import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PORTFOLIO_SYNC_FAILURE_MESSAGE,
  PORTFOLIO_SYNC_NOTICE_STORAGE_KEY,
  PORTFOLIO_SYNC_NOTICE_TTL_MS,
  clearPortfolioSyncNotice,
  readPortfolioSyncNotice,
  writePortfolioSyncNotice,
} from './portfolio-sync-notice'

function createStorage() {
  const store = new Map<string, string>()

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    keys: () => [...store.keys()],
  }
}

test('저장 실패 알림을 쓰면 읽을 수 있다 (기본 문구)', () => {
  const storage = createStorage()
  const now = Date.parse('2026-11-25T00:00:00.000Z')

  assert.equal(readPortfolioSyncNotice(storage, now), null)
  assert.equal(writePortfolioSyncNotice(storage, undefined, now), true)
  assert.equal(readPortfolioSyncNotice(storage, now + 1_000), PORTFOLIO_SYNC_FAILURE_MESSAGE)
})

test('지운 뒤에는 읽히지 않는다', () => {
  const storage = createStorage()

  writePortfolioSyncNotice(storage)
  assert.ok(readPortfolioSyncNotice(storage))
  clearPortfolioSyncNotice(storage)

  assert.equal(readPortfolioSyncNotice(storage), null)
  assert.deepEqual(storage.keys(), [])
})

test('유효 시간이 지난 알림은 보여 주지 않고 지운다', () => {
  const storage = createStorage()
  const now = Date.parse('2026-11-25T00:00:00.000Z')

  writePortfolioSyncNotice(storage, undefined, now)

  assert.equal(readPortfolioSyncNotice(storage, now + PORTFOLIO_SYNC_NOTICE_TTL_MS), PORTFOLIO_SYNC_FAILURE_MESSAGE)
  assert.equal(readPortfolioSyncNotice(storage, now + PORTFOLIO_SYNC_NOTICE_TTL_MS + 1), null)
  assert.deepEqual(storage.keys(), [])
})

test('깨졌거나 비어 있는 알림은 null 이고 저장소에서 치운다', () => {
  const storage = createStorage()

  storage.setItem(PORTFOLIO_SYNC_NOTICE_STORAGE_KEY, '{not json')
  assert.equal(readPortfolioSyncNotice(storage), null)
  assert.deepEqual(storage.keys(), [])

  storage.setItem(PORTFOLIO_SYNC_NOTICE_STORAGE_KEY, JSON.stringify({ at: Date.now(), message: '   ' }))
  assert.equal(readPortfolioSyncNotice(storage), null)
  assert.deepEqual(storage.keys(), [])
})

test('저장소가 없으면 조용히 실패한다 (SSR·저장소 차단)', () => {
  assert.equal(writePortfolioSyncNotice(undefined, undefined, 0), false)
  assert.equal(readPortfolioSyncNotice(undefined, 0), null)
  assert.doesNotThrow(() => clearPortfolioSyncNotice(undefined))
})
