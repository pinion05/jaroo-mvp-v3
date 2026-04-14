import test from 'node:test'
import assert from 'node:assert/strict'

import { buildUsdKrwFxUpstreamUrl } from './route'

test('usd krw fx proxy는 crawler endpoint url을 그대로 조합한다', () => {
  const url = buildUsdKrwFxUpstreamUrl('http://127.0.0.1:3040')

  assert.equal(url, 'http://127.0.0.1:3040/api/market/fx/usd-krw')
})
