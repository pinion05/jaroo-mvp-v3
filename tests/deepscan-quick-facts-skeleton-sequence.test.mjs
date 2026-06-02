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

function parseNumericConst(source, name) {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*([0-9_]+)`))
  assert.ok(match, `missing ${name}`)
  return Number(match[1].replaceAll('_', ''))
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

test('DeepScan loading sequencing is success-gated and no longer bypasses on raw resultsReady', () => {
  const loadingSource = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')
  const pageSource = readRepoFile('src', 'app', 'deepscan', 'page.tsx')

  assert.match(loadingSource, /function buildLoadingStages/)
  assert.match(loadingSource, /function buildVisibleNarrativeCards/)
  assert.match(loadingSource, /function buildOrderedNarrativeCards/)
  assert.match(loadingSource, /function buildPlaceholderNarrativeCard/)
  assert.match(loadingSource, /visibleStageCount/)
  assert.match(loadingSource, /arrivedStageKeys/)
  assert.match(loadingSource, /narrativeTitleSkeleton/)
  assert.match(loadingSource, /cards\.slice\(0, Math\.min\(Math\.max\(visibleStageCount, 1\), cards\.length\)\)/)
  assert.doesNotMatch(loadingSource, /elapsedSeconds >= card\.revealAt/)
  assert.doesNotMatch(loadingSource, /if \(resultsReady\) \{\s*return cards\s*\}/u)

  assert.match(pageSource, /DEEPSCAN_STAGE_WAIT_MS\s*=\s*10_000/)
  assert.match(pageSource, /DEEPSCAN_STAGE_FILL_BASE_DELAY_MS\s*=\s*2_500/)
  assert.match(pageSource, /DEEPSCAN_STAGE_FILL_DWELL_MS\s*=\s*2_500/)
  assert.match(pageSource, /markDeepScanLoadingSuccess/)
  assert.match(pageSource, /previous\.visibleStageCount === 1\s*\?\s*\{ \.\.\.previous, visibleStageCount: 2 \}/)
  assert.match(pageSource, /previous\.visibleStageCount === 2\s*\?\s*\{ \.\.\.previous, visibleStageCount: 3 \}/)
  assert.match(pageSource, /window\.setTimeout\(\(\) => \{\s*if \(targetKeyRef\.current !== releaseTargetKey\)/u)
  assert.match(pageSource, /getDeepScanStageFillDelayMs\(displayedStageKeys\.length\)/)
  assert.match(pageSource, /extractLoadingStageKeysFromCommitteeResults/)
  assert.match(pageSource, /rawResultsReady/)
  assert.match(pageSource, /sequenceComplete/)
  assert.match(pageSource, /canReuseReadyPayloadWithoutSequence/)
  assert.match(pageSource, /const resultsReady = rawResultsReady && \(loadingSequenceComplete \|\| canReuseReadyPayloadWithoutSequence\)/)
  assert.match(pageSource, /arrivedStageKeys=\{arrivedStageKeys\}/)
  assert.match(pageSource, /inlineResults=\{resultsReady && payload \? <DeepScanInlineResults/)
  assert.doesNotMatch(pageSource, /inlineResults=\{rawResultsReady && payload/)
  assert.doesNotMatch(pageSource, /firstSuccessObserved: true,\s*visibleStageCount: 2/u)
})


test('DeepScan anti-burst dwell cadence increases release delay after each displayed team', () => {
  const pageSource = readRepoFile('src', 'app', 'deepscan', 'page.tsx')
  const baseDelayMs = parseNumericConst(pageSource, 'DEEPSCAN_STAGE_FILL_BASE_DELAY_MS')
  const dwellMs = parseNumericConst(pageSource, 'DEEPSCAN_STAGE_FILL_DWELL_MS')
  const releaseDelays = [0, 1, 2].map((displayedStageCount) => baseDelayMs + displayedStageCount * dwellMs)

  assert.deepEqual(releaseDelays, [2_500, 5_000, 7_500])
  assert.match(pageSource, /function getDeepScanStageFillDelayMs\(displayedStageCount: number\)/)
  assert.match(pageSource, /Math\.max\(0, displayedStageCount\) \* DEEPSCAN_STAGE_FILL_DWELL_MS/)
  assert.match(pageSource, /getDeepScanStageFillDelayMs\(displayedStageKeys\.length\)/)
})


test("DeepScan team narrative waits until today\'s briefing sequence is fully visible", () => {
  const source = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')

  assert.match(source, /const TODAY_BRIEFING_COMPLETE_SECONDS = TODAY_BRIEFING_FIRST_REVEAL_SECONDS/)
  assert.match(source, /const NARRATIVE_CARD_REVEAL_INTERVAL_SECONDS = 5/)
  assert.match(source, /function getPostBriefingVisibleStageCount\(elapsedSeconds: number, requestedVisibleStageCount: number\)/)
  assert.match(source, /elapsedSeconds < TODAY_BRIEFING_COMPLETE_SECONDS/)
  assert.match(source, /visibleNarrativeStageCount > 0 \? buildVisibleNarrativeCards\(orderedNarrativeCards, visibleNarrativeStageCount\) : \[\]/)
  assert.match(source, /visibleNarrativeCards\.length \? \(/)
  assert.match(source, /visibleNarrativeCards\.forEach\(\(card\) => \{/)
  assert.doesNotMatch(source, /loadingStages\.forEach\(\(card\) => \{/)
})


test('DeepScan keeps the loading clock running until every requested team card is visible', () => {
  const source = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')

  assert.match(source, /const requestedNarrativeStageCount = Math\.min\(Math\.max\(visibleStageCount, 0\), orderedNarrativeCards\.length\)/)
  assert.match(source, /const narrativeSequenceComplete = requestedNarrativeStageCount === 0 \|\| visibleNarrativeStageCount >= requestedNarrativeStageCount/)
  assert.match(source, /function isNarrativeCardSummarySettled/)
  assert.match(source, /summaryState\.status === 'loading'/)
  assert.match(source, /const visibleNarrativeSummariesSettled = visibleNarrativeCards\.every/)
  assert.match(source, /const canShowInlineResults = resultsReady && narrativeSequenceComplete && visibleNarrativeSummariesSettled/)
  assert.match(source, /if \(canShowInlineResults\) \{[\s\S]*?return undefined[\s\S]*?\}/)
  assert.match(source, /canShowInlineResults && inlineResults \? <div className=\{styles\.inlineResultsSlot\}>\{inlineResults\}<\/div> : null/)
  assert.doesNotMatch(source, literalPattern('if (resultsReady) {\n      return undefined\n    }\n\n    const intervalId'))
})

test('DeepScan inline conclusion waits until visible team summaries finish', () => {
  const source = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')

  assert.match(source, /summaryState\?\.inputKey !== inputKey/)
  assert.match(source, /return false/)
  assert.match(source, /summaryState\.status === 'success'/)
  assert.match(source, /return summaryState\.status === 'error'/)
  assert.match(source, /summaryFailed/)
  assert.match(source, /요약 생략/)
  assert.doesNotMatch(source, /const canShowInlineResults = resultsReady && narrativeSequenceComplete\s*$/m)
})

test('DeepScan loading screen only fetches internal team summaries and avoids result CTA', () => {
  const source = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')

  assert.match(source, /fetch\('\/api\/deepscan\/team-summary'/)
  assert.match(source, /card\.summarizable/)
  assert.match(source, /summarizable: teamBody\.readyCount > 0 && teamBody\.readyCount \+ teamBody\.errorCount === team\.members\.length/)
  assert.doesNotMatch(source, /summarizable: teamBody\.readyCount === team\.members\.length/)
  assert.match(source, /teamName: card\.analystName/)
  assert.doesNotMatch(source, /강세|손절|보유 유지|즉시 매도|최종 판단|최종 요약/u)
  assert.doesNotMatch(source, /상세 결과 보기|상세보기|아래 버튼/u)
  assert.match(source, /inlineResults/)
})

test('/deepscan renders inline results without confirmed-result CTA gate', () => {
  const source = readRepoFile('src', 'app', 'deepscan', 'page.tsx')

  assert.match(source, /import \{ DeepScanInlineResults \}/)
  assert.match(source, /fetchState === 'loading' \|\| isCommitteeHydrating \|\| rawResultsReady/)
  assert.match(source, /inlineResults=\{resultsReady && payload \? <DeepScanInlineResults/)
  assert.doesNotMatch(source, /confirmedResultsTargetKey/)
  assert.doesNotMatch(source, /hasConfirmedResultsView/)
  assert.doesNotMatch(source, /resultsReady && !/)
})

test('DeepScan team bubbles send raw member reasons for summaries but hide raw gray copy in the UI', () => {
  const loadingSource = readRepoFile('src', 'components', 'deepscan-loading-screen.tsx')
  const pageSource = readRepoFile('src', 'app', 'deepscan', 'page.tsx')
  const routeSource = readRepoFile('src', 'app', 'api', 'deepscan', 'committee-status', 'route.ts')
  const summaryRouteSource = readRepoFile('src', 'app', 'api', 'deepscan', 'team-summary', 'route.ts')

  assert.match(loadingSource, /member\.reason/)
  assert.match(loadingSource, /`\$\{definition\.alias\}: \$\{member\.reason\}`/)
  assert.match(loadingSource, /`\$\{definition\.alias\}: 응답 대기 중`/)
  assert.match(loadingSource, /const summaryText = summaryReady \? summaryState\.summary! : null/)
  assert.match(loadingSource, /const displaySummaryText = summaryText \?\?/)
  assert.match(loadingSource, /const showSummarySkeleton = !card\.placeholder && !displaySummaryText/)
  assert.match(loadingSource, /card\.placeholder \|\| showSummarySkeleton/)
  assert.doesNotMatch(loadingSource, /const displayBody = summaryReady \? summaryState\.summary! : card\.body/)
  assert.doesNotMatch(loadingSource, /\{displayBody\}/)
  assert.doesNotMatch(loadingSource, /원문 표시/)
  assert.match(loadingSource, /<p className=\{cn\(styles\.narrativeText/)
  assert.match(loadingSource, /white-space: pre-line|styles\.narrativeText/)
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteUnavailableBody))
  assert.doesNotMatch(loadingSource, literalPattern(`${obsoleteCompactHelper}(member.reason`))
  assert.doesNotMatch(loadingSource, literalPattern(obsoletePendingBodyGate))
  assert.doesNotMatch(loadingSource, /외 \$\{.*\}명/u)
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteUnavailableCopy))
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteSummaryField))
  assert.doesNotMatch(pageSource, literalPattern(obsoleteSummaryField))
  assert.doesNotMatch(routeSource, literalPattern(obsoleteSummaryField))
  assert.doesNotMatch(summaryRouteSource, literalPattern(obsoleteSummaryField))
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteServiceName))
  assert.doesNotMatch(loadingSource, literalPattern(obsoleteKoreanLens))
})
