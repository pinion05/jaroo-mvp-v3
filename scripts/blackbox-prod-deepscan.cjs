#!/usr/bin/env node
/**
 * blackbox-prod-deepscan.cjs — jaroo 운영(https://jaroo.kr) 딥스캔 사용자 관점 블랙박스 TC 구동 스크립트
 *
 * 원칙: 제품 소스/내부 문서 접근 없이, 전용 브라우저(CDP 9225, 운영 인증 세션 격리 복제본)의
 *       화면 조작·관찰만으로 여정을 재현한다. agent-browser CLI를 래핑.
 *
 * 사용법:
 *   node scripts/blackbox-prod-deepscan.cjs <journey> [인자] [--allow-costly]
 *
 * Journeys (비용 없음 — 관찰만):
 *   credits                      마이 화면 크레딧/딥스캔 잔여 표시 확인
 *   history                      /mypage/history 목록 로드·상단 항목 덤프
 *   home                         홈 포트폴리오 화면 구조·종목 카드 덤프
 *   deepscan-empty               /deepscan 빈 상태(진입로 부재) 확인
 *   expand <종목명 부분문자열>   홈 종목카드 확장 후 분석 진입점 라벨 확인 (클릭 없음)
 *   probe-history <종목명>       기록 항목 탭 후 이동 경로 관찰 (보유 종목은 재실행 유발 위험!)
 *
 * Journeys (비용 있음 — 크레딧 소모, --allow-costly 필수):
 *   run-deepscan <종목명 부분문자열>   홈 카드 → '딥스캔 분석' 클릭 → 완주 폴링 → 증거 저장
 *   run-etf      <종목명 부분문자열>   홈 카드 → 'ETF 분석' 클릭 → 완주 폴링 → 증거 저장
 *
 * 증거: docs/tc/prod-deepscan/ 아래 run-<slug>-fulltext.txt / run-<slug>-result.png / 실행 로그
 *       runs-log.jsonl (재실행 방지 장부 — 종료 시각·크레딧 변화 기록)
 *
 * 주의(제약 준수): 로그아웃/결제/포트폴리오 변경(종목 추가·삭제·편집)/회원정보 변경 행위는
 *                 이 스크립트에 구현돼 있지 않다. 분석 '재실행'만 크레딧을 소모한다(실측 10cr/회).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CDP_PORT = process.env.JAROO_CDP_PORT || '9225';
const AB = process.env.AGENT_BROWSER || '/home/pinion/.npm-global/bin/agent-browser';
const BASE = 'https://jaroo.kr';
const EVIDENCE_DIR = path.resolve(__dirname, '..', 'docs', 'tc', 'prod-deepscan');
const RUNS_LOG = path.join(EVIDENCE_DIR, 'runs-log.jsonl');

const argv = process.argv.slice(2);
const allowCostly = argv.includes('--allow-costly');
const args = argv.filter((a) => a !== '--allow-costly');
const journey = args[0];
const stockArg = args[1] || '';

function ab(...cmdArgs) {
  return execFileSync(AB, ['--cdp', CDP_PORT, ...cmdArgs], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 20 * 1024 * 1024,
  }).toString();
}
/** agent-browser eval — 표현식 하나만 받는다 (화살표 함수 그대로 전달 금지, IIFE는 OK) */
function ev(jsExpr) {
  return ab('eval', jsExpr).trim();
}
/** eval 결과가 JSON 문자열 리터럴이면 디코딩해 반환 */
function evText(jsExpr) {
  const raw = ev(jsExpr);
  try {
    const once = JSON.parse(raw);
    return typeof once === 'string' ? once : raw;
  } catch {
    return raw;
  }
}
const kst = () =>
  new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false }) +
  '.' + String(Date.now() % 1000).padStart(3, '0');
