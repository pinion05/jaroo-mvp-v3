import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cssPath = path.join(__dirname, '..', 'src', 'components', 'home', 'jaroo-home-screen.module.css')
const css = fs.readFileSync(cssPath, 'utf8')

function cssBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`))
  assert.ok(match?.groups?.body, `${selector} block should exist`)
  return match.groups.body
}

function assertDecl(block, declaration) {
  assert.match(block, new RegExp(`(^|;)\\s*${declaration}\\s*(;|$)`))
}

test('home stock status badge remains one line while long stock names truncate', () => {
  const stockInfo = cssBlock('.stockInfo')
  assertDecl(stockInfo, 'min-width:\\s*0')
  assertDecl(stockInfo, 'flex:\\s*1')

  const stockNameRow = cssBlock('.stockNameRow')
  assertDecl(stockNameRow, 'display:\\s*flex')
  assertDecl(stockNameRow, 'min-width:\\s*0')

  const stockName = cssBlock('.stockName')
  assertDecl(stockName, 'min-width:\\s*0')
  assertDecl(stockName, 'overflow:\\s*hidden')
  assertDecl(stockName, 'text-overflow:\\s*ellipsis')
  assertDecl(stockName, 'white-space:\\s*nowrap')

  const stockBadge = cssBlock('.stockBadge')
  assertDecl(stockBadge, 'flex-shrink:\\s*0')
  assertDecl(stockBadge, 'white-space:\\s*nowrap')
})
