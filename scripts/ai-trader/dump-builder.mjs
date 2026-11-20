#!/usr/bin/env node
/**
 * AI 트레이더 v2 — 컨텍스트 덤프 빌더 (2.5a, 시안 v2 §4 구현)
 *
 * ② 흥미 선정 턴과 ⑤ 매매 결정 턴이 같은 [소스 블록 + 보유종목 섹션] prefix를
 * 바이트 단위로 공유해야 DeepSeek prefix 캐시가 hit한다. 그래서 이 모듈의 직렬화는:
 *   - 순수 함수: 시간·랜덤·로케일 의존 없음(asOf는 호출자가 명시적으로 넘긴다)
 *   - 같은 입력 → 항상 같은 바이트 → sha256 해시로 검증(골든 테스트)
 *
 * 포맷은 discovery.mjs(#369)의 소스 블록을 그대로 승계한다. 신규는 보유종목 섹션뿐.
 *
 * 사용:
 *   node scripts/ai-trader/dump-builder.mjs --source chart \
 *     [--holdings holdings.json] [--as-of 2026-11-19] [--out output/dump-...]
 *   node scripts/ai-trader/dump-builder.mjs --self-test  (고정 픽스처로 해시 안정성 확인)
 *
 * holdings.json 형태(장부 스냅샷 — paper-trade GET 에서 뽑는 값):
 *   [{ code, name, market, quantity, avgPriceKrw, currentPriceKrw, openedAt,
 *      thesis: { entryReasons: [...], source }, }]
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DUMP_SCHEMA_VER = 1;

// ---------------------------------------------------------------- 숫자·날짜 (결정적 포맷)

const won = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (from, to) => {
  const v = ((to - from) / from) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
};
const dayIndex = (isoDate) => Math.floor(Date.parse(`${String(isoDate).slice(0, 10)}T00:00:00Z`) / 86400000);
const daysBetween = (fromIso, toIso) => dayIndex(toIso) - dayIndex(fromIso);
export const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

// ---------------------------------------------------------------- 소스 블록 직렬화 (discovery.mjs 포맷 승계)

/** 뉴스 — `[n]\n본문` 연결 */
export function serializeNewsBlock(articles) {
  return articles.map((a, i) => `[${i + 1}]\n${a.text}`).join("\n\n");
}

/** 차트 — 3행 카드 (discovery.mjs fetchChart 포맷) */
export function serializeChartBlock(rows) {
  return rows
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
}

