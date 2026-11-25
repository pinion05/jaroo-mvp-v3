import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// OCR 리뷰 페이지는 'use client' 컴포넌트라 이 프로젝트의 웹 TS 테스트 인프라
// (tsx --test, React 렌더링 환경 없음)로 동작 단위 테스트가 불가능하다 — 여기선
// 배선만 정적 매칭으로 확인한다. sanitize 헬퍼의 '동작'은 screenshot-ocr.test.ts의
// normalizeKindChoice 직접 테스트가 담당한다.
const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

test('OCR 수정 패널의 kind sanitize는 normalizeKindChoice 헬퍼로 배선된다', () => {
  // 789행 위치의 인라인 'stock'||'etf' 화이트리스트가 제거되고 헬퍼를 쓴다
  assert.match(source, /normalizeKindChoice\(normalizedValue\)/)
  assert.doesNotMatch(source, /normalizedValue === 'stock' \|\| normalizedValue === 'etf'/)
  assert.match(source, /import \{[^}]*normalizeKindChoice[^}]*\} from '@\/lib\/screenshot-ocr'/)
})

test('OCR 페이지의 inferMarketTone은 screenshot-ocr export를 import한다(로컬 중복 정의 없음)', () => {
  assert.match(source, /import \{[^}]*inferMarketTone[^}]*\} from '@\/lib\/screenshot-ocr'/)
  // 컴포넌트 내부 function 정의가 다시 생기면 추출이 무의미해진다
  assert.doesNotMatch(source, /function inferMarketTone\(/)
})

test('OCR 적용 직후 업로드 세션 정리는 언마운트 시점에 한다(2026-10-29)', () => {
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
  // handleContinue 안에서 push 직전에 store를 지우면 아직 마운트된 /ocr이
  // '0개 종목 인식' 상태로 깜빡인다(실측 재현) — 정리는 언마운트 클린업으로.
  const handleContinueBody = page.slice(page.indexOf('const handleContinue'), page.indexOf('isIdentifierResolving'))
  assert.ok(handleContinueBody.includes("router.push('/home')"), '적용 후 홈으로 이동한다')
  assert.ok(!handleContinueBody.includes('clearUploadInput()'), 'handleContinue 안에서 업로드 store를 동기 삭제하지 않는다')
  assert.match(page, /useEffect\(\(\) => \(\) => \{\n    if \(isLeavingAfterApplyRef\.current\) \{\n      clearPersistedScreenshotUploadSession\(\)\n      clearUploadInput\(\)\n    \}\n  \}, \[clearUploadInput\]\)/, '적용 후 이탈 시 언마운트 클린업에서 세션을 정리한다')
  // 시세 프리페치 — push 전에 완료 또는 상한까지 기다려 홈 첫 프레임의 '- · -' 갭을 없앤다
  assert.ok(handleContinueBody.includes('await Promise.race(['), '적용 후 push 전 시세 프리페치를 상한과 함께 기다린다')
  assert.ok(handleContinueBody.includes('OCR_APPLY_QUOTE_PREFETCH_CAP_MS'), '프리페치 상한 상수를 참조한다')
})

test('OCR 적용은 기존 포트폴리오와 병합한 결과를 저장한다(재적용 때 기존 종목 보존, 2026-11)', () => {
  const page = source
  const handleContinueBody = page.slice(page.indexOf('const handleContinue'), page.indexOf('isIdentifierResolving'))

  // 적용 시점에 기존 포트폴리오를 다시 읽고(다른 기기 변경 반영), 이번 묶음만이 아니라 병합 결과로 저장한다.
  assert.ok(handleContinueBody.includes('resolveExistingPortfolioForMerge()'), '적용 시점에 기존 포트폴리오를 읽는다')
  assert.ok(handleContinueBody.includes('persistMergedAppliedPortfolio({'), '병합 적용 함수로 세션·스토어를 갱신한다')
  assert.ok(handleContinueBody.includes('syncMergedPortfolioAfterApply(existing, applyResult.plan.rows)'), '서버에는 병합 결과 전체를 보낸다')
  assert.ok(handleContinueBody.includes('replacePortfolioItems(applyResult.mergedItems)'), '스토어도 병합 결과로 교체한다')
  // 이번 묶음만 서버로 보내 저장 RPC 의 전체 교체를 유발하던 옛 호출이 남아 있지 않아야 한다.
  assert.ok(!page.includes('syncPortfolioToServer('), '이번 묶음만 보내는 옛 저장 호출이 없다')
  assert.ok(!page.includes('persistAppliedPortfolioFromMergeRows'), '교체 방식 적용 함수가 쓰이지 않는다')
  // 겹치는 종목 선택 UI 가 검수 화면에 연결돼 있다.
  assert.match(page, /import \{ PortfolioOverlapChoices \} from '@\/components\/ocr\/portfolio-overlap-choices'/)
  assert.match(page, /plan=\{mergePlan\}/)
  // 기존 포트폴리오를 읽기 전과 상한 초과 시에는 적용할 수 없다.
  assert.match(page, /&& existingPortfolio !== null\n    && !exceedsRowLimit\n    && applyStatus !== 'loading'/)
})
