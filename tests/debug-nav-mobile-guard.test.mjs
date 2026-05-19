import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

test('debug navigation is gated away from mobile and touch viewports', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src', 'components', 'debug-page-nav.tsx'), 'utf8')
  const layout = fs.readFileSync(path.join(rootDir, 'src', 'app', 'layout.tsx'), 'utf8')

  assert.match(source, /matchMedia\('\(min-width: 1024px\) and \(hover: hover\) and \(pointer: fine\)'\)/)
  assert.match(source, /if \(!canShowDebugNav\) \{\s*return null\s*\}/)
  assert.match(source, /lg:block/)
  assert.doesNotMatch(source, /md:block/)
  assert.match(layout, /className='lg:pl-28'/)
  assert.doesNotMatch(layout, /className='md:pl-28'/)
})
