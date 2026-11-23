#!/usr/bin/env node
/**
 * 2.5b 턴 데모 — 차트콕 1턴을 실 LLM 호출로 끝까지 돌린다(픽스처 장부·조언, 실딥스캔 없음).
 *
 * 증명 목표(완료 기준):
 *   1. ②흥미 턴이 3상태(신규/재확인/소멸)를 내고, 보유 종목 판정 누락 0건
 *   2. ⑤결정 턴이 decisions json을 내고, 검증 통과
 *   3. ⑤ 호출의 cached_tokens > 0 — ②와 같은 [system+덤프] prefix 재사용 실증
 *
 * 사용: node scripts/ai-trader/run-turn-demo.mjs [--persona 차트콕]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDump, withEvidence, sha256 } from "./dump-builder.mjs";
import { getKey } from "./llm.mjs";
import { runInterestTurn, validateInterest, buildDecisionTail, runDecisionTurn, validateDecision } from "./turns.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(await fs.readFile(path.join(__dirname, "test", "fixtures", "turn-fixtures.json"), "utf8"));

const personaKey = process.argv.includes("--persona")
  ? process.argv[process.argv.indexOf("--persona") + 1]
  : "차트콕";
const asOf = FIX.asOf;

// ① 덤프 — ②⑤가 공유할 반고정층 (여기서 한 번만 만든다)
const holdings = withEvidence(FIX.holdings, FIX.sourceData);
const dump = buildDump({ source: "chart", sourceData: FIX.sourceData, holdings, asOf });
console.error(`[dump] hash=${dump.hash.slice(0, 12)} bytes=${dump.meta.bytes} 보유=${holdings.length}`);

// ④ 조언 픽스처 — 실 딥스캔 대신 시안 §4.3 모양의 목업(스캔 집합 = 흥미∪보유 전부로 가정)
const advices = [
  { code: "093320", name: "케이아이엔엑스", heroScore: 62, teams: {
      market: "20일선 위에서 거래량 수반 반등, 단기 추세 전환 신호.",
      context: "업황 뉴스 흐름 중립, 심리 개선 국면.",
      fundamental: "최근 분기 영업이익 기대치 상회, 마진 안정." } },
  { code: "002690", name: "계룡건설", heroScore: 38, teams: {
      market: "하락 우위 — 삼각 수렴 하단 이탈 경계.",
      context: "건설업 종목 심리 약세 지속.",
      fundamental: "성장성 9.2로 총점 대비 편중, F-Score 5." } },
  { code: "005930", name: "삼성전자", heroScore: 55, teams: {
      market: "횡보 범위 상단, 방향 대기.",
      context: "HBM 뉴스 재점화 시 반등 여지.",
      fundamental: "대형 안정 — 이슈 없음." } },
  { code: "005935", name: "제주반도체", heroScore: 30, teams: {
      market: "하락 추세 지속.",
      context: "관심 급감.",
      fundamental: "최근 결산 부진." } },
];
const scanCodes = [...new Set([...holdings.map((h) => h.code), ...["093320", "002690", "005930", "005935"]])];

const account = { cashKrw: 3_000_000, valuationPct: -1.8, lossStreak: 1 };
const memory = { lines: [
  "(11-05) 케이아이엔엑스 쐐기 진입 — 그림 깨끗, stop만 지키면 이긴다",
  "(11-12) 제주반도체 컨센서스 미달 — 생각보다 아팠다. 다음엔 재무 재확인 먼저",
] };

// ② 흥미 선정 턴
const key = await getKey();
const interest = await runInterestTurn({ key, personaKey, dumpText: dump.text, source: "chart" });
const iv = validateInterest(interest, FIX.holdings);
console.error(`[②] ok=${iv.ok}${iv.problems.length ? " problems=" + JSON.stringify(iv.problems) : ""} 신규=${interest.parsed?.["신규"]?.length ?? "?"} 재확인=${interest.parsed?.["재확인"]?.length ?? "?"} 소멸=${interest.parsed?.["소멸"]?.length ?? "?"}`);

// ⑤ 매매 결정 턴 — system+덤프 선두가 ②와 바이트 동일인지 출발선에서 확인
const tail = buildDecisionTail({ interest, advices, account, memory, scanCodes, holdings: FIX.holdings });
const prefixCheck = sha256(`${dump.text}`) === dump.hash;
const decision = await runDecisionTurn({ key, personaKey, dumpText: dump.text, tail });
const dv = validateDecision(decision, scanCodes, FIX.holdings);
console.error(`[⑤] ok=${dv.ok}${dv.problems.length ? " problems=" + JSON.stringify(dv.problems) : ""} decisions=${decision.parsed?.decisions?.length ?? "?"}`);

// 결과 저장 + 캐시 실증 요약
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const outPath = path.join(__dirname, "output", `turn-demo-${stamp}.json`);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify({
  asOf, personaKey, dumpHash: dump.hash, prefixCheck,
  interest: { parsed: interest.parsed, validate: iv.problems, cache: interest.cacheLine },
  decision: { parsed: decision.parsed, validate: dv.problems, cache: decision.cacheLine },
}, null, 2));
console.error(`[out] ${outPath}`);
console.error(`\n=== 캐시 실증 ===\n② ${interest.cacheLine}\n⑤ ${decision.cacheLine}\n→ ⑤ cached>0 여부: ${(decision.usage.prompt_tokens_details?.cached_tokens ?? decision.usage.prompt_cache_hit_tokens ?? 0) > 0 ? "HIT ✅" : "MISS ❌"}`);
if (!iv.ok || !dv.ok) process.exit(2);
