import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const globals = readFileSync('src/app/globals.css', 'utf8')
const homeStyles = readFileSync('src/components/home/jaroo-home-screen.module.css', 'utf8')
const deepScanSource = readFileSync('src/components/deepscan-loading-screen.tsx', 'utf8')
const deepScanBriefingCardSource = readFileSync('src/components/deepscan-loading-briefing-card.tsx', 'utf8')
const deepScanStyles = readFileSync('src/components/deepscan-loading-screen.module.css', 'utf8')
const ocrSource = readFileSync('src/app/ocr/page.tsx', 'utf8')
const screenshotSource = readFileSync('src/app/screenshot/page.tsx', 'utf8')
const mergeSource = readFileSync('src/components/merge/jaroo-merge-screen.tsx', 'utf8')
const conflictSource = readFileSync('src/components/ocr-conflict-merge-card.tsx', 'utf8')
const etfSource = readFileSync('src/app/etf/page.tsx', 'utf8')
const shareCardSource = readFileSync('src/app/sharecard/page.tsx', 'utf8')

test('국내 금융 관례용 수익·손실 색상 토큰을 일반 성공·오류 색상과 분리한다', () => {
  assert.match(globals, /--jaroo-profit:\s*#d83a42/i)
  assert.match(globals, /--jaroo-loss:\s*#2b6be6/i)
  // §7: 초록 제거 — 일반 성공은 중립 먹색, 금융 긍정은 profit(빨강) 토큰으로 분리
  assert.match(globals, /--jaroo-success:\s*#0f1419/i)
  assert.doesNotMatch(globals, /#(1a9d55|2d7d46|3b6d11|1a7340|1d9e75)/i)
  assert.match(globals, /--jaroo-danger:\s*#c23938/i)
})

test('홈과 DeepScan 수익률은 수익=빨강, 손실=파랑 토큰을 사용한다', () => {
  assert.match(homeStyles, /\.up\s*\{[^}]*color:\s*var\(--jaroo-profit\)/s)
  assert.match(homeStyles, /\.down\s*\{[^}]*color:\s*var\(--jaroo-loss\)/s)
  assert.match(homeStyles, /\.stockAmt\.up\s*\{[^}]*color:\s*var\(--jaroo-profit\)/s)
  assert.match(homeStyles, /\.stockAmt\.down\s*\{[^}]*color:\s*var\(--jaroo-loss\)/s)
  assert.match(deepScanStyles, /\.gain\s*\{[^}]*color:\s*var\(--jaroo-profit\)/s)
  assert.match(deepScanStyles, /\.loss\s*\{[^}]*color:\s*var\(--jaroo-loss\)/s)
  assert.match(deepScanSource, /financialToneClass\(returnRateDisplay\.current\)/)
  assert.match(deepScanSource, /financialToneClass\(returnRateDisplay\.snapshot\)/)
  // 평가손익 톤은 로딩 브리핑 카드가 계산·적용한다 (calculated 우선, OCR 텍스트 폴백).
  assert.match(deepScanBriefingCardSource, /financialToneClass\(calculatedProfitAmount \?\? profitAmountText\)/)
})

test('OCR 검토와 업로드 예시도 같은 국내 금융 색상 토큰을 사용한다', () => {
  assert.match(ocrSource, /\.jaroo-ocr-okr-rate\.up\{color:var\(--jaroo-profit\)\}/)
  assert.match(ocrSource, /\.jaroo-ocr-okr-rate\.down\{color:var\(--jaroo-loss\)\}/)
  assert.match(screenshotSource, /\.jaroo-upload-exr-rate\.up\{color:var\(--jaroo-profit\)\}/)
  assert.match(screenshotSource, /\.jaroo-upload-exr-rate\.down\{color:var\(--jaroo-loss\)\}/)
})

test('병합·충돌 검토·ETF·공유 카드의 손익 숫자도 공통 부호 판별을 사용한다', () => {
  assert.match(mergeSource, /getFinancialValueTextClass\(row\.profitRateText\)/)
  assert.match(conflictSource, /getFinancialValueTextClass\(candidate\.profitRate\)/)
  // /etf 유사 ETF 비교(return1y)는 1단계에서 사유 명시 카드로 대체됐고, 페이지는 딥스캔
  // 결과 화면 문법을 재사용한다 — 남은 실데이터 손익 숫자(전일 대비 등락)는 딥스캔 계열의
  // 공통 부호 판별(financialToneClass)로 검사한다 (스펙 2026-09-15 D7).
  assert.match(etfSource, /financialToneClass\(changePct\)/)
  // /sharecard 총손익은 2026-09-16 실데이터화 이후 포트폴리오 카드 모델(card.totalPnl)을 쓴다.
  assert.match(shareCardSource, /getFinancialValueTextClass\(card\.totalPnl\)/)
})

test('DeepScan 완료 뱃지는 초록 조합, 금융 상승 뱃지는 국내 관례 빨강 조합을 쓴다', () => {
  // 2026-09-16 사용자 결정: '요약 완료' 등 완료·성공 뱃지는 초록/어두운 초록(emerald).
  // globals §7(초록 제거)는 손익 숫자·일반 성공 토큰에만 적용 — 상태 뱃지는 예외로 분리.
  assert.match(deepScanStyles, /\.narrativeTonePositive\s*\{[^}]*--ds-emerald-soft[^}]*--ds-emerald/s)
  assert.match(deepScanStyles, /\.(stepDone|memberDone|badgeDone)\s*\{[^}]*--ds-emerald-soft[^}]*--ds-emerald/s)
  // 퀵팩트 positive(시세 상승·컨센서스 긍정)는 상승 계열(rise=빨강)로 매핑된다
  assert.match(deepScanStyles, /\.narrativeToneRise\s*\{[^}]*--ds-rise-soft[^}]*--ds-rise/s)
  assert.match(deepScanStyles, /\.consensusToneProfit > span\s*\{[^}]*--ds-rise-soft/s)
  // 오해를 부른 기존 토큰(값은 빨강) 정의는 제거돼야 한다(주석 언급은 허용)
  assert.doesNotMatch(deepScanStyles, /--ds-green(-soft)?\s*:/)
})
