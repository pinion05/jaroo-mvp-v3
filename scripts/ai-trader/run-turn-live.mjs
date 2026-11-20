#!/usr/bin/env node
/**
 * 실턴 라이브 파이프라인 (2.5b 실행 계층) — 시안 v2 §3 전 경로 실측:
 *
 *   실소스 덤프(chart|news|finance) → ②흥미(LLM) → 스캔집합 → ④딥스캔 조언(:3002)
 *   → ⑤매매 결정(LLM) → fit/ratio 체결(paper-trade :3041)
 *   → 판단 로그 저장(ai-trader :3042 /judgments) → 계좌·저널 요약 출력
 *
 * 사용: node scripts/ai-trader/run-turn-live.mjs [--source chart|news|finance]
 *          [--slug <slug>] [--persona <이름>] [--scans 2] [--skip-scan]
 * 사전: paper-trade(3041)·ai-trader(3042) 기동, dev 스택(3002 — 딥스캔), krchart(13100)
 *       news 소스는 naver-mainnews(:13020), finance는 dart-fs(:8088)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDump } from "./dump-builder.mjs";
import { getKey } from "./llm.mjs";
import { runInterestTurn, validateInterest, buildDecisionTail, runDecisionTurn, validateDecision } from "./turns.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const SOURCE = argOf("source", "chart");
const SCANS = Number(argOf("scans", "2"));
const SKIP_SCAN = args.includes("--skip-scan");
const SLUG_ARG = argOf("slug", null);

const AITRADER = process.env.AITRADER_URL ?? "http://localhost:3042";
const PAPERTRADE = process.env.PAPERTRADE_URL ?? "http://localhost:3041";
const DEEPSCAN_API = process.env.DEEPSCAN_API ?? "http://localhost:3002/api/deepscan";
const API_NEWS = "http://pop-os.tailcff214.ts.net:13020/api/news?fresh=1";
const API_FINANCE_RANK = "http://localhost:8088/api/scores/rank?top=30";
const KRCHART_ANALYZE = (code) => `http://localhost:13100/api/analyze?symbol=${code}`;
const UNIVERSE_PATH = path.resolve(__dirname, "..", "..", "src/lib/data/instrument-universe.json");

const SRC = {
  chart: { slug: "chart-cok", persona: "차트콕" },
  news: { slug: "news-cok", persona: "뉴스콕" },
  finance: { slug: "finance-cok", persona: "재무콕" },
}[SOURCE];
if (!SRC) throw new Error(`--source 는 chart|news|finance (받은 것: ${SOURCE})`);

const j = async (url, opts, timeoutMs = 60000) => {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
};
const log = (m) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const won = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastErr = null; // 딥스캔 429 백오프 공유

/** 뉴스·재무 소스의 실행 시세 — krchart 종목별 분석의 last_close (캐시) */
const quoteCache = new Map();
async function quoteClose(code) {
  if (quoteCache.has(code)) return quoteCache.get(code);
  let v = null;
  try { v = (await j(KRCHART_ANALYZE(code), null, 60000))?.last_close ?? null; } catch { v = null; }
  quoteCache.set(code, v);
  return v;
}

// ---------------------------------------------------------------- 0. 사전 점검 + 캐릭터 확정

for (const [name, url] of [["ai-trader", `${AITRADER}/v1/characters`], ["paper-trade", `${PAPERTRADE}/v1/accounts`]]) {
  await j(`${url}?probe=1`, {}, 5000).catch((e) => { throw new Error(`${name} 응답 없음(${url}) — 기동 먼저: ${String(e).slice(0, 80)}`); });
}
log(`서비스 점검 ok (3041·3042)`);

const chars = (await j(`${AITRADER}/v1/characters`)).data.items;
const slug = SLUG_ARG ?? SRC.slug;
if (!chars.some((c) => c.slug === slug)) throw new Error(`캐릭터 '${slug}' 없음: ${JSON.stringify(chars.map((c) => c.slug))}`);
const PERSONA = argOf("persona", SRC.persona);
log(`캐릭터: ${slug} (페르소나 ${PERSONA}, 소스 ${SOURCE})`);

const boot = (await j(`${AITRADER}/v1/characters/${slug}/bootstrap`, { method: "POST" })).data;
const accountId = boot.accountId;
const acct0 = (await j(`${PAPERTRADE}/v1/accounts/${accountId}`)).data;
log(`계좌 ${accountId.slice(0, 8)}… 현금 ${won(acct0.cashKrw)}원 · 보유 ${acct0.positionCount ?? 0}종목`);

