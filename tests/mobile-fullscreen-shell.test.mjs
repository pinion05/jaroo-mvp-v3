import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const shellSource = readFileSync('src/components/jaroo-shell.tsx', 'utf8')
const layoutSource = readFileSync('src/app/layout.tsx', 'utf8')
const homeCss = readFileSync('src/components/home/jaroo-home-screen.module.css', 'utf8')
const deepScanPageSource = readFileSync('src/app/deepscan/page.tsx', 'utf8')
const loadingCss = readFileSync('src/components/deepscan-loading-screen.module.css', 'utf8')

test('mobile Jaroo shell uses full viewport and keeps 390px default desktop frame', () => {
  // 폰 프레임(캔버스 + 390px 박스)은 루트 layout.tsx 가 소유한다.
  // jaroo-shell 은 프레임 안쪽(header/main/bottomNav)만 담당한다.
  assert.match(layoutSource, /min-h-dvh w-full bg-\[color:var\(--jaroo-canvas\)\] sm:px-6 sm:py-4/)
  assert.match(layoutSource, /relative mx-auto flex h-dvh w-full flex-col overflow-hidden bg-white /)
  assert.match(layoutSource, /sm:h-\[calc\(100dvh-2rem\)\] sm:max-w-\[390px\]/)
  assert.match(layoutSource, /sm:rounded-\[32px\]/)
  // 셸은 프레임을 h-full 로 채우고, 화면별 프레임 오버라이드를 주입받을 수 있다.
  assert.match(shellSource, /frameClassName\?: string/)
  assert.match(shellSource, /cn\('relative flex h-full w-full flex-col', frameClassName\)/)
  // 모바일 풀블리드 훼손 방지: 프레임 박스가 무접두사 max-w 를 쓰면 폰에서 좌우 거터에 앱이 잘려 보인다.
  assert.doesNotMatch(layoutSource, /className='min-h-screen bg-\[color:var\(--jaroo-canvas\)\] px-3 py-4/)
})

test('root phone frame owns fixed overlays via transform containing block', () => {
  // 프레임 안 position:fixed 오버레이(모달/딥스캔 로딩)가 데스크톱에서 뷰포트 전체로
  // 탈출하지 않게, 폰 박스가 fixed 의 containing block 이 된다.
  assert.match(layoutSource, /\[transform:translateZ\(0\)\]/)
})

test('DeepScan page fills the root frame instead of drawing another phone box', () => {
  // 중첩 폰 박스 금지: 자체 캔버스/340px 박스를 그리지 않고 루트 프레임을 채운다.
  assert.doesNotMatch(deepScanPageSource, /sm:max-w-\[340px\]/)
  assert.doesNotMatch(deepScanPageSource, /sm:rounded-\[32px\]/)
  assert.doesNotMatch(deepScanPageSource, /sm:bg-\[color:var\(--jaroo-canvas\)\]/)
  assert.match(deepScanPageSource, /className='flex h-full w-full justify-center bg-white'/)
  assert.match(deepScanPageSource, /frameClassName='w-full'/)
})

test('in-frame overlays use frame-relative sizes, not viewport units', () => {
  // 오버레이 내부 폭은 프레임 기준(100%)이어야 한다. 100vw 는 데스크톱에서
  // 뷰포트 폭을 참조해 프레임보다 커지거나 어긋난다.
  assert.match(homeCss, /\.deepScanLoadingInner\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/)
  assert.match(homeCss, /\.sheet\s*\{[\s\S]*?width:\s*100%;/)
  assert.doesNotMatch(homeCss, /min\(100vw/)
  // 로딩 카드도 뷰포트가 아니라 프레임 높이를 채운다.
  assert.match(loadingCss, /min-height:\s*100%;[\s\S]*?height:\s*100%;/)
  assert.doesNotMatch(loadingCss, /100dvh/)
})

test('no app page draws a second phone box inside the root frame', () => {
  // sm:rounded-[32px] 폰 박스와 자체 캔버스는 layout.tsx 만 소유할 수 있다.
  const appDir = 'src/app'
  const pages = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx$/.test(entry) && entry !== 'layout.tsx') pages.push(full)
    }
  }
  walk(appDir)
  const offenders = pages.filter((p) => /sm:rounded-\[32px\]|sm:max-w-\[340px\]/.test(readFileSync(p, 'utf8')))
  assert.deepEqual(
    offenders,
    [],
    '루트 PhoneFrame 안에 또 폰 박스를 그리는 페이지가 있다: ' + offenders.join(', '),
  )
})
