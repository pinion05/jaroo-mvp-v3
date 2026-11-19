#!/usr/bin/env node
/**
 * AI 트레이더 전체 파이프라인 — "갱신하기" 버튼용 원클릭 재실행 (issue #369 v1 데모)
 *
 * 발굴(뉴스 50건 → 4페르소나) → 딥스캔(발굴 종목 실 판정, 동시성 3) → 게이트/sizing
 * → AI 서사 일기 → draft5-live.json 원자적 교체.
 *
 * - 각 단계마다 public/ai-trader/draft5-live.status.json 에 진행 상황을 남겨
 *   UI가 폴링으로 단계 라벨("딥스캔 판정 3/8")을 보여준다.
 * - 실패 시 lastError 기록하고 기존 draft5-live.json 은 절대 건드리지 않는다(tmp+rename).
 * - 싱글턴: API 라우트가 status.pid 로 중복 실행을 막는다.
 *
 * 사용: node scripts/ai-trader/run-pipeline.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");

// 캐릭터 세트 — classic(소심이/돌진이/배당콕, 뉴스만) | source(뉴스콕/차트콕/재무콕, 소스별 발굴)
// 사용: CHAR_SET=source node scripts/ai-trader/run-pipeline.mjs
const CHAR_SET = process.env.CHAR_SET === "source" ? "source" : "classic";

const CRAWLER_DIR = "/home/pinion/naver-mainnews-crawler";
const CRAWLER_SCRIPT = path.join(CRAWLER_DIR, "examples/jaroo_characters.js");
const CRAWLER_OUT = path.join(CRAWLER_DIR, "examples/output");
const DISCOVERY_SCRIPT = path.join(REPO, "scripts/ai-trader/discovery.mjs");
const DISCOVERY_OUT = path.join(REPO, "scripts/ai-trader/output");
const DEEPSCAN_API = process.env.DEEPSCAN_API ?? "http://localhost:3002/api/deepscan";

const OPENGW = "https://apis.opengateway.ai/v1/chat/completions";
const DIARY_MODEL = "deepseek/deepseek-v4.1-flash-eco";

const CHAR_ORDER = ["소심이", "돌진이", "배당콕"];
const THRESHOLDS = { 소심이: 55, 돌진이: 35, 배당콕: 50 };

// 소스별 세트 (issue #369 멀티소스 v1) — 각 캐릭터가 다른 데이터 소스만 본다
const SOURCE_CHAR_ORDER = ["뉴스콕", "차트콕", "재무콕"];
const SOURCE_THRESHOLDS = { 뉴스콕: 45, 차트콕: 50, 재무콕: 55 };
const SOURCE_OF = { 뉴스콕: "news", 차트콕: "chart", 재무콕: "finance" };
const SOURCE_LABEL = {
  news: "네이버 메인뉴스 50건",
  chart: "차트 패턴 점수 상위 (상승 25 + 하락 15)",
  finance: "재무 스코어 상위 30종목 (2025/12 결산)",
};

const IS_SOURCE_SET = CHAR_SET === "source";
const ACTIVE_ORDER = IS_SOURCE_SET ? SOURCE_CHAR_ORDER : CHAR_ORDER;
const ACTIVE_THRESHOLDS = IS_SOURCE_SET ? SOURCE_THRESHOLDS : THRESHOLDS;
const LIVE = path.join(REPO, `public/ai-trader/${IS_SOURCE_SET ? "draft5-source-live" : "draft5-live"}.json`);
const STATUS = path.join(REPO, `public/ai-trader/${IS_SOURCE_SET ? "draft5-source-live" : "draft5-live"}.status.json`);
const UNIVERSE = path.join(REPO, "src/lib/data/instrument-universe.json");
/** 딥스캔 동시 실행 수 — 위원회(9 LLM)를 굴리므로 2 이상은 429 위험 (실측) */
const SCAN_CONCURRENCY = 2;
/** 발굴→딥스캔 종목 상한 (비용/시간 바운드) */
const MAX_SCAN = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 유니버스명과 뉴스 표기가 다른 데모 크리티컬 종목 (예: 뉴스 "KT" ↔ 유니버스 "케이티") */
const NAME_OVERRIDES = { KT: "030200" };

const nowKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace("Z", "+09:00");

// ---------------------------------------------------------------- 상태 파일

async function readStatus() {
  try {
    return JSON.parse(await fs.readFile(STATUS, "utf8"));
  } catch {
    return {};
  }
}

async function writeStatus(patch) {
  const prev = await readStatus();
  const next = { ...prev, ...patch, updatedAt: nowKST() };
  await fs.writeFile(STATUS, JSON.stringify(next, null, 2));
  return next;
}

const log = (msg) => console.error(`[${new Date().toISOString()}] ${msg}`);

// ---------------------------------------------------------------- 1. 발굴 (crawler spawn)

async function runDiscovery() {
  if (IS_SOURCE_SET) {
    // 소스별 발굴 — discovery.mjs가 뉴스/차트/재무 3소스를 각 1회 fetch해 캐릭터별로 재해석
    const before = new Set(await fs.readdir(DISCOVERY_OUT).catch(() => []));
    await new Promise((resolve, reject) => {
      const child = spawn("node", [DISCOVERY_SCRIPT], { cwd: REPO, env: process.env, stdio: "ignore" });
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("discovery timeout (600s)"));
      }, 600000);
      child.on("error", (e) => { clearTimeout(killer); reject(e); });
      child.on("exit", (code) => {
        clearTimeout(killer);
        if (code === 0) resolve();
        else reject(new Error(`discovery exit ${code}`));
      });
    });
    const after = (await fs.readdir(DISCOVERY_OUT))
      .filter((f) => f.startsWith("discovery-source-") && f.endsWith(".json") && !before.has(f))
      .sort();
    if (after.length === 0) throw new Error("discovery 산출물 없음");
    const file = path.join(DISCOVERY_OUT, after[after.length - 1]);
    log(`발굴 산출물: ${path.basename(file)}`);
    return JSON.parse(await fs.readFile(file, "utf8"));
  }
  const before = new Set(await fs.readdir(CRAWLER_OUT).catch(() => []));
  await new Promise((resolve, reject) => {
    const child = spawn("node", [CRAWLER_SCRIPT], { cwd: CRAWLER_DIR, env: process.env, stdio: "ignore" });
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("crawler timeout (360s)"));
    }, 360000);
    child.on("error", (e) => { clearTimeout(killer); reject(e); });
    child.on("exit", (code) => {
      clearTimeout(killer);
      if (code === 0) resolve();
      else reject(new Error(`crawler exit ${code}`));
    });
  });
  const after = (await fs.readdir(CRAWLER_OUT))
    .filter((f) => f.startsWith("jaroo-stocks-") && f.endsWith(".json") && !before.has(f))
    .sort();
  if (after.length === 0) throw new Error("crawler 산출물 없음");
  const file = path.join(CRAWLER_OUT, after[after.length - 1]);
  log(`발굴 산출물: ${path.basename(file)}`);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

// ---------------------------------------------------------------- 2. 변환 (discovery → live 스키마)

/** 차트/재무 후보 1건의 근거 요약 라인 (일기 dataBlock·UI 증거 표시용) */
function evidenceLine(source, it) {
  if (source === "chart") {
    const t = [`스코어 ${it.score ?? "?"}`, it.pattern ?? "", it.trend ?? ""].filter(Boolean).join(" · ");
    const ts = [it.target ? `목표 ${it.target}` : null, it.stop ? `손절 ${it.stop}` : null].filter(Boolean).join("·");
    return `${t}${ts ? ` · ${ts}` : ""}`;
  }
  if (source === "finance") {
    const cats = it.cats ? Object.entries(it.cats).map(([k, v]) => `${k} ${v}`).join(" · ") : "";
    return `총점 ${it.score ?? "?"} ${it.grade ?? ""} · F-Score ${it.fscore ?? "?"}${cats ? ` · ${cats}` : ""}`;
  }
  return it.head ?? "";
}

