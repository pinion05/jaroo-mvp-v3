import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getVisibleDeepScanBriefingItemCount,
  isDeepScanBriefingItemContentReady,
  isDeepScanInlineResultsReady,
  isHiddenDeepScanLoadingQuickFact,
  parseDeepScanEmphasisSegments,
  shouldAdvanceDeepScanTimeline,
  shouldDisplayDeepScanReadyResults,
  shouldShowDeepScanSummarySkeleton,
} from './deepscan-loading-behavior'

test('DeepScan ready payload displays inline results immediately without waiting for the staged timeline', () => {
  const rawReady = isDeepScanInlineResultsReady({
    fetchState: 'success',
    hasPayload: true,
    isCommitteeHydrating: false,
  })

  assert.equal(rawReady, true)
  assert.equal(shouldDisplayDeepScanReadyResults(rawReady), true)
  assert.equal(
    shouldAdvanceDeepScanTimeline({
      resultsReadyForDisplay: true,
      elapsedSeconds: 1,
      sequenceCompleteSeconds: 81,
    }),
    false,
  )
})

test('DeepScan keeps loading while payload is absent or committee hydration is partial', () => {
  assert.equal(isDeepScanInlineResultsReady({ fetchState: 'loading', hasPayload: false, isCommitteeHydrating: false }), false)
  assert.equal(isDeepScanInlineResultsReady({ fetchState: 'success', hasPayload: false, isCommitteeHydrating: false }), false)
  assert.equal(isDeepScanInlineResultsReady({ fetchState: 'success', hasPayload: true, isCommitteeHydrating: true }), false)
  assert.equal(shouldDisplayDeepScanReadyResults(false), false)
  assert.equal(
    shouldAdvanceDeepScanTimeline({
      resultsReadyForDisplay: false,
      elapsedSeconds: 10,
      sequenceCompleteSeconds: 81,
    }),
    true,
  )
})

test('DeepScan loading helpers expose behavior without source-token coupling', () => {
  assert.equal(getVisibleDeepScanBriefingItemCount(4, [5, 10, 15]), 0)
  assert.equal(getVisibleDeepScanBriefingItemCount(10, [5, 10, 15]), 2)
  assert.equal(getVisibleDeepScanBriefingItemCount(0, [5, 10, 15], { forceReady: true }), 3)
  assert.equal(isDeepScanBriefingItemContentReady({
    elapsedSeconds: 30,
    revealAtSeconds: 30,
    skeletonSeconds: 3,
  }), false)
  assert.equal(isDeepScanBriefingItemContentReady({
    elapsedSeconds: 30,
    revealAtSeconds: 30,
    skeletonSeconds: 3,
    forceReady: true,
  }), true)
  assert.equal(isHiddenDeepScanLoadingQuickFact({ key: 'week52-position' }), true)
  assert.equal(isHiddenDeepScanLoadingQuickFact({ key: 'custom-range', hasIndicator: true }), true)
  assert.equal(isHiddenDeepScanLoadingQuickFact({ key: 'target-price' }), false)
  assert.equal(shouldShowDeepScanSummarySkeleton({ placeholder: false, resolvedSummaryText: '' }), true)
  assert.equal(shouldShowDeepScanSummarySkeleton({ placeholder: true, resolvedSummaryText: '' }), false)
  assert.equal(shouldShowDeepScanSummarySkeleton({ placeholder: false, resolvedSummaryText: '요약 완료' }), false)
})

test('팀 요약 **키워드** 강조 파싱 — 쌍만 굵게, 미완성 별표는 제거', () => {
  assert.deepEqual(
    parseDeepScanEmphasisSegments('지금 구간은 평단 대비 **수익권**이라 안정적이에요.'),
    [{ text: '지금 구간은 평단 대비 ', bold: false }, { text: '수익권', bold: true }, { text: '이라 안정적이에요.', bold: false }],
  )
  assert.deepEqual(parseDeepScanEmphasisSegments('강조 없는 문장'), [{ text: '강조 없는 문장', bold: false }])
  assert.deepEqual(parseDeepScanEmphasisSegments('닫히지 않은 **별표 문장'), [{ text: '닫히지 않은 별표 문장', bold: false }])
  assert.deepEqual(
    parseDeepScanEmphasisSegments('**목표가까지** 여력은 크고 **거래량**은 감소 중이에요.'),
    [{ text: '목표가까지', bold: true }, { text: ' 여력은 크고 ', bold: false }, { text: '거래량', bold: true }, { text: '은 감소 중이에요.', bold: false }],
  )
})
