// DART corpCode.xml 백그라운드 프리페치 — 하루 1회, 장 타임아웃, 디스크 캐시.
//
// 배경(2026-10-13 실측): 미국 리전(Railway IAD)에서 DART가 corpCode.xml.zip(3.5MB)을
// ~13KB/s로 쓰로틀해 완전 수신에 ~280초가 걸린다. 요청 경로의 짧은 타임아웃(5s)으로는
// 영원히 성공할 수 없어 공시 소스가 매 스캔 실패했다. 대신 프로세스가 살아 있는 동안
// 하루 1회 긴 타임아웃(기본 10분)으로 내려받아 디스크 캐시에 저장하고, 요청 경로는
// 메모리→디스크 캐시를 즉시 읽는다.
//
// 환경변수:
//   DART_CORP_CODE_PREFETCH_ENABLE         '0'/'false'/'off'/'no'면 비활성화
//   DART_CORP_CODE_PREFETCH_TIMEOUT_MS     프리페치 다운로드 타임아웃. 기본 600000(10분)
//   DART_CORP_CODE_PREFETCH_STARTUP_DELAY_MS  부팅 후 첫 실행 지연. 기본 90000
//   DART_CORP_CODE_PREFETCH_INTERVAL_MS    반복 주기. 기본 24시간
//
// Railway 단일 컨테이너 상주 프로세스 전제(워치 스케줄러와 동일한 가정).
// 다중 인스턴스로 스케일 아웃하면 인스턴스 수만큼 각자 프리페치한다(중복 다운로드만
// 낭비되고 정합성 문제는 없다 — corpCode는 정적 목록).

import { getDartCorpCodeList, hasDartKeyConfigured } from '../crawlers/dart-filings.js';

export const DEFAULT_DART_CORP_CODE_PREFETCH_TIMEOUT_MS = 600_000;
export const DEFAULT_DART_CORP_CODE_PREFETCH_STARTUP_DELAY_MS = 90_000;
export const DEFAULT_DART_CORP_CODE_PREFETCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseDisabled(value) {
  return ['0', 'false', 'off', 'no'].includes(String(value ?? '').trim().toLowerCase());
}

export function isDartCorpCodePrefetchDisabled(env = process.env) {
  return parseDisabled(env.DART_CORP_CODE_PREFETCH_ENABLE) || env.JAROO_DISABLE_SCHEDULER === '1';
}

/** corpCode 1회 프리페치 — 성공 시 디스크+메모리 캐시가 채워진다. */
export async function runDartCorpCodePrefetch(options = {}) {
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.error;

  if (!hasDartKeyConfigured(options)) {
    return { ok: false, skipped: 'dart-key-unconfigured' };
  }

  const timeoutMs = parsePositiveInteger(options.timeoutMs, DEFAULT_DART_CORP_CODE_PREFETCH_TIMEOUT_MS);
  const startedAtMs = Date.now();
  log(`[dart-corpcode-prefetch] start timeoutMs=${timeoutMs}`);

  try {
    // refresh:true — 메모리 캐시가 신선해도 프리페치는 항상 네트워크를 당겨
    // 디스크 사본을 갱신한다(프로세스 재시작 대비).
    const entries = await getDartCorpCodeList({
      ...options,
      corpCodeTimeoutMs: timeoutMs,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      refresh: true,
    });
    log(`[dart-corpcode-prefetch] ok entries=${entries.length} elapsedMs=${Date.now() - startedAtMs}`);
    return { ok: true, entries: entries.length };
  } catch (error) {
    warn(`[dart-corpcode-prefetch] failed elapsedMs=${Date.now() - startedAtMs} error=${error?.message ?? 'unknown'}`);
    return { ok: false, error: error?.message ?? 'unknown' };
  }
}

export function startDartCorpCodePrefetchScheduler(options = {}) {
  if (isDartCorpCodePrefetchDisabled()) {
    console.log('[dart-corpcode-prefetch] disabled by DART_CORP_CODE_PREFETCH_ENABLE/JAROO_DISABLE_SCHEDULER');
    return { stop() {} };
  }
  if (!hasDartKeyConfigured(options)) {
    console.log('[dart-corpcode-prefetch] skipped — DART API 키 미설정');
    return { stop() {} };
  }

  const startupDelayMs = parsePositiveInteger(options.startupDelayMs, DEFAULT_DART_CORP_CODE_PREFETCH_STARTUP_DELAY_MS);
  const intervalMs = parsePositiveInteger(options.intervalMs, DEFAULT_DART_CORP_CODE_PREFETCH_INTERVAL_MS);
  console.log(`[dart-corpcode-prefetch] scheduler started — 첫 실행 ${Math.round(startupDelayMs / 1000)}s 후, 이후 ${Math.round(intervalMs / 3_600_000)}h 간격`);

  let running = false;
  const runOnce = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runDartCorpCodePrefetch(options);
    } finally {
      running = false;
    }
  };

  const firstTimer = setTimeout(() => {
    void runOnce();
  }, startupDelayMs);
  firstTimer.unref?.();

  const intervalTimer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  intervalTimer.unref?.();

  return {
    stop() {
      clearTimeout(firstTimer);
      clearInterval(intervalTimer);
    },
  };
}