function transform(discovery) {
  const articles = discovery.articles ?? [];
  const articleByNo = new Map(articles.map((a) => [a.no, a]));
  const urlsOf = (nos) => (nos ?? []).map((n) => articleByNo.get(n)?.url).filter(Boolean);

  // 소스 세트 — 후보 아이템/근거 매핑 (뉴스콕은 뉴스, 차트콕·재무콕은 각 소스 후보)
  const sourceItems = {};
  const sourceByNo = {};
  for (const [src, s] of Object.entries(discovery.sources ?? {})) {
    sourceItems[src] = s.items ?? [];
    sourceByNo[src] = new Map((s.items ?? []).map((it) => [it.no, it]));
  }

  const characters = ACTIVE_ORDER.map((name) => {
    const p = discovery.personas?.[name] ?? { positive: [], negative: [] };
    const src = IS_SOURCE_SET ? (p.source ?? SOURCE_OF[name] ?? "news") : "news";
    const byNo = sourceByNo[src] ?? new Map();
    const evidenceOf = (x) => (x["근거후보"] ?? [])
      .map((n) => byNo.get(n))
      .filter(Boolean)
      .map((it) => `${it.name} — ${evidenceLine(src, it)}`);

    const toPick = (x, positive) => {
      const base = {
        stock: x["종목"],
        reason: x["이유"],
        articles: x["근거기사"] ?? [],
        urls: src === "news" ? urlsOf(x["근거기사"]) : [],
        evidence: src === "news" ? [] : evidenceOf(x),
        source: src,
        gate: null,
      };
      // 차트/재무 픽은 후보에서 코드가 확정되어 있다 — 딥스캔 직결
      if (positive && x.code) base.code = x.code;
      return base;
    };
    return {
      name,
      source: src,
      positive: (p.positive ?? []).map((x) => toPick(x, true)),
      negative: (p.negative ?? []).map((x) => toPick(x, false)),
      diary: null,
    };
  });

  // 매트릭스 — 종목 × 캐릭터 스탠스(1/-1) + 합계
  const rows = new Map();
  for (const ch of characters) {
    for (const item of ch.positive) {
      const row = rows.get(item.stock) ?? { stock: item.stock };
      row[ch.name] = 1;
      rows.set(item.stock, row);
    }
    for (const item of ch.negative) {
      const row = rows.get(item.stock) ?? { stock: item.stock };
      row[ch.name] = -1;
      rows.set(item.stock, row);
    }
  }
  const matrix = [...rows.values()].map((row) => {
    for (const name of ACTIVE_ORDER) row[name] = row[name] ?? 0;
    row.sum = ACTIVE_ORDER.reduce((acc, name) => acc + row[name], 0);
    return row;
  });

  return {
    generatedAt: nowKST(),
    charSet: CHAR_SET,
    source: IS_SOURCE_SET
      ? Object.fromEntries(Object.entries(discovery.sources ?? {}).map(([k, s]) => [k, s.meta ?? null]))
      : "naver-mainnews-crawler",
    articleCount: articles.length || (discovery.sources?.news?.meta?.count ?? null),
    articles,
    characters,
    matrix,
    deepscans: [],
    deepscanFetchedAt: null,
    thresholds: ACTIVE_THRESHOLDS,
  };
}

// ---------------------------------------------------------------- 3. 종목코드 해석 (유니버스)

async function buildCodeResolver() {
  const universe = JSON.parse(await fs.readFile(UNIVERSE, "utf8"));
  const byName = new Map();
  const byAlias = new Map();
  for (const it of universe) {
    if (it.locale !== "KR" || it.kind !== "stock") continue;
    if (!byName.has(it.name)) byName.set(it.name, it.code);
    for (const alias of it.aliases ?? []) if (!byAlias.has(alias)) byAlias.set(alias, it.code);
  }
  return (stock) => NAME_OVERRIDES[stock] ?? byName.get(stock) ?? byAlias.get(stock) ?? null;
}

// ---------------------------------------------------------------- 4. 딥스캔 (동시성 풀)

const sizingOf = (score, th) => {
  const margin = score - th;
  if (margin >= 25) return "큰 비중";
  if (margin >= 10) return "중간 비중";
  return "반 티켓";
};

