import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// PR #346(파비콘·메타 타이틀·OG 태그 폴리싱) 회귀 가드.
// jaroo.kr이 <title>jaroo-mvp-v3</title>·영어 플레이스홀더로 노출되고 OG 태그 0개였던
// 상태로 돌아가지 않도록, 루트 레이아웃 메타데이터와 정적 브랜딩 자산을 검증한다.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function readText(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function readBinary(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath))
}

const layoutSource = readText('src/app/layout.tsx')

test('루트 메타데이터는 한글 브랜드 타이틀·설명과 jaroo.kr metadataBase를 노출한다', () => {
  // 2026-11-05 이전에는 <title>jaroo-mvp-v3</title> 플레이스홀더가 그대로 노출됐다.
  assert.doesNotMatch(layoutSource, /title:\s*'jaroo-mvp-v3'/)
  assert.match(layoutSource, /title: 'Jaroo — MTS 스크린샷 한 장으로 AI 주식 진단'/)
  assert.match(layoutSource, /applicationName: 'Jaroo'/)
  // 한국어 서비스 설명 (영어 플레이스홀더 회귀 방지)
  assert.match(
    layoutSource,
    /MTS 스크린샷 한 장만 올리면 AI 위원회가 내 포트폴리오를 진단합니다/,
  )
  // metadataBase: 상대 경로 OG 이미지를 절대 URL로 만든다. 기본 jaroo.kr,
  // NEXT_PUBLIC_SITE_URL 오버라이드 허용(카톡/디스코드 크롤러는 상대 경로를 무시한다).
  assert.match(
    layoutSource,
    /const SITE_URL = process\.env\.NEXT_PUBLIC_SITE_URL\?\.trim\(\) \|\| 'https:\/\/jaroo\.kr'/,
  )
  assert.match(layoutSource, /metadataBase: new URL\(SITE_URL\)/)
})

test('OG·트위터 카드가 ko_KR 로케일과 1200x630 공유 이미지로 설정된다', () => {
  assert.match(layoutSource, /openGraph: \{/)
  assert.match(layoutSource, /type: 'website'/)
  assert.match(layoutSource, /locale: 'ko_KR'/)
  assert.match(layoutSource, /siteName: 'Jaroo'/)
  assert.match(layoutSource, /url: '\/'/)
  // OG 이미지: 크기 명시(1200x630) + 한국어 alt
  assert.match(
    layoutSource,
    /images: \[\s*\{\s*url: '\/opengraph-image\.png',\s*width: 1200,\s*height: 630,\s*alt:/,
  )
  // 트위터 카드는 큰 이미지 요약형
  assert.match(layoutSource, /twitter: \{[\s\S]*?card: 'summary_large_image'/)
  assert.match(layoutSource, /images: \['\/opengraph-image\.png'\]/)
})

test('themeColor는 Next 16 규약대로 viewport export에 있고 metadata 안에 없다', () => {
  // Next 16: metadata.viewport는 지원되지 않고 viewport export로 분리되어 있다.
  assert.match(layoutSource, /export const viewport: Viewport = \{[\s\S]*?themeColor: '#eef4f8'/)
  const metadataBlock = layoutSource.match(/export const metadata: Metadata = \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(metadataBlock.length > 0, 'metadata export 블록이 있어야 한다')
  assert.doesNotMatch(metadataBlock, /themeColor/)
  assert.doesNotMatch(metadataBlock, /viewport/)
})

test('파비콘·아이콘·OG 이미지 정적 자산이 src/app 에 존재하고 형식이 맞다', () => {
  // ICO: ICONDIR 시그니처(00 00 01 00)
  const ico = readBinary('src/app/favicon.ico')
  assert.ok(ico.length > 0, 'favicon.ico가 존재해야 한다')
  assert.equal(ico.subarray(0, 4).toString('hex'), '00000100', 'favicon.ico는 ICO 시그니처여야 한다')

  // 벡터 아이콘
  const svg = readText('src/app/icon.svg')
  assert.match(svg, /<svg[^>]*viewBox="0 0 512 512"/)

  // PNG 시그니처(8950 4e47 0d0a 1a0a)
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (const asset of [
    'src/app/apple-icon.png',
    'src/app/icon-192.png',
    'src/app/icon-512.png',
    'src/app/opengraph-image.png',
  ]) {
    const png = readBinary(asset)
    assert.ok(png.length > 0, `${asset} 이 존재해야 한다`)
    assert.deepEqual(
      [...png.subarray(0, 8)],
      pngSignature,
      `${asset} 는 PNG 시그니처여야 한다`,
    )
  }

  // OG 이미지 실제 크기 = 메타데이터 선언(1200x630). PNG IHDR: offset 16 width, 20 height(BE)
  const og = readBinary('src/app/opengraph-image.png')
  assert.equal(og.readUInt32BE(16), 1200, 'opengraph-image.png 너비는 1200이어야 한다')
  assert.equal(og.readUInt32BE(20), 630, 'opengraph-image.png 높이는 630이어야 한다')
})
