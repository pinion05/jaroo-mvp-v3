import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('원금회수 예측은 결과 화면에서 독립 카드가 아니라 브리핑 배열 아이템으로 렌더된다', () => {
  const inlineResults = readFileSync(new URL('../src/components/deepscan-inline-results.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(inlineResults, /DeepScanRecoveryForecastCard/, '결과 화면 바닥의 독립 카드 배치는 제거되어야 한다')

  const briefingCard = readFileSync(new URL('../src/components/deepscan-loading-briefing-card.tsx', import.meta.url), 'utf8')
  assert.match(briefingCard, /payloadRecoveryForecast\?: JarooDeepScanRecoveryForecastBlock \| null/)
  assert.match(briefingCard, /payloadRecoveryForecast && payloadRecoveryForecast\.blockState === 'ok'/, 'payload 블록이 최우선 소스여야 한다')
  assert.match(briefingCard, /recovery=\{recoveryForecastSource\}/, '배열 아이템이 통합 소스를 사용해야 한다')
  assert.match(briefingCard, /'disclaimer' in recovery/, '풀 블록의 면책 문구도 아이템 안에 렌더되어야 한다')

  const loadingScreen = readFileSync(new URL('../src/components/deepscan-loading-screen.tsx', import.meta.url), 'utf8')
  assert.match(loadingScreen, /payloadRecoveryForecast=\{payloadRecoveryForecast\}/)

  const page = readFileSync(new URL('../src/app/deepscan/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /payloadRecoveryForecast=\{payload\?\.recoveryForecast \?\? null\}/)
})

test('캐시 재사용·빠른 완료에도 브리핑 배열 순차 공개가 시퀀스 끝까지 재생된다', () => {
  const screen = readFileSync(new URL('../src/components/deepscan-loading-screen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /const shouldAdvanceTimeline = elapsedSeconds < TEAM_SEQUENCE_COMPLETE_SECONDS/, '타임라인은 시퀀스 완료까지 항상 진행')
  assert.match(screen, /forceReady=\{resultsReadyForDisplay && elapsedSeconds >= TEAM_SEQUENCE_COMPLETE_SECONDS\}/, 'forceReady는 시퀀스 완료 전에는 꺼져 있어야 한다')
  assert.match(screen, /buildCompletionState\(resultsReadyForDisplay, elapsedSeconds, snapshotCacheHit/, '상태바 즉시 완료는 유지')
})
