import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const shellSource = readFileSync('src/components/jaroo-shell.tsx', 'utf8')
const homeCss = readFileSync('src/components/home/jaroo-home-screen.module.css', 'utf8')
const deepScanPageSource = readFileSync('src/app/deepscan/page.tsx', 'utf8')

test('mobile Jaroo shell uses full viewport and keeps 390px default desktop frame', () => {
  assert.match(shellSource, /min-h-screen min-h-dvh bg-white text-foreground/)
  assert.match(shellSource, /min-h-screen min-h-dvh w-full flex-col overflow-hidden bg-white/)
  assert.match(shellSource, /sm:max-w-\[390px\]/)
  assert.match(shellSource, /frameClassName\?: string/)
  assert.match(shellSource, /cn\('relative mx-auto flex min-h-screen[\s\S]*frameClassName\)/)
  assert.match(shellSource, /sm:rounded-\[32px\]/)
  assert.doesNotMatch(shellSource, /className='min-h-screen bg-\[color:var\(--jaroo-canvas\)\] px-3 py-4/)
})

test('DeepScan loading and no-target states use v7 340px desktop frame override', () => {
  assert.match(deepScanPageSource, /flex min-h-screen min-h-dvh justify-center bg-white sm:bg-\[color:var\(--jaroo-canvas\)\] sm:px-6 sm:py-4/)
  assert.match(deepScanPageSource, /className='w-full overflow-hidden sm:max-w-\[340px\] sm:rounded-\[32px\] sm:border/)
  assert.match(deepScanPageSource, /frameClassName='sm:max-w-\[340px\]'/)
  assert.doesNotMatch(deepScanPageSource, /className='w-full overflow-hidden sm:max-w-\[390px\] sm:rounded-\[32px\] sm:border/)
})

test('mobile home and DeepScan handoff fill viewport before v7 desktop framing resumes', () => {
  assert.match(homeCss, /\.frame\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-height:\s*100dvh;/)
  assert.match(homeCss, /\.modalInner\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/)
  assert.match(homeCss, /\.deepScanLoadingMount\s*\{[\s\S]*?background:\s*#fff;/)
  assert.match(homeCss, /\.deepScanLoadingInner\s*\{[\s\S]*?width:\s*min\(100vw, 340px\);[\s\S]*?height:\s*100%;/)
})
