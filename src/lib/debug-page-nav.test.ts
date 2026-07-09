import test from 'node:test'
import assert from 'node:assert/strict'

import { DEBUG_PAGE_NAV_DESKTOP_MEDIA_QUERY, shouldShowDebugPageNav } from './debug-page-nav'

test('debug page nav only appears in development desktop pointer contexts', () => {
  assert.equal(DEBUG_PAGE_NAV_DESKTOP_MEDIA_QUERY, '(min-width: 1024px) and (hover: hover) and (pointer: fine)')
  assert.equal(shouldShowDebugPageNav({ isDevelopment: false, matchesDesktopPointer: true, pathname: '/home' }), false)
  assert.equal(shouldShowDebugPageNav({ isDevelopment: true, matchesDesktopPointer: false, pathname: '/home' }), false)
  assert.equal(shouldShowDebugPageNav({ isDevelopment: true, matchesDesktopPointer: true, pathname: '/home' }), true)
})

test('debug page nav stays hidden on capture and OCR workspaces', () => {
  assert.equal(shouldShowDebugPageNav({ isDevelopment: true, matchesDesktopPointer: true, pathname: '/screenshot' }), false)
  assert.equal(shouldShowDebugPageNav({ isDevelopment: true, matchesDesktopPointer: true, pathname: '/ocr' }), false)
})
