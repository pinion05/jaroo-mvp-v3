import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('기록 원장 마이그레이션: append 전용 테이블 + 서비스롤 전용(deny-all RLS)', () => {
  const sql = read('supabase/migrations/20260914130000_create_deepscan_scan_history.sql')
  assert.match(sql, /create table if not exists public\.deepscan_scan_history/)
  assert.match(sql, /id uuid primary key default gen_random_uuid\(\)/)
  assert.match(sql, /user_id uuid not null references auth\.users \(id\) on delete cascade/)
  assert.match(sql, /target_input jsonb not null/)
  assert.match(sql, /payload jsonb not null/)
  assert.match(sql, /create index if not exists deepscan_scan_history_user_scanned_idx/)
  assert.match(sql, /enable row level security/)
  // 스냅샷 테이블과 동일하게 클라이언트용 select 정책은 만들지 않는다(deny-all)
  assert.doesNotMatch(sql, /create policy/i)
})

test('기록 스토어: 삽입은 스캔 응답에 영향을 주지 않고, 보존 한도로 prune 한다', () => {
  const store = read('src/lib/deepscan-history-store.ts')
  assert.match(store, /HISTORY_RETENTION_PER_USER = 30/)
  assert.match(store, /\.range\(HISTORY_RETENTION_PER_USER, HISTORY_RETENTION_PER_USER \+ 49\)/)
  assert.match(store, /void pruneScanHistory/)
  assert.match(store, /target_input: input\.targetInput/)
  // 목록 조회는 payload를 내리지 않는다
  const listFn = store.slice(
    store.indexOf('export async function listScanHistory'),
    store.indexOf('export async function getScanHistoryById'),
  )
  assert.ok(listFn.includes('.limit(safeLimit)'))
  assert.ok(!listFn.includes('payload'))
})

test('기록 목록 API: 인증 단일 소스 + limit 클램프 + no-store', () => {
  const route = read('src/app/api/deepscan/history/route.ts')
  assert.match(route, /resolveApiUserId\('deepscan-history'\)/)
  assert.match(route, /status: 401/)
  assert.match(route, /status: 503/)
  assert.match(route, /normalizeHistoryLimit/)
  assert.match(route, /Math\.min\(parsed, MAX_HISTORY_LIMIT\)/)
  assert.match(route, /MAX_HISTORY_LIMIT = 50/)
  assert.match(route, /NO_STORE_PRIVATE_HEADERS/)
})

test('기록 단건 API: uuid가 아니거나 남의 행이면 404로 통일(존재 추론 방지)', () => {
  const route = read('src/app/api/deepscan/history/[id]/route.ts')
  const store = read('src/lib/deepscan-history-store.ts')
  assert.match(route, /resolveApiUserId\('deepscan-history-detail'\)/)
  assert.match(route, /status: 404/)
  assert.match(store, /\[0-9a-f\]\{8\}/)
  assert.match(store, /\.eq\('user_id', userId\)/)
  assert.match(store, /\.eq\('id', trimmed\)/)
})

test('스캔 성공 경로가 스냅샷 저장과 함께 기록 원장에 append 한다', () => {
  const route = read('src/app/api/deepscan/route.ts')
  assert.match(route, /import \{ recordScanHistory \} from '@\/lib\/deepscan-history-store'/)
  assert.match(route, /void recordScanHistory\(\{/)
  // 스냅샷 캐시 저장 바로 옆에서 호출된다
  assert.ok(route.indexOf('void saveDeepScanSnapshot({') < route.indexOf('void recordScanHistory({'))
})

test('기록 페이지는 테스트 데이터가 아니라 기록 API를 소비한다', () => {
  const page = read('src/app/mypage/history/page.tsx')
  assert.match(page, /\/api\/deepscan\/history\?limit=30/)
  assert.match(page, /buildDeepScanTargetInputFromHistoryTargetInput/)
  assert.match(page, /setTarget/)
  assert.doesNotMatch(page, /mypage-test-data/)
  assert.doesNotMatch(page, /테스트 데이터/)
})
