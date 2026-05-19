import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

test('DeepScan quick market check shows one pending skeleton at a time in slot order', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src', 'components', 'deepscan-loading-screen.tsx'), 'utf8')

  assert.match(source, /const hasWeek52Fact = displayQuickFacts\.some/)
  assert.match(source, /const showPositionSkeleton = !resultsReady && !hasWeek52Fact/)
  assert.match(source, /const showConsensusSkeleton = !resultsReady && hasWeek52Fact && !hasConsensusFact/)
  assert.match(source, /const showPerformanceCommentSkeleton = !resultsReady && hasWeek52Fact && hasConsensusFact && !hasPerformanceComment/)
  assert.match(source, /aria-label='가격 위치 조회 중'/)
  assert.match(source, /aria-label='목표가 조회 중'/)
  assert.match(source, /aria-label='기업실적코멘트 조회 중'/)
})
