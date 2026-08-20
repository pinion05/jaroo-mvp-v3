import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

test('debug navigation stays desktop-only and does not affect the mobile shell', () => {
  const nav = fs.readFileSync(path.join(rootDir, 'src', 'components', 'debug-page-nav.tsx'), 'utf8')
  const layout = fs.readFileSync(path.join(rootDir, 'src', 'app', 'layout.tsx'), 'utf8')

  // 디버그 내비는 스스로 fixed + hidden lg:block 으로 데스크톱에서만 노출된다.
  assert.match(nav, /className='fixed top-1\/2 left-4 z-50 hidden -translate-y-1\/2 lg:block'/)
  // 루트 레이아웃은 내비 때문에 본문에 좌측 패딩을 두지 않는다 (모바일 셸 레이아웃에 영향 금지).
  assert.doesNotMatch(layout, /pl-28/)
})
