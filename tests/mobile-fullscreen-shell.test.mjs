import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const shellSource = readFileSync('src/components/jaroo-shell.tsx', 'utf8')
const homeCss = readFileSync('src/components/home/jaroo-home-screen.module.css', 'utf8')
const deepScanPageSource = readFileSync('src/app/deepscan/page.tsx', 'utf8')
const homeCssBeforeDesktopMedia = homeCss.slice(0, homeCss.indexOf('@media (min-width: 768px)'))

test('mobile Jaroo shell uses the full viewport instead of a framed phone card', () => {
  assert.match(shellSource, /min-h-screen min-h-dvh bg-white text-foreground/)
  assert.match(shellSource, /min-h-screen min-h-dvh w-full flex-col overflow-hidden bg-white/)
  assert.match(shellSource, /sm:max-w-\[390px\]/)
  assert.match(shellSource, /sm:rounded-\[32px\]/)
  assert.doesNotMatch(shellSource, /className='min-h-screen bg-\[color:var\(--jaroo-canvas\)\] px-3 py-4/)
})

test('DeepScan loading handoff fills mobile before desktop framing resumes', () => {
  assert.match(deepScanPageSource, /flex min-h-screen min-h-dvh justify-center bg-white sm:bg-\[color:var\(--jaroo-canvas\)\] sm:px-6 sm:py-4/)
  assert.match(deepScanPageSource, /className='w-full overflow-hidden sm:max-w-\[390px\] sm:rounded-\[32px\] sm:border/)
  assert.doesNotMatch(deepScanPageSource, /flex min-h-screen justify-center bg-\[color:var\(--jaroo-canvas\)\] px-3 py-4/)
  assert.doesNotMatch(deepScanPageSource, /className='max-w-\[390px\] overflow-hidden rounded-\[32px\]/)
})

test('mobile home and loading screens fill the viewport before desktop framing resumes', () => {
  assert.match(homeCssBeforeDesktopMedia, /\.frame\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-height:\s*100dvh;/)
  assert.match(homeCssBeforeDesktopMedia, /\.modalInner\s*\{[\s\S]*?max-width:\s*none;[\s\S]*?height:\s*100dvh;/)
  assert.match(homeCssBeforeDesktopMedia, /\.deepScanLoadingMount\s*\{[\s\S]*?padding:\s*0;[\s\S]*?background:\s*#fff;/)
  assert.match(homeCssBeforeDesktopMedia, /\.deepScanLoadingInner\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-height:\s*100dvh;/)
  assert.match(homeCss, /@media \(min-width: 768px\) \{[\s\S]*?\.frame\s*\{[\s\S]*?width:\s*340px;/)
  assert.match(homeCss, /@media \(min-width: 768px\) \{[\s\S]*?\.deepScanLoadingInner\s*\{[\s\S]*?max-width:\s*390px;/)
})
