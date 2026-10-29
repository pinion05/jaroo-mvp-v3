import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TODAY_BRIEFING_FIRST_REVEAL_SECONDS, TODAY_BRIEFING_ITEM_COUNT, TODAY_BRIEFING_ITEM_REVEAL_INTERVAL_SECONDS, TODAY_BRIEFING_SKELETON_SECONDS } from './deepscan-loading-types'

const require = createRequire(import.meta.url)
require.extensions['.css'] = (module) => {
  module.exports = new Proxy({}, { get: (_target, property) => property === '__esModule' ? false : String(property) })
}
const { TodayBriefingCard } = require('./deepscan-loading-briefing-card') as typeof import('./deepscan-loading-briefing-card')
const at = TODAY_BRIEFING_FIRST_REVEAL_SECONDS + TODAY_BRIEFING_ITEM_COUNT * TODAY_BRIEFING_ITEM_REVEAL_INTERVAL_SECONDS
const base = {
  currentPriceText: '10,000원', currentPriceCurrency: 'KRW' as const,
  averagePriceText: '9,000원', averagePriceCurrency: 'KRW' as const,
  sharesText: '1주', profitRateText: null, profitAmountText: null,
}
const consensus = { targetPriceLabel: '15,000원', targetPriceValue: 15000, currentPriceValue: 10000 }

function renderItem(props: Partial<Parameters<typeof TodayBriefingCard>[0]>) {
  const markup = renderToStaticMarkup(createElement(TodayBriefingCard, { ...base, elapsedSeconds: 0, ...props }))
  return markup.match(/<article[^>]*todayBriefConsensusItem[\s\S]*?<\/article>/u)?.[0] ?? ''
}

test('목표가가 캐시되어 있어도 다른 항목과 동일한 3초간 스켈레톤을 표시한다', () => {
  const before = renderItem({ elapsedSeconds: at - 1, consensus })
  assert.doesNotMatch(before, /todayBriefItemIn/)
  const skeleton = renderItem({ elapsedSeconds: at, consensus })
  assert.match(skeleton, /todayBriefItemIn/)
  assert.match(skeleton, /todayBriefBodyIn/)
  assert.match(skeleton, /todayBriefConsensusSkeleton/)
  assert.doesNotMatch(skeleton, /todayBriefSkeletonOut|15,000원/)
  assert.doesNotMatch(renderItem({ elapsedSeconds: at + TODAY_BRIEFING_SKELETON_SECONDS - 1, consensus }), /15,000원/)
  const finished = renderItem({ elapsedSeconds: at + TODAY_BRIEFING_SKELETON_SECONDS, consensus })
  assert.match(finished, /todayBriefSkeletonOut/)
  assert.match(finished, /todayBriefBodyContentIn/)
  assert.match(finished, /15,000원/)
})

test('데이터 지연 시 스켈레톤을 유지하고 데이터가 도착하면 내용을 표시한다', () => {
  const pending = renderItem({ elapsedSeconds: at + 10, consensusPendingSkeleton: true })
  assert.match(pending, /todayBriefConsensusSkeleton/)
  assert.doesNotMatch(pending, /todayBriefSkeletonOut/)
  assert.match(renderItem({ elapsedSeconds: at + 10, consensusPendingSkeleton: true, consensus }), /15,000원/)
})

test('빈 상태도 같은 리듬을 따르고 미지원 상품의 빈 항목은 숨긴다', () => {
  const emptyProps = { consensusEmptyState: '목표가 없음' }
  assert.doesNotMatch(renderItem({ elapsedSeconds: at, ...emptyProps }), /목표가 없음/)
  assert.match(renderItem({ elapsedSeconds: at + TODAY_BRIEFING_SKELETON_SECONDS, ...emptyProps }), /목표가 없음/)
  assert.equal(renderItem({ elapsedSeconds: at, consensusPendingSkeleton: false }), '')
  assert.equal(renderItem({ elapsedSeconds: at, consensusPendingSkeleton: true, forceReady: true }), '')
  assert.match(renderItem({ elapsedSeconds: 0, consensus, forceReady: true }), /15,000원/)
})
