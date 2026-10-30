// JAROO_LLM_MOCK dev 게이트 + 결정적 모의 응답 유틸 — dev 배포에서 LLM 호출 비용을 0으로 만든다.
// (dev 주방에서 연습 요리할 때 진짜 재료(크레딧) 대신 나무 재료를 쓰는 개념)
//
// 프로덕션 불변 규칙:
//  - JAROO_LLM_MOCK 미설정(또는 falsy 값)이면 isLlmMockEnabled()는 항상 false다.
//    각 LLM 호출 지점은 "게이트 조건만 추가된" 기존 코드 경로를 그대로 실행하므로
//    운영 동작은 바이트 단위로 동일하게 유지된다.
//  - 토글 파싱은 DEEPSCAN_KR_LLM_ENABLE(deepscan-payload.js)과 동일한
//    trim+lowercase → ['1','true','on','yes'] 관례를 따른다.
//
// 결정성 규칙: 시드 = 해시(호출 목적|키|종목코드/요약키|날짜(YYYY-MM-DD)) →
// 같은 입력에는 하루 동안 항상 같은 모의 응답이 나온다.

const LLM_MOCK_ENABLED_VALUES = ['1', 'true', 'on', 'yes'];
const DEFAULT_LLM_MOCK_MIN_LATENCY_MS = 200;
const DEFAULT_LLM_MOCK_MAX_LATENCY_MS = 800;

/**
 * @param {{ JAROO_LLM_MOCK?: string | undefined }} [env]
 * @returns {boolean}
 */
export function isLlmMockEnabled(env = process.env) {
  const raw = env?.JAROO_LLM_MOCK;
  if (typeof raw !== 'string') {
    return false;
  }

  return LLM_MOCK_ENABLED_VALUES.includes(raw.trim().toLowerCase());
}

// 시드용 날짜 토큰(YYYY-MM-DD, UTC) — "같은 입력엔 하루 동안 같은 응답"을 만드는 시드 성분.
export function llmMockDateToken(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// 문자열 → FNV-1a 해시 → LCG 시드 PRNG.
// recovery-forecast의 createRecoverySeededRandom과 같은 스타일로 맞췄다(의존성 없는 결정적 난수).
export function createLlmMockSeededRandom(seedText) {
  const text = String(seedText ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  let state = (hash >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function pickLlmMockItem(random, values) {
  const list = Array.isArray(values) && values.length > 0 ? values : null;
  if (!list) {
    return '';
  }

  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

export function llmMockIntInRange(random, min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.floor(random() * (high - low + 1));
}

// 모의 지연 — 시드 PRNG로 200~800ms를 결정적으로 뽑아 로딩 UX가 실제와 같이 흐르게 한다.
// JAROO_LLM_MOCK_LATENCY_MS에 0 이상 정수를 주면 그 값으로 고정(테스트·즉시 응답용, 0이면 무지연).
/**
 * @param {{ JAROO_LLM_MOCK_LATENCY_MS?: string | undefined }} [env]
 * @returns {number}
 */
export function llmMockLatencyMs(random, env = process.env) {
  const configured = Number(env?.JAROO_LLM_MOCK_LATENCY_MS);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.round(configured);
  }

  return llmMockIntInRange(random, DEFAULT_LLM_MOCK_MIN_LATENCY_MS, DEFAULT_LLM_MOCK_MAX_LATENCY_MS);
}

/**
 * @param {{ JAROO_LLM_MOCK_LATENCY_MS?: string | undefined }} [env]
 * @returns {Promise<void>}
 */
export function sleepLlmMockLatency(random, env = process.env) {
  const ms = llmMockLatencyMs(random, env);
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer?.unref?.();
  });
}
