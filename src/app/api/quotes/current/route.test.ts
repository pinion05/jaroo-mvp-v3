import test from 'node:test'
import assert from 'node:assert/strict'

import { buildQuotesCurrentUpstreamUrl } from './route'

test('quotes current proxy는 crawler endpoint url을 그대로 조합한다', () => {
  const url = buildQuotesCurrentUpstreamUrl('http://127.0.0.1:3040', new URL('http://localhost/api/quotes/current?codes=005930&tickers=AAPL').searchParams)

  assert.equal(url, 'http://127.0.0.1:3040/api/quotes/current?codes=005930&tickers=AAPL')
})
