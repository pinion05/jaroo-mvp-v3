#!/usr/bin/env node
/**
 * blackbox-skeleton-choreography.cjs
 * ============================================================================
 * jaroo-dev 딥스캔 로딩 화면 "스켈레톤 안무(skeleton choreography)" 블랙박스 TC
 * — 사용자 관점 타임라인 캡처(500ms DOM 폴링) + 순서·타이밍 판정
 *
 * 블랙박스 원칙: 제품 소스/내부 문서를 읽지 않는다. 판정 기준은
 *   ① 제품이 화면에 안내한 문구 — /deepscan 대기 화면: "가격 위치, 핵심 근거,
 *      세 팀 판단을 한 흐름으로", "세 분석가가 종목을 차례로 살펴보고 있어요",
 *      "완료 신호가 오면 기다림 없이 이 화면 아래에 결과가 이어집니다"
 *   ② 일반 UX 관행 — 스켈레톤은 실제 콘텐츠 도착 전 해당 영역을 점유한다 /
 *      완료된 콘텐츠는 다시 스켈레톤으로 회귀하지 않는다 / 단계는 소개 순서대로
 *      공개된다 / 종결 후에는 로딩 요소가 소거된다
 *   ③ 관측 실측 패턴(2026-11-09 관찰 런) — 브리핑 Q&A=오늘 장 브리핑 스켈레톤
 *      (todayBriefSkeleton)이 점유 후 답변으로 교체, 팀 카드는 순차 공개,
 *      종결 시 상단 "분석가 응답을 기다리는 중… 타이머"가 "상세 결과 준비 완료"로 전환
 * 에만 근거한다. 검출 토큰은 화면에 실제 노출되는 문구 그대로다.
 *
 * 사용법:
 *   node scripts/blackbox-skeleton-choreography.cjs health
 *   node scripts/blackbox-skeleton-choreography.cjs ensure-stock [--image <png>]
 *   node scripts/blackbox-skeleton-choreography.cjs run-normal [--timeout 300]
 *   node scripts/blackbox-skeleton-choreography.cjs run-abandon [--abandon-after 5000] [--timeout 300]
 *   node scripts/blackbox-skeleton-choreography.cjs cache-replay [--timeout 60]
 *   node scripts/blackbox-skeleton-choreography.cjs analyze <evidence.jsonl>
 *
 * 환경변수:
 *   BB_BASIC_AUTH     (필수) jaroo-dev Basic Auth "user:pass". QA 자격 하드코딩 금지
 *                     규칙에 따라 최초 인증 통과에만 사용(이후 오리진 캐시 자격 사용).
 *   AGENT_BROWSER_BIN (선택) agent-browser 경로. 기본 "agent-browser".
 *
 * 전제: agent-browser 세션 jaroo-bb-sc 가 살아 있고 /login "Google로 시작하기"(dev 전용
 * 자동로그인, 필수 동의 체크 포함)로 로그인되어 있다. 스크립트는 로그인/로그아웃을
 * 수행하지 않는다. dev 스택 재시작 금지 규칙 준수.
 * 산출: docs/tc/skeleton-evidence/<runId>.jsonl (+ 동명 -summary.json)
 * ============================================================================
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ----------------------------- 설정 ----------------------------------------
const AB_BIN = process.env.AGENT_BROWSER_BIN || 'agent-browser';
const SESSION = 'jaroo-bb-sc';
const BASE = 'https://jaroo-dev.up.railway.app';
const EVIDENCE_DIR = path.resolve(__dirname, '..', 'docs', 'tc', 'skeleton-evidence');
const SAMPLE_INTERVAL_MS = 500;    // 페이지 내 샘플러 주기 (과업 지시값)
const COLLECT_EVERY_MS = 1500;     // 외부 수집기 drain 주기
const STALL_THRESHOLD_MS = 60000;  // 동일 상태 정체 임계 (일반 UX 관행: 60초+ 방치 금지)
const POST_TERMINAL_MS = 15000;    // 종결 감지 후 잔존 관찰 연장

// 관찰된 화면 문구 토큰 (출처 ①③)
const TK = {
  waitTop: '분석가 응답을 기다리는 중',       // 상단 대기 타이머 라벨
  readyTop: '상세 결과 준비 완료',            // 상단 종결 전환 문구
  arrivedTop: '실제 응답이 도착했어요',       // 종결 보조 문구
  teamLoading: '세 팀이 의견을 정리하는 중',  // 팀 섹션 로딩 라벨
  teamDoneBadge: '요약 완료',                 // 팀 카드 완료 배지
  footer: '분석 결과는 투자 권유가 아닌',     // 페이지 바닥 (하단 도달 표지)
  emptyState: '분석할 종목이 없습니다',       // /deepscan 빈 상태
  marketDone: '시세는 다 봤어요',             // 시장 데이터 단계 완료 안내
  team1: '시장·차트 팀',
  team2: '심리·환경 팀',
  team3: '가치·기본 팀',
  price: '오늘 장 기준',                      // 가격 위치 블록 표지
};

// ----------------------------- agent-browser 래퍼 ---------------------------
function ab(args, { timeoutMs = 45000, retries = 3 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = spawnSync(AB_BIN, ['--session-name', SESSION, ...args], {
      encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status === 0 && (r.stdout || '').trim() !== '') return r.stdout;
    lastErr = (r.stdout || '') + (r.stderr || '');
    // 데몬 busy·응답 유실(빈 출력)은 일시적 — 재시도
    if (attempt < retries) { sleepSync(2000); continue; }
  }
  throw new Error(`agent-browser ${args.join(' ')} failed: ${String(lastErr).slice(0, 400)}`);
}
function abEval(expr, opts) {
  const out = ab(['eval', expr], opts).trim();
  try { return JSON.parse(out); } catch (_) { return out; }
}
function abOpen(url, opts) { return ab(['open', url], opts); }
function abUrl() { return ab(['get', 'url']).trim(); }
function sleepSync(ms) { const e = Date.now() + ms; while (Date.now() < e) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------- 페이지 내 샘플러 v2 ---------------------------
// 순수 DOM 관찰. 핵심 교정(관찰 런 교훈):
//  - CSS Modules 모듈명(deepscan-loading-screen)이 'loading' 부분일치를 유발하므로
//    스켈레톤 셀렉터는 skeleton/shimmer/placeholder/aria-busy 만 사용한다.
//  - 스켈레톤 "페인팅" 판별: rect>0 + opacity!=0 + (배경색 알파>0 또는 배경이미지 있음).
//    종결 후 todayBriefSkeletonBar 가 DOM에 잔존하지만 투명 배경으로 그려지지 않는
//    사례가 관찰되어 DOM 존재와 시각 노출을 분리 계상한다.
//  - 팀 카드는 'narrativeCard' 클래스(관측). 팀 공개 순서는 body 텍스트의
//    등장 인덱스(문서 순서=시각 순서, 블록 레이아웃)로도 병행 측정한다.
//  - 본문 다이제스트는 상단 250자만 보면 팀 섹션이 안 보이므로 토큰 플래그를
//    전체 innerText 대상으로 계산하고 다이제스트는 700자로 확장한다.
const SAMPLER_INSTALL = `(function(){
  if (window.__bbsc && window.__bbscSid) return 'already';
  window.__bbsc = [];
  var TK = ${JSON.stringify(TK)};
  var q = function(sel){ try { return Array.from(document.querySelectorAll(sel)); } catch(e){ return []; } };
  var txtAll = function(){ return (document.body && document.body.innerText) || ''; };
  var painted = function(e){
    var r = e.getBoundingClientRect();
    if (!(r.width>0 && r.height>0)) return false;
    var st = getComputedStyle(e);
    if (st.opacity === '0' || st.visibility === 'hidden' || st.display === 'none') return false;
    var bgAlpha = 0;
    var m = /rgba?\\(([^)]+)\\)/.exec(st.backgroundColor);
    if (m) { var parts = m[1].split(','); bgAlpha = parts.length >= 4 ? parseFloat(parts[3]) : 1; }
    return bgAlpha > 0 || st.backgroundImage !== 'none';
  };
  var cnt = function(t){ var s = txtAll(); var n = 0, i = s.indexOf(t); while (i !== -1) { n++; i = s.indexOf(t, i + t.length); } return n; };
  window.__bbscSid = setInterval(function(){
    try {
      var txt = txtAll();
      var skSel = '[class*="skeleton" i],[class*="shimmer" i],[class*="placeholder" i],[aria-busy="true"]';
      var skAll = q(skSel);
      var skPainted = skAll.filter(painted);
      var skDom = skAll.filter(function(e){ var r = e.getBoundingClientRect(); return r.width>0 && r.height>0; });
      var idxOf = function(t){ return txt.indexOf(t); };
      var narrative = q('[class*="narrativeCard" i]').filter(function(e){ return e.getBoundingClientRect().height > 40; })
        .slice(0,8).map(function(e){ var r=e.getBoundingClientRect();
          return { s:(e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,24), y:Math.round(r.y+ (window.scrollY||0)), h:Math.round(r.height) }; });
      var briefSk = q('[class*="todayBriefSkeleton" i]').filter(function(e){ return e.getBoundingClientRect().height > 0; }).length;
      var timer = '';
      var mi = txt.indexOf(TK.waitTop);
      if (mi !== -1) timer = (txt.slice(mi, mi + 40).match(/\\d{1,3}:\\d{2}/) || [''])[0];
      window.__bbsc.push({
        i: window.__bbsc.length,
        t: Date.now(),
        pt: Math.round(performance.now()),
        u: location.pathname,
        skPainted: skPainted.length,
        skDom: skDom.length,
        skc: skDom.slice(0,2).map(function(e){ return String(e.className).slice(0,70); }),
        briefSk: briefSk,
        f: {
          waitTop: txt.indexOf(TK.waitTop) !== -1,
          readyTop: txt.indexOf(TK.readyTop) !== -1,
          arrivedTop: txt.indexOf(TK.arrivedTop) !== -1,
          teamLoading: txt.indexOf(TK.teamLoading) !== -1,
          doneCnt: cnt(TK.teamDoneBadge),
          footer: txt.indexOf(TK.footer) !== -1,
          emptyState: txt.indexOf(TK.emptyState) !== -1,
          marketDone: txt.indexOf(TK.marketDone) !== -1,
          price: txt.indexOf(TK.price) !== -1,
        },
        tmr: timer,
        tOrd: { t1: idxOf(TK.team1), t2: idxOf(TK.team2), t3: idxOf(TK.team3) },
        cards: narrative,
        x: txt.replace(/\\s+/g, ' ').slice(0, 700)
      });
      if (window.__bbsc.length > 4000) clearInterval(window.__bbscSid);
    } catch(e) {}
  }, ${SAMPLE_INTERVAL_MS});
  return 'installed';
})()`;

function installSampler() { return abEval(SAMPLER_INSTALL, { timeoutMs: 30000 }); }

// ----------------------------- 증거 기록 ------------------------------------
function newRunId(prefix) {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
class Evidence {
  constructor(runId) {
    this.runId = runId;
    this.file = path.join(EVIDENCE_DIR, `${runId}.jsonl`);
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    this.consumed = 0;
    this.samples = [];
    this.events = [];
    this.line('meta', { runId, startedAt: new Date().toISOString(), sampleIntervalMs: SAMPLE_INTERVAL_MS, tokens: TK });
  }
  line(kind, obj) { fs.appendFileSync(this.file, JSON.stringify({ kind, ...obj }) + '\n'); }
  event(event, extra = {}) {
    const rec = { t: Date.now(), event, ...extra };
    this.events.push(rec);
    this.line('event', rec);
  }
  addSamples(arr) {
    for (const s of arr) this.samples.push(s);
    if (arr.length) this.line('samples', { from: arr[0].i, to: arr[arr.length - 1].i, data: arr });
  }
}

// ----------------------------- 수집 루프 ------------------------------------
async function collect(ctx, { durationMs, isTerminal = null, onTick = null }) {
  const ev = ctx.ev;
  let deadline = Date.now() + durationMs;
  let terminalFirstAt = null;
  while (Date.now() < deadline) {
    const elapsed = Date.now() - ctx.t0;
    let res;
    try {
      res = abEval(`(function(){
        if (!window.__bbsc) return JSON.stringify({lost:true,u:location.pathname});
        return JSON.stringify({lost:false,n:window.__bbsc.length,s:window.__bbsc.slice(${ev.consumed})});
      })()`, { timeoutMs: 30000 });
    } catch (e) {
      ev.event('collect-error', { error: String(e.message).slice(0, 200) });
      await sleep(COLLECT_EVERY_MS);
      continue;
    }
    let parsed = null;
    try { parsed = typeof res === 'string' ? JSON.parse(res) : res; } catch (_) {}
    if (parsed && parsed.lost) {
      ev.event('sampler-lost-nav', { atMs: elapsed, url: parsed.u });
      ev.consumed = 0;
      try { installSampler(); } catch (e) { ev.event('sampler-reinstall-failed', { error: String(e.message).slice(0, 150) }); }
    } else if (parsed && !parsed.lost) {
      if (parsed.s && parsed.s.length) ev.addSamples(parsed.s);
      ev.consumed = parsed.n;
    }
    if (isTerminal && ev.samples.length) {
      const last = ev.samples[ev.samples.length - 1];
      if (isTerminal(last)) {
        if (terminalFirstAt == null) {
          terminalFirstAt = Date.now() - ctx.t0;
          ev.event('terminal-detected', { atMs: terminalFirstAt, url: last.u, flags: last.f });
          deadline = Math.min(deadline, Date.now() + POST_TERMINAL_MS); // 잔존 관찰 연장
        }
      }
    }
    if (onTick) await onTick({ ev, elapsed, last: ev.samples[ev.samples.length - 1] });
    await sleep(COLLECT_EVERY_MS);
  }
  return { terminalFirstAt };
}

// ----------------------------- 종결 판정 ------------------------------------
// 종결 = 상단 '준비 완료' 전환 + 세 팀 카드 모두 등장 + 요약완료 3회 + 바닥 도달
function isTerminalState(s) {
  const f = s.f || {};
  return !!(f.readyTop && f.footer && f.doneCnt >= 3 && s.tOrd && s.tOrd.t1 >= 0 && s.tOrd.t2 >= 0 && s.tOrd.t3 >= 0);
}

// ----------------------------- 시나리오 공통 --------------------------------
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !/^--/.test(process.argv[i + 1]) ? process.argv[i + 1] : def;
}
async function ensureAccess() {
  if (!process.env.BB_BASIC_AUTH) throw new Error('BB_BASIC_AUTH 환경변수가 필요합니다 (user:pass)');
  return String(abOpen(`${BASE.replace('https://', `https://${process.env.BB_BASIC_AUTH}@`)}/login`, { timeoutMs: 90000, retries: 4 })).trim();
}
/** dev 전용 자동로그인("Google로 시작하기" = 고정 QA 계정). 필요 시에만(미인증일 때) 수행하며 로그아웃은 하지 않는다. */
async function ensureLogin() {
  await ensureAccess();
  abOpen(`${BASE}/home`, { timeoutMs: 90000, retries: 4 });
  await sleep(2500);
  // 주의: /api/auth/me 는 게스트에도 200 — 상태코드가 아니라 authScope 로 판정한다(실측)
  let meTxt = '';
  try { meTxt = String(abEval(`fetch('/api/auth/me').then(function(r){return r.text()})`, { timeoutMs: 30000 })); } catch (_) {}
  if (meTxt.includes('"authScope":"authenticated"')) { console.log('[login] 이미 로그인됨'); return true; }
  console.log('[login] 미인증/게스트 상태 → dev 자동로그인 시도');
  abOpen(`${BASE}/login`, { timeoutMs: 90000, retries: 4 });
  await sleep(2000);
  try { ab(['check', 'input[type=checkbox]'], { timeoutMs: 30000 }); } catch (e) { console.log('[login] 동의 체크 생략:', String(e.message).slice(0, 80)); }
  await sleep(500);
  abEval(`(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').indexOf('Google로 시작하기')!==-1}); if(b){b.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 'dispatched'} return 'nobutton'})()`, { timeoutMs: 30000 });
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    abOpen(`${BASE}/home`, { timeoutMs: 90000, retries: 2 });
    await sleep(1500);
    try {
      meTxt = String(abEval(`fetch('/api/auth/me').then(function(r){return r.text()})`, { timeoutMs: 30000 }));
      if (meTxt.includes('"authScope":"authenticated"')) { console.log('[login] 자동로그인 성공'); return true; }
    } catch (_) {}
  }
  throw new Error('dev 자동로그인 실패');
}
async function apiHealth() {
  const r = abEval(`(function(){
    var j = function(s){ return JSON.stringify(s); };
    return Promise.all([
      fetch('/api/auth/me').then(function(r){return r.status}).catch(function(){return 'ERR'}),
      fetch('/api/portfolio').then(function(r){return r.status}).catch(function(){return 'ERR'}),
      fetch('/api/deepscan/history?limit=5').then(function(r){return r.status}).catch(function(){return 'ERR'})
    ]).then(function(a){ return j({auth:a[0], portfolio:a[1], history:a[2]}) });
  })()`, { timeoutMs: 30000 });
  try { const s = typeof r === 'string' ? r : JSON.stringify(r); return JSON.parse(JSON.parse(s)); }
  catch (_) { return { raw: String(r).slice(0, 200) }; }
}
async function hasStockCard() {
  const r = abEval(`(function(){
    var empty = /포트폴리오 준비|스크린샷을 추가해서/.test(document.body.innerText);
    var cardBtns = Array.from(document.querySelectorAll('button')).filter(function(b){
      return /(전자|반도체|디스플레이|화학|바이오|증권|은행|통신|KOSPI|KOSDAQ)/.test(b.innerText||'');
    }).map(function(b){ return b.innerText.trim().split('\\n')[0].slice(0,20); });
    return JSON.stringify({empty:empty, cards:cardBtns.slice(0,5)});
  })()`, { timeoutMs: 30000 });
  try {
    const p = typeof r === 'string' ? JSON.parse(r) : r;
    const inner = typeof p === 'string' ? JSON.parse(p) : p;
    return { empty: inner.empty, cards: inner.cards || [] };
  } catch (_) { return { empty: null, cards: [] }; }
}
async function ensureStock() {
  abOpen(`${BASE}/home`, { timeoutMs: 90000 });
  await sleep(2000);
  let st = await hasStockCard();
  if (!st.empty && st.cards.length) { console.log('[ensure-stock] 보유 종목 있음:', st.cards); return st.cards[0]; }
  console.log('[ensure-stock] 보유 종목 없음 → 합성 스크린샷 업로드 (dev 휘발성 환경 허용 범위)');
  const img = arg('--image', '/tmp/bbsc/synthetic-portfolio.png');
  if (!fs.existsSync(img)) throw new Error(`합성 스크린샷 없음: ${img}`);
  abOpen(`${BASE}/screenshot`, { timeoutMs: 90000 });
  await sleep(1500);
  ab(['upload', 'input[type=file]', img], { timeoutMs: 90000 });
  for (let i = 0; i < 24; i++) {
    await sleep(2500);
    const txt = String(abEval(`document.body.innerText.replace(/\\s+/g,' ').slice(0,300)`, { timeoutMs: 30000 })).replace(/^"|"$/g, '');
    const m = txt.match(/(\d+)개 종목 인식/);
    if (m) {
      console.log(`[ensure-stock] OCR 인식: ${m[1]}개`);
      abEval(`(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return x.innerText.includes('적용하기')}); return b?(b.click(),'clicked'):'nobutton'})()`, { timeoutMs: 30000 });
      await sleep(4000);
      break;
    }
  }
  abOpen(`${BASE}/home`, { timeoutMs: 90000 });
  await sleep(2000);
  st = await hasStockCard();
  if (st.empty || !st.cards.length) throw new Error('종목 추가 실패(업로드/OCR/적용 경로 확인 필요)');
  console.log('[ensure-stock] 추가됨:', st.cards);
  return st.cards[0];
}
/** 홈 종목 카드 확장 → "딥스캔 분석" 버튼 클릭 (2단계 진입로, 관측 기반). */
function startDeepscanFromHome() {
  const r = abEval(`(function(){
    var btns = Array.from(document.querySelectorAll('button'));
    var card = btns.find(function(b){ return (b.innerText||'').includes('KOSPI') && /(전자|반도체|디스플레이|화학|바이오|증권|은행|통신)/.test(b.innerText||''); })
      || btns.find(function(b){ return /(전자|반도체|디스플레이|화학|바이오|증권|은행|통신)/.test(b.innerText||'') && /KOSPI|KOSDAQ/.test(b.innerText||''); })
      || btns.find(function(b){ return (b.innerText||'').trim().split('\\n').length >= 3 && /(전자|반도체|디스플레이)/.test(b.innerText||''); });
    if (!card) return JSON.stringify({ok:false, step:'card'});
    card.click();
    return 'phase1';
  })()`, { timeoutMs: 30000 });
  const phase1 = typeof r === 'string' ? r.replace(/"/g, '') : String(r);
  if (phase1 !== 'phase1') { try { return JSON.parse(phase1); } catch (_) { return { ok: false, step: 'card' }; } }
  // 카드 확장 후 딥스캔 분석 버튼 대기(최대 6s) → 클릭
  for (let i = 0; i < 6; i++) {
    sleepSync(1000);
    const r2 = abEval(`(function(){
      var b = Array.from(document.querySelectorAll('button,a')).find(function(x){ return (x.innerText||'').indexOf('딥스캔 분석') !== -1; });
      if (!b) return 'waiting';
      var stock = '';
      try { stock = b.closest('[class*="card" i]') ? (b.closest('[class*="card" i]').innerText.match(/^[^\\n]+/)||[''])[0].slice(0,20) : ''; } catch(e){}
      b.click();
      return JSON.stringify({ok:true, step:'deepscan-btn', stock:stock});
    })()`, { timeoutMs: 30000 });
    const v = typeof r2 === 'string' ? r2.replace(/"/g, '') : String(r2);
    if (v === 'waiting') continue;
    try { return JSON.parse(typeof r2 === 'string' ? r2 : JSON.stringify(r2)); }
    catch (_) { return { ok: v !== 'waiting', step: 'deepscan-btn', raw: v.slice(0, 100) }; }
  }
  return { ok: false, step: 'deepscan-btn' };
}

// ----------------------------- 분석 -----------------------------------------
function flagsOf(s) { return s.f || {}; }
function firstSampleWith(samples, pred) { for (const s of samples) if (pred(s)) return s; return null; }

/** 공개 순서: 안내 순서(가격 위치→핵심 근거(시세)→세 팀) vs 실측 첫 등장 시각. */
function checkDisclosureOrder(samples) {
  const price = firstSampleWith(samples, (s) => flagsOf(s).price);
  const market = firstSampleWith(samples, (s) => flagsOf(s).marketDone); // 시세 단계 완료 안내
  const t1 = firstSampleWith(samples, (s) => s.tOrd && s.tOrd.t1 >= 0);
  const t2 = firstSampleWith(samples, (s) => s.tOrd && s.tOrd.t2 >= 0);
  const t3 = firstSampleWith(samples, (s) => s.tOrd && s.tOrd.t3 >= 0);
  const seq = [
    { name: '가격 위치(오늘 장 기준)', s: price },
    { name: '핵심 근거(시세 완료 안내)', s: market },
    { name: '팀1 시장·차트', s: t1 },
    { name: '팀2 심리·환경', s: t2 },
    { name: '팀3 가치·기본', s: t3 },
  ].filter((x) => x.s);
  const times = seq.map((x) => ({ name: x.name, t: x.s.t, i: x.s.i }));
  let inversion = null;
  for (let i = 0; i + 1 < times.length; i++) if (times[i].t > times[i + 1].t) { inversion = { earlier: times[i], later: times[i + 1] }; break; }
  return {
    announced: ['가격 위치', '핵심 근거', '세 팀 판단(팀1→2→3 순차: 세 분석가가 차례로)'],
    observed: times,
    inversion,
  };
}
/** 스켈레톤 대기(점유): 각 단계 첫 등장 직전 창에 페인팅 스켈레톤 존재 여부. */
function checkSkeletonOccupation(samples) {
  const marks = [
    { name: '가격 위치', pred: (s) => flagsOf(s).price },
    { name: '팀1', pred: (s) => s.tOrd && s.tOrd.t1 >= 0 },
    { name: '팀2', pred: (s) => s.tOrd && s.tOrd.t2 >= 0 },
    { name: '팀3', pred: (s) => s.tOrd && s.tOrd.t3 >= 0 },
  ];
  return marks.map((m) => {
    const arr = firstSampleWith(samples, m.pred);
    if (!arr) return { section: m.name, arrived: false };
    const before = samples.filter((s) => s.t < arr.t).slice(-6);
    const occupied = before.filter((s) => (s.skPainted || 0) > 0).length;
    return {
      section: m.name, arrived: true, firstAtMs: arr.pt,
      preWindow: before.length, preWindowSkeleton: occupied,
      occupied: before.length === 0 ? null : occupied > 0,
    };
  });
}
/** 회귀/깜빡임: 도착 후 플래그 소실→재등장, 텍스트 인덱스 소실. */
function detectRegressions(samples) {
  const out = [];
  const tracks = [
    { name: '가격 위치', get: (s) => flagsOf(s).price },
    { name: '시세 완료 안내', get: (s) => flagsOf(s).marketDone },
    { name: '팀1', get: (s) => s.tOrd && s.tOrd.t1 >= 0 },
    { name: '팀2', get: (s) => s.tOrd && s.tOrd.t2 >= 0 },
    { name: '팀3', get: (s) => s.tOrd && s.tOrd.t3 >= 0 },
    { name: '요약완료 배지', get: (s) => (flagsOf(s).doneCnt || 0) > 0 },
  ];
  for (const tr of tracks) {
    let arrived = false, lostAt = null, maxDone = 0;
    for (const s of samples) {
      const v = tr.get(s);
      if (tr.name === '요약완료 배지') {
        const c = flagsOf(s).doneCnt || 0;
        if (c < maxDone && c >= 0) out.push({ track: tr.name, atMs: s.pt, from: maxDone, to: c });
        maxDone = Math.max(maxDone, c);
        continue;
      }
      if (v && !arrived) arrived = true;
      else if (v && arrived && lostAt) { out.push({ track: tr.name, lostAtMs: lostAt.pt, backAtMs: s.pt, gapMs: s.t - lostAt.t }); lostAt = null; }
      else if (!v && arrived && !lostAt) lostAt = s;
    }
  }
  return out;
}
/** 스켈레톤 재점거: 전 단계 도착 후 페인팅 스켈레톤 재발생 구간. */
function detectSkeletonReturn(samples) {
  const arrivals = [
    firstSampleWith(samples, (s) => flagsOf(s).price),
    firstSampleWith(samples, (s) => s.tOrd && s.tOrd.t3 >= 0),
    firstSampleWith(samples, (s) => flagsOf(s).readyTop),
  ].filter(Boolean);
  if (!arrivals.length) return [];
  const allAt = Math.max(...arrivals.map((s) => s.t));
  const out = [];
  let cur = null;
  for (const s of samples) {
    if (s.t <= allAt) continue;
    const p = (s.skPainted || 0) > 0;
    if (p && !cur) cur = { startAt: s.t, n: 1 };
    else if (p && cur) cur.n++;
    else if (!p && cur) { out.push({ ...cur, endAt: s.t, durMs: s.t - cur.startAt }); cur = null; }
  }
  if (cur) out.push({ ...cur, endAt: null, durMs: null });
  return out;
}
/** 정체: 타이머/상태 동결 + 스켈레톤 존재가 임계 초과 지속. */
function detectStall(samples) {
  const stalls = [];
  let run = null;
  for (const s of samples) {
    const loading = (s.skPainted || 0) > 0 || flagsOf(s).waitTop;
    const key = `${loading}|${flagsOf(s).waitTop ? s.tmr : ''}|${s.u}`;
    if (loading) {
      if (!run) run = { startAt: s.t, key, lastAt: s.t };
      else if (key === run.key) run.lastAt = s.t;
      else { if (run.lastAt - run.startAt >= STALL_THRESHOLD_MS) stalls.push(run); run = { startAt: s.t, key, lastAt: s.t }; }
    } else if (run) {
      if (run.lastAt - run.startAt >= STALL_THRESHOLD_MS) stalls.push(run);
      run = null;
    }
  }
  if (run && run.lastAt - run.startAt >= STALL_THRESHOLD_MS) stalls.push(run);
  return stalls.map((r) => ({ ...r, durMs: r.lastAt - r.startAt }));
}
/** 팀 카드 그리드 재정렬: 텍스트 등장 인덱스 순서 + narrativeCard y좌표 순서 변화. */
function detectTeamReorders(samples) {
  const jumps = [];
  let prevKey = null, prevAt = null;
  for (const s of samples) {
    const o = s.tOrd || {};
    if (o.t1 < 0 && o.t2 < 0 && o.t3 < 0) continue;
    const names = [['t1', o.t1], ['t2', o.t2], ['t3', o.t3]].filter((x) => x[1] >= 0).sort((a, b) => a[1] - b[1]).map((x) => x[0]).join('>');
    const cardY = (s.cards || []).map((c) => c.s.slice(0, 8)).join('|');
    const key = `${names}#${cardY}`;
    if (prevKey && key !== prevKey) jumps.push({ atMs: s.pt, from: prevKey, to: key, gapMs: prevAt != null ? s.t - prevAt : null });
    prevKey = key; prevAt = s.t;
  }
  return jumps.slice(0, 30);
}
function analyzeTimeline(samples, events, meta = {}) {
  const last = samples[samples.length - 1] || {};
  const lf = flagsOf(last);
  const terminalIdx = samples.findIndex((s) => isTerminalState(s));
  const postTerminal = terminalIdx >= 0 ? samples.slice(terminalIdx) : [];
  const residual = postTerminal.length ? {
    paintedSkeletonSamples: postTerminal.filter((s) => (s.skPainted || 0) > 0).length,
    domSkeletonSamples: postTerminal.filter((s) => (s.skDom || 0) > 0).length,
    waitTopStillVisible: postTerminal.some((s) => flagsOf(s).waitTop),
    teamLoadingStillVisible: postTerminal.some((s) => flagsOf(s).teamLoading),
    timerStillTicking: postTerminal.some((s) => (s.tmr || '') !== ''),
  } : null;
  const pathDist = {};
  for (const s of samples) pathDist[s.u] = (pathDist[s.u] || 0) + 1;
  return {
    meta,
    sampleCount: samples.length,
    spanMs: samples.length ? samples[samples.length - 1].t - samples[0].t : 0,
    pathDistribution: pathDist,
    events: events.map((e) => ({ event: e.event, at: new Date(e.t).toISOString() })),
    order: checkDisclosureOrder(samples),
    occupation: checkSkeletonOccupation(samples),
    regressions: detectRegressions(samples),
    skeletonReturns: detectSkeletonReturn(samples),
    stalls: detectStall(samples),
    teamReorders: detectTeamReorders(samples),
    terminal: {
      detected: terminalIdx >= 0,
      detectedAtMs: terminalIdx >= 0 ? samples[terminalIdx].pt : null,
      lastFlags: lf,
      lastUrl: last.u,
      residual,
    },
  };
}
function analyzeFile(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const samples = lines.filter((l) => l.kind === 'samples').flatMap((l) => l.data)
    .concat(lines.filter((l) => l.kind === 'sample').map((l) => { const { kind, ...rest } = l; return rest; }));
  samples.sort((a, b) => a.t - b.t);
  const events = lines.filter((l) => l.kind === 'event');
  const summary = analyzeTimeline(samples, events, { file });
  const out = file.replace('.jsonl', '-summary.json');
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`분석 완료: ${out}`);
  console.log('샘플:', summary.sampleCount, '구간(ms):', summary.spanMs);
  console.log('순서 관측:', JSON.stringify(summary.order.observed.map((o) => ({ n: o.name, i: o.i }))));
  console.log('역전:', JSON.stringify(summary.order.inversion));
  console.log('회귀:', summary.regressions.length, '건 / 재점거:', summary.skeletonReturns.length, '건 / 정체:', summary.stalls.length, '건 / 재정렬:', summary.teamReorders.length, '건');
  console.log('종결:', JSON.stringify(summary.terminal));
  return summary;
}

// ----------------------------- 시나리오 -------------------------------------
async function runDeepscanScenario(kind) {
  const runId = newRunId(kind);
  const ev = new Evidence(runId);
  console.log(`[${kind}] runId=${runId}`);
  await ensureLogin();
  const stock = await ensureStock();
  ev.event('stock-ready', { stock });

  abOpen(`${BASE}/home`, { timeoutMs: 90000 });
  await sleep(2500);
  console.log('[sampler]', installSampler());

  const ctx = { ev, t0: Date.now() };
  const timeoutSec = parseInt(arg('--timeout', '300'), 10);
  let abandonAfterMs = null, abandoned = false, reenteredViaUi = false;
  if (kind === 'run-abandon') abandonAfterMs = parseInt(arg('--abandon-after', '5000'), 10);

  const click = startDeepscanFromHome();
  ev.event('deepscan-start-click', { ...click, atMs: Date.now() - ctx.t0 });
  if (!click.ok) throw new Error(`진입 실패: ${JSON.stringify(click)}`);
  console.log(`[${kind}] 딥스캔 시작 (${click.stock || ''})`);

  const res = await collect(ctx, {
    durationMs: timeoutSec * 1000,
    isTerminal: isTerminalState,
    onTick: async ({ elapsed }) => {
      if (abandonAfterMs !== null && !abandoned && elapsed >= abandonAfterMs) {
        abandoned = true;
        try {
          let href = '/deepscan';
          try { href = String(abEval('location.href', { timeoutMs: 20000 })).replace(/"/g, '') || abUrl(); }
          catch (_) { try { href = abUrl(); } catch (_) {} }
          ev.event('abandon-leave', { atMs: elapsed, url: href, mode: 'navigate-home' });
          // 이탈: 홈으로 떠났다가 재진입(SPA 내비게이션 — full reload는 측정 데몬을 붕괴시켜
          // 관측되었으므로(navar) navigate 방식으로 이탈을再现한다)
          try { abOpen(`${BASE}/home`, { timeoutMs: 60000, retries: 2 }); }
          catch (e) { ev.event('abandon-leave-error', { error: String(e.message).slice(0, 150) }); }
          await sleep(2500);
          let afterUrl = '', afterTxt = '';
          try { afterUrl = abUrl(); } catch (_) {}
          try { afterTxt = String(abEval(`document.body.innerText.replace(/\\s+/g,' ').slice(0,250)`, { timeoutMs: 30000 })).replace(/"/g, ''); }
          catch (e) { afterTxt = `EVAL-FAIL:${String(e.message).slice(0, 80)}`; }
          ev.event('abandon-left-state', { atMs: Date.now() - ctx.t0, url: afterUrl, text: afterTxt });
          // 재진입: 같은 딥스캔 URL로 복귀
          try { abOpen(href, { timeoutMs: 60000, retries: 2 }); }
          catch (e) { ev.event('reenter-error', { error: String(e.message).slice(0, 150) }); }
          await sleep(2500);
          try { afterUrl = abUrl(); afterTxt = String(abEval(`document.body.innerText.replace(/\\s+/g,' ').slice(0,250)`, { timeoutMs: 30000 })).replace(/"/g, ''); }
          catch (e) { afterTxt = `EVAL-FAIL:${String(e.message).slice(0, 80)}`; }
          ev.event('reenter-state', { atMs: Date.now() - ctx.t0, url: afterUrl, text: afterTxt });
          // 재진입이 빈 상태면 홈 카드→딥스캔 분석 UI 경로로 재시도
          if (afterTxt.includes(TK.emptyState) && !reenteredViaUi) {
            reenteredViaUi = true;
            ev.event('reenter-via-ui', { atMs: Date.now() - ctx.t0 });
            try {
              abOpen(`${BASE}/home`, { timeoutMs: 90000, retries: 3 });
              await sleep(2500);
              const c2 = startDeepscanFromHome();
              ev.event('reenter-click', { ...c2, atMs: Date.now() - ctx.t0 });
            } catch (e) { ev.event('reenter-click-error', { error: String(e.message).slice(0, 150) }); }
          }
        } catch (e) {
          ev.event('abandon-phase-error', { error: String(e.message).slice(0, 200) });
        }
      } else if (abandoned && !reenteredViaUi && elapsed > abandonAfterMs + 30000) {
        // 하네스 붕괴 복구: 이탈 후 장시간 blank(데몬 재시작)에 머물면 UI 경로로 재진입
        try {
          const u = abUrl();
          if (/about:blank|^blank/.test(u)) {
            ev.event('blank-recovery', { atMs: elapsed, url: u });
            reenteredViaUi = true;
            await ensureAccess();
            abOpen(`${BASE}/home`, { timeoutMs: 60000, retries: 2 });
            await sleep(2500);
            const c3 = startDeepscanFromHome();
            ev.event('recovery-click', { ...c3, atMs: Date.now() - ctx.t0 });
          }
        } catch (_) {}
      }
    },
  });

  const endUrl = abUrl();
  const endText = String(abEval(`document.body.innerText.replace(/\\s+/g,' ').slice(0,300)`, { timeoutMs: 30000 })).replace(/"/g, '');
  ev.event('run-end', { reason: res.terminalFirstAt != null ? 'terminal' : 'timeout', terminalAtMs: res.terminalFirstAt, endUrl, endText });
  console.log(`[${kind}] 종료: ${res.terminalFirstAt != null ? `terminal@${res.terminalFirstAt}ms` : 'timeout'} url=${endUrl}`);

  const summary = analyzeTimeline(ev.samples, ev.events, { kind });
  const summaryFile = ev.file.replace('.jsonl', '-summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify({ runId, ...summary }, null, 2));
  console.log(`[${kind}] 증거: ${ev.file}`);
  console.log(`[${kind}] 요약: ${summaryFile}`);
  return { runId, file: ev.file, summary };
}

async function cacheReplayScenario() {
  const runId = newRunId('cache-replay');
  const ev = new Evidence(runId);
  console.log(`[cache-replay] runId=${runId}`);
  await ensureLogin();
  abOpen(`${BASE}/mypage/history`, { timeoutMs: 90000 });
  await sleep(3000);
  const txt = String(abEval(`document.body.innerText.replace(/\\s+/g,' ').slice(0,400)`, { timeoutMs: 30000 })).replace(/"/g, '');
  ev.event('history-page', { text: txt });
  if (/다시 보기|다시보기/.test(txt)) {
    installSampler();
    const ctx = { ev, t0: Date.now() };
    ev.event('replay-click', { atMs: 0 });
    abEval(`(function(){var b=Array.from(document.querySelectorAll('button,a')).find(function(x){return /다시 보기|다시보기/.test(x.innerText||'')}); return b?(b.click(),'clicked'):'nobutton'})()`, { timeoutMs: 30000 });
    const timeoutSec = parseInt(arg('--timeout', '60'), 10);
    await collect(ctx, { durationMs: timeoutSec * 1000 });
    const clickT = ctx.t0;
    const firstContent = ev.samples.find((s) => flagsOf(s).readyTop || flagsOf(s).footer);
    const skSamples = ev.samples.filter((s) => (s.skPainted || 0) > 0);
    const summary = {
      kind: 'cache-replay',
      firstContentAfterMs: firstContent ? firstContent.t - clickT : null,
      totalSamples: ev.samples.length,
      skeletonPaintedSamples: skSamples.length,
      skeletonSeenMs: skSamples.length * SAMPLE_INTERVAL_MS,
      endUrl: abUrl(),
    };
    summary.verdict = summary.firstContentAfterMs != null && summary.firstContentAfterMs <= 2000 && skSamples.length <= 2
      ? 'PASS(사실상 즉시 열람)'
      : summary.firstContentAfterMs != null
        ? `CHECK(첫 콘텐츠 ${summary.firstContentAfterMs}ms, 스켈레톤 ${skSamples.length}샘플 노출)`
        : 'FAIL(콘텐츠 미도달)';
    const summaryFile = ev.file.replace('.jsonl', '-summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify({ runId, ...summary }, null, 2));
    console.log(`[cache-replay] ${summary.verdict}`);
    return { runId, file: ev.file, summary };
  }
  ev.event('no-replay-entry', { reason: 'history API 장애 또는 기록 없음' });
  const summaryFile = ev.file.replace('.jsonl', '-summary.json');
  const payload = { runId, kind: 'cache-replay', skipped: true, reason: `다시 보기 진입점 없음(페이지 문구: ${txt.slice(0, 120)})` };
  fs.writeFileSync(summaryFile, JSON.stringify(payload, null, 2));
  console.log('[cache-replay] SKIP — 제약 기록:', payload.reason);
  return { runId, file: ev.file, skipped: true };
}

// ----------------------------- main -----------------------------------------
async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'health': {
      await ensureAccess();
      abOpen(`${BASE}/home`, { timeoutMs: 90000 });
      await sleep(2500);
      console.log('[health]', JSON.stringify(await apiHealth()));
      console.log('[stocks]', JSON.stringify(await hasStockCard()));
      break;
    }
    case 'ensure-stock': await ensureStock(); break;
    case 'run-normal': await runDeepscanScenario('run-normal'); break;
    case 'run-abandon': await runDeepscanScenario('run-abandon'); break;
    case 'cache-replay': await cacheReplayScenario(); break;
    case 'analyze': {
      const f = process.argv[3];
      if (!f || !fs.existsSync(f)) throw new Error('사용법: analyze <evidence.jsonl>');
      analyzeFile(f);
      break;
    }
    default:
      console.log('사용법: node scripts/blackbox-skeleton-choreography.cjs <health|ensure-stock|run-normal|run-abandon|cache-replay|analyze> [opts]');
      console.log('  --timeout <sec>        수집 창 (기본 run=300s, cache-replay=60s)');
      console.log('  --abandon-after <ms>   run-abandon: 시작 후 새로고침 이탈 시점(기본 5000ms)');
      console.log('  --image <png>          합성 스크린샷 경로(기본 /tmp/bbsc/synthetic-portfolio.png)');
      process.exit(cmd ? 1 : 0);
  }
}
main().catch((e) => { console.error('[fatal]', e.message); process.exit(1); });
