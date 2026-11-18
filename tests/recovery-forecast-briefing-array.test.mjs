import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('원금회수 예측은 브리핑 배열 밖 — 기존 완료 카드 자리의 독립 컴포넌트', () => {
  const briefingCard = readFileSync(new URL('../src/components/deepscan-loading-briefing-card.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(briefingCard, /recoveryForecastSource/, '배열 내 회복 아이템 소스가 없어야 한다')

  const screen = readFileSync(new URL('../src/components/deepscan-loading-screen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /<TodayRecoveryForecastBriefing at=\{0\} elapsedSeconds=\{0\} forceReady recovery=/, '완료 카드 자리에 회복 컴포넌트가 렌더되어야 한다')
  assert.match(screen, /<section ref=\{recoveryForecastRef\} className=\{styles\.todayBriefingCard\} aria-label='원금회수 예측'>/, '완료 자리 회복 컴포넌트는 개인 카드 컨테이너로 감싸져야 한다')
  assert.match(screen, /<div className=\{styles\.todayBriefList\}>/, '배열과 같은 내부 패딩 컨테이너를 쓴다')
  assert.match(screen, /&& resultsReadyForDisplay\n    && teamsSettledAtSeconds !== null\n    && elapsedSeconds >= Math\.max\(TODAY_BRIEFING_ARRAY_COMPLETE_SECONDS, teamsSettledAtSeconds\)/, '공개 순서 게이트(2026-10-29 상대 시점 전환): 배열 전체 공개 + 위원 카드 완성 시점 기준 — recoveryForecastVisible이 렌더·스크롤 공통 조건')
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
  assert.match(screen, /consensusEmptyState=\{resultsReadyForDisplay && !exchangeProduct \? DEEPSCAN_CONSENSUS_EMPTY_STATE_TEXT : null\}/, '목표가 미제공 종목은 결과 확정 뒤 빈 상태 안내로 마무리(스캘래톤이 떴다 소멸하지 않게, 2026-10-29)')
})

test('딥스캔 결과 카드의 알림 강도 선택기는 가운데 정렬이다(2026-10-29)', () => {
  const selector = readFileSync(new URL('../src/components/watch-alert-level.tsx', import.meta.url), 'utf8')
  assert.match(selector, /compact \? 'flex flex-col items-center gap-1\.5' : 'flex flex-wrap items-center gap-1\.5'/, '컴팩트 모드는 라벨·필 그룹을 세로 가운데 정렬')
  assert.match(selector, /\$\{compact \? 'text-center' : ''\}/, '컴팩트 모드 힌트도 가운데 정렬')
})

test('원금회수 브리핑 섹션 — payload에 기간별 확률이 있으면 v4 배열(마지막 칩 2년+ 터미널)로 렌더한다(2026-11-18)', () => {
  const briefingCard = readFileSync(new URL('../src/components/deepscan-loading-briefing-card.tsx', import.meta.url), 'utf8')
  // 순수 헬퍼(lib)로 칩을 뽑는다 — 결과 카드(v4, #362)와 동일 규칙 공유.
  assert.match(briefingCard, /import \{ buildRecoveryHorizonChips \} from '@\/lib\/deepscan-recovery-horizon'/, '칩 모델은 lib 단일 소스에서')
  assert.match(briefingCard, /const horizonChips = buildRecoveryHorizonChips\(recovery\)/, 'recovery 블록에서 칩 생성')
  // 세로 스택 — 라벨·% 헤더 + 풀와이드 게이지, 결과 카드와 같은 role/aria 계약. 마지막 칩은 '2년+' 터미널.
  assert.match(briefingCard, /<ul className=\{styles\.recoveryHorizonList\} role='list' aria-label='기간별 본전 회복 확률'>/, '배열 컨테이너(role=list + 카드와 동일 aria-label)')
  assert.match(briefingCard, /<span className=\{styles\.recoveryHorizonLabel\}>\{chip\.text\}<\/span>/, '기간 라벨(예: 3개월 내 / 마지막 2년+) — 문구도 lib에서')
  assert.match(briefingCard, /\{Math\.max\(chip\.value, 0\)\.toFixed\(0\)\}%/, '퍼센트 정수 표기 — 카드 v4와 동일')
  assert.match(briefingCard, /aria-label=\{`\$\{chip\.text\} 회복 확률 \$\{chip\.value\.toFixed\(1\)\}%`\}/, '게이지 aria 라벨 — 카드 v4와 동일')
  assert.match(briefingCard, /width: `\$\{Math\.min\(100, Math\.max\(1\.5, chip\.value\)\)\}%`/, '게이지 폭 클램프 — 카드 v4와 동일')
})

test('기간별 배열이 있으면 문장·모델 로우·1년 단일 게이지는 렌더하지 않는다(v4 규칙)', () => {
  const briefingCard = readFileSync(new URL('../src/components/deepscan-loading-briefing-card.tsx', import.meta.url), 'utf8')
  // "1년 안에 본전 도달" 문구·게이지는 !hasHorizonChips 게이트 뒤로.
  assert.match(briefingCard, /\{!hasHorizonChips && probabilityPct !== null \? <span className=\{styles\.recoveryProbText\}> · 1년 안에 본전 도달/, '1년 문구는 폴백 전용')
  assert.match(briefingCard, /\{!hasHorizonChips && probabilityPct !== null \? \(\s*<div\s*className=\{styles\.recoveryGaugeTrack\}/, '1년 단일 게이지는 폴백 전용')
  // 모델 로우·요약 문장은 폴백(else) 브랜치로.
  assert.match(briefingCard, /\) : \(\s*<ul className=\{styles\.recoveryModels\}>/, '모델 로우는 배열 없을 때만')
  assert.match(briefingCard, /\{!hasHorizonChips \? \(\s*<p className=\{styles\.todayBriefMeaning\}>/, '요약 문장은 배열 없을 때만')
  // 로딩 프리뷰(LoadingBriefingRecoveryForecast)·구형 스냅샷 폴백 보존 — 기존 문구가 그대로 남는다.
  assert.match(briefingCard, /1년 안에 본전 도달 \{recovery\.recoveryProbabilityText\}/, '폴백 문구 보존')
  assert.match(briefingCard, /\(신뢰도 \{recovery\.confidenceText\}\)/, '폴백 신뢰도 표기 보존')
})

test('기간별 배열 스타일 — 세로 스택 5행(라벨·% 10px + 풀와이드 게이지)이 모듈에 정의된다', () => {
  const css = readFileSync(new URL('../src/components/deepscan-loading-screen.module.css', import.meta.url), 'utf8')
  assert.match(css, /\.recoveryHorizonList \{[^}]*flex-direction: column/, '세로 스택')
  assert.match(css, /\.recoveryHorizonLabel \{[^}]*font-size: 10px/, '라벨 10px')
  assert.match(css, /\.recoveryHorizonValue \{[^}]*font-size: 10px/, '퍼센트 10px')
  assert.match(css, /\.recoveryHorizonGaugeTrack \{[^}]*overflow: hidden/, '게이지 트랙')
  assert.match(css, /\.recoveryHorizonGaugeBar \{[^}]*height: 100%/, '게이지 바')
})

test('기간별 칩 순서·라벨은 결과 카드와 lib 단일 소스를 공유한다', () => {
  const lib = readFileSync(new URL('../src/lib/deepscan-recovery-horizon.ts', import.meta.url), 'utf8')
  assert.match(lib, /'3m', label: '3개월'/, '3개월 버킷')
  assert.match(lib, /'3y', label: '3년'/, '3년 버킷 — 파싱은 유지')
  // 3년 꼬리는 화면에서 숨기고 마지막 표시 칩을 '2년+' 터미널로 묶는다(2026-11-18).
  assert.match(lib, /RECOVERY_HORIZON_TAIL_HIDDEN_KEYS/, '꼬리 숨김 상수')
  assert.match(lib, /new Set<RecoveryHorizonKey>\(\['3y'\]\)/, '숨기는 버킷은 3년뿐')
  assert.match(lib, /text: index === visible\.length - 1 \? `\$\{chip\.label\}\+` : `\$\{chip\.label\} 내`/, '마지막 칩은 라벨+접미(2년+), 나머지는 N 내')
  const card = readFileSync(new URL('../src/components/deepscan-recovery-forecast-card.tsx', import.meta.url), 'utf8')
  assert.match(card, /import \{ buildRecoveryHorizonChips \} from '@\/lib\/deepscan-recovery-horizon'/, '카드도 lib에서 공유 받는다 — 필터·라벨 조립까지 위임')
  assert.doesNotMatch(card, /export const HORIZON_CHIP_ORDER = \[/, '카드에 로컬 중복 정의가 없어야 한다')
  assert.doesNotMatch(card, /recoveryHorizonProbabilities\?\.\[key\]/, '카드가 버킷을 직접 조립하지 않아야 한다')
})
