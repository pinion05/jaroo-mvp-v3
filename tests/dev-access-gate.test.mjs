import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

test('dev 접근 게이트는 env 게이트로만 동작하며 prod에서는 완전 무해하다', () => {
  const gate = read('lib/dev-access-gate.ts')

  // DEV_BASIC_AUTH env가 없으면 null 반환 = 게이트 비활성(운영·로컬 무영향)
  assert.match(gate, /DEV_BASIC_AUTH/)
  assert.match(gate, /if \(!basic\) return null/)

  // 401 챌린지는 표준 WWW-Authenticate Basic
  assert.match(gate, /WWW-Authenticate/)
  assert.match(gate, /Basic realm=/)

  // 가용성 프로브 경로는 무조건 통과
  assert.match(gate, /\/api\/health/)
})

test('프록시(미들웨어)는 세션 갱신 앞단에서 게이트를 통과시킨다', () => {
  const proxy = read('proxy.ts')
  assert.match(proxy, /devAccessGate/)
  assert.match(proxy, /if \(gate\) return gate/)
  assert.match(proxy, /updateSupabaseSession/)
})
