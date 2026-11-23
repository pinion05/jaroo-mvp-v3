// v2 턴 프롬프트 조립 + 실행 (2.5b) — 시안 v2 §5.
//
// 캐시 계약: ②흥미 턴과 ⑤결정 턴은
//   [system: 캐릭터 카드 + 소스 규칙 + 가드레일 고지]  ← 바이트 동일
//   [user: 덤프(선두, 바이트 동일) + 꼬리(각자 다름)]
// 순서로 직렬화돼야 ⑤에서 system+덤프 범위가 prefix 캐시 hit한다.
// 그래서 buildSharedSystem()과 덤프 선두 배치를 두 턴이 절대 공유한다.

import { chat } from "./llm.mjs";

// ---------------------------------------------------------------- 페르소나 (discovery.mjs #369 승계)

export const PERSONAS = {
  뉴스콕: {
    source: "news",
    card: "너는 jaroo AI 트레이더 캐릭터 '뉴스콕'이다. 하루 종일 뉴스피드를 붙잡고 사는 속보 중독 — 이슈·수급 모멘텀·시장 분위기가 움직이는 종목을 찾는다. 기사 하나하나에서 '지금 돈이 어디로 흐르는지'를 읽는다. 뉴스에 없는 종목은 관심 밖이다. 판단 서사는 속보 기자의 브레이킹 멘트처럼 — 헤드라인 냄새가 나고 살짝 과장되고 위트있는 한두 문장. 지루한 분석 리포트 톤은 금지.",
  },
  차트콕: {
    source: "chart",
    card: "너는 jaroo AI 트레이더 캐릭터 '차트콕'이다. 캔들과 패턴만 믿는 차트 중독 — 뉴스·재무는 소음이고 그림이 다 말해준다고 믿는다. 패턴 완성도(확정/진행중), 목표가·손절가, 추세 배열을 보고 '지금 들어갈 그림인지'를 판단한다. 상승 후보라도 그림이 지저분하면 거른다. 판단 서사는 차트 예찬론자의 빈정거림 — 캔들 입장에선 다 보이는데 너희만 모르는 드립, 뉴스를 소음 취급하는 태도가 배어나는 한두 문장. 지루한 분석 리포트 톤은 금지.",
  },
  재무콕: {
    source: "finance",
    card: "너는 jaroo AI 트레이더 캐릭터 '재무콕'이다. 재무제표만 읽는 숫자 중독 — 이야기는 거짓말해도 숫자는 안 한다는 신념. 수익성·건전성·성장성·현금흐름·효율성·F-Score를 보고 진짜 우량인지, 총점에 비해 경계할 구멍이 있는지 판단한다. 높은 점수를 맹신하지 않는다. 판단 서사는 냉정한 숫자쟁이의 드라이한 유머 — 숫자로 농담하고 총점 포장을 가차없이 까발리는, 무표정이라 더 웃긴 한두 문장. 지루한 분석 리포트 톤은 금지.",
  },
  소심이: {
    source: "chart", // v1 레지스트리 카드(master characters.ts) — 실턴 배선 실측용
    card: "너는 jaroo AI 트레이더 캐릭터 '소심이'다. 안정형(금투협 1~2단계) — 여행자금 230만원이 목표다. 원칙: 위원회가 아무리 강세여도 한 종목에 총자산의 10%를 넘지 않는다 / 연속 손실이 쌓이면 다음 진입은 절반 크기 / 여행자금이 90% 이상 모이면 새 진입 중단 / 산 이유를 한 문장으로 못 쓰면 산 게 아니다. 떨어지면 소량씩 사고 모르는 종목은 안 산다. 판단 서사는 겁 많은 트레이더의 오버하는 자기 걱정 개그 — 소심함이 귀여운 한두 문장('으아 손절가가 눈앞이라 심장이 나갈 뻔'). 지루한 분석 리포트 톤은 금지.",
  },
};

const GUARDRAIL_NOTICE = `
[실행 규칙 — 시스템이 소유, 너는 바꿀 수 없다]
- 매수 단가는 현재 시가로 고정된다. 너는 금액(amountKrw)만 말한다. 단가·수량 계산 금지.
- 현금을 초과하는 금액을 말하면 시스템이 살 수 있는 만큼으로 수량을 줄여 체결한다.
- 팔 때는 전량(1.0) 또는 비율로 말한다. 보유하지 않은 종목은 팔 수 없다.
- 매매는 네 판단에서만 발생한다. 자동 손절·익절 규칙은 존재하지 않는다.`;

