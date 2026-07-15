import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shellSource = readFileSync('src/components/jaroo-shell.tsx', 'utf8')
const bottomNavSource = readFileSync('src/components/app-bottom-nav.tsx', 'utf8')
const deepScanSource = readFileSync('src/app/deepscan/page.tsx', 'utf8')
const deepScanLoadingSource = readFileSync('src/components/deepscan-loading-screen.tsx', 'utf8')
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
})

test('DeepScan collapsible sections expose expanded state and controlled panels', () => {
  assert.match(deepScanSource, /aria-expanded=\{isOpen\}/)
  assert.match(deepScanSource, /aria-controls=\{panelId\}/)
  assert.match(deepScanSource, /<div id=\{panelId\} hidden=\{!isOpen\}>/)
  assert.match(deepScanSource, /sectionKey='why'/)
  assert.match(deepScanSource, /sectionKey='pfSim'/)
  assert.match(deepScanSource, /aria-expanded=\{openSections\.scenarioDetail\}/)
  assert.match(deepScanSource, /aria-controls=\{scenarioDetailPanelId\}/)
  assert.match(deepScanSource, /<div id=\{scenarioDetailPanelId\} hidden=\{!openSections\.scenarioDetail\}>/)
})
