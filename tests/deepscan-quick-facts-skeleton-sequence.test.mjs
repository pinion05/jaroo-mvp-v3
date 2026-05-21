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

const obsoleteSummaryField = ['three', 'Lens', 'Summary'].join('')
const obsoleteServiceName = ['three', '-', 'lens'].join('')
const obsoleteKoreanLens = ['3', '렌즈'].join('')
const obsoleteUnavailableBody = ['summary', 'Unavailable', 'Body'].join('')
const obsoleteCompactHelper = ['compact', 'Finding', 'Text'].join('')
const obsoleteUnavailableCopy = ['요약', ' 불가'].join('')
const obsoletePriceAnalyst = ['시세', ' 분석가'].join('')
const obsoleteConsensusAnalyst = ['컨센서스', ' 분석가'].join('')
const obsoleteFundamentalAnalyst = ['실적', ' 분석가'].join('')
const obsoletePendingBodyGate = ['cardSettled ? card.body : card.', 'pending', 'Text'].join('')

test('DeepScan loading screen uses v13 chat flow with three committee teams, not lens sections', () => {
  const source = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')

  assert.match(source, /function buildLoadingStages/)
  assert.match(source, /analystName: '가치\/기본 팀'/)
  assert.match(source, /analystName: '시장\/차트 팀'/)
  assert.match(source, /analystName: '심리\/환경 팀'/)
  assert.match(source, /가치 분석가/)
  assert.match(source, /성장 전략가/)
  assert.match(source, /재무 감사관/)
  assert.match(source, /차트 마스터/)
  assert.match(source, /수급 추적기/)
  assert.match(source, /모멘텀 스카우터/)
  assert.match(source, /심리 분석AI/)
  assert.match(source, /산업 전문가/)
  assert.match(source, /이벤트 스캐너/)
  assert.match(source, /narrativePricebar/)
  assert.match(source, /positionQuickFact\?\.indicator/)
  assert.doesNotMatch(source, literalPattern(obsoletePriceAnalyst))
  assert.doesNotMatch(source, literalPattern(obsoleteConsensusAnalyst))
  assert.doesNotMatch(source, literalPattern(obsoleteFundamentalAnalyst))
  assert.doesNotMatch(source, /aria-label='빠른 시장 체크'/)
  assert.doesNotMatch(source, /aria-label='딥스캔 진행 요약'/)
  assert.doesNotMatch(source, />진행 요약</)
  assert.doesNotMatch(source, /aria-label='가격 위치 조회 중'/)
})

test('DeepScan target price quick fact remains visible with missing or failed reason', () => {
  const source = readRepoFile('src', 'app', 'deepscan', 'page.tsx')

  assert.match(source, /function buildTargetPriceStatusQuickFact/)
  assert.match(source, /'조회 실패'/)
  assert.match(source, /'미제공'/)
  assert.match(source, /아직 증권사 목표가가 제시되지 않은 종목입니다\./)
  assert.match(source, /증권사 목표가를 지금 불러오지 못했습니다\./)
  assert.match(source, /requestSeed\.holding\.name/)
  assert.doesNotMatch(source, /isNoDataConsensusBody\(consensus\.body\)\) \{\s*return null/u)
})

test('DeepScan loading v13 sequencing is reveal-only and resultsReady bypasses delay', () => {
  const source = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')

  assert.match(source, /function buildLoadingStages/)
  assert.match(source, /function buildVisibleNarrativeCards/)
  assert.match(source, /function buildCompletionState/)
  assert.match(source, /cards\.filter\(\(card\) => elapsedSeconds >= card\.revealAt\)/)
  assert.match(source, /if \(resultsReady\) \{\s*return cards\s*\}/u)
  assert.match(source, /const progressPct = resultsReady \? 100 : Math\.min/)
  assert.match(source, /실제 응답이 도착했습니다/)
  assert.doesNotMatch(source, /TOTAL\s*=\s*60/)
  assert.doesNotMatch(source, /60_000|60000|60 \* 1000/)
  assert.doesNotMatch(source, /setTimeout\(/)
})

test('DeepScan loading screen does not introduce fetches, pre-ready recommendations, or result CTA', () => {
  const source = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')

  assert.doesNotMatch(source, /fetch\(/)
  assert.doesNotMatch(source, /강세|손절|보유 유지|즉시 매도|최종 판단|최종 요약/u)
  assert.doesNotMatch(source, /상세 결과 보기|상세보기|아래 버튼/u)
  assert.match(source, /inlineResults/)
})

test('/deepscan renders inline results without confirmed-result CTA gate', () => {
  const source = readRepoFile('src', 'app', 'deepscan', 'page.tsx')

  assert.match(source, /import \{ DeepScanInlineResults \}/)
  assert.match(source, /fetchState === 'loading' \|\| isCommitteeHydrating \|\| resultsReady/)
  assert.match(source, /inlineResults=\{resultsReady && payload \? <DeepScanInlineResults/)
  assert.doesNotMatch(source, /confirmedResultsTargetKey/)
  assert.doesNotMatch(source, /hasConfirmedResultsView/)
  assert.doesNotMatch(source, /resultsReady && !/)
})

test('DeepScan team bubbles preserve raw member reasons without hidden summary layer', () => {
  const loadingSource = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')
  const pageSource = readRepoFile('src', 'app', 'deepscan', 'page.tsx')
  const routeSource = readRepoFile('src', 'app', 'api', 'deepscan', 'committee-status', 'route.ts')

  assert.match(loadingSource, /member\.reason/)
  assert.match(loadingSource, /`\$\{definition\.alias\}: \$\{member\.reason\}`/)
  assert.match(loadingSource, /`\$\{definition\.alias\}: 응답 대기 중`/)
  assert.match(loadingSource, /<p className=\{styles\.narrativeText\}>\{card\.body\}<\/p>/)
  assert.match(loadingSource, /white-space: pre-line|styles\.narrativeText/)
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteUnavailableBody))
  assert.doesNotMatch(loadingSource, literalPattern(`${obsoleteCompactHelper}(member.reason`))
  assert.doesNotMatch(loadingSource, literalPattern(obsoletePendingBodyGate))
  assert.doesNotMatch(loadingSource, /외 \$\{.*\}명/u)
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteUnavailableCopy))
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteSummaryField))
  assert.doesNotMatch(pageSource, literalPattern(obsoleteSummaryField))
  assert.doesNotMatch(routeSource, literalPattern(obsoleteSummaryField))
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteServiceName))
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteKoreanLens))
})