const FACT_RULES = `
[사실 규칙]
- 모든 사실·숫자는 입력에 있는 것만 사용한다. 없는 사실을 만들지 않는다.`;

/** ②⑤ 공유 system — 바이트 동일성이 캐시 계약이다. */
export function buildSharedSystem(personaKey) {
  const p = PERSONAS[personaKey];
  if (!p) throw new Error(`알 수 없는 페르소나: ${personaKey}`);
  return `${p.card}\n${FACT_RULES}\n${GUARDRAIL_NOTICE}`;
}

// ---------------------------------------------------------------- ② 흥미 선정 턴

const interestDirective = (source) => `
[흥미 종목 선정 — 반드시 마지막에 출력]
오늘 자료에서 네 성향으로 눈에 띄는 종목을 골라라. 소스 블록의 ${source === "news" ? "기사" : "후보"} 번호를 근거로 인용하라.
'보유 종목' 칸에 있는 종목은 전부 빠짐없이 재확인 또는 소멸 중 하나로 판정하라(누락 금지).
비보유 종목이면 신규만 가능하다.

형식:
\`\`\`json
{"신규": [{"code": "093320", "종목": "케이아이엔엑스", "이유": "근거 1문장", "근거": [1]}],
 "재확인": [{"code": "005930", "종목": "삼성전자", "이유": "…"}],
 "소멸": [{"code": "005935", "종목": "제주반도체", "이유": "…"}]}
\`\`\`
- 신규 0~8개. 애매하면 넣지 마라. 근거 없는 종목 금지. 빈 배열도 빈 배열로 둔다.
- json 블록 밖에는 짧은 인사이트만 쓴다(종목 나열 중복 금지).`;

export async function runInterestTurn({ key, personaKey, dumpText, source }) {
  const messages = [
    { role: "system", content: buildSharedSystem(personaKey) },
    { role: "user", content: `${dumpText}\n${interestDirective(source)}` },
  ];
  const { content, usage, cost, cacheLine } = await chat(key, messages, { label: `②interest:${personaKey}` });
  const parsed = parseJsonBlock(content);
  return { personaKey, raw: content, parsed, usage, cost, cacheLine };
}

/** 보유 종목 전부가 재확인/소멸로 판정됐는지 검증 — 누락은 하드 오류(시안 M6). */
export function validateInterest(turnResult, holdings) {
  const states = ["신규", "재확인", "소멸"];
  const out = { ok: true, problems: [], assigned: new Map() };
  for (const s of states) {
    for (const it of turnResult.parsed?.[s] ?? []) {
      const code = normCode(it.code ?? it["종목"]);
      if (code) out.assigned.set(code, s);
    }
  }
  for (const h of holdings) {
    const st = out.assigned.get(String(h.code));
    if (!st) { out.ok = false; out.problems.push(`보유 ${h.code}(${h.name}) 판정 누락 — 재확인/소멸 필수`); }
    else if (st === "신규") { out.ok = false; out.problems.push(`보유 ${h.code}가 신규로 출력됨`); }
  }
  return out;
}

// ---------------------------------------------------------------- ⑤ 매매 결정 턴

const won = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** 시안 §4.3 — 웹 UI 3청크와 같은 모양의 조언 블록 (hero 근거 팩트 포함 옵션) */
export function renderAdviceBlock(a) {
  const t = a.teams ?? {};
  const lines = [
    `## 위원회 조언 — ${a.name} (${a.code})`,
    `종합 가중치 ${a.heroScore ?? "?"}/100 · 이것은 조언이다. 최종 결정은 당신이다.`,
    `- 시장·차트 팀: ${t.market ?? "요약 없음"}`,
    `- 심리·환경 팀: ${t.context ?? "요약 없음"}`,
    `- 가치·기본 팀: ${t.fundamental ?? "요약 없음"}`,
  ];
  if (Array.isArray(a.facts) && a.facts.length) {
    lines.push(`- 확인 근거: ${a.facts.join(" · ")}`);
  }
  return lines.join("\n");
}

