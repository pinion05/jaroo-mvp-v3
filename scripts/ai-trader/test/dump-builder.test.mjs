// 덤프 빌더 골든 테스트 — ②·⑤ 프롬프트가 공유할 반고정층의 바이트 재현성을 보증한다.
// 실행: node --test scripts/ai-trader/test/dump-builder.test.mjs   (디렉터리 지정은 이 Node에서 미지원)
// 골든 갱신: UPDATE_GOLDEN=1 node --test scripts/ai-trader/test/dump-builder.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DUMP_SCHEMA_VER,
  buildDump,
  serializeHoldingsSection,
  collectEvidence,
  withEvidence,
  sha256,
} from "../dump-builder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(await fs.readFile(path.join(__dirname, "fixtures", "turn-fixtures.json"), "utf8"));
const GOLDEN_PATH = path.join(__dirname, "golden", "chart-dump.md");
const AS_OF = "2026-11-19";

const chartDump = () =>
  buildDump({
    source: "chart",
    sourceData: FIX.sourceData,
    holdings: withEvidence(FIX.holdings, FIX.sourceData),
    asOf: AS_OF,
  });

test("같은 입력 → 같은 바이트·같은 해시 (prefix 캐시 계약)", () => {
  const a = chartDump();
  const b = chartDump();
  assert.equal(a.hash, b.hash);
  assert.equal(a.text, b.text);
  assert.equal(a.meta.hash, sha256(a.text));
});

test("골든 스냅샷과 바이트 일치", async () => {
  const dump = chartDump();
  if (process.env.UPDATE_GOLDEN || !(await fs.stat(GOLDEN_PATH).then(() => true, () => false))) {
    await fs.mkdir(path.dirname(GOLDEN_PATH), { recursive: true });
    await fs.writeFile(GOLDEN_PATH, dump.text);
    return;
  }
  const golden = await fs.readFile(GOLDEN_PATH, "utf8");
  assert.equal(dump.text, golden);
});

test("메타 — 스키마 버전·소스·asOf·카운트", () => {
  const { meta } = chartDump();
  assert.equal(meta.schemaVer, DUMP_SCHEMA_VER);
  assert.equal(meta.source, "chart");
  assert.equal(meta.asOf, AS_OF);
  assert.equal(meta.sourceCount, FIX.sourceData.chartRows.length);
  assert.equal(meta.holdingsCount, FIX.holdings.length);
  assert.ok(meta.bytes > 0);
});

test("보유 없음 상태도 결정적 출력", () => {
  const t1 = serializeHoldingsSection([], AS_OF);
  const t2 = serializeHoldingsSection([], AS_OF);
  assert.equal(t1, "## 보유 종목 — 매도/홀드 심사 대상\n(없음 — 오늘은 신규 진입만 고려한다)");
  assert.equal(t1, t2);
});

test("소스 증거 수집 — 등장/이탈/권외/언급없음 4형태", () => {
  const inAll = FIX.holdings.find((h) => h.code === "093320");
  const inNothing = FIX.holdings.find((h) => h.code === "005935");
  const ev = collectEvidence(inAll, FIX.sourceData);
  assert.match(ev.chart, /상승 후보 1위/);
  assert.match(ev.finance, /total 71\.2 \(1위\)/);
  assert.match(ev.news, /언급 2건\(2, 3\)/);
  const ev2 = collectEvidence(inNothing, FIX.sourceData);
  assert.equal(ev2.chart, "상위권 이탈");
  assert.equal(ev2.finance, "권외");
  assert.equal(ev2.news, "언급 없음");
});

test("보유종목 섹션 — 수량 명시·진입일수·손익 부호·정렬(코드순)", () => {
  const section = serializeHoldingsSection(withEvidence(FIX.holdings, FIX.sourceData), AS_OF);
  // 005930(11-05 진입, 14일)이 코드순으로 093320 앞에 온다
  const iSamsung = section.indexOf("### 삼성전자");
  const iKinx = section.indexOf("### 케이아이엔엑스");
  assert.ok(iSamsung > -1 && iKinx > -1 && iSamsung < iKinx);
  // '보유 N주'가 수량, '진입 N일째'가 기간 — 0주(0일) 혼동 방지 형식(2026-11-20 실측 교정)
  assert.match(section, /삼성전자 \(005930\) · 보유 4주 · 진입 14일째/);
  assert.match(section, /케이아이엔엑스 \(093320\) · 보유 9주 · 진입 14일째/);
  assert.match(section, /제주반도체 \(005935\) · 보유 2주 · 진입 42일째/);
  assert.match(section, /\(-4\.0%\)/);   // 평단 대비 하락 부호
  assert.match(section, /\(\+2\.3%\)/);  // 상승 부호
});
