import test from 'node:test'
import assert from 'node:assert/strict'

import { OCR_SYSTEM_PROMPT, extractOpenRouterErrorMessage, extractOpenRouterErrorStatus } from './route'

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

test('OCR prompt explains brokerage rows that show P/L amount plus parenthesized return', () => {
  assert.match(OCR_SYSTEM_PROMPT, /\+262,740 \(12\.7%\)[\s\S]*\+12\.7%/)
  assert.match(OCR_SYSTEM_PROMPT, /-13,263 \(6\.8%\)[\s\S]*-6\.8%/)
})
