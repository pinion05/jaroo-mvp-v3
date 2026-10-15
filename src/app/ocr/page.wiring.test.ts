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