// ---------------------------------------------------------------- 1. 실소스 덤프

let sourceData = {};
let nameToCode = new Map(); // 종목명 → 6자리 코드 (②픽 해석용)
let priceOf = async () => null; // 코드 → 실행 시세

if (SOURCE === "chart") {
  const [bull, bear] = await Promise.all([
    j(`http://localhost:13100/api/screener?top=25&direction=bullish&sort=rank`, null, 150000),
    j(`http://localhost:13100/api/screener?top=15&direction=bearish&sort=rank`, null, 150000),
  ]);
  const chartRows = [
    ...bull.results.map((r) => ({ ...r, side: "상승" })),
    ...bear.results.map((r) => ({ ...r, side: "하락" })),
  ];
  sourceData = { chartRows };
  const byCode = new Map(chartRows.map((r) => [String(r.symbol), r]));
  for (const r of chartRows) if (!nameToCode.has(r.name)) nameToCode.set(r.name, String(r.symbol));
  priceOf = async (code) => byCode.get(code)?.close ?? null;
  log(`차트 덤프: 상승 ${bull.results.length} + 하락 ${bear.results.length} (${bull.results[0]?.last_date ?? "?"} 기준)`);
} else if (SOURCE === "news") {
  // 네이버 업스트림이 pageSize>20을 400으로 거부(2026-11-20 실측) — 20씩 3페이지로 50건 조립
  const pages = await Promise.all([1, 2, 3].map((p) => j(`${API_NEWS}&limit=20&page=${p}`, null, 60000)));
  const seen = new Set();
  const articles = pages.flatMap((d) => d.articles ?? []).filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
  sourceData = { articles: articles.slice(0, 50) };
  const universe = JSON.parse(await fs.readFile(UNIVERSE_PATH, "utf8"));
  for (const it of universe) {
    if (it.locale !== "KR" || it.kind !== "stock") continue;
    if (!nameToCode.has(it.name)) nameToCode.set(it.name, it.code);
    for (const alias of it.aliases ?? []) if (!nameToCode.has(alias)) nameToCode.set(alias, it.code);
  }
  priceOf = quoteClose;
  log(`뉴스 덤프: ${articles.length}건(${pages.length}페이지 병합) · 유니버스 매칭표 ${nameToCode.size}항목`);
} else {
  const d = await j(API_FINANCE_RANK, null, 120000);
  const items = d.list.map((r, i) => ({
    no: i + 1, code: r.stock_code, name: r.corp_name, market: r.market,
    score: r.total_score, grade: r.grade ?? "", basis: r.basis ?? "", fscore: r.fscore ?? null,
    cats: Array.isArray(r.categories) ? Object.fromEntries(r.categories.map((c) => [c.name, c.points])) : null,
  }));
  sourceData = { financeItems: items };
  for (const it of items) if (!nameToCode.has(it.name)) nameToCode.set(it.name, String(it.code));
  priceOf = quoteClose;
  log(`재무 덤프: ${items.length}종목 (${d.generated_at ?? "?"} 생성, ${d.basis ?? d.filter?.sort ?? ""})`);
}

const positions = acct0.positionCount ? (await j(`${PAPERTRADE}/v1/accounts/${accountId}/positions`)).data.items ?? [] : [];
const holdings = positions.map((p) => ({
  code: p.symbol, name: p.name ?? p.symbol, market: p.market ?? null,
  quantity: p.quantity, avgPriceKrw: p.avgPriceKrw, currentPriceKrw: p.avgPriceKrw,
  openedAt: new Date(p.updatedAt).toISOString().slice(0, 10),
  thesis: { entryReasons: ["(이전 턴 진입 — 테제 원문은 저널 fact에)"] },
}));
for (const h of holdings) {
  const q = await priceOf(h.code);
  if (q) h.currentPriceKrw = q;
}

const asOf = new Date().toISOString().slice(0, 10);
const dump = buildDump({ source: SOURCE, sourceData, holdings, asOf });
log(`덤프 hash=${dump.hash.slice(0, 12)} bytes=${dump.meta.bytes} 보유=${holdings.length}`);

// ---------------------------------------------------------------- 2. ② 흥미 선정 턴

const key = await getKey();
const interest = await runInterestTurn({ key, personaKey: PERSONA, dumpText: dump.text, source: SOURCE });
const iv = validateInterest(interest, holdings);
const i = interest.parsed ?? {};
log(`② ok=${iv.ok} 신규=${(i["신규"] ?? []).length} 재확인=${(i["재확인"] ?? []).length} 소멸=${(i["소멸"] ?? []).length}`);
if (!iv.ok) throw new Error(`② 검증 실패: ${JSON.stringify(iv.problems)}`);

