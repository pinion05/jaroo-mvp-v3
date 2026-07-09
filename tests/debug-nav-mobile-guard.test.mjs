import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

test('debug navigation keeps desktop-only shell spacing contract', () => {
  const layout = fs.readFileSync(path.join(rootDir, 'src', 'app', 'layout.tsx'), 'utf8')

  assert.match(layout, /className='lg:pl-28'/)
  assert.doesNotMatch(layout, /className='md:pl-28'/)
})
