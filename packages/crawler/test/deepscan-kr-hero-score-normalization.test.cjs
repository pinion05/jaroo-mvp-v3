const test = require('node:test');
const assert = require('node:assert/strict');

// hero.score 계통 축소 방지 계약(TC-e2e-deepscan §9 관측 2 + 버그헌트 FM-2 파생).
//
// 결함: 위원 일부만 응답한 partial 상황에서
//   - KR: 미응답 위원이 0점으로 섞여 축/종합 점수가 감소하거나, 아예 committeeScores를
//     계산하지 않아 종목 무관 데이터 가용성 점수로 폴백(실측: 4종목 hero.score 전부 36)
//   - US(web): buildHeroScore가 고정 분모 100으로 나눠 미응답 위원 몫만큼 일괄 감소
// 이 테스트는 "분모 = 실제 응답 위원의 가중치 합" 정규화를 고정한다.

test('buildKrCommitteeFromMemberScores: 전원 응답 시 기존 가중합과 동일하다', async () => {
  const { buildKrCommitteeFromMemberScores } = await import('../src/services/deepscan-kr-score.js');
  const full = {
    profitability: 80, valuation: 60, ownershipStability: 40,
    trend: 70, consensusMomentum: 50, priceLocation: 60,
    avgPriceGap: 30, upsideBuffer: 90, holdingCompleteness: 45,
  };
  const committee = buildKrCommitteeFromMemberScores(full);
  // 기존 산식: 80×0.4 + 60×0.35 + 40×0.25 = 63
  assert.equal(committee.businessQuality.score, 63);
  // 70×0.4 + 50×0.35 + 60×0.25 = 60.5 → 61
  assert.equal(committee.marketTiming.score, 61);
  // 30×0.45 + 90×0.3 + 45×0.25 = 51.75 → 52
  assert.equal(committee.positionFit.score, 52);
});

test('buildKrCommitteeFromMemberScores: 일부 응답 시 응답 위원 가중치 합으로 정규화(계통 축소 방지)', async () => {
  const { buildKrCommitteeFromMemberScores } = await import('../src/services/deepscan-kr-score.js');
  // profitability(0.4)만 응답: 예전이면 80×0.4=32(미응답 2명이 0점으로 섞임) —
  // 정규화 후에는 80 그대로.
  const one = buildKrCommitteeFromMemberScores({ profitability: 80 });
  assert.equal(one.businessQuality.score, 80);

  // 2/3 응답: (80×0.4 + 60×0.35)/(0.4+0.35) = 70.67 → 71 (32+21=53이 아님)
  const two = buildKrCommitteeFromMemberScores({ profitability: 80, valuation: 60 });
  assert.equal(two.businessQuality.score, 71);

  // 축 전체 미응답 → null (0이 아니라 미정)
  const none = buildKrCommitteeFromMemberScores({ profitability: 80 });
  assert.equal(none.marketTiming.score, null);
  assert.equal(none.positionFit.score, null);
});

test('scoreDeepScanKrFromCommittee: 한 축이 비어도 hero가 나머지 축 가중치로 정규화된다', async () => {
  const { scoreDeepScanKrFromCommittee } = await import('../src/services/deepscan-kr-score.js');
  // 빈 증거 페널티(-18: 시세·컨센서스·리포트 부재)는 공통으로 적용되므로
  // '축 결측에 따른 추가 감점이 없는지'를 상대 비교로 검증한다.
  const full = scoreDeepScanKrFromCommittee({}, {
    businessQuality: { score: 60 }, marketTiming: { score: 60 }, positionFit: { score: 60 },
  });
  // 세 축이 모두 60 → 기준 hero
  assert.equal(full.hero.score, 42);

  // positionFit 축 미응답(null): (60×0.4 + 60×0.35)/(0.4+0.35) = 60 — 추가 감소 없음.
  // 과거 산식(null→0)이었다면 60×0.75 = 45로 눌렸을 값이다.
  const partial = scoreDeepScanKrFromCommittee({}, {
    businessQuality: { score: 60 }, marketTiming: { score: 60 }, positionFit: { score: null },
  });
  assert.equal(partial.hero.score, full.hero.score);

  // 모든 축 미응답 → 0 (crash 아님)
  const empty = scoreDeepScanKrFromCommittee({}, {
    businessQuality: { score: null }, marketTiming: { score: null }, positionFit: { score: null },
  });
  assert.equal(empty.hero.score, 0);
});

test('buildKrCommitteeAxesFromLlmResults: pending 포함 partial에서 응답 위원 기준 종합 점수를 계산한다', async () => {
  const { buildKrCommitteeAxesFromLlmResults } = await import('../src/services/deepscan-kr-committee-runtime.js');
  const mkResult = (score) => ({ score, reason: 'r', confidence: 'medium' });

  // 9위원 중 5위원만 응답(나머지 pending): committeeScores가 null이 아니어야 한다.
  const shape = buildKrCommitteeAxesFromLlmResults(null, {
    profitability: mkResult(80),
    valuation: mkResult(60),
    ownershipStability: mkResult(40),
    trend: mkResult(70),
    consensusMomentum: mkResult(50),
  }, [], ['priceLocation', 'avgPriceGap', 'upsideBuffer', 'holdingCompleteness']);

  assert.equal(shape.hasPendingMembers, true);
  assert.equal(shape.hasMemberErrors, false);
  assert.notEqual(shape.committeeScores, null);
  assert.equal(shape.committeeScores.businessQuality.score, 63);
  // marketTiming은 trend·consensusMomentum만 응답: (70×0.4 + 50×0.35)/(0.4+0.35) = 60.67 → 61
  assert.equal(shape.committeeScores.marketTiming.score, 61);
  assert.equal(shape.committeeScores.positionFit.score, null);
});

test('buildKrCommitteeAxesFromLlmResults: 오류 위원 또는 응답 0명이면 종합 점수를 보류한다', async () => {
  const { buildKrCommitteeAxesFromLlmResults } = await import('../src/services/deepscan-kr-committee-runtime.js');
  const mkResult = (score) => ({ score, reason: 'r', confidence: 'medium' });

  // 위원 오류 1명: 기존 '보류' 계약 유지
  const withError = buildKrCommitteeAxesFromLlmResults(null, {
    profitability: mkResult(80), valuation: mkResult(60), ownershipStability: mkResult(40),
    trend: mkResult(70), consensusMomentum: mkResult(50), priceLocation: mkResult(60),
    avgPriceGap: mkResult(30), upsideBuffer: mkResult(90),
  }, [{ member: 'holdingCompleteness', error: 'llm-upstream-error' }], []);
  assert.equal(withError.hasMemberErrors, true);
  assert.equal(withError.committeeScores, null);

  // 응답 0명(전원 pending): 빈 위원회 점수로 덮어쓰지 않는다
  const noneResponded = buildKrCommitteeAxesFromLlmResults(null, {}, [], [
    'profitability', 'valuation', 'ownershipStability', 'trend', 'consensusMomentum', 'priceLocation',
    'avgPriceGap', 'upsideBuffer', 'holdingCompleteness',
  ]);
  assert.equal(noneResponded.hasPendingMembers, true);
  assert.equal(noneResponded.committeeScores, null);
});
