import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// 설치된 next(dist)의 실제 컨벤션 정규식 엔진으로 판정한다.
// Next 16.x 는 app/ 안 icon 파일명으로 icon, icon<한 자리 숫자>, icon-<6자 해시>
// 만 메타데이터 라우트로 인식한다. 그 외 이름(예: icon-192.png)은 라우트로
// 컴파일되지 않아 서빙되지도, <link rel=icon> 태그도 만들지 않는 죽은 파일이 된다.
const { isMetadataRouteFile } = require('next/dist/lib/metadata/is-metadata-route')

const appDir = path.join(__dirname, '..', 'src', 'app')
const appRootFiles = fs.readdirSync(appDir).filter((f) => fs.statSync(path.join(appDir, f)).isFile())

// app/ 루트의 icon* / apple-icon* / opengraph-image* / twitter-image* 정적 파일 전부
const iconConventionFiles = appRootFiles.filter((f) =>
  /^(icon|apple-icon|opengraph-image|twitter-image|favicon)/.test(f),
)

test('app/ 루트의 모든 정적 아이콘/OG 파일은 Next 메타데이터 라우트 컨벤션을 만족한다', () => {
  assert.ok(iconConventionFiles.length > 0, '아이콘 컨벤션 파일이 최소 1개는 있어야 한다')
  for (const file of iconConventionFiles) {
    const relative = `/${file}`
    assert.equal(
      isMetadataRouteFile(relative, [], true),
      true,
      `${relative} 은(는) isMetadataRouteFile=false — 서빙되지도 link 태그도 생성되지 않는 죽은 파일이다. ` +
        '컨벤션명(icon.svg, icon1.png, apple-icon.png, favicon.ico...) 또는 public/ + metadata.icons 를 사용하라',
    )
  }
})

function pngSize(p) {
  const b = fs.readFileSync(p)
  assert.equal(b.readUInt32BE(0), 0x89504e47, `${p} 는 PNG 시그니처여야 한다`)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

test('icon1/icon2 는 PWA 표준 192/512 치수를 가진다(Next 가 sizes 속성을 여기서 유도)', () => {
  const s1 = pngSize(path.join(appDir, 'icon1.png'))
  assert.deepEqual(s1, { width: 192, height: 192 })
  const s2 = pngSize(path.join(appDir, 'icon2.png'))
  assert.deepEqual(s2, { width: 512, height: 512 })
})