/** 재무 — 총점·등급·F-Score·카테고리 (discovery.mjs blockFinance 포맷) */
export function serializeFinanceBlock(items) {
  return items
    .map((it) => {
      const cats = it.cats ? Object.entries(it.cats).map(([k, v]) => `${k} ${v}`).join(" · ") : "";
      return `[${it.no ?? "?"}] ${it.name}(${it.code}·${it.market}) 총점 ${it.score} · ${it.grade} · F-Score ${it.fscore ?? "?"} · 결산 ${it.basis}${cats ? `\n  ${cats}` : ""}`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------- 보유종목 섹션 (시안 §4.2 — 신규)

/**
 * holdings: [{ code, name, market, quantity, avgPriceKrw, currentPriceKrw, openedAt,
 *              thesis: { entryReasons: string[] },
 *              evidence: { chart, finance, news } | undefined }]
 * evidence가 없으면 해당 줄은 "수집 안 됨"으로 나간다(빈 문자열보다 덤프가 자명하다).
 */
export function serializeHoldingsSection(holdings, asOf) {
  const head = "## 보유 종목 — 매도/홀드 심사 대상";
  if (!holdings || holdings.length === 0) return `${head}\n(없음 — 오늘은 신규 진입만 고려한다)`;
  const cards = [...holdings]
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
    .map((h) => {
      const days = daysBetween(h.openedAt, asOf);
      const reasons = h.thesis?.entryReasons?.length ? h.thesis.entryReasons.join(" + ") : "기록 없음";
      const ev = h.evidence ?? {};
      const line = (label, v) => (v == null || v === "" ? `${label} 수집 안 됨` : `${label} ${v}`);
      return [
        `### ${h.name} (${h.code}) · 보유 ${h.quantity}주 · 진입 ${days}일째 · 평단 ${won(h.avgPriceKrw)} · 현재 ${won(h.currentPriceKrw)} (${pct(h.avgPriceKrw, h.currentPriceKrw)}%)`,
        `- 진입 근거(${days}일 전): ${reasons}`,
        `- 오늘 소스 증거: ${line("[차트]", ev.chart)} · ${line("[재무]", ev.finance)} · ${line("[뉴스]", ev.news)}`,
      ].join("\n");
    });
  return [head, ...cards].join("\n\n");
}

// ---------------------------------------------------------------- 덤프 조립

const SOURCE_BLOCK = {
  news: (d) => serializeNewsBlock(d.articles ?? []),
  chart: (d) => serializeChartBlock(d.chartRows ?? []),
  finance: (d) => serializeFinanceBlock(d.financeItems ?? []),
};

/**
 * buildDump({ source, sourceData, holdings, asOf }) → { text, hash, meta }
 * text가 ②·⑤ 프롬프트의 반고정층 그 자체다. meta는 프롬프트에 못 박지 않는다(캐시 보존).
 */
export function buildDump({ source, sourceData = {}, holdings = [], asOf }) {
  if (!SOURCE_BLOCK[source]) throw new Error(`알 수 없는 소스: ${source}`);
  if (!asOf) throw new Error("asOf(YYYY-MM-DD) 필수 — 직렬화 결정성 요건");
  const block = SOURCE_BLOCK[source](sourceData);
  const holdingsText = serializeHoldingsSection(holdings, asOf);
  const text = `${block}\n\n${holdingsText}`;
  return {
    text,
    hash: sha256(text),
    meta: {
      schemaVer: DUMP_SCHEMA_VER,
      source,
      asOf,
      hash: sha256(text),
      bytes: Buffer.byteLength(text, "utf8"),
      sourceCount:
        source === "news" ? (sourceData.articles ?? []).length
        : source === "chart" ? (sourceData.chartRows ?? []).length
        : (sourceData.financeItems ?? []).length,
      holdingsCount: holdings.length,
    },
  };
}

// ---------------------------------------------------------------- 소스 증거 수집 (보유종목용 — 실측 어댑터)

/**
 * 이미 수집한 소스 데이터에서 보유 종목의 오늘 증거를 뽑는다(추가 API 호출 없음).
 * chartRows: fetchChart 결과 rows(상승+하락, side/rank 포함)와 같은 모양.
 */
export function collectEvidence(holding, { articles = [], chartRows = [], financeItems = [] }) {
  const byName = articles
    .map((a, i) => (String(a.text || "").includes(holding.name) ? i + 1 : 0))
    .filter((n) => n > 0);
  const chartRow = chartRows.find((r) => String(r.symbol) === String(holding.code));
  const finItem = financeItems.find((it) => String(it.code) === String(holding.code));
  return {
    chart: chartRow
      ? `${chartRow.side} 후보 ${chartRow.rank}위 · 스코어 ${chartRow.top_score} · ${chartRow.top?.kind ?? "?"}`
      : "상위권 이탈",
    finance: finItem ? `total ${finItem.score} (${finItem.no}위) · ${finItem.grade}` : "권외",
    news: byName.length > 0 ? `언급 ${byName.length}건(${byName.slice(0, 5).join(", ")})` : "언급 없음",
  };
}

export function withEvidence(holdings, sourceData) {
  const articles = sourceData.articles ?? [];
  const chartRows = sourceData.chartRows ?? [];
  const financeItems = sourceData.financeItems ?? [];
  return holdings.map((h) => ({ ...h, evidence: collectEvidence(h, { articles, chartRows, financeItems }) }));
}

// ---------------------------------------------------------------- CLI

async function main() {
  const args = process.argv.slice(2);
  const argOf = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };

  if (args.includes("--self-test")) {
    const asOf = "2026-11-19";
    const mk = () => buildDump({
      source: "chart",
      sourceData: { chartRows: [
        { name: "케이아이엔엑스", symbol: "093320", market: "KOSDAQ", side: "상승", top_score: 78.4, bias: "상승 우위", top: { kind: "하강 쐐기", direction: "bullish", status: "확정", target: 153116, stop: 118943 }, trend_label: "상승", above_ma20: true, change_pct: 2.1, bullish_count: 4, patterns: 6, bearish_count: 1, rank: 3 },
      ] },
      holdings: [{ code: "093320", name: "케이아이엔엑스", market: "KOSDAQ", quantity: 10, avgPriceKrw: 118943, currentPriceKrw: 114000, openedAt: "2026-11-05", thesis: { entryReasons: ["하강 쐐기 확정"] }, evidence: { chart: "상승 후보 3위 · 스코어 78.4 · 하강 쐐기", finance: "total 71 (88위) · B+", news: "언급 없음" } }],
      asOf,
    });
    const a = mk();
    const b = mk();
    if (a.hash !== b.hash) { console.error("해시 불안정!"); process.exit(1); }
    console.log(`OK hash=${a.hash.slice(0, 16)}… bytes=${a.meta.bytes}`);
    return;
  }

  const source = argOf("source");
  if (!source) { console.error("--source news|chart|finance 필수 (또는 --self-test)"); process.exit(1); }
  const asOf = argOf("as-of", new Date().toISOString().slice(0, 10));
  const holdingsPath = argOf("holdings");
  const holdings = holdingsPath ? JSON.parse(await fs.readFile(holdingsPath, "utf8")) : [];

  // 소스 데이터: discovery.mjs가 output/ 에 남긴 스냅샷을 재사용(있으면) — 없으면 빈 블록으로 골격만
  const snapPath = argOf("source-snapshot");
  const sourceData = snapPath ? JSON.parse(await fs.readFile(snapPath, "utf8")) : {};

  const dump = buildDump({ source, sourceData, holdings, asOf });
  const out = argOf("out");
  if (out) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, dump.text);
    await fs.writeFile(`${out}.meta.json`, `${JSON.stringify(dump.meta, null, 2)}\n`);
    console.error(`썼음: ${out} (${dump.meta.bytes}B hash=${dump.hash.slice(0, 12)})`);
  } else {
    process.stdout.write(dump.text);
    process.stderr.write(`\n[meta] ${JSON.stringify(dump.meta)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
