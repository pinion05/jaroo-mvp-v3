const test = require('node:test');
const assert = require('node:assert/strict');

// 유저 딥스캔 위원회 소프트 데드라인 기본값 계약(TC-e2e-deepscan §6.1 회귀 방지).
//
// 과거 기본 5s는 멤버 응답(p95 ~45s)보다 짧아 5쟝 스냅샷이 partial(1~4/9)로 확정되고
// 백그라운드 완주분이 폐기돼 "부실한 분석"으로 experience됐다. 이 계약은:
//   1) 기본값이 멤버 p95의 2배 수준(90s) 이상인지
//   2) env 오버라이드(KR 전용 > 공통)가 그대로 존중되는지
//   3) 워치 일일 배치 경로는 committeeLlm=off 배선으로 LLM을 아예 스킵하는지(영향 없음)
// 를 고정한다.

const ENV_KEYS = ['DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS', 'DEEPSCAN_LLM_SOFT_DEADLINE_MS'];

function withCleanEnv(run) {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]]);
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  return Promise.resolve().then(run).finally(() => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test('KR committee soft deadline 기본값은 90s(멤버 p95 45s의 2배)이다', async () => {
  await withCleanEnv(async () => {
    const { DEFAULT_KR_LLM_SOFT_DEADLINE_MS, resolveKrCommitteeSoftDeadlineMs } =
      await import('../src/services/deepscan-kr-committee-runtime.js');
    assert.equal(DEFAULT_KR_LLM_SOFT_DEADLINE_MS, 90_000);
    assert.equal(resolveKrCommitteeSoftDeadlineMs(), 90_000);
  });
});

test('유저 딥스캔 소프트 데드라인은 이전 결함값(5s)으로 회귀하지 않는다', async () => {
  await withCleanEnv(async () => {
    const { resolveKrCommitteeSoftDeadlineMs } = await import('../src/services/deepscan-kr-committee-runtime.js');
    // 위원 개별 응답 p95 실측(~45s)보다 기본값이 커야 partial 폐기가 재발하지 않는다.
    assert.ok(resolveKrCommitteeSoftDeadlineMs() >= 90_000, '기본 소프트 데드라인은 최소 90s');
    assert.notEqual(resolveKrCommitteeSoftDeadlineMs(), 5_000);
  });
});

test('DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS 오버라이드가 최우선 적용된다', async () => {
  await withCleanEnv(async () => {
    const { resolveKrCommitteeSoftDeadlineMs } = await import('../src/services/deepscan-kr-committee-runtime.js');
    process.env.DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS = '45000';
    assert.equal(resolveKrCommitteeSoftDeadlineMs(), 45_000);
    // KR 전용이 공통보다 우선한다.
    process.env.DEEPSCAN_LLM_SOFT_DEADLINE_MS = '7000';
    assert.equal(resolveKrCommitteeSoftDeadlineMs(), 45_000);
    delete process.env.DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS;
    assert.equal(resolveKrCommitteeSoftDeadlineMs(), 7_000);
  });
});

test('호출부 옵션과 유효하지 않은 env는 각각 최우선/기본값으로 정규화된다', async () => {
  await withCleanEnv(async () => {
    const { resolveKrCommitteeSoftDeadlineMs, DEFAULT_KR_LLM_SOFT_DEADLINE_MS } =
      await import('../src/services/deepscan-kr-committee-runtime.js');
    assert.equal(resolveKrCommitteeSoftDeadlineMs(12_000), 12_000);
    process.env.DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS = 'not-a-number';
    assert.equal(resolveKrCommitteeSoftDeadlineMs(), DEFAULT_KR_LLM_SOFT_DEADLINE_MS);
    process.env.DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS = '0';
    assert.equal(resolveKrCommitteeSoftDeadlineMs(), DEFAULT_KR_LLM_SOFT_DEADLINE_MS);
  });
});

test('워치 일일 배치는 committeeLlm=off 배선으로 위원회 LLM을 스킵한다(기본값 영향 없음)', async () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../../src/lib/watch/daily-batch.ts'),
    'utf8',
  );
  assert.match(source, /skipCommitteeLlm:\s*true/, '워치 배치는 skipCommitteeLlm:true로 LLM을 스킵해야 한다');

  const buildPayloadSource = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../../src/lib/deepscan-runtime/build-payload.ts'),
    'utf8',
  );
  assert.match(buildPayloadSource, /committeeLlm', 'off'/, 'skipCommitteeLlm은 crawler 쿼리 committeeLlm=off로 연결된다');
  const committeeRuntimeSource = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/services/deepscan-kr-committee-runtime.js'),
    'utf8',
  );
  // 유저 딥스캔 경로(기본)는 스킵 배선이 없으므로 항상 90s 기본값을 쓴다.
  assert.ok(committeeRuntimeSource.includes('DEFAULT_KR_LLM_SOFT_DEADLINE_MS = 90_000'));
});
