import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/app/ocr/page.tsx', import.meta.url), 'utf8')

test('OCR apply navigation suppresses screenshot redirect after successful apply', () => {
  assert.match(source, /const appliedPortfolioNavigationRef = useRef\(false\)/)

  const noSessionBlock = source.slice(source.indexOf('if (!session) {'), source.indexOf('setUploadStatuses(\n      Object.fromEntries'))
  assert.match(noSessionBlock, /if \(appliedPortfolioNavigationRef\.current\) \{\n\s+return\n\s+\}/)
  assert.ok(
    noSessionBlock.indexOf('appliedPortfolioNavigationRef.current') < noSessionBlock.indexOf("router.replace('/screenshot')"),
    'successful apply guard must run before screenshot redirect',
  )
})

test('OCR apply sets guard after portfolio persistence succeeds and before upload session cleanup', () => {
  const applyBlock = source.slice(source.indexOf('const handleContinue = () =>'), source.indexOf('const isIdentifierResolving'))
  assert.ok(
    applyBlock.indexOf('if (!applyResult.persisted || applyResult.normalizedItems.length === 0)')
      < applyBlock.indexOf('appliedPortfolioNavigationRef.current = true'),
    'guard should only be set after persisted apply result is validated',
  )
  assert.ok(
    applyBlock.indexOf('appliedPortfolioNavigationRef.current = true')
      < applyBlock.indexOf('clearPersistedScreenshotUploadSession()'),
    'guard must be set before clearing OCR upload session',
  )
  assert.ok(
    applyBlock.indexOf('clearUploadInput()') < applyBlock.indexOf("router.push('/home')"),
    'home navigation should remain the final successful apply navigation',
  )
  assert.match(applyBlock, /catch \(error\) \{\n\s+appliedPortfolioNavigationRef\.current = false/)
})
