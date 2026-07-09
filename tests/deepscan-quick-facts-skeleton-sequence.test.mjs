import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

function readRepoFile(...parts) {
  return fs.readFileSync(path.join(rootDir, ...parts), 'utf8')
}

function literalPattern(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

const obsoleteSourceTokens = [
  ['three', 'Lens', 'Summary'].join(''),
  ['three', '-', 'lens'].join(''),
  ['3', '렌즈'].join(''),
  ['summary', 'Unavailable', 'Body'].join(''),
  ['cardSettled ? card.body : card.', 'pending', 'Text'].join(''),
]

const obsoleteCopyTokens = [
  ['요약', ' 불가'].join(''),
  ['시세', ' 분석가'].join(''),
  ['컨센서스', ' 분석가'].join(''),
  ['실적', ' 분석가'].join(''),
  '상세 결과 보기',
  '상세보기',
  '아래 버튼',
]

test('DeepScan source keeps obsolete lens, CTA, and raw-summary copy out', () => {
  const sources = [
    readRepoFile('src', 'components', 'deepscan-loading-screen.tsx'),
    readRepoFile('src', 'app', 'deepscan', 'page.tsx'),
    readRepoFile('src', 'app', 'api', 'deepscan', 'committee-status', 'route.ts'),
    readRepoFile('src', 'app', 'api', 'deepscan', 'team-summary', 'route.ts'),
  ]

  for (const source of sources) {
    for (const token of obsoleteSourceTokens) {
      assert.doesNotMatch(source, literalPattern(token))
    }
  }

  const loadingSource = sources[0]
  for (const token of obsoleteCopyTokens) {
    assert.doesNotMatch(loadingSource, literalPattern(token))
  }
  assert.doesNotMatch(loadingSource, /강세|손절|보유 유지|즉시 매도|최종 판단|최종 요약/u)
  assert.doesNotMatch(loadingSource, /원문 표시|외 \$\{.*\}명/u)
})

test('DeepScan loading CSS keeps removed bridge widgets and frantic shimmer out', () => {
  const cssSource = readRepoFile('src', 'components', 'deepscan-loading-screen.module.css')

  for (const selector of [
    '.todayChartFactBridge',
    '.todayRangeTrack',
    '.todayProductBridge',
    '.narrativePricebar',
  ]) {
    assert.doesNotMatch(cssSource, literalPattern(selector))
  }

  assert.match(cssSource, /--ds-skeleton-shimmer-duration:\s*4\.2s;/)
  assert.match(cssSource, /--ds-member-pulse-duration:\s*4s;/)
  assert.doesNotMatch(cssSource, /animation: shimmer 1\.(?:15|4)s/)
  assert.doesNotMatch(cssSource, /animation: pulse 1s infinite/)
})
