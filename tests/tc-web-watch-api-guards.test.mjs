import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 워치(종목 감시) API 3개 라우트는 전용 테스트가 없었다 — 인증·Origin 가드와
// 계정 단위 스코프 규약(#222 §3-6: 종목별 설정 없음)의 회귀를 잡는다.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('워치 목록 API는 모든 메서드에서 미인증 401과 상태 변경 Origin 가드를 유지한다', () => {
  const source = read('src/app/api/watch/route.ts')
  // GET/POST/DELETE 3곳 모두 로그인 게이트
  assert.equal((source.match(/status: 401/g) ?? []).length, 3)
  // 상태 변경(POST/DELETE)만 Origin 2차 방어 — GET은 읽기라 무가드
  assert.equal((source.match(/originAllowedForStateChange\(request\)/g) ?? []).length, 2)
  assert.match(source, /error: '보안 검증에 실패했어요\.'\s*\},\s*\{\s*status: 403/)
  // 입력 클램프 한도(코드 24 / 이름 80 / 마켓 24) — 과대 문자열 DB 유입 차단
  assert.match(source, /const MAX_CODE = 24/)
  assert.match(source, /const MAX_NAME = 80/)
  assert.match(source, /const MAX_MARKET = 24/)
  assert.match(source, /trimmed\.slice\(0, max\)/)
  // POST는 code+name 필수(400)
  assert.match(source, /if \(!code \|\| !name\) \{[\s\S]*?status: 400/)
  // 재등록은 계정+코드 충돌 기준 upsert(갱신)
  assert.match(
    source,
    /upsert\(\{ user_id: user\.id, code, name, market \}, \{ onConflict: 'user_id,code' \}\)/,
  )
  // DELETE는 본인 행만 — user_id eq 누락 시 타인 등록을 해지할 수 있다
  const deleteBlock = source.match(/export async function DELETE[\s\S]*$/)?.[0] ?? ''
  assert.ok(deleteBlock.length > 0, 'DELETE 핸들러가 있어야 한다')
  assert.match(deleteBlock, /\.eq\('user_id', user\.id\)/)
  assert.match(deleteBlock, /\.eq\('code', code\)/)
})

test('워치 알림 강도 설정 API는 계정 단위 upsert와 기본값 폴백을 유지한다', () => {
  const source = read('src/app/api/watch/settings/route.ts')
  // GET/PUT 모두 미인증 401
  assert.equal((source.match(/status: 401/g) ?? []).length, 2)
  // 상태 변경(PUT)만 Origin 가드
  assert.equal((source.match(/originAllowedForStateChange\(request\)/g) ?? []).length, 1)
  // 알림 강도는 공유 정규화 함수로만 결정된다(임의 문자열 DB 유입 차단)
  assert.match(source, /import \{ normalizeAlertLevel \} from '@\/lib\/watch\/levels'/)
  assert.match(source, /normalizeAlertLevel\(data\?\.alert_level\)/) // 행 없음 → 기본값 폴백
  assert.match(source, /const alertLevel = normalizeAlertLevel\(body\.alertLevel\)/)
  // 계정 단위(1행) upsert
  assert.match(
    source,
    /upsert\(\{ user_id: user\.id, alert_level: alertLevel, updated_at: new Date\(\)\.toISOString\(\) \}, \{ onConflict: 'user_id' \}\)/,
  )
})

test('워치 배치 트리거는 시크릿 미설정 503과 상수시간 Bearer 비교로 보호된다', () => {
  const source = read('src/app/api/watch/batch/tick/route.ts')
  // 외부 수동 트리거 엔드포인트 — 시크릿 상수시간 검증 필수
  assert.match(source, /import \{ timingSafeEqual \} from 'node:crypto'/)
  assert.match(source, /secretsMatch\(authorization, `Bearer \$\{secret\}`\)/)
  assert.match(source, /timingSafeEqual\(aBuf, bBuf\)/)
  // 시크릿 미설정 배포에서는 배치를 실행하지 않고 503
  assert.match(source, /if \(!secret\) \{[\s\S]*?watch-batch-not-configured[\s\S]*?status: 503/)
  assert.match(source, /export const runtime = 'nodejs'/)
})
