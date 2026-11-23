import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOCK_OCR_ROWS,
  OCR_SCHEMA,
  OCR_SYSTEM_PROMPT,
  extractJsonObjectText,
  extractOpenRouterErrorMessage,
  extractOpenRouterErrorStatus,
  toPublicOcrErrorMessage,
} from './shared'

test('OpenRouter가 HTTP 200으로 error payload를 내려도 메시지를 추출한다', () => {
  const message = extractOpenRouterErrorMessage({
    error: {
      message: 'Upstream error from Alibaba: invalid image size',
    },
  })

  assert.equal(message, 'Upstream error from Alibaba: invalid image size')
})

test('OpenRouter가 error.code를 주면 그 상태 코드를 사용한다', () => {
  const status = extractOpenRouterErrorStatus({
    error: {
      message: 'boom',
      code: 502,
    },
  } as never)

  assert.equal(status, 502)
})

test('정상 payload 에서는 error message가 없다', () => {
  const message = extractOpenRouterErrorMessage({
    choices: [
      {
        message: {
          content: '{"rows":[]}',
        },
      },
    ],
  })

  assert.equal(message, '')
})

test('OCR upstream key limit errors are not exposed verbatim', () => {
  const message = toPublicOcrErrorMessage('Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/key-id')

  assert.equal(message, 'OCR 사용량 한도를 초과했어요. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.')
  assert.doesNotMatch(message, /openrouter|key-id/i)
})

test('extractJsonObjectText accepts fenced JSON from schema-free OCR models', () => {
  assert.equal(extractJsonObjectText('```json\n{"rows":[]}\n```'), '{"rows":[]}')
  assert.equal(extractJsonObjectText('prefix {"rows":[]} suffix'), '{"rows":[]}')
})

test('OCR schema extracts only name/quantity/profitRate with optional 평단·식별자', () => {
  const rowSchema = OCR_SCHEMA.schema.properties.rows.items
  const properties = rowSchema.properties as Record<string, unknown>
  const requiredFields = rowSchema.required as readonly string[]

  assert.deepEqual([...requiredFields], ['name', 'quantity', 'profitRate'])
  assert.equal(properties.profitAmount, undefined)
  assert.equal(properties.evaluationAmount, undefined)
  assert.equal((properties.averagePrice as { type?: string }).type, 'string')
  assert.equal(requiredFields.includes('averagePrice'), false)
})

test('OCR schema allows optional direct averagePrice and prompt guards purchase-price confusion', () => {
  const rowSchema = OCR_SCHEMA.schema.properties.rows.items

  assert.equal(rowSchema.properties.averagePrice.type, 'string')
  assert.equal((rowSchema.required as readonly string[]).includes('averagePrice'), false)
  assert.match(OCR_SYSTEM_PROMPT, /매입가, 매입단가, 평단/)
  assert.match(OCR_SYSTEM_PROMPT, /Never use a total purchase amount/)
})

test('OCR prompt은 거래량 오인 방지와 색상 부호 규칙을 유지한다', () => {
  assert.match(OCR_SYSTEM_PROMPT, /거래량/)
  assert.match(OCR_SYSTEM_PROMPT, /red means profit \(\+\), blue means loss \(-\)/)
  assert.match(OCR_SYSTEM_PROMPT, /-13,263 \(6\.8%\)[^\n]*"-6\.8%"/)
  assert.match(OCR_SYSTEM_PROMPT, /\+262,740 \(12\.7%\)[^\n]*"\+12\.7%"/)
})

// --- JAROO_LLM_MOCK=1 dev 전용 고정 픽스처(비용 0) 검증 ---

test('MOCK_OCR_ROWS 고정 픽스처는 sanitizeOcrRows 파서를 그대로 통과한다', async () => {
  const { sanitizeOcrRows } = await import('@/lib/screenshot-ocr')

  const first = sanitizeOcrRows(MOCK_OCR_ROWS)
  const second = sanitizeOcrRows(MOCK_OCR_ROWS)

  assert.equal(first.length, 3, '샘플 보유 3종이 반환돼야 한다')
  for (const row of first) {
    assert.match(row.name, /^\[MOCK\]/, '행 이름에 [MOCK] 접두가 있어야 한다')
    assert.ok(row.quantity.length > 0, '필수 필드 quantity')
    assert.ok(row.profitRate.length > 0, '필수 필드 profitRate')
  }
  assert.equal(first[0].code, '005930')
  assert.match(first[0].profitRate, /^\+/)
  assert.match(first[1].profitRate, /^-/)
  // 업로드 이미지와 무관하게 항상 같은 행(결정성).
  assert.deepEqual(first, second)
})

test('JAROO_LLM_MOCK 게이트는 기본 off이고 토글 관례(1/true/on/yes)를 따른다', async () => {
  const { isLlmMockEnabled } = await import('../../../../packages/deepscan-runtime-core/src/llm-mock.js')

  assert.equal(isLlmMockEnabled({}), false)
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: '0' }), false)
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: 'off' }), false)
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: '1' }), true)
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: 'true' }), true)
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: 'on' }), true)
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: 'yes' }), true)
})
