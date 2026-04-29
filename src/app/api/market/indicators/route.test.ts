import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMarketIndicatorsUpstreamUrl } from './route'

test('market indicators proxy는 crawler endpoint url을 그대로 조합한다', () => {
  const url = buildMarketIndicatorsUpstreamUrl('http://127.0.0.1:3040')

  assert.equal(url, 'http://127.0.0.1:3040/api/source/stockplus-adrinfo-investing/market/indicators')
})
