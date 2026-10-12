import { HttpError } from './http-error.js';

// 와치독 기본 300s(웹 fetch 데드라인 150s의 2배, 실측 정상 잡 60~125s 대비 여유).
// 잡 하나가 유기돼도 슬롯 점유가 이 안에 자동 회수되어 '2일 장애'가 '최대 5분 장애'로 줄어든다.
export const DEFAULT_DEEPSCAN_KR_JOB_MAX_MS = 300_000;

// setTimeout delay는 2^31-1을 넘으면 ~1ms로 오버플로 동작하므로 상한 클램프.
const MAX_WATCHDOG_DELAY_MS = 2_147_483_647;

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function buildDeepscanKrJobKey(input) {
  return stableStringify({
    schema: 'jaroo.deepscan.kr.canonical.v1',
    instrument: {
      code: input.instrument?.code ?? null,
      ticker: input.instrument?.ticker ?? null,
      market: input.instrument?.market ?? null,
      kind: input.instrument?.kind ?? null,
    },
    holding: input.holding ?? null,
    selectedAt: input.selectedAt ?? null,
    sourceContext: input.sourceContext ?? null,
    disclosureOptions: input.disclosureOptions ?? null,
  });
}

/**
 * KR DeepScan 잡 admission 제어.
 * - 전역/종목별 동시 잡 한도와 동일 jobKey dedup을 유지한다.
 * - 모든 잡에 하드 와치독(DEEPSCAN_KR_JOB_MAX_MS)을 건다. load() Promise가
 *   영원히 settle되지 않는 유기(2026-10-11 사고)가 발생해도 슬롯이 자동 회복된다.
 * - busy 응답에 limits + activeJobs 스냅샷을 포함해 원인을 컬 한 번으로 진단한다.
 */
export function createDeepscanKrAdmission(options = {}) {
  const env = options.env ?? process.env;
  const serviceName = options.serviceName ?? 'jaroo-mvp-v3-crawler';
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.error;
  const now = options.now ?? (() => Date.now());

  const jobs = new Map();
  const activePerCode = new Map();

  const readLimits = () => ({
    global: parsePositiveInteger(env.DEEPSCAN_KR_GLOBAL_JOBS, 1),
    perCode: parsePositiveInteger(env.DEEPSCAN_KR_PER_CODE_JOBS, 1),
  });

  const maxJobMs = () => parsePositiveInteger(env.DEEPSCAN_KR_JOB_MAX_MS, DEFAULT_DEEPSCAN_KR_JOB_MAX_MS);

  const snapshot = () => {
    const at = now();
    return {
      limits: readLimits(),
      activeJobs: Array.from(jobs.values()).map((job) => ({
        code: job.code,
        startedAt: job.startedAt,
        ageMs: at - Date.parse(job.startedAt),
      })),
    };
  };

  const release = (jobKey, code) => {
    const nextActiveForCode = Math.max(0, (activePerCode.get(code) ?? 1) - 1);
    if (nextActiveForCode === 0) {
      activePerCode.delete(code);
    } else {
      activePerCode.set(code, nextActiveForCode);
    }
    jobs.delete(jobKey);
  };

  const run = async (input, load) => {
    if (env.DEEPSCAN_KR_EXECUTION_DISABLED === '1') {
      throw new HttpError(503, 'KR DeepScan execution disabled', {
        status: 'unavailable',
        retryable: true,
      });
    }

    const jobKey = buildDeepscanKrJobKey(input);
    const existing = jobs.get(jobKey);
    if (existing) {
      return existing.promise;
    }

    const code = String(input.instrument?.code ?? input.instrument?.ticker ?? 'unknown');
    const { global: globalLimit, perCode: perCodeLimit } = readLimits();
    const activeForCode = activePerCode.get(code) ?? 0;

    if (jobs.size >= globalLimit || activeForCode >= perCodeLimit) {
      throw new HttpError(429, 'KR DeepScan crawler is busy', {
        status: 'busy',
        reason: jobs.size >= globalLimit ? 'global_limit' : 'per_code_limit',
        retryAfterMs: parsePositiveInteger(env.DEEPSCAN_KR_BUSY_RETRY_AFTER_MS, 2000),
        ...snapshot(),
      });
    }

    activePerCode.set(code, activeForCode + 1);
    const startedAtMs = now();
    const startedAt = new Date(startedAtMs).toISOString();

    let resolveJob = null;
    let rejectJob = null;
    let settled = false;
    const promise = new Promise((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    const settleOnce = (settle, value) => {
      if (settled) {
        return false;
      }
      settled = true;
      settle(value);
      return true;
    };

    let timedOut = false;
    let released = false;
    const releaseOnce = () => {
      if (released) {
        return;
      }
      released = true;
      release(jobKey, code);
    };

    const watchdog = setTimeout(() => {
      timedOut = true;
      warn(`[${serviceName}] deepscan-kr job watchdog timeout code=${code} startedAt=${startedAt} maxMs=${maxJobMs()} activeJobs=${JSON.stringify(snapshot().activeJobs)} — admission slot reclaimed (job promise abandoned)`);
      releaseOnce();
      settleOnce(rejectJob, new HttpError(504, 'KR DeepScan job timed out', {
        status: 'timeout',
        code,
        startedAt,
        durationMs: now() - startedAtMs,
        retryable: true,
      }));
    }, Math.min(maxJobMs(), MAX_WATCHDOG_DELAY_MS));
    if (typeof watchdog.unref === 'function') {
      watchdog.unref();
    }

    jobs.set(jobKey, { code, startedAt, promise });

    (async () => {
      try {
        const value = await load();
        if (!settleOnce(resolveJob, value)) {
          warn(`[${serviceName}] deepscan-kr job ghost settled code=${code} startedAt=${startedAt} outcome=resolved durationMs=${now() - startedAtMs} — result discarded (slot already reclaimed by watchdog)`);
        }
      } catch (error) {
        if (!settleOnce(rejectJob, error)) {
          warn(`[${serviceName}] deepscan-kr job ghost settled code=${code} startedAt=${startedAt} outcome=rejected durationMs=${now() - startedAtMs} error=${error?.message ?? String(error)}`);
        }
      } finally {
        clearTimeout(watchdog);
        releaseOnce();
        if (!timedOut) {
          log(`[${serviceName}] deepscan-kr job complete code=${code} durationMs=${now() - startedAtMs}`);
        }
      }
    })();

    return promise;
  };

  return { run, snapshot };
}
