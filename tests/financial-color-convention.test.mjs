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
  assert.match(globals, /--jaroo-success:\s*#2d7d46/i)
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
  assert.match(etfSource, /getFinancialValueTextClass\(item\.return1y\)/)
  assert.match(shareCardSource, /getFinancialValueTextClass\(sharePortfolioCard\.totalPnl\)/)
})
