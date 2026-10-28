import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('원금회수 예측은 브리핑 배열 밖 — 기존 완료 카드 자리의 독립 컴포넌트', () => {
  const briefingCard = readFileSync(new URL('../src/components/deepscan-loading-briefing-card.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(briefingCard, /recoveryForecastSource/, '배열 내 회복 아이템 소스가 없어야 한다')

  const screen = readFileSync(new URL('../src/components/deepscan-loading-screen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /<TodayRecoveryForecastBriefing at=\{0\} elapsedSeconds=\{0\} forceReady recovery=/, '완료 카드 자리에 회복 컴포넌트가 렌더되어야 한다')
  assert.doesNotMatch(screen, /completionTitle|completionCard/, "완료 카드('실제 분석 결과가 도착했어요')는 제거되어야 한다")
  assert.doesNotMatch(screen, /progressDetails|세부 진행 단계/, "'세부 진행 단계·분석 상태' 접힘 컴포넌트는 제거되어야 한다")
})

test('원금회수 예측 카피 — D안 세 갈래 길 시안(2026-10-28)이 반영되어 있다', () => {
  const briefingCard = readFileSync(new URL('../src/components/deepscan-loading-briefing-card.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(briefingCard, /원금회수까지는 얼마나 걸릴까요\?/, '이해하기 어렵던 기존 질문형 제목은 제거')
  assert.match(briefingCard, /본전까지 <b>세 갈래 길<\/b>/, '세 갈래 길 섹션 라벨이 있어야 한다')
  assert.match(briefingCard, /무리 없이 /, '결론 헤드라인(무리 없이 ~ 본전까지 돌아와요)')
  assert.match(briefingCard, /recoveryFriendlyTradingDays/, '거래일 → 사람 말 환산 헬퍼(약 한 달/약 3주)')
  assert.match(briefingCard, /recoveryNeededGainPct/, '본전까지 필요 상승률 계산(손실률 → +N% 남음)')
  assert.match(briefingCard, /10번 중 /, "확률 '10번 중 N번' 표현")
  assert.match(briefingCard, /이 흐름 그대로 가면/, '유사 패턴 레인 문구')
  assert.match(briefingCard, /평범하게 흐르면/, 'GBM 레인 문구')
  assert.match(briefingCard, /출렁여도 결국에는/, '점프-확산 레인 문구')
  assert.match(briefingCard, /신뢰도 \{recovery.confidenceText\}/, '신뢰도 필')

  const css = readFileSync(new URL('../src/components/deepscan-loading-screen.module.css', import.meta.url), 'utf8')
  assert.match(css, /\.recoveryPaths \{/, '세 갈래 길 경로 리스트 스타일')
  assert.match(css, /\.recoveryHeadline \{/, '헤드라인 스타일')
  assert.doesNotMatch(css, /\.recoveryModelRow \{/, '기존 모델 도트 리스트 스타일은 제거')
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
