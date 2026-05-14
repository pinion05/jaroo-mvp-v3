import test from 'node:test'
import assert from 'node:assert/strict'

import { GET } from './route'

test('web health route는 외부 데이터 조회 없이 ok를 반환한다', async () => {
  const response = await GET()
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.service, 'jaroo-v3-web')
})
