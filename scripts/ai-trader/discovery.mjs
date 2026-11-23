#!/usr/bin/env node
/**
 * AI 트레이더 소스별 발굴(discovery) — issue #369 멀티소스 v1 (2026-11-19)
 *
 * 캐릭터 3인이 각각 다른 데이터 소스만 보고 종목을 발굴한다:
 *   뉴스콕 — 네이버 메인뉴스 50건 (naver-mainnews-crawler :13020)
 *   차트콕 — 차트 패턴 점수 상위 (krchart /api/screener :13100, 상승 N + 하락 M)
 *   재무콕 — 재무 스코어 상위 (dart-fs-crawler /api/scores/rank :8088, TSV 폴백)
 *
 * 구조는 jaroo_characters.js와 동일한 기계:
 *   [system: 소스별 분석가(고정)] + [user: 후보 블록(고정) + 꼬리에 캐릭터 지시(가변)]
 * 산출물의 긍정 종목이 deepscan → 게이트 → 매매로 이어진다 (run-pipeline.mjs CHAR_SET=source).
 *
 * 사용: node scripts/ai-trader/discovery.mjs [--only news,chart,finance] [--bullish 25] [--bearish 15] [--finance-top 30]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");

const API_NEWS = "http://pop-os.tailcff214.ts.net:13020/api/news?limit=50&fresh=1";
const API_CHART = "http://localhost:13100/api/screener";
const API_FINANCE_RANK = "http://localhost:8088/api/scores/rank";
const FINANCE_TSV_FALLBACK = "/tmp/all_scores.tsv"; // 전수 배치 스냅샷 (2025/12 결산, 휘발성)

const OPENGW = "https://apis.opengateway.ai/v1/chat/completions";
const MODEL = "deepseek/deepseek-v4.1-flash-eco";
const PRICE = { prompt: 0.00000003, cached: 0.0000000006, completion: 0.00000012 };

// ---------------------------------------------------------------- CLI

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ONLY = (argOf("only", "news,chart,finance")).split(",").map((s) => s.trim()).filter(Boolean);
const BULLISH_N = Number(argOf("bullish", 25));
const BEARISH_N = Number(argOf("bearish", 15));
const FINANCE_TOP = Number(argOf("finance-top", 30));

// ---------------------------------------------------------------- 캐릭터 (각 1개 소스만 본다)

const PERSONAS = {
  뉴스콕: {
    source: "news",
    directive:
      "너는 jaroo AI 트레이더 캐릭터 '뉴스콕'이다. 하루 종일 뉴스피드를 붙잡고 사는 속보 중독 — 이슈·수급 모멘텀·시장 분위기가 움직이는 종목을 찾는다. 기사 하나하나에서 '지금 돈이 어디로 흐르는지'를 읽는다. 뉴스에 없는 종목은 관심 밖이다. 말투는 빠르고 말이 많다.",
  },
  차트콕: {
    source: "chart",
    directive:
      "너는 jaroo AI 트레이더 캐릭터 '차트콕'이다. 캔들과 패턴만 믿는 차트 중독 — 뉴스·재무는 소음이고 그림이 다 말해준다고 믿는다. 패턴 점수 상위 후보의 방향(상승/하락 우위), 패턴 완성도(확정/진행중), 목표가·손절가, 추세 배열을 보고 '지금 들어갈 그림인지'를 판단한다. 상승 후보라도 그림이 지저분하면 거른다. 말투는 단호하고 군더더기 없다.",
  },
  재무콕: {
    source: "finance",
    directive:
      "너는 jaroo AI 트레이더 캐릭터 '재무콕'이다. 재무제표만 읽는 숫자 중독 — 이야기는 거짓말해도 숫자는 안 한다는 신념. 재무 스코어 상위 후보의 수익성·건전성·성장성·현금흐름·효율성·F-Score를 보고 진짜 우량인지, 총점에 비해 경계할 구멍(성장 정체, F-Score 낮음, 한 카테고리 편중)이 있는지 판단한다. 높은 점수를 맹신하지 않는다. 말투는 냉정하고 계산적이다.",
  },
};

// ---------------------------------------------------------------- 소스별 어댑터 — { block, items, meta } 반환

const j = async (url, timeoutMs = 30000) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
};

/** 뉴스 — 50개 기사 원문 블록 (기존 jaroo_characters.js와 동일 포맷) */
async function fetchNews() {
  const d = await j(`${API_NEWS}`);
  const items = d.articles.map((a, i) => ({
    no: i + 1,
    url: a.url,
    head: String(a.text || "").split(/\.\s|\n/)[0].slice(0, 90),
  }));
  const block = d.articles.map((a, i) => `[${i + 1}]\n${a.text}`).join("\n\n");
  return { block, items, meta: { count: d.count } };
}

