#!/usr/bin/env node
/**
 * jaroo 블랙박스 TC — 금융 데이터 표시 신뢰성 (TC-BBD-001 ~ TC-BBD-028)
 *
 * 원칙: 제품 소스/내부 문서를 읽지 않고, 화면에 렌더링된 값만 관찰한다.
 *       기대값 출처는 ①공개 금융 관행(한국 상승 빨강/하락 파랑, 원화 천단위 콤마)
 *       ②상식적 값 범위(예: 삼성전자 주가 5만~30만원 수준 — 공개 사실)
 *       ③산술 일관성(화면 내 값들 간 정합) ④크로스환경 일관성(dev↔local) 뿐이다.
 *
 * 사용법 (프로젝트 루트에서):
 *   BB_BASIC_AUTH='user:pass' node scripts/blackbox-data-sanity.cjs [그룹...]
 *
 *   그룹: pre portfolio market datetime deepscan ocr empty local all (기본 all)
 *   env:
 *     BB_BASE_URL    기본 https://jaroo-dev.up.railway.app
 *     LOCAL_URL      기본 http://127.0.0.1:3002   (빈 상태 영역만 사용 — 재시작 금지)
 *     BB_BASIC_AUTH  QA Basic Auth 자격 "user:pass" (파일 하드코딩 금지 규칙 준수)
 *     BB_SESSION     agent-browser 세션명, 기본 jaroo-bb-data
 *     BB_EXPAND_ROWS =1 이면 보유 종목 행 1개 확장해 수량×현재가 검증(기본 0=비활성)
 *     BB_LOCAL_TRY_GOOGLE =1 이면 로컬 Google 버튼 실측(기본 0 — 진짜 구글 이동시 SKIP 규칙)
 *
 * 안전 규칙(내장):
 *   - 딥스캔 신규 실행/OCR 업로드/결제/탈퇴/포트폴리오 변경 액션은 일절 클릭하지 않는다.
 *   - '종목 제거', '로그아웃', '회원 탈퇴', '충전', '시작하기' 라벨 요소는 클릭 금지 목록으로 차단.
 *   - 종료 시 브라우저 세션을 close 한다.
 *
 * 판정: PASS / FAIL / WARN(관찰·경계) / SKIP(제약) — FAIL 있으면 exit code 1.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

// ---------------- 설정 ----------------
const BB_BASE_URL = (process.env.BB_BASE_URL || 'https://jaroo-dev.up.railway.app').replace(/\/+$/, '');
const LOCAL_URL = (process.env.LOCAL_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');
const BB_BASIC_AUTH = process.env.BB_BASIC_AUTH || '';
const SESSION = process.env.BB_SESSION || 'jaroo-bb-data';
const EXPAND_ROWS = process.env.BB_EXPAND_ROWS === '1';
const LOCAL_TRY_GOOGLE = process.env.BB_LOCAL_TRY_GOOGLE === '1';
const NOW = new Date(); // 판정 기준 시각(실행 머신 로컬 타임 = KST)

const GROUPS = ['pre', 'portfolio', 'market', 'datetime', 'deepscan', 'ocr', 'empty', 'local'];
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let selected = argv.length ? argv : ['all'];
if (selected.includes('all')) selected = GROUPS.slice();
for (const g of selected) {
  if (!GROUPS.includes(g)) {
    console.error(`알 수 없는 그룹: ${g} (가능: ${GROUPS.join(' ')})`);
    process.exit(2);
  }
}

// ---------------- 결과 수집 ----------------
const results = [];
function report(id, verdict, msg) {
  results.push({ id, verdict, msg });
  console.log(`[${id}][${verdict}] ${msg}`);
}
const summary = () => {
  const c = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const r of results) c[r.verdict]++;
  return c;
};
const clip = (s, n = 90) => String(s == null ? '' : s).replace(/\s+/g, ' ').slice(0, n);

// ---------------- agent-browser 래퍼 ----------------
function findAgentBrowser() {
  const candidates = [
    process.env.AGENT_BROWSER,
    '/home/pinion/.npm-global/bin/agent-browser',
    `${process.env.HOME || '/home'}/.npm-global/bin/agent-browser`,
    'agent-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c.includes('/')) {
      try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {}
    } else {
      try { execFileSync('which', [c], { stdio: 'ignore' }); return c; } catch {}
    }
  }
  return null;
}
const AB = findAgentBrowser();
if (!AB) {
  console.error('agent-browser 실행 파일을 찾을 수 없습니다. AGENT_BROWSER 환경변수로 지정하세요.');
  process.exit(2);
}

function ab(args, { timeoutMs = 60000, tolerant = true } = {}) {
  try {
    const out = execFileSync(AB, ['--session-name', SESSION, ...args], {
      timeout: timeoutMs,
      encoding: 'utf8',
    });
    return { ok: true, out: String(out) };
  } catch (e) {
    // open 은 load 이벤트 지연으로 exit 1 이 나도 실제 이동은 성공하는 경우가 있어 tolerant 기본값 사용
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function ev(js, { timeoutMs = 30000 } = {}) {
  const r = ab(['eval', js], { timeoutMs });
  let s = (r.out || '').trim();
  if (s.startsWith('"') && s.endsWith('"')) { try { s = JSON.parse(s); } catch {} }
  return s;
}
function evJSON(js) {
  const s = ev(`JSON.stringify(${js})`);
  try { return JSON.parse(s); } catch { return null; }
}
function openURL(url, waitMs = 2500) {
  ab(['open', url], { timeoutMs: 45000 });
  sleep(waitMs);
}
const currentURL = () => ev('location.href');
const bodyText = () => ev('document.body.innerText');

// dev 자동로그인 (무반응 실측 이력 있음: 잔여 브라우저 상태에서 클릭 no-op → 클리어 후 복구)
function devLoginOnce() {
  const consent = refInfo(/필수|만 14세/);
  if (consent && !consent.checked) safeClick(consent.ref, consent.label);
  sleep(600);
  const g = refInfo(/^Google로 시작하기$/);
  if (!g) return { status: 'no-button' };
  safeClick(g.ref, g.label);
  sleep(4500);
  const href = currentURL();
  if (/accounts\.google\.com/.test(href)) return { status: 'real-google', href };
  openURL(`${BB_BASE_URL}/home`, 2500);
  const t = bodyText();
  const guest = /(^|\n)게스트(\n|$)/.test(t || '');
  if (!guest && !/Google로 시작하기/.test(t || '')) return { status: 'ok', text: t };
  return { status: 'noop', text: t, href };
}
function devLogin() {
  let r = devLoginOnce();
  if (r.status === 'noop') {
    // 2회차: 쿠키/스토리지 클리어 후 재시도 (실측 복구 절차)
    ab(['cookies', 'clear']);
    openURL(`${BB_BASE_URL}/login`, 2000);
    ev("try{localStorage.clear();sessionStorage.clear();'ok'}catch(e){String(e)}");
    openURL(`${BB_BASE_URL}/login`, 2500);
    r = devLoginOnce();
  }
  return r;
}

// 스냅샷에서 라벨 regex 에 맞는 요소의 ref 찾기 (버튼/링크/체크박스)
function refInfo(labelRe) {
  const snap = (ab(['snapshot']) || { out: '' }).out || '';
  for (const line of snap.split('\n')) {
    const m = line.match(/\[ref=(e\d+)\]/);
    if (!m) continue;
    const lbl = line.match(/- (?:button|link|checkbox) "([^"]+)"/);
    if (lbl && labelRe.test(lbl[1].replace(/\n/g, ' '))) {
      return { ref: '@' + m[1], label: lbl[1], checked: /\[checked=true/.test(line), line };
    }
  }
  return null;
}
const CLICK_DENY = [/종목 제거/, /로그아웃/, /회원 탈퇴/, /충전/, /^시작하기$/, /업로드/, /올리기/, /제거/, /삭제/];
function safeClick(ref, labelForLog) {
  if (labelForLog && CLICK_DENY.some((re) => re.test(labelForLog))) {
    throw new Error(`클릭 금지 목록 일치: ${labelForLog}`);
  }
  return ab(['click', ref]);
}

// ---------------- 파서 ----------------
const toNum = (s) => Number(String(s).replace(/,/g, '').replace(/−/g, '-').replace(/\+/g, ''));
const fmtInt = (n) => n.toLocaleString('ko-KR');
function parseWon(tok) {
  const m = String(tok).match(/([+−\-]?)([\d,]+)\s*원/);
  if (!m) return null;
  const v = toNum(m[2]);
  return m[1] === '-' || m[1] === '−' ? -v : v;
}
function parsePct(tok) {
  const m = String(tok).match(/([+−\-]?)(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] === '-' || m[1] === '−' ? -v : v;
}

// 상식 범위표 (출처: 공개 사실 기반 — 문서 TC-blackbox-data.md 참조)
const PRICE_RANGES = [
  { re: /삼성전자/, min: 50000, max: 300000 },        // 과제 기준 공개 사실 범위
  { re: /KODEX\s*코스피/, min: 10000, max: 100000 },  // KOSPI 추종 ETF, 지수 2~5천 수준 공개 사실
  { re: /./, min: 100, max: 10000000 },               // 국내 상장 유가증권 일반 상식 한도
];
function priceRangeFor(name) {
  for (const r of PRICE_RANGES) if (r.re.test(name)) return r;
  return PRICE_RANGES[PRICE_RANGES.length - 1];
}

// ---------------- Dev 공통 플로우 ----------------
function devLoginURL() {
  if (!BB_BASIC_AUTH) return `${BB_BASE_URL}/login`;
  return BB_BASE_URL.replace('://', `://${BB_BASIC_AUTH}@`) + '/login';
}

function collectSignColors() {
  return evJSON(`(() => {
    const out = [];
    for (const e of document.querySelectorAll('body *')) {
      if (e.childElementCount) continue;
      const t = (e.textContent || '').trim();
      if (t.length < 2 || t.length > 32) continue;
      if (!/^[+\\u2212-]\\d/.test(t)) continue;
      if (!/[%\\uc6d0]/.test(t)) continue;
      out.push({ t, c: getComputedStyle(e).color });
    }
    return out;
  })()`) || [];
}
function classifyColor(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
  if (!m) return null;
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  if (r >= 150 && r - g >= 50 && r - b >= 50) return 'red';
  if (b >= 150 && b - r >= 50 && b - g >= 30) return 'blue';
  return 'other';
}
function checkColorConvention(samples, id, where) {
  if (!samples.length) {
    report(id, 'SKIP', `${where}: 부호 값 요소 없음(관찰 대상 부재)`);
    return;
  }
  const pos = samples.filter((s) => /^[+]/.test(s.t));
  const neg = samples.filter((s) => /^[\u2212-]/.test(s.t));
  const bad = [];
  for (const s of pos) if (classifyColor(s.c) !== 'red') bad.push(`${s.t}=${s.c}(${classifyColor(s.c)})`);
  for (const s of neg) if (classifyColor(s.c) !== 'blue') bad.push(`${s.t}=${s.c}(${classifyColor(s.c)})`);
  if (bad.length) report(id, 'FAIL', `${where}: 한국 관행(상승 빨강/하락 파랑) 위반 — ${bad.slice(0, 4).join(', ')}`);
  else
    report(
      id,
      'PASS',
      `${where}: 상승 ${pos.length}건 모두 적색, 하락 ${neg.length}건 모두 청색 (예: ${pos[0] ? pos[0].t + '=' + pos[0].c : '-'} / ${neg[0] ? neg[0].t + '=' + neg[0].c : '-'})`
    );
}

function extractLoginSamples(text) {
  // 로그인 마케팅 예시: "종목명\n±x.x%" 3연속 (출처: 화면 관찰)
  const map = {};
  const lines = String(text || '').split('\n').map((s) => s.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^[+−\-]?\d+(?:\.\d+)?%$/.test(lines[i + 1]) && /[\uac00-\ud7a3A-Za-z]/.test(lines[i]) && lines[i].length <= 12) {
      map[lines[i]] = lines[i + 1];
    }
  }
  return map;
}

function extractPortfolio() {
  return evJSON(`(() => {
    const text = document.body.innerText;
    const articles = [...document.querySelectorAll('article')].map(a => a.innerText);
    const navLinks = [...document.querySelectorAll('nav a')].map(a => (a.innerText || '').trim());
    return { url: location.href, text, articles, navLinks };
  })()`);
}
function parseSummary(text) {
  const totalM = /총 평가액\s*\n\s*([\d,]+)\s*원/.exec(text || '');
  const pnlM = /([+−\-][\d,]+)\s*원\s*·\s*([+−\-]?\d+(?:\.\d+)?)\s*%/.exec(text || '');
  if (!totalM) return null;
  return {
    totalVal: toNum(totalM[1]),
    totalPnl: pnlM ? parseWon(pnlM[1] + '원') : null,
    totalPct: pnlM ? parsePct(pnlM[2] + '%') : null,
  };
}
function parseArticleRow(txt) {
  const lines = String(txt || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const name = lines[0] || '';
  const qtyM = /(?:^|\s)(\d+)\s*주\b/.exec(txt || '');
  const pctM = /([+−\-]\d+(?:\.\d+)?)\s*%/.exec(txt || '');
  const wonM = /([+−\-][\d,]+)\s*원/.exec(txt || '');
  const label = /(손실|수익|이익)/.exec(txt || '');
  return {
    name,
    qty: qtyM ? Number(qtyM[1]) : null,
    pct: pctM ? parsePct(pctM[1] + '%') : null,
    pnl: wonM ? parseWon(wonM[1] + '원') : null,
    label: label ? label[1] : null,
  };
}

function residueScan(text) {
  const hits = [];
  const strong = [/NaN\s*원/, /undefined\s*원/, /Infinity\s*%?/, /NaN\s*%/];
  for (const re of strong) {
    const m = re.exec(text || '');
    if (m) hits.push(m[0]);
  }
  if (/\bNaN\b/.test(text || '')) hits.push('NaN');
  if (/\bundefined\b/.test(text || '')) hits.push('undefined');
  return [...new Set(hits)];
}

function scanDates(texts) {
  const all = texts.filter(Boolean).join('\n');
  const dates = [];
  const re = /(\d{4})\s*([.\-\/])\s*(\d{1,2})\s*([.\-\/])\s*(\d{1,2})/g;
  let m;
  while ((m = re.exec(all))) {
    dates.push({ raw: m[0], sep: m[2], y: +m[1], mo: +m[3], d: +m[5] });
  }
  const times = (all.match(/\b\d{1,2}:\d{2}\b/g) || []).slice(0, 10);
  const relatives = (all.match(/방금|금일|오늘|어제|이번 주|지난 주|\d+\s*(?:초|분|시간|일|주|개월|년)\s*전/g) || []).slice(0, 10);
  return { dates, times, relatives, all };
}

// ---------------- 그룹 실행 ----------------
async function main() {
  console.log(`# jaroo 블랙박스 데이터 신뢰성 TC — ${NOW.toISOString()}`);
  console.log(`# dev=${BB_BASE_URL} local=${LOCAL_URL} 세션=${SESSION} 그룹=${selected.join(',')}`);
  if (!BB_BASIC_AUTH) console.log('# 경고: BB_BASIC_AUTH 미설정 — dev Basic Auth 통과가 안 되면 로그인 단계 실패 가능');
  console.log('');

  // ===== 공통 상태 =====
  let loginSamples = {};
  let loginColors = [];
  let pf = null; // 포트폴리오 추출
  let homeText = '';
  let mypageText = '';
  let historyText = '';
  let historyLoaded = false;
  let watchText = '';
  let ocrText = '';
  let localSamples = {};

  // ===== pre =====
  if (selected.includes('pre')) {
    openURL(devLoginURL(), 3000);
    const devLoginText = bodyText();
    loginSamples = extractLoginSamples(devLoginText);
    loginColors = collectSignColors();
    const r = devLogin();
    if (r.status === 'ok') report('TC-BBD-001', 'PASS', `dev 자동로그인 확인(/home 인증 진입, 진짜 구글 아님) — ${clip(r.text, 50)}`);
    else if (r.status === 'real-google') report('TC-BBD-001', 'SKIP', `진짜 Google OAuth로 이동함(규칙: SKIP+보고) — ${clip(r.href, 70)}`);
    else if (r.status === 'noop')
      report('TC-BBD-001', 'FAIL', `dev "Google로 시작하기" 클릭 무반응(침묵 실패) — 네트워크 요청/에러 표시 없이 /login 잔류, 상태 클리어 재시도에도 실패. 실측: 잔여 쿠키/스토리지 상태에서 간헐 발생, 전량 클리어로 복구된 사례 있음`);
    else report('TC-BBD-001', 'WARN', `로그인 버튼 미발견(이미 로그인 상태일 수 있음) — ${clip(devLoginText, 60)}`);
  } else {
    openURL(devLoginURL(), 3000); // 다른 그룹 진입용 세션 확보
    const t = bodyText();
    loginSamples = extractLoginSamples(t);
    loginColors = collectSignColors();
    if (/포트폴리오|총 평가액/.test(t) && !/Google로 시작하기/.test(t)) {
      // 이미 로그인 상태
    } else {
      devLogin();
    }
  }

  // ===== 홈/포트폴리오 =====
  openURL(`${BB_BASE_URL}/home`, 3000);
  pf = extractPortfolio() || { text: '', articles: [], navLinks: [] };
  homeText = pf.text || '';
  const sum = parseSummary(homeText);
  const rows = (pf.articles || []).map(parseArticleRow).filter((r) => r.name);
  const isEmptyHome = !rows.length;

  if (selected.includes('portfolio')) {
    // TC-BBD-002 총 평가액 천단위 콤마 포맷 (출처: 공개 금융 관행)
    if (!sum) {
      report('TC-BBD-002', 'SKIP', `보유 종목 요약 없음(빈 포트폴리오) — ${clip(homeText, 60)}`);
    } else {
      const m = /총 평가액\s*\n\s*([\d,]+)\s*원/.exec(homeText);
      const tok = m ? m[1] + '원' : '';
      if (/^\d{1,3}(,\d{3})*$/.test(m ? m[1] : '')) report('TC-BBD-002', 'PASS', `총 평가액 표기 "${tok}" — 천단위 콤마 정상`);
      else report('TC-BBD-002', 'FAIL', `총 평가액 표기 "${tok}" — 천단위 콤마 형식 위반`);
    }

    // TC-BBD-003 Σ종목 손익 = 총 손익 (출처: 산술 일관성)
    if (!sum || !sum.totalPnl || !rows.length) {
      report('TC-BBD-003', 'SKIP', '종목별 손익/총 손익 값이 화면에 없음(빈 포트폴리오)');
    } else {
      const s = rows.reduce((a, r) => a + (r.pnl || 0), 0);
      const diff = Math.abs(s - sum.totalPnl);
      report(
        'TC-BBD-003',
        diff <= 2 ? 'PASS' : 'FAIL',
        `Σ종목손익 ${fmtInt(s)}원 vs 총손익 ${fmtInt(sum.totalPnl)}원 (차 ${fmtInt(diff)}원)`
      );
    }

    // TC-BBD-004 총 손익률 = 총손익/총매입액, 매입액=평가액−손익 (출처: 산술 일관성)
    if (!sum || !sum.totalPnl || sum.totalPct == null) {
      report('TC-BBD-004', 'SKIP', '총 손익률/총 손익 값이 화면에 없음');
    } else {
      const cost = sum.totalVal - sum.totalPnl;
      const expect = (sum.totalPnl / cost) * 100;
      const diff = Math.abs(expect - sum.totalPct);
      report(
        'TC-BBD-004',
        diff <= 0.2 ? 'PASS' : 'FAIL',
        `총손익률 ${sum.totalPct}% vs 산출 ${expect.toFixed(2)}% (매입 ${fmtInt(cost)}원, 차 ${diff.toFixed(2)}p)`
      );
    }

    // TC-BBD-005 종목 라벨(손실/수익) ↔ 부호 정합 (출처: 산술 일관성)
    if (!rows.length) report('TC-BBD-005', 'SKIP', '종목 행 없음');
    else {
      const bad = rows.filter((r) => {
        const p = r.pnl != null ? r.pnl : r.pct;
        if (p == null || !r.label) return false;
        const isLoss = r.label === '손실';
        return isLoss ? p >= 0 : p <= 0;
      });
      report(
        'TC-BBD-005',
        bad.length ? 'FAIL' : 'PASS',
        bad.length
          ? `라벨/부호 불일치: ${bad.map((r) => `${r.name}(${r.label}/${r.pnl ?? r.pct})`).slice(0, 3).join(', ')}`
          : `종목 ${rows.length}건 라벨·부호 정합`
      );
    }

    // TC-BBD-006 색 규약 (출처: 공개 금융 관행 — 한국 상승 빨강/하락 파랑)
    if (!isEmptyHome) {
      openURL(`${BB_BASE_URL}/home`, 1500);
      const cols = collectSignColors();
      checkColorConvention(cols, 'TC-BBD-006', '홈');
    } else {
      checkColorConvention(loginColors, 'TC-BBD-006', '로그인(보유 데이터 없어 예시 카드로 관찰)');
    }

    // TC-BBD-007 부호 글리프 일관성 (U+2212 − vs ASCII -) (출처: 표기 일관성 관찰)
    {
      const src = `${homeText}\n${Object.keys(loginSamples).map((k) => loginSamples[k]).join('\n')}`;
      const typographic = (/−\d/.exec(src) || []).length;
      const ascii = (/-\d/.exec(src) || []).length;
      if (!typographic && !ascii) report('TC-BBD-007', 'SKIP', '부호 값 관찰 불가');
      else if (typographic && ascii)
        report('TC-BBD-007', 'WARN', `부호 글리프 혼용 관찰: U+2212(−)와 ASCII(-) 동시 사용 (출처: 화면 관찰, 로그인/홈 혼용)`);
      else report('TC-BBD-007', 'PASS', `부호 글리프 단일 사용(${typographic ? 'U+2212 −' : 'ASCII -'})`);
    }

    // TC-BBD-008 (옵션) 확장행 정합: 평가금액=수량×현재가 (출처: 산술 일관성)
    if (!EXPAND_ROWS) report('TC-BBD-008', 'SKIP', 'BB_EXPAND_ROWS=1 미설정 — 행 확장 클릭 회피(안전 기본값)');
    else if (!rows.length) report('TC-BBD-008', 'SKIP', '종목 행 없음');
    else {
      openURL(`${BB_BASE_URL}/home`, 2000);
      const info = refInfo(new RegExp(rows[0].name.slice(0, 8)));
      let verdict = 'SKIP';
      let msg = '확장 실패';
      if (info) {
        safeClick(info.ref, info.label);
        sleep(1500);
        const t = bodyText();
        const cur = parseWon(/현재가\s*\n\s*([\d,]+)\s*원/.exec(t)?.[1] + '원');
        const avg = parseWon(/평단\s*\n\s*([\d,]+)\s*원/.exec(t)?.[1] + '원');
        const val = parseWon(/평가금액\s*\n\s*([\d,]+)\s*원/.exec(t)?.[1] + '원');
        if (cur && val) {
          const expect = rows[0].qty * cur;
          const diff = Math.abs(expect - val);
          verdict = diff <= 2 ? 'PASS' : 'FAIL';
          msg = `${rows[0].name}: ${rows[0].qty}주×현재가${fmtInt(cur)}=${fmtInt(expect)} vs 평가금액${fmtInt(val)} (차 ${fmtInt(diff)}원, 평단 ${avg ? fmtInt(avg) : 'n/a'})`;
        } else msg = `확장행 값 추출 실패 — ${clip(t, 70)}`;
      }
      report('TC-BBD-008', verdict, msg);
    }
  }

  // ===== market =====
  if (selected.includes('market')) {
    // TC-BBD-009 대표 종목 가격 상식 범위 (출처: 공개 사실 — 삼성전자 5만~30만원 등)
    {
      let checked = 0;
      const bad = [];
      // 행이 확장된 직후라면 최신 본문에 현재가가 있다(접힌 상태면 SKIP)
      const srcTexts = [homeText, bodyText()];
      for (const t of srcTexts) {
        const curM = /현재가\s*\n\s*([\d,]+)\s*원/.exec(t || '');
        if (curM) {
          checked++;
          const v = toNum(curM[1]);
          const row = rows[0] || { name: '(첫 행)' };
          const range = priceRangeFor(row.name || '');
          if (v < range.min || v > range.max) bad.push(`${row.name} 현재가 ${fmtInt(v)}원 (범위 ${fmtInt(range.min)}~${fmtInt(range.max)})`);
          break;
        }
      }
      if (!checked) report('TC-BBD-009', 'SKIP', '현재가 노출 화면 없음(행 확장 필요 — 빈 포트폴리오/접힌 상태)');
      else if (bad.length) report('TC-BBD-009', 'FAIL', `상식 범위 이탈: ${bad.join('; ')}`);
      else report('TC-BBD-009', 'PASS', `현재가 ${checked}건 상식 범위 내`);
    }

    // TC-BBD-010 등락/손익률 상식 한도 (출처: 상식 — 일중 등락 ±30% 이상 표시는 오류 신호, 보유 손익률 |·|≤100%)
    {
      const pcts = [];
      for (const r of rows) if (r.pct != null) pcts.push({ ctx: `종목:${r.name}`, v: r.pct });
      if (sum && sum.totalPct != null) pcts.push({ ctx: '총손익률', v: sum.totalPct });
      for (const k of Object.keys(loginSamples)) pcts.push({ ctx: `로그인예시:${k}`, v: parsePct(loginSamples[k]) });
      if (!pcts.length) report('TC-BBD-010', 'SKIP', '백분율 값 관찰 불가');
      else {
        const bad = pcts.filter((p) => p.v == null || Math.abs(p.v) > 100);
        if (bad.length)
          report('TC-BBD-010', 'WARN', `|±100%| 초과 값 관찰(누적 보유손익은 상품 특성상 가능 — 목적은 일중 등락 오류 탐지): ${bad.map((b) => `${b.ctx}=${b.v}%`).slice(0, 4).join(', ')}`);
        else report('TC-BBD-010', 'PASS', `백분율 ${pcts.length}건 모두 |±100%| 이내`);
      }
    }

    // TC-BBD-011 시세 기준 시각 표시 (출처: 공개 금융 관행 — 시세에는 기준 시각 표시)
    {
      const t = homeText || '';
      const hasTime = /\b\d{1,2}:\d{2}\b/.test(t) || /기준/.test(t);
      if (!rows.length) report('TC-BBD-011', 'SKIP', '보유 종목 없음 — 시세 기준 시각 관찰 대상 부재');
      else if (hasTime) report('TC-BBD-011', 'PASS', '기준 시각/시각 표기 관찰됨');
      else report('TC-BBD-011', 'WARN', '홈 시세 영역에 기준 시각 표시 없음(관찰) — "시세 새로고침" 버튼만 존재');
    }
  }

  // ===== mypage / history / watchlist / ocr 데이터 수집 =====
  // 인증 상태 확인(mypage 접근) — 게스트/미인증이면 수집 SKIP 처리
  const authOK = (() => {
    openURL(`${BB_BASE_URL}/mypage`, 2200);
    const t = bodyText();
    return /로그아웃|user id/.test(t || '') && !/Google로 시작하기/.test(t || '');
  })();
  if (!authOK) console.log('# 주의: 인증 세션 확보 실패(자동로그인 무반응 가능) — mypage/이력/워치 수집은 SKIP 처리됨');
  if ((selected.includes('empty') || selected.includes('datetime')) && authOK) {
    mypageText = bodyText(); // authOK 프로브가 이미 mypage에 있음
  }
  if ((selected.includes('deepscan') || selected.includes('datetime')) && authOK) {
    openURL(`${BB_BASE_URL}/mypage/history`, 3000);
    historyText = bodyText();
    historyLoaded = /분석 기록/.test(historyText || '') && !/기록을 불러오지 못했어요/.test(historyText || '');
  }
  if (selected.includes('empty') && authOK) {
    openURL(`${BB_BASE_URL}/mypage/watchlist`, 2500);
    watchText = bodyText();
  }
  if (selected.includes('ocr')) {
    openURL(`${BB_BASE_URL}/screenshot`, 2500);
    ocrText = bodyText();
  }

  // ===== datetime =====
  if (selected.includes('datetime')) {
    const { dates, times, relatives } = scanDates([homeText, mypageText, historyText]);
    // TC-BBD-012 날짜 포맷 일관성
    if (!dates.length) report('TC-BBD-012', 'SKIP', '표시된 절대 날짜 없음(상대 표현만 관찰' + (relatives.length ? `: ${relatives.slice(0, 3).join(', ')}` : '') + ')');
    else {
      const seps = new Set(dates.map((d) => d.sep));
      if (seps.size > 1) report('TC-BBD-012', 'WARN', `날짜 구분자 혼용: ${[...seps].join(' vs ')} — ${dates.slice(0, 3).map((d) => d.raw).join(', ')}`);
      else report('TC-BBD-012', 'PASS', `날짜 포맷 단일(${[...seps][0]}) — ${dates.slice(0, 3).map((d) => d.raw).join(', ')}`);
    }
    // TC-BBD-013 미래 날짜 부재
    if (!dates.length) report('TC-BBD-013', 'SKIP', '검사할 날짜 표시 없음');
    else {
      const limit = new Date(NOW.getTime() + 2 * 864e5);
      const future = dates.filter((d) => {
        const dt = new Date(d.y, d.mo - 1, d.d);
        return dt > limit || d.y < 1990 || d.y > 2100;
      });
      report('TC-BBD-013', future.length ? 'FAIL' : 'PASS', future.length ? `명백 오류 날짜: ${future.map((d) => d.raw).join(', ')}` : `날짜 ${dates.length}건 정상 범위(미래/과거 이상 없음)`);
    }
    // TC-BBD-014 상대/절대 혼용
    if (dates.length && relatives.length) report('TC-BBD-014', 'WARN', `상대(${relatives.slice(0, 2).join(',')})와 절대 날짜 혼용 관찰`);
    else if (relatives.length) report('TC-BBD-014', 'PASS', `상대 표현만 사용: ${relatives.slice(0, 3).join(', ')}`);
    else if (dates.length) report('TC-BBD-014', 'PASS', '절대 날짜만 사용(혼용 없음)');
    else report('TC-BBD-014', 'SKIP', '날짜/상대 표현 관찰 부재');
  }

  // ===== deepscan (읽기 전용) =====
  if (selected.includes('deepscan')) {
    // TC-BBD-015 이력 로드
    if (!historyText) report('TC-BBD-015', 'SKIP', '이력 페이지 미수집(인증 세션 확보 실패)');
    else if (!/분석 기록/.test(historyText)) report('TC-BBD-015', 'SKIP', `페이지가 분석 기록이 아님(리다이렉트) — ${clip(historyText, 60)}`);
    else if (/기록을 불러오지 못했어요/.test(historyText))
      report('TC-BBD-015', 'FAIL', `분석 기록 페이지 로드 실패 화면 — "기록을 불러오지 못했어요. 잠시 후 다시 시도해주세요." (유효 세션에서도 지속, 이력 값 관찰 불가)`);
    else report('TC-BBD-015', 'PASS', `이력 페이지 로드됨 — ${clip(historyText, 60)}`);

    const t = historyText || '';
    const hasEntries = historyLoaded && !/등록된|없어요/.test(t);
    // TC-BBD-016 점수 0~100
    if (!hasEntries) report('TC-BBD-016', 'SKIP', '이력 항목 없음(로드 실패 또는 빈 이력)');
    else {
      const scores = [...t.matchAll(/(?:점수|매력)\D{0,6}(\d{1,3})/g)].map((m) => +m[1]);
      const bad = scores.filter((s) => s < 0 || s > 100);
      if (!scores.length) report('TC-BBD-016', 'WARN', '점수 표기 발견 안 됨(이력은 존재)');
      else if (bad.length) report('TC-BBD-016', 'FAIL', `점수 범위 이탈: ${bad.join(', ')}`);
      else report('TC-BBD-016', 'PASS', `점수 ${scores.length}건 모두 0~100 (${scores.slice(0, 5).join(', ')})`);
    }
    // TC-BBD-017 목표가 상식 범위 (현재가 100배 등은 오류 신호)
    if (!hasEntries) report('TC-BBD-017', 'SKIP', '이력 항목 없음');
    else {
      const targets = [...t.matchAll(/목표가?\D{0,10}([\d,]+)\s*원/g)].map((m) => toNum(m[1]));
      const curs = [...t.matchAll(/현재가\D{0,10}([\d,]+)\s*원/g)].map((m) => toNum(m[1]));
      if (!targets.length) report('TC-BBD-017', 'WARN', '목표가 표기 없음(이력은 존재)');
      else {
        const bad = targets.filter((v) => v < 1000 || v > 1e8 || (curs.length && curs.some((c) => v / c > 20 || v / c < 0.1)));
        if (bad.length) report('TC-BBD-017', 'FAIL', `목표가 상식 이탈(현재가 대비 0.1~20배 밖 또는 절대값 이상): ${bad.map(fmtInt).join(', ')}원`);
        else report('TC-BBD-017', 'PASS', `목표가 ${targets.length}건 상식 범위 내`);
      }
    }
    // TC-BBD-018 퍼센트 범위
    if (!hasEntries) report('TC-BBD-018', 'SKIP', '이력 항목 없음');
    else {
      const pcts = [...t.matchAll(/([+−\-]?\d+(?:\.\d+)?)\s*%/g)].map((m) => parsePct(m[1] + '%')).filter((v) => v != null);
      const bad = pcts.filter((v) => v < -100 || v > 1000);
      if (bad.length) report('TC-BBD-018', 'FAIL', `퍼센트 이상값: ${bad.join(', ')}%`);
      else report('TC-BBD-018', 'PASS', `퍼센트 ${pcts.length}건 범위 내(-100~1000%)`);
    }
    // TC-BBD-019 통화 혼동
    {
      const dollar = /\$\s*\d|\d\s*(?:USD|달러)/.test(t);
      const won = /원/.test(t);
      if (!hasEntries) report('TC-BBD-019', 'SKIP', '이력 항목 없음');
      else if (dollar && won) report('TC-BBD-019', 'WARN', '$ 표기와 원 표기 동시 존재 — 통화 혼동 가능 관찰');
      else report('TC-BBD-019', 'PASS', '통화 표기 단일(원화만 관찰)');
    }
  }

  // ===== ocr (읽기 전용 — 업로드 금지) =====
  if (selected.includes('ocr')) {
    const t = ocrText || '';
    // 가이드/이력 공용 패턴: 종목명 \n N주 \n 콤마원 \n ±%
    const lines = t.split('\n').map((s) => s.trim());
    const items = [];
    for (let i = 0; i < lines.length - 3; i++) {
      if (/^\d+\s*주$/.test(lines[i + 1]) && /^[\d,]+\s*원$/.test(lines[i + 2]) && /^[+−\-]?\d+(?:\.\d+)?%$/.test(lines[i + 3])) {
        items.push({ name: lines[i], qty: Number(lines[i + 1].replace(/\s*주/, '')), val: parseWon(lines[i + 2]), pct: parsePct(lines[i + 3]) });
      }
    }
    // TC-BBD-020 인식 결과 포맷
    if (!items.length) report('TC-BBD-020', 'SKIP', `OCR 인식 결과 형식 항목 없음 — ${clip(t, 60)}`);
    else {
      const fmtBad = items.filter((it) => it.val == null || it.pct == null || !it.qty);
      if (fmtBad.length) report('TC-BBD-020', 'FAIL', `포맷 이상 항목: ${fmtBad.map((it) => it.name).join(', ')}`);
      else report('TC-BBD-020', 'PASS', `인식 포맷 정상 ${items.length}건: ${items.map((it) => `${it.name}/${it.qty}주/${fmtInt(it.val)}원/${it.pct}%`).slice(0, 3).join(' · ')}`);
    }
    // TC-BBD-021 예시 값 상식 (삼성전자 5만~30만원 — 과제 기준 공개 사실)
    {
      const ss = items.find((it) => /삼성전자/.test(it.name));
      if (!ss) report('TC-BBD-021', 'SKIP', '삼성전자 예시 항목 없음');
      else {
        const r = priceRangeFor('삼성전자');
        const v = ss.qty === 1 ? ss.val : ss.val; // 1주면 평가금액=단가
        if (v < r.min || v > r.max)
          report('TC-BBD-021', 'WARN', `가이드 예시 삼성전자 ${fmtInt(v)}원(${ss.qty}주) — 상식 범위 ${fmtInt(r.min)}~${fmtInt(r.max)}원 초과 (정적 예시 문구라 FAIL 대신 WARN)`);
        else report('TC-BBD-021', 'PASS', `삼성전자 예시 ${fmtInt(v)}원 — 범위 내`);
      }
    }
  }

  // ===== empty (dev + local) =====
  if (selected.includes('empty')) {
    // TC-BBD-022 dev 빈 포트폴리오 잔여값
    if (!isEmptyHome) report('TC-BBD-022', 'SKIP', `보유 종목 ${rows.length}건 존재 — 빈 상태 아님`);
    else {
      const hits = residueScan(homeText);
      report('TC-BBD-022', hits.length ? 'FAIL' : 'PASS', hits.length ? `NaN/undefined/Infinity 잔여: ${hits.join(', ')}` : '빈 홈 텍스트에 NaN/undefined/Infinity/0원 잔여 없음');
    }
    // TC-BBD-023 빈 상태 안내·CTA (+ 워치 빈 상태 위생)
    if (!isEmptyHome) report('TC-BBD-023', 'SKIP', '빈 상태 아님');
    else {
      const guide = /포트폴리오 준비/.test(homeText) && /스크린샷 추가하기/.test(homeText);
      const watchLoadingTogether = watchText ? /불러오는 중/.test(watchText) && /없어요/.test(watchText) : false;
      if (!guide) report('TC-BBD-023', 'FAIL', `빈 상태 안내/CTA 미흡 — ${clip(homeText, 80)}`);
      else if (watchLoadingTogether)
        report('TC-BBD-023', 'WARN', `홈 빈 상태 안내+CTA는 정상. 단, 워치(/mypage/watchlist)에서 "불러오는 중이에요…" 로딩 문구와 "등록된 종목이 없어요" 빈 상태 문구가 동시 표시됨 — 상태 표시 위생 이슈`);
      else report('TC-BBD-023', 'PASS', '빈 상태 안내+CTA 정상(홈·워치 모두 잔여 문구 없음)');
    }
    // TC-BBD-024 mypage 수치 미정 표시 관찰
    {
      const m = mypageText || '';
      if (!m || !/딥스캔/.test(m)) report('TC-BBD-024', 'SKIP', `mypage 미수집 또는 페이지 아님(인증 세션 문제) — ${clip(m, 50)}`);
      else if (/딥스캔\s*[—–-]\s*회|보유 크레딧\s*[—–-]\s*cr/.test(m.replace(/\n/g, ' ')))
        report('TC-BBD-024', 'WARN', `수치 미정 표시 관찰: "딥스캔 —회 / 보유 크레딧 —cr" (0도 아닌 미상태 — 숫자 아님)`);
      else report('TC-BBD-024', 'PASS', `mypage 수치 표기 정상 — ${clip(m, 60)}`);
    }
    // TC-BBD-027 빈 홈 하단 네비 부재 관찰
    if (!isEmptyHome) report('TC-BBD-027', 'SKIP', '빈 상태 아님');
    else {
      const navCount = (pf.navLinks || []).length;
      report('TC-BBD-027', navCount === 0 ? 'WARN' : 'PASS', navCount === 0 ? '빈 포트폴리오 홈에서 하단 네비게이션 부재 — 다른 화면(워치/기록/마이) 탐색 불가(직접 URL로만 접근 가능)' : `하단 네비 ${navCount}건 존재`);
    }
  }

  // ===== local (빈 상태 영역만 — 재시작 금지) =====
  if (selected.includes('local')) {
    openURL(`${LOCAL_URL}/login`, 2500);
    const localLoginText = bodyText();
    localSamples = extractLoginSamples(localLoginText);

    // TC-BBD-025 게스트 빈 홈 잔여 부재 (크로스환경 일관성)
    {
      const consent = refInfo(/필수|만 14세/);
      if (consent && !consent.checked) safeClick(consent.ref, consent.label);
      sleep(600);
      const guest = refInfo(/게스트로 둘러보기/);
      if (!guest) report('TC-BBD-025', 'SKIP', `로컬 로그인 화면에 게스트 진입 없음 — ${clip(localLoginText, 60)}`);
      else {
        safeClick(guest.ref, guest.label);
        sleep(1500);
        openURL(`${LOCAL_URL}/home`, 2500);
        const t = bodyText();
        if (!/포트폴리오 준비|게스트/.test(t)) report('TC-BBD-025', 'SKIP', `게스트 홈 진입 불확실 — ${clip(t, 70)}`);
        else {
          const hits = residueScan(t);
          report('TC-BBD-025', hits.length ? 'FAIL' : 'PASS', hits.length ? `로컬 게스트 빈 홈 잔여: ${hits.join(', ')}` : `로컬 게스트 빈 홈 NaN/undefined/Infinity 잔여 없음 — ${clip(t, 60)}`);
        }
      }
    }

    // TC-BBD-026 로컬 Google 버튼 — 진짜 구글이면 SKIP (규칙)
    if (!LOCAL_TRY_GOOGLE) report('TC-BBD-026', 'SKIP', '사전 실측 결과 로컬 "Google로 시작하기"는 진짜 accounts.google.com OAuth로 이동(규칙: 진짜 구글이면 SKIP+보고). 스크립트는 클릭하지 않음(BB_LOCAL_TRY_GOOGLE=1로 실측 가능).');
    else {
      const consent = refInfo(/필수|만 14세/);
      if (consent && !consent.checked) safeClick(consent.ref, consent.label);
      sleep(500);
      const g = refInfo(/^Google로 시작하기$/);
      if (!g) report('TC-BBD-026', 'SKIP', 'Google 버튼 없음');
      else {
        safeClick(g.ref, g.label);
        sleep(4000);
        const href = currentURL();
        openURL(`${LOCAL_URL}/login`, 1000); // 즉시 복귀(계정 선택 수행 금지)
        if (/accounts\.google\.com/.test(href)) report('TC-BBD-026', 'SKIP', `진짜 Google OAuth 이동 확인 — ${clip(href, 60)} (계정 선택 없이 복귀)`);
        else report('TC-BBD-026', 'PASS', `로컬 자동로그인 동작 — ${clip(href, 60)}`);
      }
    }

    // TC-BBD-028 로그인 예시 숫자 dev↔local 일관성 (크로스환경 일관성)
    {
      const devK = Object.keys(loginSamples).sort();
      const locK = Object.keys(localSamples).sort();
      if (!devK.length || !locK.length) report('TC-BBD-028', 'SKIP', `예시 숫자 수집 불가(dev ${devK.length}건/local ${locK.length}건)`);
      else {
        const same = devK.length === locK.length && devK.every((k) => loginSamples[k] === localSamples[k]);
        report('TC-BBD-028', same ? 'PASS' : 'WARN', same ? `로그인 예시 숫자 동일: ${devK.map((k) => `${k} ${loginSamples[k]}`).join(', ')}` : `예시 불일치 — dev: ${devK.map((k) => `${k}=${loginSamples[k]}`).join(',')} / local: ${locK.map((k) => `${k}=${localSamples[k]}`).join(',')}`);
      }
    }
  } else if (selected.includes('pre')) {
    // local 미선정 시에도 크로스환경 비교는 pre 에서 (로그인 페이지만 읽기, 클릭 없음)
    openURL(`${LOCAL_URL}/login`, 2500);
    const lt = bodyText();
    localSamples = extractLoginSamples(lt);
    const devK = Object.keys(loginSamples).sort();
    const locK = Object.keys(localSamples).sort();
    if (devK.length && locK.length) {
      const same = devK.length === locK.length && devK.every((k) => loginSamples[k] === localSamples[k]);
      report('TC-BBD-028', same ? 'PASS' : 'WARN', same ? `로그인 예시 숫자 동일: ${devK.map((k) => `${k} ${loginSamples[k]}`).join(', ')}` : `예시 불일치 — dev: ${devK.map((k) => loginSamples[k]).join(',')} / local: ${locK.map((k) => localSamples[k]).join(',')}`);
    } else report('TC-BBD-028', 'SKIP', `예시 수집 불가(dev ${devK.length}/local ${locK.length})`);
  }

  // ===== 종료 =====
  const c = summary();
  console.log('');
  console.log('=== 요약 ===');
  console.log(`PASS ${c.PASS} / FAIL ${c.FAIL} / WARN ${c.WARN} / SKIP ${c.SKIP} — 총 ${results.length} TC`);
  for (const r of results.filter((x) => x.verdict === 'FAIL')) console.log(`!! FAIL: [${r.id}] ${r.msg}`);
  ab(['close']);
  process.exit(c.FAIL ? 1 : 0);
}

main().catch((e) => {
  console.error('스크립트 오류:', e && e.message);
  ab(['close']);
  process.exit(2);
});
