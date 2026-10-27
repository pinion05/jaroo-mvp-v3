import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('루트 레이아웃은 요청시 렌더로 런타임 env 주입을 보장한다', () => {
  const layout = readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /export const dynamic = .force-dynamic./)
  assert.match(layout, /buildJarooRuntimeEnvScript/)
})
