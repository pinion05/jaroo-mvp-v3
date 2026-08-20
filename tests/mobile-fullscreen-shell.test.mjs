import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const shellSource = readFileSync('src/components/jaroo-shell.tsx', 'utf8')
const layoutSource = readFileSync('src/app/layout.tsx', 'utf8')
const homeCss = readFileSync('src/components/home/jaroo-home-screen.module.css', 'utf8')
const deepScanPageSource = readFileSync('src/app/deepscan/page.tsx', 'utf8')

test('mobile Jaroo shell uses full viewport and keeps 390px default desktop frame', () => {
  // 폰 프레임(캔버스 + 390px 박스)은 루트 layout.tsx 가 소유한다.
  // jaroo-shell 읔 프레임 안쪽(header/main/bottomNav)만 담당한다.
  assert.match(layoutSource, /min-h-dvh w-full bg-\[color:var\(--jaroo-canvas\)\] sm:px-6 sm:py-4/)
  assert.match(
    layoutSource,
    /relative mx-auto flex h-dvh w-full flex-col overflow-hidden bg-white sm:h-\[calc\(100dvh-2rem\)\] sm:max-w-\[390px\]/,
  )
  assert.match(layoutSource, /sm:rounded-\[32px\]/)
  // 셸은 프레임을 h-full 로 채우고, 화면별 프레임 오버라이드를 주입받을 수 있다.
  assert.match(shellSource, /frameClassName\?: string/)
  assert.match(shellSource, /cn\('relative flex h-full w-full flex-col', frameClassName\)/)
  // 모바일 풀블리드 훼손 방지: 프레임 박스가 무접두사 max-w 를 쓰면 폰에서 좌우 거터에 앱이 잘려 보인다.
  assert.doesNotMatch(layoutSource, /className='min-h-screen bg-\[color:var\(--jaroo-canvas\)\] px-3 py-4/)
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
