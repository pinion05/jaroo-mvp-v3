import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shellSource = readFileSync('src/components/jaroo-shell.tsx', 'utf8')
const bottomNavSource = readFileSync('src/components/app-bottom-nav.tsx', 'utf8')
const homeSource = readFileSync('src/components/home/jaroo-home-screen.tsx', 'utf8')
const deepScanLoadingSource = readFileSync('src/components/deepscan-loading-screen.tsx', 'utf8')
const deepScanLoadingStyles = readFileSync('src/components/deepscan-loading-screen.module.css', 'utf8')
const screenshotSource = readFileSync('src/app/screenshot/page.tsx', 'utf8')
const ocrSource = readFileSync('src/app/ocr/page.tsx', 'utf8')

test('Jaroo shell icon-only back link has an accessible label', () => {
  assert.match(shellSource, /aria-label='뒤로 가기'/)
  assert.match(shellSource, /<ArrowLeft[^>]+aria-hidden='true'/)
})

test('bottom nav exposes a label and current page state', () => {
  assert.match(bottomNavSource, /<nav aria-label='주요 화면'/)
  assert.match(bottomNavSource, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(bottomNavSource, /<Icon[^>]+aria-hidden='true'/)
})

test('screenshot upload keeps escape and login controls visible for guests', () => {
  assert.match(screenshotSource, /<div className='jaroo-upload-head'>/)
  assert.match(screenshotSource, /aria-label='뒤로 가기'/)
  assert.match(screenshotSource, /href='\/login'/)
  assert.match(screenshotSource, /router\.push\('\/home'\)/)
  assert.doesNotMatch(screenshotSource, /\{!isFirstPortfolio \|\| isPreparing \? \(/)
})

test('OCR manual review exposes and normalizes profit amount before recomputing average price', () => {
  assert.match(ocrSource, /평가손익/)
  assert.match(ocrSource, /field === 'profitAmount'/)
  assert.match(ocrSource, /normalizeOcrProfitAmount\(rawProfitAmount, rawProfitRate\)/)
  assert.match(ocrSource, /normalizeOcrProfitRate\(rawProfitRate, profitAmount\)/)
  assert.match(ocrSource, /nextRow\.profitAmount \?\? ''/)
})

test('DeepScan labels live and broker snapshot return rates separately', () => {
  assert.match(deepScanLoadingSource, /현재가 기준/)
  assert.match(deepScanLoadingSource, /촬영 당시/)
  assert.match(deepScanLoadingSource, /snapshotProfitRate/)
  assert.match(deepScanLoadingStyles, /\.returnRateContext\s*\{[^}]*color: var\(--ds-mid\)/s)
  assert.match(deepScanLoadingStyles, /\.snapshotReturnRate\s*\{[^}]*color: var\(--ds-mid\)[^}]*font-size: 11px/s)
})

test('expandable controls expose their expanded state to assistive tech', () => {
  // 홈 종목 행 펼침, OCR 수동 편집, DeepScan 로딩 요약 — 현재의 확장형 컨트롤들.
  assert.match(homeSource, /aria-expanded=\{open\}/)
  assert.match(ocrSource, /aria-expanded=\{isEditing\}/)
  assert.match(deepScanLoadingSource, /aria-expanded=\{summaryExpanded\}/)
})