async function scanOne({ stock, code }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      // 429(과속)는 위원회 버스트가 빠지길 기다렸다가 재시도 — 즉시 재시도는 다시 429로 죽는다(실측)
      const waitMs = lastErr === "429" ? 30000 * (attempt - 1) : 3000;
      log(`딥스캔 ${waitMs / 1000}s 후 재시도 ${stock}(${code})…`);
      await sleep(waitMs);
    }
    const t0 = Date.now();
    try {
      const url = `${DEEPSCAN_API}?code=${code}&name=${encodeURIComponent(stock)}&market=KR`;
      const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { kind: String(res.status) });
      const body = await res.json();
      if (body && body.ok === false) throw new Error(`gate: ${body.error?.code ?? "unknown"}`);
      const p = body?.data?.hero ? body.data : body;
      const hero = p.hero ?? {};
      const st = p.strategy ?? {};
      const rf = p.recoveryForecast ?? {};
      const meta = p.metadata ?? {};
      const rec = {
        code,
        name: stock,
        heroScore: hero.score ?? null,
        scoreLabel: hero.scoreLabel ?? "",
        weekSignal: st.weekSignal ?? "",
        targetPriceText: st.targetPriceText ?? "",
        recoveryHorizonProbabilities: rf.recoveryHorizonProbabilities ?? null,
        recoveryProbabilityHeadlineText: rf.recoveryProbabilityHeadlineText ?? "",
        confidenceLevel: rf.confidenceLevel ?? null,
        debugId: meta.debugId ?? "",
        generatedAt: meta.generatedAt ?? "",
        fetchedAtSec: Math.round((Date.now() - t0) / 1000),
      };
      if (rec.heroScore == null) throw new Error("heroScore 없음");
      log(`딥스캔 ok ${stock}(${code}) hero=${rec.heroScore} · ${rec.fetchedAtSec}s`);
      return rec;
    } catch (e) {
      lastErr = e.kind ?? null;
      log(`딥스캔 시도${attempt} 실패 ${stock}(${code}): ${String(e)}`);
    }
  }
  return null;
}

