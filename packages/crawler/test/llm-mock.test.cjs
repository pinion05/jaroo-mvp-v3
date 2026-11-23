const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

// JAROO_LLM_MOCK=1 dev 전용 결정적 LLM 모의 응답 검증.
// 프로덕션 불변(게이트 기본 off)도 함께 검증한다.

function withMockEnv(t, env) {
  const originals = {};
  for (const [key, value] of Object.entries(env)) {
    originals[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

function installFetchSpy(t) {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not be called in llm-mock mode');
  };
  t.after(() => {
    global.fetch = originalFetch;
  });
  return () => fetchCalls;
}

test('JAROO_LLM_MOCK 게이트는 DEEPSCAN_KR_LLM_ENABLE 토글 관례(1/true/on/yes)를 따른다', async () => {
  const { isLlmMockEnabled } = await import('../../deepscan-runtime-core/src/llm-mock.js');

  assert.equal(isLlmMockEnabled({}), false);
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: '' }), false);
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: '0' }), false);
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: 'off' }), false);
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: 'no' }), false);
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: '1' }), true);
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: 'true' }), true);
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: 'on' }), true);
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: 'yes' }), true);
  assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: ' ON ' }), true);
});

test('시드 PRNG는 같은 시드에 같은 수열을 내고 날짜 토큰은 YYYY-MM-DD다', async () => {
  const { createLlmMockSeededRandom, llmMockDateToken } = await import('../../deepscan-runtime-core/src/llm-mock.js');

  const first = createLlmMockSeededRandom('committee|trend|005930|2026-10-30');
  const second = createLlmMockSeededRandom('committee|trend|005930|2026-10-30');
  const other = createLlmMockSeededRandom('committee|valuation|005930|2026-10-30');

  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
  assert.notDeepEqual([first(), first()], [other(), other()]);
  assert.match(llmMockDateToken(new Date('2026-10-30T01:02:03.456Z')), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(llmMockDateToken(new Date('2026-10-30T23:59:59.999Z')), '2026-10-30');
});

test('JAROO_LLM_MOCK=1이면 위원회 멤버 LLM이 네트워크 0회·키 없이 결정적 [MOCK] 응답을 반환한다', async t => {
  withMockEnv(t, {
    JAROO_LLM_MOCK: '1',
    JAROO_LLM_MOCK_LATENCY_MS: '0',
    OPENROUTER_API_KEY: undefined,
  });
  const getFetchCalls = installFetchSpy(t);
  const { scoreCommitteeMember } = await import('../../deepscan-runtime-core/src/committee-llm.js');
  const logDir = mkdtempSync(join(tmpdir(), 'llm-mock-committee-'));
  t.after(() => rmSync(logDir, { recursive: true, force: true }));

  const dumps = {
    shared: { instrument: { code: { value: '005930' }, name: { value: '삼성전자' } } },
    memberDump: { facts: {} },
  };
  const options = { systemPrompt: () => 'test', logDir };

  const first = await scoreCommitteeMember('trend', dumps, options);
  const second = await scoreCommitteeMember('trend', dumps, options);

  assert.equal(getFetchCalls(), 0, 'mock 모드에서는 fetch 네트워크 호출이 0회여야 한다');
  assert.equal(first.finalStatus, 'success');
  assert.equal(first.llmResultPresent, true);
  assert.equal(first.attempts, 1);
  assert.equal(Number.isInteger(first.score), true);
  assert.ok(first.score >= 35 && first.score <= 85, `점수는 플러시블 밴드(35~85) 내: ${first.score}`);
  assert.match(first.reason, /^\[MOCK\]/, '서사 앞에 [MOCK] 접두가 있어야 한다');
  assert.ok(['low', 'medium', 'high'].includes(first.confidence));
  // 결정성 — 같은 입력(멤버+종목+날짜)엔 같은 응답.
  assert.deepEqual(
    { score: first.score, reason: first.reason, confidence: first.confidence },
    { score: second.score, reason: second.reason, confidence: second.confidence },
  );
});

test('JAROO_LLM_MOCK=1이면 위원회 전체(파서 포함)가 complete 상태에 도달한다', async t => {
  withMockEnv(t, {
    JAROO_LLM_MOCK: '1',
    JAROO_LLM_MOCK_LATENCY_MS: '0',
    OPENROUTER_API_KEY: undefined,
  });
  const getFetchCalls = installFetchSpy(t);
  const { scoreCommitteeMembersProgressive } = await import('../../deepscan-runtime-core/src/committee-llm.js');
  const logDir = mkdtempSync(join(tmpdir(), 'llm-mock-progressive-'));
  t.after(() => rmSync(logDir, { recursive: true, force: true }));

  const memberKeys = ['profitability', 'trend', 'avgPriceGap'];
  const snapshot = await scoreCommitteeMembersProgressive({
    memberKeys,
    shared: { instrument: { code: { value: '005930' }, name: { value: '삼성전자' } } },
    members: Object.fromEntries(memberKeys.map((memberKey) => [memberKey, { facts: {} }])),
    options: {
      requestId: 'llm-mock-test',
      schemaName: 'jaroo_llm_mock_test',
      title: 'llm mock test',
      concurrency: 3,
      softDeadlineMs: 0,
      summaryKey: 'llm-mock-test',
      logDir,
      systemPrompt: () => 'test',
    },
  });

  assert.equal(getFetchCalls(), 0);
  assert.equal(snapshot.status, 'complete');
  assert.deepEqual(snapshot.errors, []);
  assert.deepEqual(snapshot.pending, []);
  assert.equal(snapshot.completed, memberKeys.length);
  for (const memberKey of memberKeys) {
    assert.match(snapshot.results[memberKey].reason, /^\[MOCK\]/, `${memberKey} 서사에 [MOCK] 접두`);
  }
});

test('JAROO_LLM_MOCK=1이면 KR 위원회 런타임도 키 없이 complete로 돈다 (scoreDeepScanKrCommitteeFromDump)', async t => {
  withMockEnv(t, {
    JAROO_LLM_MOCK: '1',
    JAROO_LLM_MOCK_LATENCY_MS: '0',
    OPENROUTER_API_KEY: undefined,
    DEEPSCAN_KR_LLM_ENABLE: undefined,
  });
  const getFetchCalls = installFetchSpy(t);
  const { scoreDeepScanKrCommitteeFromDump } = await import('../src/services/deepscan-kr-committee-runtime.js');

  const result = await scoreDeepScanKrCommitteeFromDump({}, {
    instrument: { code: '005930', name: '삼성전자', market: 'KR' },
    sourceContext: {},
  }, {
    instrument: { code: '005930', name: '삼성전자', market: 'KR' },
    pageCoverage: { totalKnownPages: 0, availablePageIds: [], missingPageIds: [], availableCount: 0 },
    sourceCoverage: { hasCurrentQuote: false, hasHolding: false, hasPackageResult: false, availableReportPages: [] },
    reportSignals: {},
    missingSources: [],
    sourceLimitations: [],
    topFacts: [],
    topRisks: [],
  }, {});

  assert.equal(getFetchCalls(), 0);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.errors, []);
  for (const memberKey of result.memberKeys) {
    assert.match(result.results[memberKey].reason, /^\[MOCK\]/, `${memberKey} 서사에 [MOCK] 접두`);
    assert.ok(result.results[memberKey].score >= 35 && result.results[memberKey].score <= 85);
  }
});

