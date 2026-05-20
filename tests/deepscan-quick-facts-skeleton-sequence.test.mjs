import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

test('DeepScan quick market check only waits on quote-derived price position', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src', 'components', 'deepscan-loading-screen.tsx'), 'utf8')

  assert.match(source, /const hasWeek52Fact = displayQuickFacts\.some/)
  assert.match(source, /const showPositionSkeleton = !resultsReady && !hasWeek52Fact/)
  assert.doesNotMatch(source, /const showConsensusSkeleton =/)
  assert.doesNotMatch(source, /const showPerformanceCommentSkeleton =/)
  assert.match(source, /aria-label='가격 위치 조회 중'/)
  assert.doesNotMatch(source, /aria-label='목표가 조회 중'/)
  assert.doesNotMatch(source, /aria-label='기업실적코멘트 조회 중'/)
})

test('DeepScan target price quick fact remains visible with missing or failed reason', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src', 'app', 'deepscan', 'page.tsx'), 'utf8')

  assert.match(source, /function buildTargetPriceStatusQuickFact/)
  assert.match(source, /'조회 실패'/)
  assert.match(source, /'미제공'/)
  assert.match(source, /아직 증권사 목표가가 제시되지 않은 종목입니다\./)
  assert.match(source, /증권사 목표가를 지금 불러오지 못했습니다\./)
  assert.match(source, /requestSeed\.holding\.name/)
  assert.doesNotMatch(source, /isNoDataConsensusBody\(consensus\.body\)\) \{\s*return null/u)
})
