import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('AI 위원 카드가 공개될 때마다 화면 스크롤이 따라간다(2026-10-29)', () => {
  const screen = readFileSync(new URL('../src/components/deepscan-loading-screen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /data-narrative-card=\{card\.key\}/, '위원 카드에 스크롤 타깃 식별자(data-narrative-card)가 있어야 한다')
  assert.match(screen, /querySelectorAll<HTMLElement>\('\[data-narrative-card\]'\)/, '마지막 렌더 카드를 DOM에서 찾아 타깃으로 삼는다')
  assert.match(screen, /return startDeepScanMobileAutoScroll\(target\)/, '브리핑·브리지와 같은 모바일 오토스크롤 헬퍼로 카드 하단을 뷰에 맞춘다')
  assert.match(screen, /\[sequentialNarrativeCards\.length, settledCommitteeCardCount\]/, '새 카드 행 등장(행 수)과 스캘래톤→내용 전환(확정 수) 모두 스크롤을 유발한다')
})

test('원금회수 예측·종합 결론 등장 시 화면 스크롤이 따라간다(2026-10-29)', () => {
  const screen = readFileSync(new URL('../src/components/deepscan-loading-screen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /<section ref=\{recoveryForecastRef\} className=\{styles\.todayBriefingCard\} aria-label='원금회수 예측'>/, '원금회수 예측 섹션에 스크롤 타깃 ref가 붙는다')
  assert.match(screen, /recoveryForecastVisible \? startDeepScanMobileAutoScroll\(recoveryForecastRef\.current\) : undefined/, '원금회수 예측 등장 시 오토스크롤을 유발한다')
  assert.match(screen, /<div ref=\{inlineResultsRef\} className=\{styles\.inlineResultsSlot\}>/, '종합 결론 슬롯에 스크롤 타깃 ref가 붙는다')
  assert.match(screen, /inlineResultsReady && hasInlineResults \? startDeepScanMobileAutoScroll\(inlineResultsRef\.current\) : undefined/, '종합 결론 등장 시 오토스크롤을 유발한다')
})
