import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OCR_SCHEMA,
  OCR_SYSTEM_PROMPT,
  extractJsonObjectText,
  extractOpenRouterErrorMessage,
  extractOpenRouterErrorStatus,
  toPublicOcrErrorMessage,
} from './route'

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

test('OCR schema requires signed row-level profitAmount', () => {
  const rowSchema = OCR_SCHEMA.schema.properties.rows.items

  assert.equal(rowSchema.properties.profitAmount.type, 'string')
  assert.equal(rowSchema.required.includes('profitAmount'), true)
})

test('OCR prompt carries P/L amount sign into unsigned parenthesized return', () => {
  assert.match(OCR_SYSTEM_PROMPT, /profitAmount/)
  assert.match(OCR_SYSTEM_PROMPT, /-13,263[^\n]*\(6\.8%\)[\s\S]*-6\.8%/)
  assert.match(OCR_SYSTEM_PROMPT, /\+262,740[^\n]*\(12\.7%\)[\s\S]*\+12\.7%/)
})
