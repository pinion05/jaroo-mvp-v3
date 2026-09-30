import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCommitteeWritebackPayload,
  countCommitteeOpinions,
} from './deepscan-committee-writeback'
import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

type MemberStub = Record<string, unknown>

function shellMember(): MemberStub {
  return { shortLabel: '위원', title: '위원', status: 'pending', reason: null, score: null, scoreLabel: '', tone: 'neutral', iconTone: 'neutral' }
}

function answeredMember(score = 70): MemberStub {
  return { shortLabel: '위원', title: '위원', status: 'success', reason: '근거 있는 의견', score, scoreLabel: '긍정', tone: 'positive', iconTone: 'positive' }
}

function axesWith(...members: MemberStub[]) {
  return [{ label: '축', score: null, scoreText: '', axisStatusText: '', subtitle: '', avgLabel: '', members }]
}

function payloadWithAxes(axes: unknown): JarooDeepScanPayload {
  return {
    committee: { axes },
    metadata: { llmCommittee: { requestId: 'req-1', status: 'partial', completed: 0, pending: 9, errors: 0 } },
  } as unknown as JarooDeepScanPayload
}

test('의견 수 카운트 — success+내용만 센다', () => {
  assert.equal(countCommitteeOpinions(axesWith(shellMember(), answeredMember(80), answeredMember())), 2)
  assert.equal(countCommitteeOpinions(axesWith(shellMember(), shellMember())), 0)
  assert.equal(countCommitteeOpinions(null), 0)
  assert.equal(countCommitteeOpinions('nope'), 0)
})

test('빈 껍데기 → 완성 axes는 병합을 허용하고 status를 complete로 바꾼다', () => {
  const existing = payloadWithAxes(axesWith(shellMember(), shellMember(), shellMember()))
  const nextAxes = axesWith(answeredMember(75), answeredMember(60), shellMember())
  const merged = buildCommitteeWritebackPayload(existing, nextAxes)
  assert.ok(merged?.metadata?.llmCommittee)
  assert.equal(countCommitteeOpinions(merged?.committee?.axes), 2)
  assert.equal(merged.metadata.llmCommittee.status, 'complete')
  assert.equal(merged.metadata.llmCommittee.pending, 0)
  // 기존 필드 보존 확인
  assert.equal(merged.metadata.llmCommittee.requestId, 'req-1')
})

test('가드 — 다음 axes가 기존보다 나으면(동점·열세·빈 배열) 쓰기 생략', () => {
  const complete = payloadWithAxes(axesWith(answeredMember(), answeredMember(), answeredMember()))
  assert.equal(buildCommitteeWritebackPayload(complete, axesWith(answeredMember(), answeredMember(), shellMember())), null)
  assert.equal(buildCommitteeWritebackPayload(complete, []), null)
  assert.equal(buildCommitteeWritebackPayload(complete, 'junk'), null)
})

test('구조 깨진 axes(멤버 배열 없는 축뿐)는 병합 거부', () => {
  const existing = payloadWithAxes(axesWith(shellMember()))
  assert.equal(buildCommitteeWritebackPayload(existing, [{ label: '축' }]), null)
})
