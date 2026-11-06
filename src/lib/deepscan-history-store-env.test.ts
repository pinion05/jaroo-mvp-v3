import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// 기록 원장 서비스 클라이언트의 env 해석 계약(TC-blackbox-data TC-BBD-015 회귀 방지).
//
// 결함: deepscan/etf history·snapshot 스토어가 process.env.NEXT_PUBLIC_SUPABASE_URL만
// 직접 읽어서, SUPABASE_URL(서버 런타임 표준, .env.local·dev Railway 관례)만 정의된
// 환경에서 클라이언트가 null이었다. 그 결과 /api/deepscan/history·/api/etf/history가
// 유효 세션에서도 영구 503 → "/mypage/history 기록을 불러오지 못했어요" 지속 재현.
//
// 이 테스트는 로컬 목 PostgREST로 클라이언트 "생성·조회 성공" 자체를 검증한다.

const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

type SavedEnv = Array<(typeof ENV_KEYS)[number], string | undefined>

function saveEnv(): SavedEnv {
  return ENV_KEYS.map((key) => [key, process.env[key]])
}

function restoreEnv(saved: SavedEnv) {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function clearSupabaseEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

/** PostgREST GET 1회에 rows를 반환하는 초소형 목 서버. */
async function startMockPostgrest(rows: unknown[]): Promise<{ url: string; close: () => Promise<void> }> {
  const seen: string[] = []
  const server = http.createServer((req, res) => {
    seen.push(String(req.url))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(rows))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

test('SUPABASE_URL만 정의된 환경(dev 관례)에서 기록 원장 클라이언트가 조회에 성공한다', async () => {
  const saved = saveEnv()
  const mock = await startMockPostgrest([
    {
      id: '0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a',
      target_key: 'KOSPI:005930',
      market: 'KOSPI',
      stock_name: '삼성전자',
      target_input: { instrument: { code: '005930', market: 'KOSPI' } },
      charged_credits: 1,
      scanned_at: '2026-11-05T11:00:00.000Z',
    },
  ])
  try {
    clearSupabaseEnv()
    // TC 실측 환경 형태: .env.local은 SUPABASE_URL만 정의(NEXT_PUBLIC_* 미설정).
    process.env.SUPABASE_URL = mock.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'

    const { listScanHistory } = await import('./deepscan-history-store')
    const rows = await listScanHistory('11111111-1111-1111-1111-111111111111', 30)
    assert.notEqual(rows, null, 'SUPABASE_URL만 있으면 클라이언트가 생성돼야 한다(과거 null → 503 결함)')
    assert.equal(rows!.length, 1)
    assert.equal(rows![0].targetKey, 'KOSPI:005930')
    assert.equal(rows![0].stockName, '삼성전자')
    assert.equal(rows![0].chargedCredits, 1)
  } finally {
    await mock.close()
    restoreEnv(saved)
  }
})

test('ETF 기록 원장도 동일하게 SUPABASE_URL 런타임 값으로 조회된다', async () => {
  const saved = saveEnv()
  const mock = await startMockPostgrest([])
  try {
    clearSupabaseEnv()
    process.env.SUPABASE_URL = mock.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'

    const { listEtfHistory } = await import('./etf-history-store')
    const rows = await listEtfHistory('11111111-1111-1111-1111-111111111111', 30)
    assert.notEqual(rows, null, 'ETF 스토어도 SUPABASE_URL만으로 클라이언트가 생성돼야 한다')
    assert.deepEqual(rows, [])
  } finally {
    await mock.close()
    restoreEnv(saved)
  }
})

test('NEXT_PUBLIC_SUPABASE_URL 정의 환경(기존 관례)은 여전히 동작한다', async () => {
  const saved = saveEnv()
  const mock = await startMockPostgrest([])
  try {
    clearSupabaseEnv()
    process.env.NEXT_PUBLIC_SUPABASE_URL = mock.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'

    const { listScanHistory } = await import('./deepscan-history-store')
    const rows = await listScanHistory('11111111-1111-1111-1111-111111111111', 20)
    assert.notEqual(rows, null)
  } finally {
    await mock.close()
    restoreEnv(saved)
  }
})

test('URL·서비스롤 키가 모두 없으면 null(503 계약 유지)', async () => {
  const saved = saveEnv()
  try {
    clearSupabaseEnv()
    const { listScanHistory } = await import('./deepscan-history-store')
    const rows = await listScanHistory('11111111-1111-1111-1111-111111111111', 20)
    assert.equal(rows, null)
  } finally {
    restoreEnv(saved)
  }
})

test('서비스롤 키만 있고 URL이 없으면 null(503 계약 유지)', async () => {
  const saved = saveEnv()
  try {
    clearSupabaseEnv()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
    const { listScanHistory } = await import('./deepscan-history-store')
    assert.equal(await listScanHistory('11111111-1111-1111-1111-111111111111', 20), null)
  } finally {
    restoreEnv(saved)
  }
})