function log(msg) { console.log(`[${kst()}] ${msg}`); }
function logRun(entry) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.appendFileSync(RUNS_LOG, JSON.stringify({ ts: kst(), ...entry }) + '\n');
}
function open(url) { ab('open', url); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** 마이 화면에서 '딥스캔 N회 / 보유 크레딧 M cr' 추출 (렌더 지연 대기 재시도) */
function readCredits() {
  open(`${BASE}/mypage`);
  for (let i = 0; i < 6; i++) {
    sleep(2000);
    const txt = evText(`JSON.stringify(document.body.innerText)`);
    const m1 = txt.match(/딥스캔 ([0-9,]+)회/);
    const m2 = txt.match(/보유 크레딧 ([0-9,]+)cr/);
    if (m1 && m2) return { scans: m1[1], credits: m2[1] };
  }
  return { scans: null, credits: null };
}

/** 홈 종목카드 확장 (JS 클릭 — aria-expanded 토글). 종목명 부분문자열로 카드 선택. */
function expandCard(namePart) {
  open(`${BASE}/home`);
  sleep(3000);
  const r = ev(`(()=>{const btn=Array.from(document.querySelectorAll('article button')).find(x=>x.innerText.includes('${namePart}')); if(!btn) return 'NO_CARD'; btn.click(); return 'EXPANDED';})()`);
  if (!r.includes('EXPANDED')) throw new Error(`종목카드 없음: ${namePart}`);
  sleep(1200);
  return evText(`(()=>{const art=Array.from(document.querySelectorAll('article')).find(x=>x.innerText.includes('${namePart}')); const links=Array.from(art.querySelectorAll('a')).map(a=>a.innerText.replace(/\\n/g,'|')); return JSON.stringify(links);})()`);
}

/** 분석 링크 클릭 후 완주 폴링. linkText: '딥스캔 분석' | 'ETF 분석' */
async function runAnalysis(namePart, linkText) {
  if (!allowCostly) {
    throw new Error('크레딧 소모 여정 — --allow-costly 게이트 필요 (실측 10cr/회, ETF 경로는 상품에 따라 무과금 관측됨)');
  }
  log(`${namePart} 카드 확장…`);
  const links = expandCard(namePart);
  log(`카드 내 링크: ${links}`);
  const before = readCredits();
  log(`실행 전 크레딧: 딥스캔 ${before.scans}회 / ${before.credits}cr`);
  const t0 = Date.now();
  const clicked = ev(`(()=>{const art=Array.from(document.querySelectorAll('article')).find(x=>x.innerText.includes('${namePart}')); const a=Array.from(art.querySelectorAll('a')).find(x=>x.innerText.includes('${linkText}')); if(!a) return 'NO_LINK'; a.click(); return 'CLICKED:'+(a.getAttribute('href')||'');})()`);
  if (!clicked.startsWith('CLICKED')) throw new Error(`진입 링크 없음(${linkText}): ${clicked}`);
  log(`클릭 완료 ${clicked} — 폴링 시작`);

  const deadline = Date.now() + 190_000; // 최대 ~3분 (페이지별 90초 소프트데드라인 여유분)
  let lastLen = 0, stages = [];
  while (Date.now() < deadline) {
    sleep(5000);
    const st = ev(`(()=>{const t=document.body.innerText; return JSON.stringify({p:location.pathname,len:t.length,hdr:(t.split('\\n').find(l=>l.includes('기다리는 중')||l.includes('정리하는 중')||l.includes('준비 완료')||l.includes('정리해드렸'))||'').trim(),teams:[...t.matchAll(/(시장·차트 팀|심리·환경 팀|가치·기본 팀)\\n[^\\n]*\\n[^\\n]*\\n([^\\n]*)/g)].map(m=>m[1].slice(0,4)+'='+m[2].trim().slice(0,8)).join(','),done:t.includes('추천 시나리오')||t.includes('결과 공유하기')});})()`);
    let s; try { s = JSON.parse(JSON.parse(st)); } catch { s = { raw: st }; }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const line = `${elapsed}s ${JSON.stringify(s)}`;
    if (s.len !== lastLen || s.done) { log(line); stages.push({ elapsed, ...s }); lastLen = s.len; }
    if (s.done) break;
  }
  const totalSec = Math.round((Date.now() - t0) / 1000);
  const slug = namePart.replace(/\s+/g, '-');
  const fullText = evText(`JSON.stringify(document.body.innerText)`);
  const txtPath = path.join(EVIDENCE_DIR, `run-${slug}-fulltext.txt`);
  const pngPath = path.join(EVIDENCE_DIR, `run-${slug}-result.png`);
  fs.writeFileSync(txtPath, fullText);
  try { ab('screenshot', '-f', pngPath); } catch (e) { log(`스크린샷 실패: ${e.message}`); }
  const after = readCredits();
  log(`실행 후 크레딧: 딥스캔 ${after.scans}회 / ${after.credits}cr`);
  logRun({
    journey: `${journey}:${namePart}`, linkText, totalSec,
    creditsBefore: before, creditsAfter: after, stages: stages.length,
    evidence: [path.basename(txtPath), path.basename(pngPath)].join(', '),
  });
  log(`완주 ${totalSec}s — 증거: ${txtPath}`);
  return { totalSec, before, after };
}

switch (journey) {
  case 'credits': {
    const c = readCredits();
    log(JSON.stringify(c));
    logRun({ journey, ...c });
    break;
  }
  case 'home': {
    open(`${BASE}/home`);
    sleep(3000);
    log(evText(`JSON.stringify(document.body.innerText.slice(0,1500))`));
    break;
  }
  case 'history': {
    open(`${BASE}/mypage/history`);
    sleep(4000);
    const t0 = Date.now();
    const txt = evText(`JSON.stringify(document.body.innerText.slice(0,2000))`);
    log(`로드 ${Date.now() - t0}ms`);
    log(txt);
    break;
  }
  case 'deepscan-empty': {
    // ⚠️ 실측 발견(2026-11-09): 직전 분석 종목 컨텍스트가 남아 있으면 /deepscan '방문만으로'
    //    유료 위원 재실행이 자동 발생했다(12:43 ETN 사례, -10cr). 따라서 이 여정도 게이트 필요.
    if (!allowCostly) throw new Error('직전 종목 컨텍스트 재실행 유발 가능(--allow-costly 필요) — 빈 상태 확인은 신규 방문 세션에서 권장');
    open(`${BASE}/deepscan`);
    sleep(2500);
    log(evText(`JSON.stringify(location.pathname + ' || ' + document.body.innerText.slice(0,300))`));
    break;
  }
  case 'expand': {
    log(expandCard(stockArg));
    break;
  }
  case 'probe-history': {
    // 주의: 보유 종목 항목은 탭 시 '재실행'이 유발됨(크레딧 소모). 비보유 종목 바운스 확인용.
    if (!allowCostly) throw new Error('재실행 유발 가능 여정 — --allow-costly 게이트 필요');
    open(`${BASE}/mypage/history`);
    sleep(4000);
    const r = ev(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.innerText.includes('${stockArg}')); if(!b) return 'NO_ITEM'; b.click(); return 'TAPPED';})()`);
    sleep(4000);
    const dst = ev(`location.pathname`);
    log(`탭 결과: ${r} → ${dst}`);
    logRun({ journey: `${journey}:${stockArg}`, result: r, destination: dst });
    break;
  }
  case 'run-deepscan': {
    runAnalysis(stockArg, '딥스캔 분석');
    break;
  }
  case 'run-etf': {
    runAnalysis(stockArg, 'ETF 분석');
    break;
  }
  default:
    console.error('사용법: node blackbox-prod-deepscan.cjs <credits|home|history|deepscan-empty|expand|probe-history|run-deepscan|run-etf> [종목명] [--allow-costly]');
    console.error('크레딧 소모 여정(run-*, probe-history, deepscan-empty)은 --allow-costly 필수.');
    console.error('실측 과금 규칙(2026-11-09): /deepscan 위원 실행 10cr/회 · /deepscan 재방문도 직전 종목 재실행 유발(과금) · /etf ETF 분석은 관측 2회 모두 무과금.');
    process.exit(1);
}
