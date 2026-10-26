const test = require('node:test');
const assert = require('node:assert/strict');

async function makeAdmission(env = {}) {
  const { createDeepscanKrAdmission } = await import('../src/services/deepscan-kr-admission.js');
  const logs = [];
  const warns = [];
  const admission = createDeepscanKrAdmission({
    env: { ...env },
    serviceName: 'test-crawler',
    log: (line) => logs.push(line),
    warn: (line) => warns.push(line),
    now: () => Date.now(),
  });
  return { admission, logs, warns };
}

const inputFor = (code) => ({
  instrument: { code, market: 'KR', kind: 'stock' },
  holding: { shares: '10' },
});

const neverSettles = () => new Promise(() => {});

test('전역 한도 초과 시 429 busy + limits/activeJobs 진단 스냅샷', async () => {
  const { admission } = await makeAdmission();
  const first = admission.run(inputFor('005930'), neverSettles);

  await assert.rejects(
    admission.run(inputFor('068270'), () => Promise.resolve({})),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.details.status, 'busy');
      assert.equal(error.details.reason, 'global_limit');
      assert.equal(error.details.retryAfterMs, 2000);
      assert.deepEqual(error.details.limits, { global: 1, perCode: 1 });
      assert.equal(error.details.activeJobs.length, 1);
      assert.equal(error.details.activeJobs[0].code, '005930');
      assert.equal(typeof error.details.activeJobs[0].startedAt, 'string');
      assert.equal(typeof error.details.activeJobs[0].ageMs, 'number');
      return true;
    },
  );
});

test('종목별 한도 초과 시 per_code_limit 사유', async () => {
  const { admission } = await makeAdmission({ DEEPSCAN_KR_GLOBAL_JOBS: '4' });
  const first = admission.run(inputFor('005930'), neverSettles);

  // 같은 종목, 다른 jobKey(보유 수량 상이) → dedup이 아닌 per-code 한도에 걸린다.
  await assert.rejects(
    admission.run({ instrument: { code: '005930', market: 'KR', kind: 'stock' }, holding: { shares: '20' } }, () => Promise.resolve({})),
    (error) => {
      assert.equal(error.details.reason, 'per_code_limit');
      return true;
    },
  );
});

test('동일 jobKey 재요청은 기존 잡으로 dedup (두 번째 load 미실행)', async () => {
  const { admission } = await makeAdmission();
  let releaseLoad;
  const load = () => new Promise((resolve) => { releaseLoad = resolve; });
  const first = admission.run(inputFor('005930'), load);
  const second = admission.run(inputFor('005930'), () => Promise.resolve('wrong-load-ran'));
  releaseLoad({ ok: true });
  // dedup이면 두 요청 모두 첫 load의 결과로 settle하고 두 번째 load는 실행되지 않는다.
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, { ok: true });
  assert.deepEqual(b, { ok: true });
});

test('정상 완료 시 기존 로그 형식 유지 + 슬롯 해제', async () => {
  const { admission, logs } = await makeAdmission();
  const result = await admission.run(inputFor('005930'), () => Promise.resolve(42));
  assert.equal(result, 42);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[test-crawler\] deepscan-kr job complete code=005930 durationMs=\d+$/);

  // 슬롯 해제 확인: 후속 잡이 즉시 승인된다.
  const next = await admission.run(inputFor('068270'), () => Promise.resolve(7));
  assert.equal(next, 7);
});

test('와치독: 유기 load()를 504로 마무리하고 슬롯 회수 + 고스트 settle 로그', async () => {
  // 와치독 타이머는 unref라 이벤트 루프를 유지하지 않는다(admission 구현 참조).
  // orphan reject를 20ms 와치독 발화에 의존해 await하는 동안 루프에 남은 예정
  // 작업이 없으면 node:test가 루프 종료로 판정해 이 테스트(와 이후 테스트)를
  // 취소한다 — ref keep-alive 타이머로 루프를 유지해 러너 상호작용 결함을 보완한다.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    const { admission, logs, warns } = await makeAdmission({ DEEPSCAN_KR_JOB_MAX_MS: '20' });
    let ghostResolve;
    const load = () => new Promise((resolve) => { ghostResolve = resolve; });

    const orphan = admission.run(inputFor('005930'), load);
    await assert.rejects(orphan, (error) => {
      assert.equal(error.status, 504);
      assert.equal(error.details.status, 'timeout');
      assert.equal(error.details.code, '005930');
      assert.equal(error.details.retryable, true);
      return true;
    });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /deepscan-kr job watchdog timeout code=005930/);
    assert.match(warns[0], /activeJobs=\[/);

    // 슬롯 회수 확인: 동일 jobKey 재요청이 즉시 새 잡으로 승인된다(죽은 promise dedup 아님).
    const retried = admission.run(inputFor('005930'), () => Promise.resolve('recovered'));
    assert.notEqual(retried, orphan);
    assert.equal(await retried, 'recovered');

    // 고스트가 늦게 settle해도: 결과는 버려지고 ghost 로그만 남는다(오도성 complete 로그 없음).
    ghostResolve('late-value');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const ghostWarns = warns.filter((line) => line.includes('ghost settled'));
    assert.equal(ghostWarns.length, 1);
    assert.match(ghostWarns[0], /outcome=resolved/);
    assert.equal(logs.filter((line) => line.includes('code=005930')).length, 1); // 재시도 잡의 complete만
  } finally {
    clearTimeout(keepAlive);
  }
});

test('와치독 지연 오버플로 클램프: 거대 env값도 즉시 504로 이어지지 않음', async () => {
  const { admission, warns } = await makeAdmission({ DEEPSCAN_KR_JOB_MAX_MS: '99999999999999' });
  const result = await admission.run(inputFor('005930'), () => new Promise((resolve) => setTimeout(() => resolve('ok'), 10)));
  assert.equal(result, 'ok');
  assert.equal(warns.length, 0);
});

test('DEEPSCAN_KR_EXECUTION_DISABLED=1이면 503', async () => {
  const { admission } = await makeAdmission({ DEEPSCAN_KR_EXECUTION_DISABLED: '1' });
  await assert.rejects(admission.run(inputFor('005930'), () => Promise.resolve()), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.details.status, 'unavailable');
    return true;
  });
});

test('jobKey는 종목/보유 조합 기준으로 안정 생성', async () => {
  const { buildDeepscanKrJobKey, DEFAULT_DEEPSCAN_KR_JOB_MAX_MS } = await import('../src/services/deepscan-kr-admission.js');
  const base = buildDeepscanKrJobKey(inputFor('005930'));
  assert.equal(base, buildDeepscanKrJobKey(inputFor('005930')));
  assert.notEqual(base, buildDeepscanKrJobKey(inputFor('068270')));
  assert.equal(DEFAULT_DEEPSCAN_KR_JOB_MAX_MS, 300_000);
});
