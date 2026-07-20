import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const css = readFileSync('src/components/home/jaroo-home-screen.module.css', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

function cssBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`))
  assert.ok(match?.groups?.body, `${selector} block should exist`)
  return match.groups.body
}

test('home frame keeps the bottom navigation pinned when removing holdings shortens the page', () => {
  const frame = cssBlock('.frame')
  assert.match(frame, /display:\s*flex/)
  assert.match(frame, /flex-direction:\s*column/)

  const top = cssBlock('.top')
  assert.match(top, /flex:\s*0 0 auto/)

  const body = cssBlock('.body')
  assert.match(body, /flex:\s*1 0 auto/)

  const bottomNav = cssBlock('.frame > nav')
  assert.match(bottomNav, /flex:\s*0 0 auto/)
})
