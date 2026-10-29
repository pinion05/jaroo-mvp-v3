import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('원금회수 예측은 브리핑 배열 밖 — 기존 완료 카드 자리의 독립 컴포넌트', () => {
  const briefingCard = readFileSync(new URL('../src/components/deepscan-loading-briefing-card.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(briefingCard, /recoveryForecastSource/, '배열 내 회복 아이템 소스가 없어야 한다')

  const screen = readFileSync(new URL('../src/components/deepscan-loading-screen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /<TodayRecoveryForecastBriefing at=\{0\} elapsedSeconds=\{0\} forceReady recovery=/, '완료 카드 자리에 회복 컴포넌트가 렌더되어야 한다')
  assert.match(screen, /<section className=\{styles\.todayBriefingCard\} aria-label='원금회수 예측'>/, '완료 자리 회복 컴포넌트는 개인 카드 컨테이너로 감싸져야 한다')
  assert.match(screen, /<div className=\{styles\.todayBriefList\}>/, '배열과 같은 내부 패딩 컨테이너를 쓴다')
  assert.match(screen, /if \(!resultsReadyForDisplay \|\| teamsSettledAtSeconds === null \|\| elapsedSeconds < Math\.max\(TODAY_BRIEFING_ARRAY_COMPLETE_SECONDS, teamsSettledAtSeconds\)\)/, '공개 순서 게이트(2026-10-29 상대 시점 전환): 배열 전체 공개 + 위원 카드 완성 시점 기준')
  assert.doesNotMatch(screen, /completionTitle|completionCard/, "완료 카드('실제 분석 결과가 도착했어요')는 제거되어야 한다")
  assert.doesNotMatch(screen, /progressDetails|세부 진행 단계/, "'세부 진행 단계·분석 상태' 접힘 컴포넌트는 제거되어야 한다")
})

test('원금회수 예측 문구 — 디자인 유지, 이해하기 쉬운 표기(2026-10-28)', () => {
  const briefingCard = readFileSync(new URL('../src/components/deepscan-loading-briefing-card.tsx', import.meta.url), 'utf8')
  assert.match(briefingCard, /recoveryFriendlyTradingDays/, '거래일 → 사람 말 환산 헬퍼(예: 20거래일(약 4주))')
  assert.match(briefingCard, /1년 안에 본전 도달/, "'1년 내' 대신 쉬운 '1년 안에 본전 도달'")
  assert.match(briefingCard, /\(신뢰도 \{recovery.confidenceText\}\)/, '신뢰도 괄호 표기')
  const payload = readFileSync(new URL('../src/lib/deepscan-runtime/build-payload.ts', import.meta.url), 'utf8')
  assert.match(payload, /비슷하게 빠졌던 과거 사례/, '모델 라벨: 유사 패턴 → 비슷하게 빠졌던 과거 사례')
  assert.match(payload, /평소처럼 움직일 때/, '모델 라벨: 일반 주가 변동 → 평소처럼 움직일 때')
  assert.match(payload, /갑자기 급등락할 때/, '모델 라벨: 급등락 반영 → 갑자기 급등락할 때')
  assert.match(payload, /본전에 도달해요/, 'summaryText 쉬운 문장')
})

test('캐시 재사용·빠른 완료에도 브리핑 배열 순차 공개가 시퀀스 끝까지 재생된다', () => {
  const screen = readFileSync(new URL('../src/components/deepscan-loading-screen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /const shouldAdvanceTimeline = elapsedSeconds < TEAM_SEQUENCE_COMPLETE_SECONDS/, '타임라인은 시퀀스 완료까지 항상 진행')
  assert.match(screen, /forceReady=\{resultsReadyForDisplay && elapsedSeconds >= TEAM_SEQUENCE_COMPLETE_SECONDS\}/, 'forceReady는 시퀀스 완료 전에는 꺼져 있어야 한다')
})

test('컨센서스(애널리스트 목표가) 아이템도 로딩 중 질문+스켈레톤이 렌더된다', () => {
  const briefingCard = readFileSync(new URL('../src/components/deepscan-loading-briefing-card.tsx', import.meta.url), 'utf8')
  assert.match(briefingCard, /consensusPendingSkeleton && !forceReady/, '데이터 없는 로딩 중 스켈레톤 브랜치가 있어야 한다')
  assert.match(briefingCard, /consensusPendingSkeleton\?: boolean/, '프롭이 선언되어야 한다')
  const screen = readFileSync(new URL('../src/components/deepscan-loading-screen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /consensusPendingSkeleton=\{!exchangeProduct\}/, '일반 주식만 스켈레톤 활성(ETF는 미표시 유지)')
})
