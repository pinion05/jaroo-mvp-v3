import test from 'node:test'
import assert from 'node:assert/strict'

import {
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