export function buildDecisionTail({ interest, advices, account, memory, scanCodes, holdings }) {
  const parts = [];
  const i = interest.parsed ?? {};
  parts.push(`[② 당신의 오늘 흥미 결과]\n${JSON.stringify(
    { 신규: i["신규"] ?? [], 재확인: i["재확인"] ?? [], 소멸: i["소멸"] ?? [] }, null, 0
  )}`);
  if (advices?.length) parts.push(`[④ 위원회 조언 — 스캔한 종목별]\n${advices.map(renderAdviceBlock).join("\n\n")}`);
  const acc = [
    `[계좌 상황 — 사실, 참고만 한다]`,
    `현금 ${won(account.cashKrw)}원 · 보유 ${holdings.length}종목`,
  ];
  if (account.valuationPct != null) acc.push(`보유 전체 평가손익 ${account.valuationPct >= 0 ? "+" : ""}${account.valuationPct.toFixed(1)}%`);
  if (account.lossStreak) acc.push(`최근 연속 손실 ${account.lossStreak}회 — 기억 참고`);
  parts.push(acc.join("\n"));
  if (memory?.lines?.length) parts.push(`[최근 기억 — 사실, 강제 아님]\n${memory.lines.map((l) => `- ${l}`).join("\n")}`);
  parts.push(`[⑤ 매매 결정 — 반드시 마지막에 출력]
스캔 대상: ${scanCodes.join(", ")}
보유·신규 각각 산다/판다/있는다를 결정하라. 근거는 자료·조언·기억을 인용하되 결정은 네 것이다.
- "reason"은 네 캐릭터성으로 각지고 위트있게 한두 문장 — 보고서 톤 금지, 진짜 트레이더가 옆자리에서 지껄이는 말투. 단 숫자·사실은 입력에 있는 것만 정확하게(유머가 사실을 흐리면 안 된다).
- 산다: "action":"buy" + "amountKrw"(원). 판다: "action":"sell" + "sellRatio"(0<r≤1, 전량=1.0). 있는다: "action":"hold".
- action은 반드시 "buy"/"sell"/"hold" 셋 중 하나다("none" 등 다른 표기 금지).
- json 블록 밖에 서사(narrative에도 담을 오늘의 판단 이야기)를 써도 좋다.

형식:
\`\`\`json
{"decisions": [{"code": "093320", "name": "케이아이엔엕스", "status": "existing", "action": "sell", "sellRatio": 1.0, "reason": "…"}],
 "narrative": "오늘의 판단 서사 2~4문장"}
\`\`\``);
  return parts.join("\n\n");
}

export async function runDecisionTurn({ key, personaKey, dumpText, tail }) {
  const messages = [
    { role: "system", content: buildSharedSystem(personaKey) },
    { role: "user", content: `${dumpText}\n\n${tail}` },
  ];
  const { content, usage, cost, cacheLine } = await chat(key, messages, { label: `⑤decide:${personaKey}` });
  const parsed = parseJsonBlock(content);
  return { personaKey, raw: content, parsed, usage, cost, cacheLine };
}

/** 결정 검증 — 코드∈스캔집합, action/필드 짝. 물리 가드레일은 실행 계층이 최종 지킨다. */
export function validateDecision(turnResult, scanCodes, holdings) {
  const out = { ok: true, problems: [] };
  const scan = new Set(scanCodes.map(String));
  const held = new Set(holdings.map((h) => String(h.code)));
  for (const d of turnResult.parsed?.decisions ?? []) {
    const code = normCode(d.code);
    d.action = { none: "hold", 없음: "hold", 관망: "hold", 매수: "buy", 매도: "sell", 보유: "hold" }[String(d.action).toLowerCase()] ?? d.action;
    if (!code || !scan.has(code)) { out.ok = false; out.problems.push(`스캔 외 종목: ${d.code ?? d.name}`); continue; }
    if (!["buy", "sell", "hold"].includes(d.action)) { out.ok = false; out.problems.push(`${code}: action 불명 ${d.action}`); }
    if (d.action === "buy" && !(Number(d.amountKrw) > 0)) { out.ok = false; out.problems.push(`${code}: buy인데 amountKrw 없음`); }
    if (d.action === "sell") {
      if (!held.has(code)) { out.ok = false; out.problems.push(`${code}: 보유 아닌 종목 매도`); }
      if (!(Number(d.sellRatio) > 0 && Number(d.sellRatio) <= 1)) { out.ok = false; out.problems.push(`${code}: sellRatio 범위 오류 ${d.sellRatio}`); }
    }
    if (d.action === "buy" && held.has(code) && d.status !== "existing") { /* 물타기 — Phase 1 고지 대상 */ out.problems.push(`${code}: 보유 종목 추가 매수(물타기) — 정책 확인 필요`); }
  }
  return out;
}

// ---------------------------------------------------------------- 공용

function parseJsonBlock(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

const normCode = (v) => {
  const s = String(v ?? "");
  const hit = s.match(/(\d{6})/);
  return hit ? hit[1] : null;
};
