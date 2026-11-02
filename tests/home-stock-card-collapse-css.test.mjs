import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cssPath = path.join(__dirname, '..', 'src', 'components', 'home', 'jaroo-home-screen.module.css')
const css = stripCssComments(fs.readFileSync(cssPath, 'utf8'))

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function cssBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`))
  assert.ok(match?.groups?.body, `${selector} block should exist`)
  return match.groups.body
}

function assertDecl(block, declaration) {
  assert.match(block, new RegExp(`(^|;)\\s*${declaration}\\s*(;|$)`))
}

function refuteDecl(block, declaration, reason) {
  assert.doesNotMatch(block, new RegExp(`(^|;)\\s*${declaration}\\s*(;|$)`), reason)
}

test('접힌 종목 카드 상세(grid 0fr)는 그리드 아이템에 세로 padding/border를 두지 않아 하단 유령 여백이 생기지 않는다', () => {
  // .stockDetail의 접힘 트릭: grid-template-rows: 0fr 트랙의 auto 최솟값은 그리드
  // 아이템의 min-content + 세로 padding/border까지 더해진다. 아이템(.stockDetailInner)이
  // 세로 박스 기여분을 가지면 접힌 상태가 0이 아니라 그 높이만큼 남아(visibility:hidden은
  // 레이아웃 유지) 종목 카드의 상하 세로 여백이 비대칭이 된다(#342).
  const detailInner = cssBlock('.stockDetailInner')
  assertDecl(detailInner, 'overflow:\\s*hidden')
  assertDecl(detailInner, 'min-height:\\s*0')
  refuteDecl(
    detailInner,
    'padding(-top|-bottom)?\\s*:',
    '.stockDetailInner(0fr 그리드 아이템)에 세로 padding이 있으면 접힌 높이가 0보다 커진다',
  )
  refuteDecl(
    detailInner,
    'border(-top|-bottom|-block|-width)?\\s*:',
    '.stockDetailInner(0fr 그리드 아이템)에 세로 border가 있으면 접힌 높이가 0보다 커진다',
  )
  refuteDecl(
    detailInner,
    'margin(-top|-bottom|-block)?\\s*:',
    '.stockDetailInner(0fr 그리드 아이템)에 세로 margin이 있으면 접힌 높이가 0보다 커진다',
  )

  // 세로 여백과 구분선은 중첩 래퍼(.stockDetailBody)가 담당한다.
  const detailBody = cssBlock('.stockDetailBody')
  assertDecl(detailBody, 'border-top:\\s*0\\.5px solid #eef0f3')
  assertDecl(detailBody, 'padding:\\s*0 13px 13px')
})