// ---------------------------------------------------------------- 3. 스캔 집합 + ④ 딥스캔 조언

const codeOf = (p) => {
  const direct = String(p.code ?? "").match(/\d{6}/)?.[1] ?? null;
  const name = p["종목"] ?? p.name;
  return (direct && (nameToCode.has(name) || nameToCode.size === 0 || !name)) ? direct : (nameToCode.get(name) ?? direct);
};
const newPicks = (i["신규"] ?? [])
  .map((p) => { const code = codeOf(p); return code ? { code, name: p["종목"] ?? p.name, 이유: p["이유"] } : null; })
  .filter(Boolean);
const scanSet = [...new Map([...holdings.map((h) => [h.code, h]), ...newPicks.map((p) => [p.code, p])]).values()];
const toScan = scanSet.slice(0, SCANS);
log(`스캔 집합 ${scanSet.length}종목(보유 ${holdings.length} + 신규 ${newPicks.length}) → 딥스캔 ${toScan.length}개${SKIP_SCAN ? " (스킵 모드)" : ""}`);

const advices = [];
for (const s of toScan) {
  if (SKIP_SCAN) break;
  const a = await scanOne(s);
  if (a) advices.push(a);
}

// ---------------------------------------------------------------- 4. ⑤ 매매 결정 턴

const account = { cashKrw: acct0.cashKrw, valuationPct: null, lossStreak: null };
const tail = buildDecisionTail({ interest, advices, account, memory: { lines: [] }, scanCodes: scanSet.map((s) => s.code), holdings });
const decision = await runDecisionTurn({ key, personaKey: PERSONA, dumpText: dump.text, tail });
const dv = validateDecision(decision, scanSet.map((s) => s.code), holdings);
log(`⑤ ok=${dv.ok} decisions=${(decision.parsed?.decisions ?? []).length} ${dv.problems.join("; ")}`);

// ---------------------------------------------------------------- 5. 실행 — fit/ratio 체결 + 판단 로그

