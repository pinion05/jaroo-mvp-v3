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

test('로그인 화면은 필수 가입 동의 체크박스로 게이트하며 약관 페이지로 링크한다', () => {
  const source = read('src/app/login/page.tsx')

  // 필수 동의 체크박스 (select/email 양쪽 뷰 공용 컴포넌트)
  assert.match(source, /function ConsentCheckbox/)
  assert.match(source, /aria-required='true'/)
  assert.match(source, /만 14세 이상/)
  assert.match(source, /href='\/terms'/)
  assert.match(source, /href='\/privacy'/)

  // 동의 전에는 Google/이메일 진입을 막는다
  assert.match(source, /disabled=\{pending \|\| !termsAgreed\}/)
  assert.match(source, /서비스 이용약관과 개인정보처리방침에 동의해주세요\./)

  // 동의 상태는 공유 훅이 관리한다
  assert.match(source, /useTermsConsent/)

  // "간주돼요" 식 암묵적 동의 문구는 제거되어야 한다
  assert.doesNotMatch(source, /동의하는 것으로 간주/)
})

test('동의 저장 로직은 공유 훅에 단일화되어 있다', () => {
  const hook = read('src/components/auth/terms-consent.tsx')
  assert.match(hook, /export function useTermsConsent/)
  assert.match(hook, /TERMS_CONSENT_STORAGE_KEY/)
  assert.match(hook, /window\.localStorage\.setItem\(TERMS_CONSENT_STORAGE_KEY/)
  assert.match(hook, /window\.localStorage\.removeItem\(TERMS_CONSENT_STORAGE_KEY/)
})

test('구버전 /signup 폼(AuthForm)도 동일한 동의 게이트를 통과해야 가입할 수 있다', () => {
  const source = read('src/components/auth/auth-form.tsx')
  assert.match(source, /useTermsConsent/)
  assert.match(source, /disabled=\{pending \|\| !termsAgreed\}/)
  assert.match(source, /termsAcceptedAt: consentAt/)
  assert.match(source, /href='\/terms'/)
  assert.match(source, /href='\/privacy'/)
})

test('OAuth 콜백은 consent 쿼리를 검증해 profiles 에 동의 기록을 남긴다', () => {
  const route = read('src/app/auth/callback/route.ts')
  assert.match(route, /parseTermsConsentAt/)
  assert.match(route, /termsConsentRow/)
  assert.match(route, /from\('profiles'\)/)
  assert.match(route, /upsert/)
  // 동의 기록 실패가 로그인 자체를 깨지 않는다 (best-effort)
  assert.match(route, /terms consent record failed/)
})

test('이메일 가입은 동의 시점을 raw_user_meta_data 로 전달한다', () => {
  const route = read('src/app/api/auth/signup/route.ts')
  assert.match(route, /termsAcceptedAt/)
  assert.match(route, /parseTermsConsentAt/)
  assert.match(route, /terms_accepted_at/)
  assert.match(route, /terms_version/)
})

test('동의 시점 파서는 미래/7일 경과 값을 거절한다', () => {
  const lib = read('src/lib/supabase/terms-consent.ts')
  assert.match(lib, /sevenDays/)
  assert.match(lib, /Number\.isNaN\(ts\)/)
})

test('profiles 마이그레이션은 동의 컬럼과 트리거 전파를 정의한다', () => {
  const migration = read('supabase/migrations/20260820120000_add_terms_consent_to_profiles.sql')
  assert.match(migration, /add column if not exists terms_accepted_at timestamptz/)
  assert.match(migration, /add column if not exists terms_version text/)
  // 이메일 확인 전 가입자도 동의가 기록되도록 트리거가 메타데이터를 옮긴다
  assert.match(migration, /raw_user_meta_data ->> 'terms_accepted_at'/)
  assert.match(migration, /coalesce\(public\.profiles\.terms_accepted_at, excluded\.terms_accepted_at\)/)
})

test('마이페이지 기타 메뉴는 약관/개인정보/문의를 실제 링크로 연결한다', () => {
  const source = read('src/app/mypage/page.tsx')
  assert.match(source, /RowLink href='\/terms'/)
  assert.match(source, /RowLink href='\/privacy'/)
  assert.match(source, /mailto:support@jaroo\.kr/)
})