/** 차트 — 스크리너 상승 N + 하락 M 후보. items에 code/market를 싣는다(픽→코드 확정용) */
async function fetchChart() {
  const [bull, bear] = await Promise.all([
    j(`${API_CHART}?top=${BULLISH_N}&direction=bullish&sort=rank`, 150000),
    j(`${API_CHART}?top=${BEARISH_N}&direction=bearish&sort=rank`, 150000),
  ]);
  const rows = [
    ...bull.results.map((r) => ({ ...r, side: "상승" })),
    ...bear.results.map((r) => ({ ...r, side: "하락" })),
  ];
  const items = rows.map((r, i) => ({
    no: i + 1,
    code: r.symbol,
    name: r.name,
    market: r.market,
    side: r.side,
    score: r.top_score,
    rank: r.rank,
    pattern: r.top ? `${r.top.kind}(${r.top.direction}·${r.top.status})` : "",
    target: r.top?.target ?? null,
    stop: r.top?.stop ?? null,
    trend: r.trend_label ?? "",
    bias: r.bias ?? "",
  }));
  const block = rows
    .map((r, i) => {
      const p = r.top ?? {};
      const tgt = [p.target ? `목표 ${p.target}` : null, p.stop ? `손절 ${p.stop}` : null].filter(Boolean).join("·");
      return [
        `[${i + 1}] ${r.name}(${r.symbol}·${r.market}) [${r.side} 후보]`,
        `스코어 ${r.top_score} · ${r.bias} · 최상 패턴: ${p.kind ?? "?"}(${p.direction ?? "?"}·${p.status ?? "?"})${tgt ? " · " + tgt : ""}`,
        `추세 ${r.trend_label ?? "?"} · MA20 ${r.above_ma20 ? "위" : "아래"} · 전일 ${r.change_pct}% · 상승패턴 ${r.bullish_count}/${r.patterns}개 · 하락패턴 ${r.bearish_count}/${r.patterns}개`,
      ].join("\n");
    })
    .join("\n\n");
  return {
    block,
    items,
    meta: { bullish: bull.results.length, bearish: bear.results.length, filter: bull.filter ?? null },
  };
}

/** 재무 — /api/scores/rank 우선, 없으면 전수 TSV 스냅샷 상위로 폴백 */
async function fetchFinance() {
  try {
    const d = await j(`${API_FINANCE_RANK}?top=${FINANCE_TOP}`, 120000);
    if (!Array.isArray(d.list) || d.list.length === 0) throw new Error("rank 응답에 list 없음");
    const items = d.list.map((r, i) => ({
      no: i + 1,
      code: r.stock_code,
      name: r.corp_name,
      market: r.market,
      score: r.total_score,
      grade: r.grade ?? "",
      basis: r.basis ?? "",
      fscore: r.fscore ?? null,
      // categories: [{key,name,points,max}] → {수익성: 24, ...} (TSV 폴백과 동일 형태로 통일)
      cats: Array.isArray(r.categories)
        ? Object.fromEntries(r.categories.map((c) => [c.name, c.points]))
        : null,
    }));
    return { block: blockFinance(items), items, meta: { via: "api", count: items.length, universe: d.universe ?? null, generatedAt: d.generated_at ?? null } };
  } catch (e) {
    console.error(`[finance] /api/scores/rank 실패(${String(e).slice(0, 120)}) → TSV 스냅샷 폴백`);
    const raw = await fs.readFile(FINANCE_TSV_FALLBACK, "utf8");
    const rows = raw
      .trim()
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((c) => c.length >= 8 && c[0] && !Number.isNaN(Number(c[0])))
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .slice(0, FINANCE_TOP);
    const items = rows.map((c, i) => ({
      no: i + 1,
      code: c[2],
      name: c[1],
      market: c[3],
      score: Number(c[0]),
      grade: c[4] ?? "",
      basis: c[5] ?? "",
      fscore: c[6] != null && c[6] !== "" ? Number(c[6]) : null,
      cats: { 수익성: c[7], 건전성: c[8], 성장성: c[9], 현금흐름: c[10], 효율성: c[11] },
    }));
    return { block: blockFinance(items), items, meta: { via: "tsv-fallback", count: items.length } };
  }
}