const decisions = (decision.parsed?.decisions ?? []).map((d) => {
  // 스키마 혼동 정규화 — LLM이 action 자리에 status:"buy" 등을 쓰는 경우(2026-11-20 실측)
  const verb = ["buy", "sell", "hold"].includes(d.status) ? d.status : null;
  if (!d.action && verb) d.action = verb;
  if (verb && !d.status?.match(/existing|new/)) d.status = undefined;
  // 매도에 sellRatio 누락 → 전량(1.0) 기본(2026-11-20 실측: 계룡건설 매도 스킵 사고)
  if (d.action === "sell" && !(Number(d.sellRatio) > 0)) {
    d.sellRatio = 1.0;
    log(`정규화: ${d.code} 매도 sellRatio 누락 → 전량 1.0 적용`);
  }
  return d;
});
const fills = [];
for (const d of decisions) {
  const code = String(d.code ?? "").match(/\d{6}/)?.[0];
  const price = code ? await priceOf(code) : null;
  let order = null, orderStatus = "skipped", errMsg = null;
  if (d.action === "buy" && code && price && Number(d.amountKrw) > 0) {
    try {
      order = (await j(`${PAPERTRADE}/v1/accounts/${accountId}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: code, side: "buy", amountKrw: Number(d.amountKrw), priceKrw: price, name: d.name ?? null, market: "KR" }),
      })).data;
      orderStatus = "filled";
      log(`체결 BUY ${code} ${d.name ?? ""} 금액의사 ${won(d.amountKrw)} → ${order.quantity}주 @ ${won(order.executedPriceKrw)}`);
    } catch (e) { orderStatus = "failed"; errMsg = String(e).slice(0, 200); log(`체결 실패 BUY ${code}: ${errMsg}`); }
  } else if (d.action === "sell" && code && price && Number(d.sellRatio) > 0) {
    try {
      order = (await j(`${PAPERTRADE}/v1/accounts/${accountId}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: code, side: "sell", ratio: Number(d.sellRatio), priceKrw: price, name: d.name ?? null, market: "KR" }),
      })).data;
      orderStatus = "filled";
      log(`체결 SELL ${code} ratio=${d.sellRatio} → ${order.quantity}주 @ ${won(order.executedPriceKrw)}`);
    } catch (e) { orderStatus = "failed"; errMsg = String(e).slice(0, 200); log(`체결 실패 SELL ${code}: ${errMsg}`); }
  }
  const advice = advices.find((a) => a.code === code);
  const jres = await j(`${AITRADER}/v1/characters/${slug}/judgments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decision: d.action, symbol: code,
      quantity: order?.quantity ?? null, priceKrw: order?.executedPriceKrw ?? price ?? null,
      reasonCode: `persona_${d.action}${d.status === "existing" ? "_existing" : "_new"}`,
      fact: {
        dumpHash: dump.hash, asOf, source: SOURCE,
        heroScore: advice?.heroScore ?? null, teams: advice?.teams ?? null, debugId: advice?.debugId ?? "",
        amountIntentKrw: d.amountKrw ?? null, sellRatio: d.sellRatio ?? null, scanSet: scanSet.map((s) => s.code),
      },
      rationale: d.reason ?? decision.parsed?.narrative ?? "",
      order: { orderId: order?.orderId ?? null, orderStatus, errorMessage: errMsg }, // filled/skipped/failed — #373 어휘
    }),
  }).catch((e) => { log(`판단 로그 실패 ${code}: ${String(e).slice(0, 150)}`); return null; });
  fills.push({ d, order, orderStatus, judgmentId: jres?.data?.logId ?? null });
}

// ---------------------------------------------------------------- 6. 요약 (UI가 보여줄 데이터 그대로)

const acct1 = (await j(`${PAPERTRADE}/v1/accounts/${accountId}`)).data;
const pos1 = acct1.positionCount ? (await j(`${PAPERTRADE}/v1/accounts/${accountId}/positions`)).data.items ?? [] : [];
const journal = (await j(`${AITRADER}/v1/characters/${slug}/journal?limit=20`)).data.items;

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const outPath = path.join(__dirname, "output", `turn-live-${SOURCE}-${stamp}.json`);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify({
  asOf, slug, source: SOURCE, accountId, dumpHash: dump.hash,
  interest: interest.parsed, advices, decisions, fills,
  account: acct1, positions: pos1, journal,
}, null, 2));

console.error("\n===== 실턴 결과 =====");
console.error(`[${PERSONA}] 현금 ${won(acct1.cashKrw)}원 · 보유 ${pos1.length}종목 · 판단 로그 ${journal.length}건`);
for (const p of pos1) console.error(`  보유 ${p.symbol} ${p.name ?? ""} ${p.quantity}주 평단 ${won(p.avgPriceKrw)}`);
for (const f of fills) console.error(`  [${f.d.action}] ${f.d.code} ${f.d.name} ${f.orderStatus} ${f.order ? `${f.order.quantity}주` : ""} — ${String(f.d.reason).slice(0, 80)}`);
console.error(`기록: ${outPath}`);

// ---------------------------------------------------------------- 딥스캔 (run-pipeline 패턴 승계: 429 백오프 3회)

async function scanOne(s) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await sleep(lastErr === "429" ? 30000 * (attempt - 1) : 3000);
    try {
      const t0 = Date.now();
      const res = await fetch(`${DEEPSCAN_API}?code=${s.code}&name=${encodeURIComponent(s.name)}&market=KR`, { signal: AbortSignal.timeout(300000) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { kind: String(res.status) });
      const body = await res.json();
      if (body?.ok === false) throw new Error(`gate: ${body.error?.code ?? "?"}`);
      const p = body?.data?.hero ? body.data : body;
      const hero = p.hero ?? {};
      const teams = {};
      const ts = p.teamSummaries ?? p.storedTeamSummaries ?? p.teams ?? null;
      if (ts && typeof ts === "object") {
        for (const [k, v] of Object.entries(ts)) {
          const key = /market/i.test(k) ? "market" : /context|psych/i.test(k) ? "context" : /fund/i.test(k) ? "fundamental" : null;
          const val = typeof v === "string" ? v : v?.summary ?? null;
          if (key && val) teams[key] = val;
        }
      }
      const a = {
        code: s.code, name: s.name, heroScore: hero.score ?? null, teams,
        facts: Array.isArray(hero.evidenceFacts) ? hero.evidenceFacts.slice(0, 5) : [],
        debugId: p.metadata?.debugId ?? "",
        fetchedAtSec: Math.round((Date.now() - t0) / 1000),
      };
      if (a.heroScore == null) throw new Error("heroScore 없음");
      log(`④ 딥스캔 ok ${s.name}(${s.code}) hero=${a.heroScore} 팀요약=${Object.keys(teams).length}/3 · ${a.fetchedAtSec}s`);
      return a;
    } catch (e) {
      lastErr = e.kind ?? null;
      log(`④ 시도${attempt} 실패 ${s.name}(${s.code}): ${String(e).slice(0, 100)}`);
    }
  }
  return null;
}
