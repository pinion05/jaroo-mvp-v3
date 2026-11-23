import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

// TC-BBSC-007 정적 계약 — 딥스캔 런 중 새로고침(F5) 웨지 회귀 (2026-11-09).
// 유닛 테스트(src/lib/deepscan-refresh-wedge.test.ts)가 순수 판정을 검증하면,
// 이 파일은 페이지 배선이 그 계약을 지키는지 검증한다.
//
// 웨지 근원(실측): 런 중 전체 문서 로드 → 스토어 비어 있음 → 하이드레이션이 세션
// 타깃 시드 → 이후 같은 종목을 "새 객체"로 계속 덮어써 target 참조가 매 이펙트
// 주기마다 교체 → [target] deps 이펙트(퀵시세·브리핑·정규 요청) 무한 재실행
// (로컬 재현: quotes/current 16,677회 스톰, 렌더러 RSS 30초 만에 ~1.9GB, 평가 불응).

test('계약(클라이언트): 하이드레이션 반영은 원샷 판정 함수를 통해서만 일어난다', () => {
  const page = read('src/app/deepscan/page.tsx')

  // 반영 결정은 순수 함수(resolveDeepScanHydrationApplication)로 위임한다
  assert.match(page, /resolveDeepScanHydrationApplication\(\{/)
  // 시드는 스토어가 비어 있을 때만 반영한다(원샷) — 페이지 본문에 직접 덮어쓰기
  // 판정(!target || 키 동일 시 반영)이 되돌아오지 않게 한다
  assert.doesNotMatch(page, /shouldApplyHydratedTarget = !target \|\|/)
  // 반영 결정에 현재 메모리 타깃을 전달한다
  assert.match(page, /currentTarget: target,/)
})

test('계약(클라이언트): 정규 요청 이펙트는 haltVerdict 객체가 아니라 파생 불리언만 구독한다', () => {
  const page = read('src/app/deepscan/page.tsx')

  // 게이트는 파생 불리언
  assert.match(page, /const canonicalRequestHalted = haltVerdict === 'halted'/)
  assert.match(page, /requestStatus !== 'loading' \|\| canonicalRequestHalted\)/)
  // 이펙트 deps에 haltVerdict 객체 정체성이 남아 있지 않다
  const depsMatch = page.match(/\}, \[abandonInFlight, appendArrivedLoadingStageKeys, ([^\]]+)\]\)/)
  assert.ok(depsMatch, '정규 요청 이펙트 deps 배열을 찾을 수 없다')
  assert.ok(!depsMatch[1].includes('haltVerdict'), `deps에 haltVerdict이 남아 있다: ${depsMatch[1]}`)
  assert.ok(depsMatch[1].includes('canonicalRequestHalted'), `deps에 canonicalRequestHalted이 없다: ${depsMatch[1]}`)
})

test('계약(클라이언트): 하이드레이션 이펙트는 target 참조가 바뀌어도 재반영하지 않는다(수렴 조건)', () => {
  const page = read('src/app/deepscan/page.tsx')

  // 원샷 판정 함수가 currentTarget(=target)을 받아 apply=false로 수렴시킨다.
  // 이 계약과 유닛 테스트(재판정 50회 모두 apply=false)가 함께 루프 종결을 보장한다.
  assert.match(page, /void hydrateTarget\(\)/)
  assert.match(page, /setHydrationChecked\(true\)/)
})

// TC-BBSC-005 정적 계약 — 종결 후 로딩 문구 소거.
test('계약(클라이언트): 팀 브리지 카드는 진행 중에만 마운트된다 — 종결 후 라벨 잔존 금지', () => {
  const screen = read('src/components/deepscan-loading-screen.tsx')

  // 조건부 렌더: bridge 상태가 없으면 섹션 자체를 DOM에서 소거한다
  assert.match(screen, /\{teamBridgeState \? \(/)
  assert.match(screen, /aria-label='세 팀 분석 전환 상태'>/)
  // 폴백 문구("세 팀이 의견을 정리하는 중…" ?? 폴백)로 상시 렌더하지 않는다
  assert.doesNotMatch(screen, /teamBridgeState\?\.statusText \?\?/)
  // 완료 상태용 CSS 클래스(teamBridgeCardDone)로 가리는 구조가 되돌아오지 않는다
  assert.doesNotMatch(screen, /teamBridgeCardDone/)
})