test('JAROO_LLM_MOCK 미설정(기본)이면 기존 동작이 그대로다 — 키 없으면 위원회 LLM이 게이트된다', async t => {
  withMockEnv(t, {
    JAROO_LLM_MOCK: undefined,
    JAROO_LLM_MOCK_LATENCY_MS: undefined,
    OPENROUTER_API_KEY: undefined,
  });
  installFetchSpy(t);
  const { scoreCommitteeMember } = await import('../../deepscan-runtime-core/src/committee-llm.js');

  await assert.rejects(
    scoreCommitteeMember('trend', { shared: {}, memberDump: {} }, { systemPrompt: () => 'test' }),
    /OPENROUTER_API_KEY is not configured/,
  );
});

test('실적 댓글 요약 모의 응답은 정확히 3줄·[MOCK] 접두·결정적이다', async t => {
  withMockEnv(t, { JAROO_LLM_MOCK: '1', JAROO_LLM_MOCK_LATENCY_MS: '0' });
  const { buildLlmMockCommentarySummaryLines } = await import('../src/services/deepscan-payload.js');

  const input = { instrument: { code: '005930', name: '삼성전자' } };
  const performanceComment = { text: '매출액과 영업이익이 개선됨', asOf: '2026-06-02' };

  const first = buildLlmMockCommentarySummaryLines(input, performanceComment);
  const second = buildLlmMockCommentarySummaryLines(input, performanceComment);

  assert.equal(first.length, 3);
  assert.match(first[0], /^\[MOCK\]/);
  for (const line of first) {
    assert.ok(typeof line === 'string' && line.trim().length > 0);
  }
  assert.deepEqual(first, second);
});
