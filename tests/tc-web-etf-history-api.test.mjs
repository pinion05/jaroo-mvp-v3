import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ETF 기록 원장 API(history·[id])와 위원회 상태 프록시는 전용 테스트가 없었다 —
// lib(etf-history-store)만 커버되고 라우트 계약(인증 단일 소스·limit 클램프·
// no-store·404 통일·no-store 릴레이)은 무보호 상태였다.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('ETF 기록 목록 API는 인증 단일 소스와 limit 클램프·no-store를 유지한다', () => {
  const source = read('src/app/api/etf/history/route.ts')
  // limit 정규화: 기본 20, 상한 50(보존 한도 30 이상 여유) — 무제한 인출 차단
  assert.match(source, /export const DEFAULT_ETF_HISTORY_LIMIT = 20/)
  assert.match(source, /export const MAX_ETF_HISTORY_LIMIT = 50/)
  assert.match(source, /if \(!Number\.isFinite\(parsed\) \|\| parsed <= 0\) return DEFAULT_ETF_HISTORY_LIMIT/)
  assert.match(source, /return Math\.min\(parsed, MAX_ETF_HISTORY_LIMIT\)/)
  // 인증 단일 소스(resolveApiUserId): unavailable 503 / unauthorized 401
  assert.match(source, /resolveApiUserId\('etf-history'\)/)
  assert.equal((source.match(/status: 503, headers: NO_STORE_PRIVATE_HEADERS/g) ?? []).length, 2)
  assert.equal((source.match(/status: 401, headers: NO_STORE_PRIVATE_HEADERS/g) ?? []).length, 1)
  // 응답에 보존 한도(retention)를 함께 노출 — 클라이언트가 프루닝 기준을 알 수 있게
  assert.match(source, /\{ rows, limit, retention: ETF_HISTORY_RETENTION_PER_USER \}/)
  // 개인 원장 — 캐시 금지 + 요청시 렌더
  assert.match(source, /export const dynamic = 'force-dynamic'/)
  assert.equal((source.match(/NO_STORE_PRIVATE_HEADERS/g) ?? []).length, 5) // import 1 + 응답 4
})

test('ETF 기록 단건 API는 본인 소유가 아니면 404로 통일해 존재를 추론하지 못하게 한다', () => {
  const source = read('src/app/api/etf/history/[id]/route.ts')
  // 조회는 항상 본인 userId 스코프로 — 남의 행은 존재해도 404
  assert.match(source, /getEtfHistoryById\(auth\.userId, String\(id \?\? ''\)\)/)
  // uuid가 아니거나 본인 소유가 아니면 동일 404 (존재 추론 방지)
  assert.match(source, /error: 'not-found'\s*\},\s*\{\s*status: 404, headers: NO_STORE_PRIVATE_HEADERS/)
  assert.equal((source.match(/status: 404/g) ?? []).length, 1)
  assert.match(source, /resolveApiUserId\('etf-history-detail'\)/)
})

test('ETF 위원회 상태 프록시는 requestId 검증과 no-store 릴레이를 유지한다', () => {
  const source = read('src/app/api/etf/committee-status/route.ts')
  // requestId는 인코딩해 릴레이하고, 없으면 400
  assert.match(source, /encodeURIComponent\(requestId\)/)
  assert.match(source, /if \(!requestId\) \{[\s\S]*?requestId is required[\s\S]*?status: 400/)
  // 진행 상태 폴링 응답 — 400·정상 릴레이·502 모두 no-store (3곳)
  assert.equal((source.match(/'cache-control': 'no-store'/g) ?? []).length, 3)
  // upstream 장애는 한국어 안내와 함께 502
  assert.match(source, /status: 502/)
  assert.match(source, /AI 위원회 진행 상태를 가져오지 못했어요/)
  // 크롤러 deepscan committee-status 엔드포인트와 동일 계약 (ETF는 스냅샷 쓰래백 없음)
  assert.match(
    source,
    /buildCrawlerUrl\(\s*baseUrl,\s*`\/api\/source\/deepscan\/kr\/committee-status\?requestId=/,
  )
})