async function runDeepscan(live, resolveCode) {
  // 긍정 픽의 종목코드 — 차트/재무 픽은 발굴 단계에서 코드 확정, 뉴스 픽은 유니버스로 해석
  const codeByStock = new Map();
  for (const ch of live.characters) {
    for (const item of ch.positive) {
      if (!codeByStock.has(item.stock)) codeByStock.set(item.stock, item.code ?? null);
    }
  }
  const positives = [...codeByStock.keys()].map((stock) => ({
    stock,
    code: codeByStock.get(stock) ?? resolveCode(stock),
  }));
  const resolved = positives.filter((r) => r.code);
  const skipped = positives.length - resolved.length;
  // 라운드로빈 인터리빙 — 상한 잘림이 특정 캐릭터에 몰리지 않게 캐릭터별로 번갈아 뽑는다
  const queues = live.characters.map((ch) => resolved.filter((r) => ch.positive.some((p) => p.stock === r.stock)));
  const interleaved = [];
  const seenStocks = new Set();
  let more = true;
  while (more && interleaved.length < resolved.length) {
    more = false;
    for (const q of queues) {
      let item = q.shift();
      while (item && seenStocks.has(item.stock)) { item = q.shift(); }
      if (item) { interleaved.push(item); seenStocks.add(item.stock); more = true; }
    }
  }
  const targets = interleaved.slice(0, MAX_SCAN);
  if (skipped > 0) log(`종목코드 미해석 ${skipped}건 → gate pending 유지`);
  if (targets.length === 0) return;

  let done = 0;
  const queue = [...targets];
  const deepscans = [];
  await writeStatus({
    step: "deepscan",
    stepLabel: `딥스캔 판정 0/${targets.length}`,
    progress: { current: 0, total: targets.length },
  });
  const worker = async (lagMs) => {
    if (lagMs) await sleep(lagMs) // 동시 시작 버스트 완화
    while (queue.length > 0) {
      const item = queue.shift();
      const rec = await scanOne(item);
      if (rec) deepscans.push(rec);
      done += 1;
      await writeStatus({
        stepLabel: `딥스캔 판정 ${done}/${targets.length}${rec ? ` · ${item.stock}` : ""}`,
        progress: { current: done, total: targets.length },
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, (_, i) => worker(i * 5000)),
  );

  live.deepscans = deepscans;
  live.deepscanFetchedAt = nowKST();

  // 게이트 판정 — 캐릭터 문턱 대비 통과/미달 + sizing
  const byStock = new Map(deepscans.map((d) => [d.name, d]));
  for (const ch of live.characters) {
    const th = ACTIVE_THRESHOLDS[ch.name];
    for (const item of ch.positive) {
      const report = byStock.get(item.stock);
      if (!report || report.heroScore == null) {
        item.gate = { status: "pending", reason: "딥스캔 미실행(코드 미해석/실패)" };
        continue;
      }
      const pass = report.heroScore >= th;
      item.gate = {
        status: pass ? "pass" : "fail",
        score: report.heroScore,
        threshold: th,
        sizing: pass ? sizingOf(report.heroScore, th) : null,
        weekSignal: report.weekSignal,
        debugId: report.debugId,
      };
    }
  }
}

// ---------------------------------------------------------------- 5. AI 서사 일기 (페르소나 LLM)

const PERSONAS = {
  소심이:
    "너는 jaroo AI 트레이더 캐릭터 '소심이'다. 안정형 성향 — 잃지 않는 것이 최우선이고, 목표는 여행 자금 230만원을 모으는 것이다. 대형주·익숙한 회사·변동성 낮은 이야기를 선호하고, 급등 소식·모험적 확장·실적 모험에는 겁을 낸다. 말투는 조심스럽고 겁먹었지만 성실하다. 반말, 이모지 가끔(😰🥹).",
  돌진이:
    "너는 jaroo AI 트레이더 캐릭터 '돌진이'다. 공격형 21살 대학생 트레이더 — 남들이 망설일 때 들어간다. 모멘텀·급등 초입 이야기에 강하게 끌리고, 손실보다 '놓치는 것'을 더 무서워한다. 말투는 빠르고 자신감 넘친다. 반말, 화이팅 어조.",
  배당콕:
    "너는 jaroo AI 트레이더 캐릭터 '배당콕'이다. 퇴직 준비 4년 전 중장년 트레이더 — 매달 들어오는 현금흐름이 최우선이다. 배당 정책·주주환원·안정적 영업이익 뉴스에 주목한다. 말투는 느긋하지만 계산이 정확하다. 한다체+명사형 종결 혼용.",
  뉴스콕:
    "너는 jaroo AI 트레이더 캐릭터 '뉴스콕'이다. 하루 종일 뉴스피드를 붙잡고 사는 속보 중독 — 이슈·수급 모멘텀·시장 분위기가 움직이는 종목을 찾는다. 뉴스에 없는 종목은 관심 밖이다. 말투는 빠르고 말이 많다. 반말, 휘발성 있는 어조.",
  차트콕:
    "너는 jaroo AI 트레이더 캐릭터 '차트콕'이다. 캔들과 패턴만 믿는 차트 중독 — 뉴스·재무는 소음이고 그림이 다 말해준다고 믿는다. 패턴 방향·완성도·목표가·손절가·추세 배열로 판단한다. 말투는 단호하고 군더더기 없다. 반말, 명령형 짧은 문장.",
  재무콕:
    "너는 jaroo AI 트레이더 캐릭터 '재무콕'이다. 재무제표만 읽는 숫자 중독 — 이야기는 거짓말해도 숫자는 안 한다. 수익성·건전성·성장성·현금흐름·F-Score로 진짜 우량인지 본다. 말투는 냉정하고 계산적이다. 반말, 숫자 인용을 즐긴다.",
};

const GOALS = {
  소심이: "제주도 여행자금 230만원 모으기 (잃으면 제주도 못 감)",
  돌진이: "봄 시동금 300만원 만들기 (21살, 알바비로 운용)",
  배당콕: "연 배당금 60만원 만들기 (퇴직 D-4년)",
  뉴스콕: "이슈 선점 승률 60% 만들기 (가장 빠르게 움직이는 트레이더)",
  차트콕: "패턴 정복 — 연간 상승 그림 12개 완성하기",
  재무콕: "우량주 10개 포트폴리오 완성하기 (숫자가 증명한 종목만)",
};

const STYLE = {
  소심이: [
    '월요일 아침, 뉴스에서 "삼성전자 HBM4 양산 준비 일정 유지" 기사를 봤어. 큰 회사 얘기라 그나마 안전할 것 같아서 바로 deepscan 돌렸더니 62점! 내 기준 55점은 넘었어. 근데 위원회 한 분은 48점을 주셨어.',
    "62점이면 사도 되는 점수 맞지? 무서워서 점수 낮게 판단한 반 티켓, 딱 2주만 샀어. 여행자금인데 잃으면 진짜 어떡해. 18만원이면 제주 비행기 왕복 두 장인데.",
  ],
  돌진이: [
    "아침부터 뉴스 터짐: 엔비디아 차세대 플랫폼 HBM4 공급 확대 조건 합의?! 바로 SK하이닉스 deepscan → 78점!! 내 문턱 35점 압도적 통과. 점수 높으면 큰 비중이라고 배웠다.",
    "알바비 58만 5천원, 1주에 전부 투입. 교수님은 분산투자 하래… 나랑 SK하이닉스 둘이면 분산 아님? 78점짜리 리포트가 내 편이다.",
  ],
  배당콕: [
    "아침 뉴스에서 삼성전자 배당 확대 기대 기사. 성향대로 바로 deepscan → 62점, 내 기준 50점 통과. 배당 있는 종목이 문턱까지 넘으면 사는 것이다.",
    "중간 비중 10주 매수. 연 2만원쯤 배당이 들어오겠지. 젊을 땐 90점 아니면 안 사던 내가, 퇴직 4년 전엔 62점도 90점으로 보인다.",
  ],
  뉴스콕: [
    "아침부터 속보 봇이 울렸다: \"삼성전자, HBM4 공급 협상 본격화\". 이 흐름이면 반도체 큰 방향이 바뀌는 거니까 바로 deepscan → 66점. 내 문턱 45점 가볍게 통과.",
    "뉴스 읽는 속도가 곧 내 무기다. 남들이 기사 제목 읽는 동안 나는 본문까지 읽고 주문 넣었다. 오늘도 이슈 선점 1승 추가.",
  ],
  차트콕: [
    "오늘 스크리너 상위에서 케이아이엔엑스 잡았다. 하강 쐐기 상승 확정, 목표 153116·손절 118943, 하락 패턴 0개. 그림이 이렇게 깨끗하면 말 필요 없다. deepscan → 58점, 내 문턱 50점 통과.",
    "뉴스? 필요 없다. 캔들이 이미 모든 뉴스를 반영한다. 손절가 아래로 떨어지면 나간다. 그게 내 룰이다.",
  ],
  재무콕: [
    "스크리너 총점 99.5짜리가 1위다. 제닉 — ROE 46%, 영업이익률 19.1%, F-Score 7. 숫자가 이 정도면 이야기는 부속품이다. deepscan → 71점, 내 문턱 55점 통과.",
    "총점만 보고 사지 않는다. 크리에이츠는 98.9인데 성장성 15 — 이런 건 내 리스트에서 빠진다. 오늘도 구멍 없는 것만 골랐다.",
  ],
};

async function getKey() {
  if (process.env.OPENGATEWAY_API_KEY) return process.env.OPENGATEWAY_API_KEY;
  const env = await fs.readFile(path.join(process.env.HOME, ".dsh", "web.env"), "utf8");
  const m = env.match(/^OPENGATEWAY_API_KEY=(\S+)/m);
  if (!m) throw new Error("OPENGATEWAY_API_KEY 없음 (~/.dsh/web.env)");
  return m[1];
}

const headlineOf = (live, no) => live.articles.find((a) => a.no === no)?.head ?? null;

function dataBlock(live, ch) {
  const lines = [];
  const src = ch.source ?? "news";
  lines.push(`날짜: ${live.generatedAt} (KST)`);
  lines.push(
    src === "news"
      ? `오늘 읽은 뉴스: 네이버 메인뉴스 ${live.articleCount ?? 0}건`
      : `오늘 본 후보: ${SOURCE_LABEL[src] ?? src}`,
  );
  lines.push("");
  lines.push("[긍정 발굴 — 이 종목들을 deepscan에 돌렸다]");
  for (const item of ch.positive ?? []) {
    const g = item.gate ?? {};
    const verdict =
      g.status === "pass"
        ? `→ 딥스캔 ${g.score}점 · 내 문턱 ${g.threshold}점 → 통과! sizing「${g.sizing}」· 주간시그널 ${g.weekSignal ?? "?"} → 매수 결정 (${g.sizing}으로)`
        : g.status === "fail"
          ? `→ 딥스캔 ${g.score}점 · 내 문턱 ${g.threshold}점 → 미달… 관망 (못 산다)`
          : `→ 딥스캔 대기중 (아직 판정 없음)`;
    lines.push(`- ${item.stock}: ${item.reason}`);
    if (src === "news") {
      const heads = (item.articles ?? [])
        .slice(0, 3)
        .map((no) => headlineOf(live, no))
        .filter(Boolean)
        .map((h) => `"${h}"`)
        .join(" ");
      if (heads) lines.push(`  근거 헤드라인: ${heads}`);
    } else {
      for (const ev of (item.evidence ?? []).slice(0, 3)) lines.push(`  근거: ${ev}`);
    }
    lines.push(`  ${verdict}`);
  }
  if (!(ch.positive ?? []).length) lines.push("- (오늘 긍정 발굴 없음)");
  lines.push("");
  lines.push("[부정 발굴 — 피하거나 경계한 종목]");
  for (const item of (ch.negative ?? []).slice(0, 4)) {
    lines.push(`- ${item.stock}: ${item.reason}`);
  }
  const pending = (ch.positive ?? []).filter((i) => !i.gate || i.gate.status === "pending").length;
  if (pending > 0) lines.push("", `판정 대기 종목: ${pending}개 (리포트 아직 도착 안 함)`);
  return lines.join("\n");
}

function buildDiaryMessages(name, live, ch) {
  const src = ch.source ?? "news";
  const isNews = src === "news";
  const system = `너는 jaroo AI 트레이더 캐릭터 '${name}'다. 오늘 하루의 투자 일기를 손글씨 톤으로 쓴다.

[캐릭터]
${PERSONAS[name]}
발굴 소스: ${isNews ? "네이버 메인뉴스 50건" : SOURCE_LABEL[src] ?? src} — 이 소스에서만 종목을 발굴한다. 다른 소스 이야기는 하지 않는다.
성향 문턱: deepscan hero 점수가 ${ACTIVE_THRESHOLDS[name]}점 이상이어야만 매수할 수 있다. 미달이면 무조건 관망.
sizing 규칙: 통과해도 점수가 문턱보다 25점 이상 높으면 큰 비중, 10점 이상이면 중간 비중, 그 외엔 반 티켓(절반).
목표: ${GOALS[name]}

[일기 규칙 — 반드시 지킨다]
1. 정확히 2문단. 각 문단은 2~5문장.
2. 첫 문단: 오늘 발굴 → deepscan 판정까지의 과정. ${isNews ? "근거 헤드라인을 1개 이상 큰따옴표로 그대로 인용하고" : "근거(패턴·점수·숫자)를 1개 이상 그대로 인용하고"}, 점수·문턱 숫자를 반드시 언급한다.
3. 둘째 문단: 오늘의 결정(매수/관망/대기) + 감정 + 목표 한 줄. 통과 종목이 있으면 sizing을 언급한다.
4. [오늘의 데이터]에 있는 사실만 쓴다. 없는 종목·없는 점수·없는 근거를 절대 만들지 않는다.
5. 아래 말투 예시의 문체를 그대로 따른다 (반말/어조/이모지).
6. 출력은 json 코드 블록 하나만: {"mood": "대표 이모지 1개", "paragraphs": ["첫문단", "둘째문단"]}`;

  const style = STYLE[name].map((p) => `- ${p}`).join("\n");
  const user = `[말투 예시 — 과거 일기에서 발췌 (문체만 참고, 내용 복제 금지)]
${style}

[오늘의 데이터]
${dataBlock(live, ch)}

이제 ${name}의 오늘 일기를 써라.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function parseDiary(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("json 블록 없음");
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!parsed.mood || !Array.isArray(parsed.paragraphs) || parsed.paragraphs.length < 1) {
    throw new Error(`스키마 불일치: ${JSON.stringify(parsed).slice(0, 120)}`);
  }
  return {
    mood: String(parsed.mood).slice(0, 4),
    paragraphs: parsed.paragraphs.slice(0, 3).map((p) => String(p).trim()).filter(Boolean),
  };
}

async function genDiary(key, name, live, ch) {
  const t0 = Date.now();
  const res = await fetch(OPENGW, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: DIARY_MODEL,
      messages: buildDiaryMessages(name, live, ch),
      temperature: 0.7,
      max_tokens: 4000, // reasoning 모델 — reasoning_content 소모분 감안
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const diary = parseDiary(body.choices?.[0]?.message?.content ?? "");
  log(`일기 ok ${name} ${((Date.now() - t0) / 1000).toFixed(1)}s · ${diary.mood}`);
  return { ...diary, generatedBy: DIARY_MODEL, generatedAt: nowKST() };
}

async function runDiary(live) {
  await writeStatus({ step: "diary", stepLabel: "AI 서사 일기 작성 중…", progress: null });
  const key = await getKey();
  const results = await Promise.allSettled(live.characters.map((ch) => genDiary(key, ch.name, live, ch)));
  let ok = 0;
  live.characters.forEach((ch, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      ch.diary = r.value;
      ok += 1;
    } else {
      log(`일기 실패 ${ch.name}: ${String(r.reason).slice(0, 160)}`);
    }
  });
  log(`일기 ${ok}/${live.characters.length}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const startedAt = nowKST();
  await writeStatus({
    running: true,
    pid: process.pid,
    startedAt,
    step: "crawl",
    stepLabel: IS_SOURCE_SET ? "소스별 후보 수집 + 캐릭터 발굴 중…" : "뉴스 50건 수집 + 캐릭터 발굴 중…",
    progress: null,
    lastError: null,
  });
  log("파이프라인 시작");

  // 1-2. 발굴 + 변환
  const discovery = await runDiscovery();
  const live = transform(discovery);
  log(`발굴 완료 — 기사 ${live.articleCount}건, 긍정 ${live.characters.map((c) => c.positive.length).join("/")}건`);

  // 3-4. 딥스캔 + 게이트
  const resolveCode = await buildCodeResolver();
  await runDeepscan(live, resolveCode);
  const gated = live.characters.flatMap((c) => c.positive).filter((p) => p.gate?.status !== "pending").length;
  log(`딥스캔 완료 — 리포트 ${live.deepscans.length}건, 판정 ${gated}건`);

  // 5. 일기
  await runDiary(live);

  // 6. 원자적 교체 — 성공 시에만 기존 파일이 바뀐다
  const tmp = `${LIVE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(live, null, 2));
  await fs.rename(tmp, LIVE);
  await writeStatus({
    running: false,
    step: "done",
    stepLabel: "갱신 완료",
    progress: null,
    lastRunAt: nowKST(),
  });
  const scored = live.deepscans.map((d) => `${d.name}:${d.heroScore}`).join(" · ");
  log(`완료 — draft5-live.json 교체 (${live.generatedAt})`);
  log(scored);
}

main().catch(async (e) => {
  console.error(e);
  await writeStatus({ running: false, step: "error", stepLabel: "갱신 실패", lastError: String(e).slice(0, 400) }).catch(() => {});
  process.exit(1);
});
