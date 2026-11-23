// OpenGateway 공통 클라이언터 — 턴 스크립트(②⑤⑧)가 같은 기계로 호출한다.
// usage에서 캐시 hit 토큰까지 로그로 남긴다(prefix 캐시 계약의 실증 재료).

import fs from "node:fs/promises";
import path from "node:path";

const OPENGW = "https://apis.opengateway.ai/v1/chat/completions";
const MODEL = "deepseek/deepseek-v4.1-flash-eco";
const PRICE = { prompt: 0.00000003, cached: 0.0000000006, completion: 0.00000012 };

export async function getKey() {
  if (process.env.OPENGATEWAY_API_KEY) return process.env.OPENGATEWAY_API_KEY;
  const env = await fs.readFile(path.join(process.env.HOME, ".dsh", "web.env"), "utf8");
  const m = env.match(/^OPENGATEWAY_API_KEY=(\S+)/m);
  if (!m) throw new Error("OPENGATEWAY_API_KEY 없음 (~/.dsh/web.env)");
  return m[1];
}

/** chat(key, messages, {label}) → { content, usage, cost }
 *  usage 캐시 필드는 provider별 이름 차이를 흡수한다. */
export async function chat(key, messages, { label = "llm" } = {}) {
  const res = await fetch(OPENGW, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.6,
      max_tokens: 65536,
      reasoning_effort: "low",
    }),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const usage = j.usage ?? {};
  const promptTok = usage.prompt_tokens ?? 0;
  const cachedTok =
    usage.prompt_tokens_details?.cached_tokens
    ?? usage.prompt_cache_hit_tokens
    ?? 0;
  const completionTok = usage.completion_tokens ?? 0;
  const cost =
    (promptTok - cachedTok) * PRICE.prompt
    + cachedTok * PRICE.cached
    + completionTok * PRICE.completion;
  const line = `[${label}] prompt=${promptTok} (cached=${cachedTok}, ${promptTok ? Math.round((cachedTok / promptTok) * 100) : 0}%) completion=${completionTok} $${cost.toFixed(6)}`;
  console.error(line);
  if (process.env.DEBUG_USAGE) console.error(`[${label}] usage=${JSON.stringify(usage)}`);
  return { content: j.choices?.[0]?.message?.content ?? "", usage, cost, cacheLine: line };
}

export const MODEL_NAME = MODEL;
