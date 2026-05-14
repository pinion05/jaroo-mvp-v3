import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

const guardedWebFiles = [
  'src/app/api/deepscan/route.ts',
  'src/app/api/deepscan/committee-status/route.ts',
  'src/lib/deepscan-runtime/build-payload.ts',
]

const forbiddenPatterns = [
  /from ['"]playwright['"]/,
  /from ['"].*packages\/crawler\/src\/services\/deepscan-payload\.js['"]/,
  /from ['"].*packages\/crawler\/src\/crawlers\/wisereport-kr/,
  /from ['"].*deepscan-kr-committee-runtime\.js['"]/,
  /require\(['"]playwright['"]\)/,
  /require\(['"].*wisereport-kr/,
]

test('web DeepScan routes do not import KR crawler or Playwright runtime directly', () => {
  for (const relativePath of guardedWebFiles) {
    const source = readFileSync(join(ROOT, relativePath), 'utf8')

    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${relativePath} violates DeepScan web/crawler boundary with ${pattern}`)
    }
  }
})