function blockFinance(items) {
  return items
    .map((it) => {
      const cats = it.cats
        ? Object.entries(it.cats)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ")
        : "";
      return `[${it.no}] ${it.name}(${it.code}·${it.market}) 총점 ${it.score} · ${it.grade} · F-Score ${it.fscore ?? "?"} · 결산 ${it.basis}${cats ? `\n  ${cats}` : ""}`;
    })
    .join("\n\n");
}

const SOURCES = { news: fetchNews, chart: fetchChart, finance: fetchFinance };

// ---------------------------------------------------------------- 소스별 프롬프트

const COMMON_RULES = (evidence) => `
[공통 규칙]
- 모든 사실·숫자는 입력에 있는 것만 사용한다. 없는 사실을 만들지 않는다.
- 각 인사이트에 근거 ${evidence} 번호를 붙인다. 예: (${evidence} 7, 21)
- 지정된 관점의 성격이 해석에 드러나되, 근거와 해석을 한 문장 안에서 구분한다.
- 서론·결론·총평 없이 항목만 출력한다.
`;

const SYSTEMS = {
  news: `너는 증권 뉴스 분석가다. 입력된 50개 뉴스 본문에서 지정된 관점의 인사이트를 뽑는다.\n${COMMON_RULES("기사")}`,
  chart: `너는 차트 패턴 분석가다. 입력된 차트 패턴 점수 상위 후보(상승·하락)에서 지정된 관점의 인사이트를 뽑는다.\n${COMMON_RULES("후보")}`,
  finance: `너는 재무제표 분석가다. 입력된 재무 스코어 상위 후보에서 지정된 관점의 인사이트를 뽑는다.\n${COMMON_RULES("후보")}`,
};

const stockDirectiveFor = (source) => {
  if (source === "news") {
    return `
[관심 종목 반환 — 반드시 마지막에 출력]
이 관점에서 평가하는 종목을 기사에 언급된 것만 골라, 긍정/부정으로 나눠 아래 형식의 json 코드 블록으로 반환하라.
- "긍정": 이 관점에서 긍정적으로 평가하는 종목 (흥미, 주목, 매수 관점 고려 대상)
- "부정": 이 관점에서 부정적으로 평가하는 종목 (리스크, 회피, 하락 우려, 경계 대상)
- 각 항목: "종목"(기사에 나온 이름 그대로), "이유"(이 관점의 근거 1문장), "근거기사"(정수 배열)
- 긍정·부정 각각 0~8개. 스탠스가 애매하면 넣지 마라. 근거 없는 종목 금지.
- 빈 배열도 빈 배열로 둔다. json 블록 외에 종목 목록을 중복 나열하지 마라.

형식:
\`\`\`json
{"긍정": [{"종목": "삼성전자", "이유": "예시", "근거기사": [33]}],
 "부정": [{"종목": "HLB테라픠틱스", "이유": "예시", "근거기사": [3]}]}
\`\`\`
`;
  }
  const ev = source === "chart" ? "후보" : "후보";
  const pos = source === "chart" ? "이 관점에서 매수 고려할 상승 그림의 종목" : "이 관점에서 진짜 우량이라 인정하는 종목";
  const neg = source === "chart" ? "경계·하락 그림이거나 상승 후보 중에서도 거를 종목" : "점수는 높아도 이 관점에서 경계할 구멍이 있는 종목";
  return `
[관심 종목 반환 — 반드시 마지막에 출력]
이 관점에서 평가하는 종목을 입력 ${ev}에 있는 것만 골라, 긍정/부정으로 나눠 아래 형식의 json 코드 블록으로 반환하라.
- "긍정": ${pos}
- "부정": ${neg}
- 각 항목: "종목"(${ev} 표기 그대로), "이유"(이 관점의 근거 1문장 — 패턴/숫자를 인용), "근거후보"(정수 배열)
- 긍정·부정 각각 0~8개. 애매하면 넣지 마라. 입력에 없는 종목 금지.
- 빈 배열도 빈 배열로 둔다. json 블록 외에 종목 목록을 중복 나열하지 마라.

형식:
\`\`\`json
{"긍정": [{"종목": "제닉", "이유": "예시", "근거후보": [1]}],
 "부정": [{"종목": "경방", "이유": "예시", "근거후보": [4]}]}
\`\`\`
`;
};

