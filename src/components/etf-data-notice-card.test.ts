import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ETF_NOTICE_REASON_LABELS, EtfDataNoticeCard } from './etf-data-notice-card'

test('EtfDataNoticeCard renders reason label and message for each reason', () => {
  for (const reason of ['source-absent', 'source-pending', 'planned'] as const) {
    const html = renderToStaticMarkup(
      createElement(EtfDataNoticeCard, {
        reason,
        message: 'ETF에는 애널리스트 목표가·컨센서스가 없어요',
        eyebrow: '추천 시나리오',
      }),
    )
    assert.match(html, new RegExp(ETF_NOTICE_REASON_LABELS[reason]))
    assert.match(html, /애널리스트 목표가/)
    assert.match(html, /추천 시나리오/)
  }
})

test('notice reason labels are distinct and emoji-free', () => {
  const labels = Object.values(ETF_NOTICE_REASON_LABELS)
  assert.equal(new Set(labels).size, labels.length)
  for (const label of labels) {
    assert.doesNotMatch(label, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  }
})

test('source-absent reason uses a distinct visual tone from planned', () => {
  const absent = renderToStaticMarkup(
    createElement(EtfDataNoticeCard, { reason: 'source-absent', message: '메시지' }),
  )
  const planned = renderToStaticMarkup(
    createElement(EtfDataNoticeCard, { reason: 'planned', message: '메시지' }),
  )
  assert.notEqual(absent, planned)
})
