import test from 'node:test'
import assert from 'node:assert/strict'

import { buildLoginRedirectNext } from './proxy'

// 보호 경로(/deepscan 등) 게스트 리다이렉트의 next 값 계약 — 원래 경로를 쿼리까지
// 보존한다. 런타임 실측 시나리오(/deepscan?code=530092 딥링크)에서 ?code= 가
// 버려져 로그인 후 링크가 죽던 결함의 회귀 방어.
test('buildLoginRedirectNext — 쿼리를 포함한 원래 경로를 통째로 보존한다', () => {
  assert.equal(buildLoginRedirectNext('/deepscan', '?code=530092'), '/deepscan?code=530092')
  assert.equal(buildLoginRedirectNext('/mypage', '?tab=credits'), '/mypage?tab=credits')
  assert.equal(buildLoginRedirectNext('/deepscan', '?code=530092&market=KR'), '/deepscan?code=530092&market=KR')
})

test('buildLoginRedirectNext — 쿼리 없으면 pathname만, 비정형 search는 붙이지 않는다', () => {
  assert.equal(buildLoginRedirectNext('/deepscan', ''), '/deepscan')
  // NextURL.search는 항상 '?'로 시작 — 방어적으로 '?' 없는 값은 무시
  assert.equal(buildLoginRedirectNext('/deepscan', 'code=530092'), '/deepscan')
})