// ---------------------------------------------------------------- LLM 기계 (jaroo_characters.js 동일)

async function getKey() {
  if (process.env.OPENGATEWAY_API_KEY) return process.env.OPENGATEWAY_API_KEY;
  const env = await fs.readFile(path.join(process.env.HOME, ".dsh", "web.env"), "utf8");
  const m = env.match(/^OPENGATEWAY_API_KEY=(\S+)/m);
  if (!m) throw new Error("OPENGATEWAY_API_KEY 없음 (~/.dsh/web.env)");
  return m[1];
}

async function chat(key, messages) {
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
  return res.json();
}

/** 인사이트(마크다운)와 ```json``` 종목 블록 분리 → { insights, positive, negative, ok } */
export function splitContent(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/);
  let positive = [], negative = [], ok = false;
  let insights = text;
  if (m) {
    insights = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
    try {
      const parsed = JSON.parse(m[1]);
      const valid = (arr) => Array.isArray(arr)
        ? arr.filter((s) => s && typeof s["종목"] === "string")
        : [];
      if (Array.isArray(parsed)) {
        positive = valid(parsed); ok = true;
      } else if (parsed && typeof parsed === "object") {
        positive = valid(parsed["긍정"]); negative = valid(parsed["부정"]); ok = true;
      }
    } catch { /* 파싱 실패 시 원문 유지 */ }
  }
  return { insights, positive, negative, ok };
}

/** 차트/재무 픽에 후보 매칭으로 code·market 확정 (뉴스는 run-pipeline이 유니버스로 해석)
 *  LLM이 "이름(코드·시장)" 통째로 반환하는 경우가 있어 3단계 매칭: 정확명 → 괄호 제거명 → 코드 추출 */
