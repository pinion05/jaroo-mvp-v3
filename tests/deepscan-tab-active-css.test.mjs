import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pagePath = path.join(__dirname, '..', 'src', 'app', 'deepscan', 'page.tsx')
const source = fs.readFileSync(pagePath, 'utf8')

function tabTriggerClass(value) {
  const match = source.match(new RegExp(`value='${value}'[\\s\\S]*?className='(?<className>[^']+)'`))
  assert.ok(match?.groups?.className, `${value} tab trigger class should exist`)
  return match.groups.className
}

function assertToken(className, token) {
  assert.ok(className.split(/\s+/).includes(token), `expected class token: ${token}`)
}

test('DeepScan top tabs fill the active tab instead of drawing an underline', () => {
  assert.match(
    source,
    /TabsList className='grid h-11 w-full grid-cols-2 gap-1 rounded-\[20px\] bg-white\/80 p-1 shadow-\[inset_0_0_0_1px_rgba\(181,212,244,0\.55\)\]'/,
  )
  assert.doesNotMatch(source, /variant='line'/)
  assert.doesNotMatch(source, /data-active:border(?:-b)?-\[color:var\(--jaroo-primary\)\]/)
  assert.doesNotMatch(source, /after:bottom|after:h-\[2\.5px\]|after:bg-\[color:var\(--jaroo-primary\)\]/)

  for (const value of ['analysis', 'strategy']) {
    const className = tabTriggerClass(value)

    assertToken(className, 'h-full')
    assertToken(className, 'rounded-[16px]')
    assertToken(className, 'border-0')
    assertToken(className, 'after:hidden')
    assertToken(className, 'data-active:bg-[color:var(--jaroo-primary)]')
    assertToken(className, 'data-active:text-white')
    assertToken(className, 'data-active:shadow-[0_8px_18px_rgba(24,95,165,0.22)]')
  }
})
