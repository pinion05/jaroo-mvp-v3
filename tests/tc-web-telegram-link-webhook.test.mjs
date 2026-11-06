import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 텔레그램 알림 연동(link)과 봇 웹훅(webhook) 라우트는 전용 테스트가 없었다.
// 개인 연동 상태의 no-store, 봇 미설정 503, 1회용 토큰 규약과 웹훅 시크릿 검증의
// 회귀를 잡는다.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('텔레그램 연동 API는 개인정보 no-store와 봇 미설정 503, 1회용 토큰 규약을 유지한다', () => {
  const source = read('src/app/api/telegram/link/route.ts')
  // 연동 상태는 개인 데이터 — GET/POST/DELETE 모든 응답이 no-store, private (총 17곳: import 1 + 응답 16)
  assert.match(
    source,
    /import \{ resolveApiUserId, NO_STORE_PRIVATE_HEADERS \} from '@\/lib\/supabase\/api-auth'/,
  )
  assert.equal((source.match(/NO_STORE_PRIVATE_HEADERS/g) ?? []).length, 17)
  // GET도 봇 설정을 검증한다 — 미설정 배포에서 UI 행이 보이지 않게 503
  // (GET만 체크를 빼먹어 행이 보이고, 클릭 시에야 503 알럿이 뜬 사례 반영)
  assert.match(
    source,
    /export async function GET[\s\S]*?hasTelegramBotConfig\(\) \|\| !getTelegramBotUsername\(\)[\s\S]*?telegram-unconfigured[\s\S]*?status: 503/,
  )
  // 상태 변경(POST/DELETE) Origin 2차 방어
  assert.equal((source.match(/originAllowedForStateChange\(req\)/g) ?? []).length, 2)
  // 1회용 연동 토큰: 24바이트 base64url, 10분 TTL
  assert.match(source, /const LINK_TOKEN_TTL_MS = 10 \* 60 \* 1000/)
  assert.match(source, /randomBytes\(24\)\.toString\('base64url'\)/)
  // 재발급 시 이전 미사용 토큰 즉시 무효화
  assert.match(source, /\.is\('used_at', null\)/)
})

test('텔레그램 웹훅은 시크릿 헤더 검증 후 1회용 토큰으로 연결을 확정한다', () => {
  const source = read('src/app/api/telegram/webhook/route.ts')
  // Telegram 공식 시크릿 헤더를 상수시간 비교로 검증한다
  assert.match(source, /x-telegram-bot-api-secret-token/)
  assert.match(source, /timingSafeEqual\(a, b\)/)
  assert.match(source, /if \(!received \|\| !expected\) return false/)
  // 봇/시크릿 미설정은 503, 헤더 위조는 401 (텔레그램 재시도 루프 방지용 구분)
  assert.match(source, /telegram-unconfigured[\s\S]*?status: 503/)
  assert.match(source, /error: 'forbidden'\s*\},\s*\{\s*status: 401/)
  // 봇 개인 채팅만 지원 — 채널/그룹 전송은 chat.id로 차단
  assert.match(source, /message\.chat\.type && message\.chat\.type !== 'private'/)
  // "/startabc" 오인 방지 — 정확한 "/start " 접두 파싱
  assert.match(source, /text !== '\/start' && !text\.startsWith\('\/start '\)/)
  // 만료·재사용 토큰 거절 안내
  assert.match(source, /만료되었거나 이미 사용되었어요/)
  // 한 텔레그램 계정 = 한 Jaroo 계정 (chat_id unique 충돌 거부)
  assert.match(source, /conflict && conflict\.user_id !== tokenRow\.user_id/)
  // 연결 확정 upsert는 user_id 충돌 기준
  assert.match(source, /\{ onConflict: 'user_id' \}/)
})