function attachCodes(picks, items) {
  const byName = new Map(items.map((it) => [it.name, it]));
  const byCode = new Map(items.filter((it) => it.code).map((it) => [it.code, it]));
  return picks.map((p) => {
    const raw = String(p["종목"]).trim();
    const paren = raw.match(/^(.*?)\s*\((\d{6})/); // "케이아이엔엑스(093320·KOSDAQ)"
    const bare = paren ? paren[1].trim() : raw;
    const codeIn = raw.match(/(\d{6})/)?.[1] ?? null;
    const hit = byName.get(raw) ?? byName.get(bare) ?? (codeIn ? byCode.get(codeIn) : undefined) ?? null;
    return {
      ...p,
      종목: hit ? hit.name : bare,
      code: hit?.code ?? codeIn,
      market: hit?.market ?? null,
      side: hit?.side ?? null,
      score: hit?.score ?? null,
    };
  });
}

const fmt = (n) => n.toLocaleString("ko-KR");

// ---------------------------------------------------------------- 메인

async function main() {
  const key = await getKey();
  const enabled = Object.entries(PERSONAS).filter(([, p]) => ONLY.includes(p.source));
  if (enabled.length === 0) throw new Error(`실행할 소스 없음: --only ${ONLY.join(",")}`);

  // 0) 소스별 후보는 각 1회만 fetch → 같은 소스 캐릭터에 재사용
  const fetched = {};
  for (const source of new Set(enabled.map(([, p]) => p.source))) {
    console.error(`[fetch] ${source} …`);
    fetched[source] = await SOURCES[source]();
    const m = fetched[source].meta;
    console.error(`[fetch] ${source} 완료 — ${JSON.stringify(m)}`);
  }

  const rows = [];
  const personasOut = {};
  let n = 0;
  for (const [name, persona] of enabled) {
    n += 1;
    const { block, items } = fetched[persona.source];
    const userMsg =
      (persona.source === "news"
        ? `다음 ${items.length}개 기사 본문을 읽어라.\n\n`
        : `다음 ${persona.source === "chart" ? "차트 패턴 점수 상위" : "재무 스코어 상위"} 후보 ${items.length}건을 읽어라.\n\n`) +
      `${block}\n\n[관점 지시 — 이 부분만 매번 다름]\n${persona.directive}\n${stockDirectiveFor(persona.source)}`;
    const t0 = Date.now();
    let resp, content = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      resp = await chat(key, [
        { role: "system", content: SYSTEMS[persona.source] },
        { role: "user", content: userMsg },
      ]);
      content = (resp.choices[0].message.content || "").trim();
      if (content) break;
      console.error(`[${name}] content 비었음 (finish=${resp.choices[0].finish_reason}) — 재시도 ${attempt}/2`);
      if (attempt === 2) throw new Error(`[${name}] 재시도 후에도 content 없음`);
    }

    const u = resp.usage || {};
    const pt = u.prompt_tokens || 0;
    const cached = u.prompt_tokens_details?.cached_tokens || 0;
    const ct = u.completion_tokens || 0;
    const cost = pt * PRICE.prompt - cached * (PRICE.prompt - PRICE.cached) + ct * PRICE.completion;
    const sec = (Date.now() - t0) / 1000;

    const { insights, positive, negative, ok } = splitContent(content);
    personasOut[name] = {
      source: persona.source,
      insights,
      positive: persona.source === "news" ? positive : attachCodes(positive, items),
      negative: persona.source === "news" ? negative : attachCodes(negative, items),
    };
    rows.push({ name, pt, cached, ct, sec, cost });
    console.error(
      `[${n}/${enabled.length}] ${name}(${persona.source}): prompt ${fmt(pt)} (cache ${fmt(cached)})` +
        ` | completion ${fmt(ct)} | ${sec.toFixed(1)}s | $${cost.toFixed(6)} | 긍정 ${positive.length} / 부정 ${negative.length}${ok ? "" : " (json 파싱실패)"}`
    );
  }

  // 저장
  await fs.mkdir(OUT_DIR, { recursive: true });
  const now = new Date(), p2 = (x) => String(x).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const sources = {};
  for (const [src, f] of Object.entries(fetched)) sources[src] = { meta: f.meta, items: f.items };

  await fs.writeFile(
    path.join(OUT_DIR, `discovery-source-${stamp}.json`),
    JSON.stringify({ generated_at: new Date().toISOString(), model: MODEL, sources, personas: personasOut }, null, 2),
  );

  const evLabel = { news: "근거기사", chart: "근거후보", finance: "근거후보" };
  const md = `# 소스별 AI 트레이더 발굴 — ${enabled.map(([n2]) => n2).join(" · ")}\n\n` +
    Object.entries(personasOut).map(([name, v]) => {
      const list = (arr, mark) => (arr || [])
        .map((s) => `- ${mark} **${s["종목"]}**${s.code ? `(${s.code})` : ""} — ${s["이유"] || ""}`)
        .join("\n");
      return `## ${name} [소스: ${v.source}]\n\n${v.insights}\n\n### 긍정 종목\n${list(v.positive, "＋") || "- (없음)"}\n\n### 부정 종목\n${list(v.negative, "－") || "- (없음)"}`;
    }).join("\n\n") + "\n";
  await fs.writeFile(path.join(OUT_DIR, `discovery-source-${stamp}.md`), md + "\n");

  console.log(md);
  console.error(`\n총 비용 $${totalCost.toFixed(6)} — 저장: discovery-source-${stamp}.{md,json}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
