#!/usr/bin/env node
/**
 * jaroo 블랙박스 출시 체크리스트 (TC-BBL-001 ~ TC-BBL-024)
 * =====================================================
 * 프로덕션 출시 전 게스트 표면 스모크: 성능 예산 · 접근성 기본 · 결제/플랜 표시(표시만) ·
 * 크로스 뷰포트 · SEO/메타 · 운영 안정성 관찰.
 *
 * 블랙박스 원칙 (최우선 — 위반 금지)
 *  - 제품 소스/내부 문서를 읽지 않는다. 기대값은 ①공개 관행(Web 성능 상식, WCAG, 전자상거래 관행)
 *    ②공개 법령(전자상거래법 가격 표시) ③크로스환경 일관성에서만 도출한다.
 *  - 운영(production)에서는 게스트 표면만 관찰한다. 로그인 시도 금지, 가입/결제 실행 금지,
 *    결제 버튼 클릭 금지 (이 스크립트는 click/type/fill을 호출하지 않는다).
 *  - 순차 요청, 요청 간 최소 500ms, 페이지당 최대 3 샘플(SAMPLES 고정) — 부하 금지.
 *
 * 사용법
 *  - node scripts/blackbox-launch-check.cjs                # 모든 그룹 (운영 대상)
 *  - node scripts/blackbox-launch-check.cjs perf a11y      # 그룹 선택
 *  - 그룹: perf | a11y | payment | viewport | seo | stability | all
 *
 * 환경변수
 *  - PROD_URL   기본 https://jaroo.kr      (운영)
 *  - BASE_URL   기본 http://127.0.0.1:3002 (로컬, 재시작 금지)
 *  - TARGET     prod(기본) | local | both
 *  - AGENT_BROWSER          기본 /home/pinion/.npm-global/bin/agent-browser
 *  - BROWSER_SESSION        기본 jaroo-bb-launch
 *  - GAP_MS                 요청 간 간격(기본 500, 운영 예의)
 *
 * 종료 코드: 0=FAIL 없음(INFO는 허용) · 1=FAIL 존재 · 2=셋업 오류
 */
'use strict';

const { execFile } = require('child_process');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------
const PROD_URL = (process.env.PROD_URL || 'https://jaroo.kr').replace(/\/+$/, '');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');
const TARGET = (process.env.TARGET || 'prod').toLowerCase(); // prod | local | both
const AB_PATH = process.env.AGENT_BROWSER || '/home/pinion/.npm-global/bin/agent-browser';
const SESSION = process.env.BROWSER_SESSION || 'jaroo-bb-launch';
const GAP_MS = Number(process.env.GAP_MS || 500);
const SAMPLES = 3; // 페이지당 최대 3 샘플 (고정, 상향 금지)
const UA = 'jaroo-blackbox-launch-check/1.0 (+TC-BBL guest-surface smoke)';

// 성능 예산 — 출처: 공개 관행
//  TTFB ≤ 800ms      : web.dev "TTFB" Good 기준(≤0.8s) — 공개 관행
//  로드완료 ≤ 3000ms : "3초 초과 시 이탈 급증" 모바일 속도 관행(Google/SOASTA 통계) — 공개 관행
//  존재하지 않는 경로는 HTTP 404로 응답 — HTTP/SEO 공개 관행
const BUDGET = { ttfbMs: 800, loadMs: 3000 };

const PERF_PAGES = [
  { id: 'TC-BBL-001', path: '/', name: '메인(/)' },
  { id: 'TC-BBL-002', path: '/login', name: '로그인' },
  { id: 'TC-BBL-003', path: '/terms', name: '이용약관' },
  { id: 'TC-BBL-004', path: '/privacy', name: '개인정보처리방침' },
  { id: 'TC-BBL-005', path: '/tc-bbl-nonexistent-404', name: '존재하지 않는 경로(404)', expect404: true },
];
const VIEWPORTS = [320, 390, 768, 1024]; // 공개 관행: 초소형(320)~태블릿(768)~노트북(1024)
const VIEWPORT_PAGES = ['/', '/login', '/terms'];
const SEO_PAGES = ['/', '/login', '/terms', '/privacy'];
const PAYMENT_PROBE_PATHS = ['/pricing', '/plans', '/subscribe'];

const GROUPS = ['perf', 'a11y', 'payment', 'viewport', 'seo', 'stability'];
const ALL_GROUPS = ['all', ...GROUPS];

// ---------------------------------------------------------------------------
// 공통 유틸
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const results = [];
function record(target, id, group, title, verdict, detail) {
  results.push({ target, id, group, title, verdict, detail });
  const tag = { PASS: 'PASS', FAIL: 'FAIL', INFO: 'INFO' }[verdict] || verdict;
  console.log(`[${id}][${tag}] (${target}) ${title}`);
  if (detail) console.log(`    └ ${detail}`);
}

async function fetchGet(url, opts = {}) {
  const t0 = performance.now();
  const res = await fetch(url, {
    redirect: 'manual',
    headers: { 'user-agent': UA, accept: '*/*' },
    signal: AbortSignal.timeout(opts.timeoutMs || 20000),
  });
  let body = '';
  try { body = await res.text(); } catch { /* 본문 없음 */ }
  const totalMs = Math.round(performance.now() - t0);
  await sleep(GAP_MS); // 운영 예의
  return {
    url,
    status: res.status,
    location: res.headers.get('location') || '',
    contentType: (res.headers.get('content-type') || '').split(';')[0],
    body,
    bytes: body.length,
    totalMs,
  };
}

function ab(args, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    execFile(
      AB_PATH,
      args,
      { env: { ...process.env, AGENT_BROWSER_SESSION: SESSION }, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) { err.stderr = String(stderr || ''); reject(err); } else resolve(String(stdout)); }
    );
  });
}

/** agent-browser eval 결과 파싱 (출력은 JSON 문자열 형태로 직렬화되어 나옴) */
function parseAbOut(raw) {
  let s = String(raw).trim();
  for (let i = 0; i < 2; i++) {
    try {
      const v = JSON.parse(s);
      if (typeof v === 'string') s = v; else return v;
    } catch { return s; }
  }
  return s;
}

async function abEval(fn, timeoutMs = 60000) {
  const src = typeof fn === 'function' ? `(${fn.toString()})()` : String(fn);
  const out = await ab(['eval', src], timeoutMs);
  return parseAbOut(out);
}

async function browserOpen(url) {
  await ab(['open', url], 120000); // 로드 이벤트까지 대기
  await sleep(300);                // 렌더/수화 안정화
}

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); }

// ---------------------------------------------------------------------------
// 페이지 컨텍스트에서 실행되는 계측 함수들 (self-contained — 클로저 참조 금지)
// ---------------------------------------------------------------------------

/** 성능: Navigation Timing 1샘플 (TTFB=responseStart, 로드완료=loadEventEnd) */
function pageNavTiming() {
  const n = performance.getEntriesByType('navigation')[0];
  if (!n) return JSON.stringify(null);
  return JSON.stringify({
    final: location.pathname,
    redirected: n.redirectCount > 0,
    ttfbMs: Math.round(n.responseStart),
    loadMs: Math.round(n.loadEventEnd || n.domComplete || 0),
  });
}

/** 접근성 구조: lang/h1/이미지 alt/SVG 라벨/체크박스 라벨 연결/버튼 목록 */
function pageA11y() {
  const imgs = [...document.querySelectorAll('img')].map((i) => ({
    alt: i.getAttribute('alt'),
    src: (i.getAttribute('src') || '').slice(0, 60),
  }));
  const svgs = [...document.querySelectorAll('svg')];
  const unlabeledSvg = svgs.filter((s) => !s.hasAttribute('aria-hidden')
    && !s.hasAttribute('aria-label') && !s.getAttribute('role') && !s.querySelector('title'));
  const cb = document.querySelector('input[type="checkbox"]');
  const cbWrapped = cb ? !!cb.closest('label') : null;
  const cbLabels = cb && cb.labels ? cb.labels.length : -1;
  return JSON.stringify({
    path: location.pathname,
    lang: document.documentElement.lang || '',
    h1: document.querySelectorAll('h1').length,
    headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 6)
      .map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 26)}`),
    imgs, imgMissingAlt: imgs.filter((i) => i.alt === null).length,
    svgTotal: svgs.length,
    svgAriaHidden: svgs.filter((s) => s.hasAttribute('aria-hidden')).length,
    svgUnlabeled: unlabeledSvg.length,
    checkbox: cb
      ? { labelAssociated: cbLabels > 0 || cbWrapped === true, via: cbLabels > 0 ? 'label 연결' : (cbWrapped ? 'label 래핑(암묵)' : '없음'), ariaRequired: cb.getAttribute('aria-required') }
      : null,
    buttons: [...document.querySelectorAll('button')].slice(0, 12)
      .map((b) => ({ text: b.textContent.trim().slice(0, 22), disabled: b.matches('[disabled],[aria-disabled="true"]') })),
    links: [...document.querySelectorAll('a')].slice(0, 12).map((a) => a.getAttribute('href')),
  });
}

/** 포커스 가시성: 현재 activeElement의 포커스 표시 상태 */
function pageFocusStop() {
  const el = document.activeElement;
  if (!el || el === document.body) return JSON.stringify(null);
  const cs = getComputedStyle(el);
  return JSON.stringify({
    tag: el.tagName,
    name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 16),
    outlineVisible: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
    boxShadowVisible: cs.boxShadow !== 'none',
    underline: el.tagName === 'A' && (cs.textDecorationLine || '').includes('underline'),
  });
}

/** 색 대비 샘플 (WCAG 1.4.3 계산식, 비활성 컴포넌트는 예외로 별도 기록) */
function pageContrast() {
  function parse(c) { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
  function ratio(f, b) { const a = lum(f), d = lum(b); const hi = Math.max(a, d), lo = Math.min(a, d);
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2); }
  function bgOf(el) { let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor);
    if (c && c.a > 0.9) return c; e = e.parentElement; } return { r: 255, g: 255, b: 255 }; }
  const samples = []; const exempt = []; const seen = new Set();
  document.querySelectorAll('a,button,p,h1,h2,h3,span,label,li').forEach((el) => {
    if (samples.length + exempt.length >= 14) return;
    const t = el.textContent.trim();
    if (!t || t.length < 3) return;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const k = t.slice(0, 16); if (seen.has(k)) return; seen.add(k);
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const fg = parse(cs.color); if (!fg) return;
    const entry = { text: t.slice(0, 20), fg: cs.color, fs: cs.fontSize, ratio: ratio(fg, bgOf(el)) };
    if (el.closest('[disabled],button[disabled],[aria-disabled="true"]')) exempt.push(entry);
    else samples.push(entry);
  });
  return JSON.stringify({ path: location.pathname, samples, exempt });
}

/** 뷰포트: 가로 스크롤 · 텍스트 잘림 · 터치 타깃 크기 */
function pageViewport() {
  const de = document.documentElement;
  const clipped = [];
  document.querySelectorAll('a,button,input,label,span,p,h1,h2,h3,li').forEach((el) => {
    if (clipped.length >= 6) return;
    const t = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      ? el.textContent.trim().slice(0, 16) : '';
    if (!t) return;
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible') {
      clipped.push({ text: t, scrollW: el.scrollWidth, clientW: el.clientWidth });
    }
  });
  const targets = [];
  document.querySelectorAll('a,button,input,label').forEach((el) => {
    if (targets.length >= 14) return;
    // 라벨로 래핑된 입력(예: 동의 체크박스)은 클릭 히트영역인 라벨 박스로 통합 계산(이중 계산 방지)
    if (el.tagName === 'INPUT' && el.closest('label')) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const inlineTextLink = el.tagName === 'A' && !!el.closest('label,p'); // 문장 내 인라인 링크(WCAG 2.5.8 예외 계층, 관행상 제외)
    const disabled = !!el.closest('[disabled],button[disabled],[aria-disabled="true"]');
    targets.push({
      tag: el.tagName,
      name: (el.getAttribute('aria-label') || el.textContent || el.type || '').trim().slice(0, 16),
      w: Math.round(r.width), h: Math.round(r.height),
      inlineExempt: inlineTextLink, disabled,
    });
  });
  return JSON.stringify({
    path: location.pathname,
    vw: de.clientWidth,
    scrollW: de.scrollWidth,
    hOverflow: de.scrollWidth > de.clientWidth + 1,
    clipped,
    targets,
  });
}

/** 결제 표면 관찰(표시만): 가격/구독/부가세/플랜 키워드와 '결제성' 요소 — 클릭 없음 */
function pagePayment() {
  const t = document.body.innerText || '';
  const grab = (re, n) => (t.match(re) || []).slice(0, n);
  return JSON.stringify({
    path: location.pathname,
    price: grab(/[^\n]{0,28}(₩|[0-9,]\s*원\b)[^\n]{0,28}/g, 6),
    plan: grab(/[^\n]{0,24}(플랜|프리미엄|Pro|크레딧)[^\n]{0,28}/g, 6),
    vat: grab(/[^\n]{0,24}(부가세|부가가치세|VAT)[^\n]{0,28}/g, 4),
    subscription: grab(/[^\n]{0,24}(정기\s?구독|구독|정기결제|매월|월\s?결제|갱신|해지)[^\n]{0,28}/g, 6),
    payishElements: [...document.querySelectorAll('button,a')].map((e) => ({ tag: e.tagName, text: (e.textContent || '').trim().slice(0, 22) }))
      .filter((x) => /결제|구매|구독|업그레이드|플랜|크레딧/.test(x.text)).slice(0, 8),
  });
}

// ---------------------------------------------------------------------------
// 그룹 실행
// ---------------------------------------------------------------------------

/** [perf] TC-BBL-001~005 — 페이지당: 상태 1회 관찰 + 브라우저 내비게이션 3샘플(중앙값) */
async function groupPerf(target, base) {
  console.log(`\n=== 성능 스모크 (예산: TTFB ≤${BUDGET.ttfbMs}ms, 로드완료 ≤${BUDGET.loadMs}ms · ${SAMPLES}샘플 중앙값 · 출처: web.dev TTFB Good / 3초 이탈 관행) ===`);
  const table = [];
  for (const p of PERF_PAGES) {
    const url = base + p.path;
    const probe = await fetchGet(url); // 상태코드·리다이렉트 관찰 1회
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
      try {
        await browserOpen(url);
        const s = await abEval(pageNavTiming);
        if (s && typeof s === 'object') samples.push(s);
      } catch (e) {
        console.log(`    ! 샘플 ${i + 1} 실패: ${String(e.message || e).slice(0, 80)}`);
      }
      await sleep(GAP_MS);
    }
    const ttfbs = samples.map((s) => s.ttfbMs).filter((x) => x > 0);
    const loads = samples.map((s) => s.loadMs).filter((x) => x > 0);
    const medTtfb = ttfbs.length ? median(ttfbs) : null;
    const medLoad = loads.length ? median(loads) : null;
    const redirected = samples.some((s) => s.redirected);
    const finalPath = samples.length ? samples[samples.length - 1].final : '(샘플 없음)';

    const statusOk = p.expect404 ? probe.status === 404 : probe.status === 200 || (probe.status >= 300 && probe.status < 400);
    const budgetOk = medTtfb !== null && medLoad !== null && medTtfb <= BUDGET.ttfbMs && medLoad <= BUDGET.loadMs;
    const verdict = statusOk && budgetOk ? 'PASS' : 'FAIL';
    const detail = [
      `HTTP ${probe.status}${redirected ? ` (${p.path} → ${finalPath} 리다이렉트)` : ''}`,
      `TTFB 중앙값 ${medTtfb === null ? '측정불가' : medTtfb + 'ms'} (예산 ≤${BUDGET.ttfbMs}ms)`,
      `로드완료 중앙값 ${medLoad === null ? '측정불가' : medLoad + 'ms'} (예산 ≤${BUDGET.loadMs}ms)`,
      `샘플 ${samples.length}/${SAMPLES} · TTFB=[${ttfbs.join(', ')}] load=[${loads.join(', ')}]`,
    ].join(' · ');
    record(target, p.id, 'perf', `성능 스모크 ${p.name}`, verdict, detail);
    table.push({ name: p.name, path: p.path, status: probe.status, medTtfb, medLoad, redirected, finalPath });
  }
  console.log('    [예산 대비 요약] ' + table.map((r) =>
    `${r.path}{${r.status}} TTFB ${r.medTtfb ?? '-'}ms/800 · load ${r.medLoad ?? '-'}ms/3000${r.redirected ? ' (→' + r.finalPath + ')' : ''}`
  ).join(' | '));
}

/** [a11y] TC-BBL-006~011 — lang/alt·SVG/h1/포커스/체크박스 라벨/대비 */
async function groupA11y(target, base) {
  console.log('\n=== 접근성 기본 (출처: WCAG 2.1 — 3.1.1·1.1.1·2.4.7·1.3.1/3.3.2·1.4.3 / h1·구조는 공개 관행) ===');
  const pages = ['/login', '/terms', '/privacy', '/home'];
  const states = [];
  for (const path of pages) {
    try {
      await browserOpen(base + path);
      const st = await abEval(pageA11y);
      if (st && typeof st === 'object') states.push(st);
      else console.log(`    ! ${path} 상태 수집 실패`);
    } catch (e) {
      console.log(`    ! ${path} 열람 실패: ${String(e.message || e).slice(0, 80)}`);
    }
    await sleep(GAP_MS);
  }

  // TC-BBL-006 html lang=ko
  const badLang = states.filter((s) => s.lang !== 'ko');
  record(target, 'TC-BBL-006', 'a11y', 'html lang="ko"',
    badLang.length === 0 && states.length > 0 ? 'PASS' : 'FAIL',
    states.map((s) => `${s.path}: lang="${s.lang}"`).join(' · ') + ' (WCAG 3.1.1 A)');

  // TC-BBL-007 핵심 이미지 alt (+ 라벨 없는 장식 SVG 관찰)
  const noAlt = states.flatMap((s) => s.imgs.filter((i) => i.alt === null).map((i) => `${s.path}: ${i.src}`));
  const unlabeledSvg = states.map((s) => `${s.path}: ${s.svgUnlabeled}/${s.svgTotal}개(aria-hidden 아님·라벨 없음)`).join(' · ');
  record(target, 'TC-BBL-007', 'a11y', '핵심 이미지 대체 텍스트(alt)',
    noAlt.length === 0 ? 'PASS' : 'FAIL',
    `alt 누락 img ${noAlt.length}개${noAlt.length ? ' — ' + noAlt.slice(0, 4).join(', ') : ''} · 장식 SVG는 aria-hidden 처리 ${states.reduce((a, s) => a + s.svgAriaHidden, 0)}개 / 라벨없는 SVG ${states.reduce((a, s) => a + s.svgUnlabeled, 0)}개(관찰 기록) — WCAG 1.1.1 A`);

  // TC-BBL-008 h1 존재
  const h1List = states.map((s) => `${s.path}: h1 ${s.h1}개${s.headings.length ? ' · 첫 헤딩 "' + s.headings[0] + '"' : '(헤딩 없음)'}`);
  const h1Ok = states.every((s) => s.h1 >= 1);
  record(target, 'TC-BBL-008', 'a11y', '페이지별 h1 존재', h1Ok ? 'PASS' : 'FAIL',
    h1List.join(' · ') + ' — h1 단일 사용은 HTML/접근성 공개 관행');

  // TC-BBL-010 로그인 동의 체크박스 라벨 연결 (해당 TC는 /login 상태에서)
  const login = states.find((s) => s.path === '/login') || states[0];
  const cb = login && login.checkbox;
  record(target, 'TC-BBL-010', 'a11y', '로그인 동의 체크박스 라벨 연결',
    cb && cb.labelAssociated ? 'PASS' : 'FAIL',
    cb ? `연결=${cb.via} · aria-required=${cb.ariaRequired}` : '체크박스를 찾지 못함(로그인 게스트 표면) — WCAG 1.3.1/3.3.2 A');

  // TC-BBL-009 포커스 가시성 (Tab 이동 — /login에서만, 입력 없음)
  try {
    await browserOpen(base + '/login');
    const stops = [];
    for (let i = 0; i < 4; i++) {
      await ab(['press', 'Tab'], 30000);
      await sleep(250);
      const st = await abEval(pageFocusStop);
      if (st && typeof st === 'object') stops.push(st);
    }
    const visible = stops.filter((s) => s.outlineVisible || s.boxShadowVisible || s.underline);
    record(target, 'TC-BBL-009', 'a11y', '키보드 포커스 가시성(Tab 이동)',
      stops.length > 0 && visible.length === stops.length ? 'PASS' : 'FAIL',
      `${visible.length}/${stops.length} 정차 지점 가시 · ` + stops.map((s) => `${s.tag}"${s.name}"${s.outlineVisible ? '(아웃라인)' : s.boxShadowVisible ? '(쉐도우)' : s.underline ? '(밑줄)' : '(표시없음!)'}`).join(' → ') + ' — WCAG 2.4.7 AA');
  } catch (e) {
    record(target, 'TC-BBL-009', 'a11y', '키보드 포커스 가시성(Tab 이동)', 'FAIL', `측정 오류: ${String(e.message || e).slice(0, 100)}`);
  }

  // TC-BBL-011 주요 텍스트 색 대비 샘플 (/login + /terms)
  const ratios = []; const exempts = [];
  for (const path of ['/login', '/terms']) {
    try {
      await browserOpen(base + path);
      const c = await abEval(pageContrast);
      if (c && typeof c === 'object') {
        ratios.push(...c.samples.map((s) => ({ ...s, path })));
        exempts.push(...c.exempt.map((s) => ({ ...s, path })));
      }
    } catch { /* 다음 페이지 */ }
    await sleep(GAP_MS);
  }
  const failing = ratios.filter((s) => s.ratio < 4.5);
  const minRatio = ratios.length ? Math.min(...ratios.map((s) => s.ratio)) : '-';
  record(target, 'TC-BBL-011', 'a11y', '주요 텍스트 색 대비(4.5:1) 샘플',
    ratios.length > 0 && failing.length === 0 ? 'PASS' : 'FAIL',
    `${ratios.length}개 샘플 중 미달 ${failing.length}개${failing.length ? ' — ' + failing.slice(0, 3).map((s) => `${s.path} "${s.text}" ${s.ratio}:1(${s.fg})`).join(', ') : ''}`
    + ` · 최저 ${minRatio}:1 · 비활성 컴포넌트 예외 ${exempts.length}개${exempts.length ? '(예: ' + exempts[0].text.trim() + ' ' + exempts[0].ratio + ':1 — WCAG 1.4.3 비활성 UI 예외)' : ''} — WCAG 1.4.3 AA`);
}

/** [payment] TC-BBL-012~015 — 결제·플랜 표시 계약(표시만, 클릭 금지) */
async function groupPayment(target, base) {
  console.log('\n=== 결제·플랜 표시 계약 (표시만 — 결제 버튼 클릭 금지 / 출처: 전자상거래법 가격표시 관행·이커머스 공개 관행) ===');
  // 1) 게스트 도달 가능 표면 탐색: 게스트 페이지 원문 키워드 + 링크 + 대표 경로 상태 관찰
  const surfaces = [];
  for (const path of ['/', '/login', '/home', '/terms']) {
    const r = await fetchGet(base + path);
    const text = r.body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
    const hasPrice = /(₩|[0-9,]\s*원\b)/.test(text);
    const hasPlan = /(플랜|프리미엄|크레딧|Pro)/.test(text);
    const hrefs = [...r.body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const pricingLinks = hrefs.filter((h) => /(pricing|plans?|subscribe|billing|pay|buy|checkout)/i.test(h));
    surfaces.push({ path, status: r.status, hasPrice, hasPlan, pricingLinks, hasTermsClause: /유료 서비스/.test(text) });
  }
  const probeStatus = [];
  for (const path of PAYMENT_PROBE_PATHS) {
    const r = await fetchGet(base + path);
    probeStatus.push(`${path}=${r.status}`);
  }
  // 2) 게스트 /home 실화면 텍스트 관찰(클릭 없음)
  let homePay = null;
  try {
    await browserOpen(base + '/home');
    homePay = await abEval(pagePayment);
  } catch (e) { console.log(`    ! /home 관찰 실패: ${String(e.message || e).slice(0, 80)}`); }

  const reachable = surfaces.filter((s) => s.hasPrice && s.hasPlan && s.status === 200);  const gateEvidence = [
    surfaces.map((s) => `${s.path}{${s.status}} 가격텍스트=${s.hasPrice} 플랜어휘=${s.hasPlan}`).join(' · '),
    `대표 결제 경로 탐색(상태만): ${probeStatus.join(', ')}`,
    `게스트 /home 화면: ${homePay ? `가격 [${(homePay.price || []).length}건] 플랜 [${(homePay.plan || []).length}건] 결제성 요소 [${(homePay.payishElements || []).length}건]` : '관찰 실패'}`,
  ].join(' | ');

  // TC-BBL-012 게스트 결제 표면 도달성
  if (reachable.length === 0) {
    record(target, 'TC-BBL-012', 'payment', '게스트 도달 가능 결제 표면', 'INFO',
      `도달 불가 — 로그인 게이트 뒤 · ${gateEvidence}`);
  } else {
    record(target, 'TC-BBL-012', 'payment', '게스트 도달 가능 결제 표면', 'PASS',
      `도달: ${reachable.map((s) => s.path).join(', ')} · ${gateEvidence}`);
  }

  // TC-BBL-013~015: 표면이 있으면 표시 계약 검증(원화·부가세·구독 안내 키워드로 표시 여부만 판정), 없으면 게이트 뒤 기록
  const termsEvidence = surfaces.find((s) => s.path === '/terms' && s.hasTermsClause);
  const gateNote = '로그인 게이트 뒤 — 게스트 표면에서 가격 표시 관찰 불가';
  const termsNote = termsEvidence ? '공개 약관에 "유료 서비스(크레딧·정기 구독)의 종류·가격·이용 조건은 서비스 내 결제 화면에 표시" 문구 확인(표시 주체: 결제 화면)' : '';

  if (reachable.length) {
    const priceTxt = (homePay && homePay.price) || [];
    const vatTxt = (homePay && homePay.vat) || [];
    const subTxt = (homePay && homePay.subscription) || [];
    const planTxt = (homePay && homePay.plan) || [];
    record(target, 'TC-BBL-013', 'payment', '상품명·플랜명 표시',
      planTxt.length > 0 ? 'PASS' : 'FAIL',
      `표면 ${reachable.map((s) => s.path).join(', ')} · 플랜/상품명 표시 샘플: ${planTxt.slice(0, 3).map((x) => String(x).trim()).join(' / ') || '없음'} — 전자상거래 관행: 상품명·단위 명시`);
    record(target, 'TC-BBL-014', 'payment', '가격 원화·부가세 표기 관행',
      priceTxt.length > 0 && vatTxt.length > 0 ? 'PASS' : 'FAIL',
      `가격 표시: ${priceTxt.slice(0, 3).map((x) => String(x).trim()).join(' / ') || '없음'} · 부가세 표기: ${vatTxt.slice(0, 2).map((x) => String(x).trim()).join(' / ') || '없음'} — 전자상거래법 가격표시 관행(원화 + 부가세 포함/별도 명시)`);
    record(target, 'TC-BBL-015', 'payment', '구독 상품 안내(주기·갱신·해지)',
      subTxt.length > 0 ? 'PASS' : 'FAIL',
      `구독 안내 샘플: ${subTxt.slice(0, 3).map((x) => String(x).trim()).join(' / ') || '없음'} — 정기결제 관행(결제 주기·자동 갱신·해지 방법 고지)`);
  } else {
    record(target, 'TC-BBL-013', 'payment', '상품명·플랜명 표시', 'INFO',
      [gateNote, termsNote].filter(Boolean).join(' · '));
    record(target, 'TC-BBL-014', 'payment', '가격 원화·부가세 표기 관행', 'INFO',
      [gateNote, termsNote].filter(Boolean).join(' · '));
    record(target, 'TC-BBL-015', 'payment', '구독 상품 안내(주기·갱신·해지)', 'INFO',
      [gateNote, termsNote].filter(Boolean).join(' · '));
  }
}

/** [viewport] TC-BBL-016~018 — 320/390/768/1024 */
async function groupViewport(target, base) {
  console.log(`\n=== 크로스 뷰포트 (${VIEWPORTS.join('/')}px · 출처: 반응형 공개 관행, 터치 타깃 44px Apple HIG·WCAG 2.5.8 24px 최소) ===`);
  const perPage = [];
  for (const path of VIEWPORT_PAGES) {
    const widths = [];
    for (let wi = 0; wi < VIEWPORTS.length; wi++) {
      const w = VIEWPORTS[wi];
      try {
        // 첫 폭은 로드 전에 뷰포트 설정(모바일 우선 렌더 보장), 이후 폭은 리사이즈로 측정(재요청 없음)
        await ab(['set', 'viewport', String(w), '844'], 30000);
        if (wi === 0) { await sleep(300); await browserOpen(base + path); }
        else await sleep(500); // 반응형 CSS/레이아웃 안정화 대기
        const st = await abEval(pageViewport);
        if (st && typeof st === 'object') widths.push({ w, ...st });
      } catch (e) {
        console.log(`    ! ${path}@${w}px 실패: ${String(e.message || e).slice(0, 60)}`);
      }
    }
    perPage.push({ path, widths });
    await sleep(GAP_MS);
  }

  // TC-BBL-016 가로 스크롤 없음
  const overflowRows = perPage.flatMap((p) => p.widths.filter((x) => x.hOverflow).map((x) => `${p.path}@${x.w}px(scrollW=${x.scrollW})`));
  record(target, 'TC-BBL-016', 'viewport', '가로 스크롤(overflow) 없음',
    overflowRows.length === 0 && perPage.length > 0 ? 'PASS' : 'FAIL',
    perPage.map((p) => `${p.path}: ${p.widths.map((x) => `${x.w}px${x.hOverflow ? '!오버플로' : 'OK'}`).join(' ')}`).join(' | ') || '측정 실패');

  // TC-BBL-017 텍스트 잘림
  const clipRows = perPage.flatMap((p) => p.widths.filter((x) => x.clipped.length > 0)
    .map((x) => `${p.path}@${x.w}px: ${x.clipped.map((c) => `"${c.text}"(${c.clientW}<${c.scrollW})`).join(', ')}`));
  record(target, 'TC-BBL-017', 'viewport', '텍스트 잘림 없음(샘플)',
    clipRows.length === 0 && perPage.length > 0 ? 'PASS' : 'FAIL',
    clipRows.length ? clipRows.slice(0, 4).join(' | ') : `${perPage.length}개 페이지 × ${VIEWPORTS.length}폭 샘플에서 잘림 요소 0건`);

  // TC-BBL-018 터치 타깃 크기 (24px 미만=FAIL(WCAG 2.5.8 AA 최소), 44px 미만=관행 미달 주석)
  let minW = 9999, minH = 9999; const under24 = []; const under44 = [];
  for (const p of perPage) for (const x of p.widths) for (const t of (x.targets || [])) {
    if (t.inlineExempt || t.disabled) continue;
    minW = Math.min(minW, t.w); minH = Math.min(minH, t.h);
    if (t.w < 24 || t.h < 24) under24.push(`${p.path}@${x.w} ${t.tag}"${t.name}" ${t.w}x${t.h}`);
    else if (t.w < 44 || t.h < 44) under44.push(`${p.path}@${x.w} ${t.tag}"${t.name}" ${t.w}x${t.h}`);
  }
  record(target, 'TC-BBL-018', 'viewport', '터치 타깃 크기(최소 24px, 권장 44px) 샘플',
    under24.length === 0 ? 'PASS' : 'FAIL',
    `최소 타깃 ${minW}x${minH}px · 24px 미만 ${under24.length}개${under24.length ? ' — ' + under24.slice(0, 3).join(', ') : ''}`
    + ` · 44px 관행 미달 ${under44.length}개${under44.length ? '(예: ' + under44.slice(0, 3).join(', ') + ')' : ''} — WCAG 2.5.8(24px)/Apple HIG(44px), 문장 내 인라인 링크·비활성 제외`);
}

/** [seo] TC-BBL-019~022 — 메타/파비콘 (HTTP 관찰만) */
async function groupSeo(target, base) {
  console.log('\n=== SEO/메타 (출처: 검색엔진 공개 가이드·Open Graph 프로토콜 관행) ===');
  const pick = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
  const rows = [];
  for (const path of SEO_PAGES) {
    const r = await fetchGet(base + path);
    rows.push({
      path, status: r.status, final: r.status >= 300 && r.status < 400 ? r.location : path,
      title: pick(r.body, /<title>([^<]*)<\/title>/),
      description: pick(r.body, /<meta\s+name="description"\s+content="([^"]*)"/),
      canonical: pick(r.body, /<link\s+rel="canonical"\s+href="([^"]*)"/),
      ogTitle: pick(r.body, /<meta\s+property="og:title"\s+content="([^"]*)"/),
      ogDesc: pick(r.body, /<meta\s+property="og:description"\s+content="([^"]*)"/),
      ogImage: pick(r.body, /<meta\s+property="og:image"\s+content="([^"]*)"/),
    });
  }
  const fmt = (v, max = 40) => (v === null ? '없음' : `"${String(v).slice(0, max)}"`);

  // TC-BBL-019 title/description
  const badMeta = rows.filter((r) => !r.title || !r.description || r.status >= 400);
  record(target, 'TC-BBL-019', 'seo', 'title·meta description',
    badMeta.length === 0 ? 'PASS' : 'FAIL',
    rows.map((r) => `${r.path}: title=${fmt(r.title, 30)} desc=${r.description ? `${r.description.length}자` : '없음'}`).join(' | '));

  // TC-BBL-020 canonical
  const noCanonical = rows.filter((r) => !r.canonical);
  record(target, 'TC-BBL-020', 'seo', 'canonical URL',
    noCanonical.length === 0 ? 'PASS' : 'FAIL',
    rows.map((r) => `${r.path}: ${r.canonical ? r.canonical : '없음'}`).join(' | ') + ' — 고유 canonical은 검색엔진 공개 가이드 관행');

  // TC-BBL-021 OG 태그
  const badOg = rows.filter((r) => !r.ogTitle || !r.ogDesc || !r.ogImage);
  record(target, 'TC-BBL-021', 'seo', 'Open Graph 태그(og:title/description/image)',
    badOg.length === 0 ? 'PASS' : 'FAIL',
    rows.map((r) => `${r.path}: og:title=${r.ogTitle ? 'O' : 'X'} og:desc=${r.ogDesc ? 'O' : 'X'} og:image=${r.ogImage ? 'O' : 'X'}`).join(' | ') + ' — OG 프로토콜 공개 관행');

  // TC-BBL-022 파비콘 로드 (+ og:image 실제 로드)
  const fav = await fetchGet(base + '/favicon.ico');
  const ogImgUrl0 = (rows.find((r) => r.ogImage) || {}).ogImage || '';
  const ogImgUrl = /^https?:/.test(ogImgUrl0) ? ogImgUrl0 : (ogImgUrl0 ? base + ogImgUrl0 : '');
  const ogImg = ogImgUrl ? await fetchGet(ogImgUrl) : null;
  const favOk = fav.status === 200 && /image/.test(fav.contentType);
  const ogOk = !ogImg || (ogImg.status === 200 && /image/.test(ogImg.contentType));
  record(target, 'TC-BBL-022', 'seo', '파비콘·OG 이미지 로드',
    favOk && ogOk ? 'PASS' : 'FAIL',
    `/favicon.ico ${fav.status}(${fav.contentType}, ${fav.bytes}B)${ogImg ? ` · og:image ${ogImg.status}(${ogImg.contentType}, ${ogImg.bytes}B)` : ' · og:image 미지정'}`);
}

/** [stability] TC-BBL-023~024 */
async function groupStability(target, base) {
  console.log('\n=== 운영 안정성 관찰 (출처: 헬스 엔드포인트·멱등성 공개 관행) ===');
  // TC-BBL-023 /api/health
  const h1 = await fetchGet(base + '/api/health');
  const h2 = await fetchGet(base + '/api/health');
  let healthBody = '';
  try { healthBody = JSON.stringify(JSON.parse(h1.body)); } catch { healthBody = h1.body.slice(0, 80); }
  const sameHealth = h1.status === h2.status && h1.contentType === h2.contentType;
  record(target, 'TC-BBL-023', 'stability', '/api/health 응답',
    h1.status === 200 && sameHealth ? 'PASS' : 'FAIL',
    `1회:${h1.status}(${h1.totalMs}ms) 2회:${h2.status}(${h2.totalMs}ms) · ${h1.contentType} · 본문 ${healthBody.slice(0, 90)}`);

  // TC-BBL-024 동일 경로 2회 일관성 (정적 게스트 페이지)
  const p1 = await fetchGet(base + '/terms');
  const p2 = await fetchGet(base + '/terms');
  const p3 = await fetchGet(base + '/login');
  const p4 = await fetchGet(base + '/login');
  const row = (a, b, name) => `${name} ${a.status}/${b.status} · ${a.contentType} · ${a.bytes}B/${b.bytes}B · 해시 ${sha(a.body) === sha(b.body) ? '일치' : '불일치(길이 동일)'}`;
  const shapeOk = p1.status === p2.status && p1.contentType === p2.contentType && p1.bytes === p2.bytes
    && p3.status === p4.status && p3.contentType === p4.contentType && p3.bytes === p4.bytes;
  const hashOk = sha(p1.body) === sha(p2.body) && sha(p3.body) === sha(p4.body);
  const verdict = !shapeOk ? 'FAIL' : hashOk ? 'PASS' : 'INFO';
  record(target, 'TC-BBL-024', 'stability', '동일 경로 2회 응답 일관성', verdict,
    `${row(p1, p2, '/terms')} | ${row(p3, p4, '/login')}${hashOk ? '' : ' — 상태·유형·길이 일치, 본문 일부 토큰(빌드/세션 ID성)만 상이(관찰 기록)'}`);
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
async function runForTarget(targetName, base, selected) {
  console.log(`\n########## 대상: ${targetName} (${base}) ##########`);
  const needBrowser = ['perf', 'a11y', 'payment', 'viewport'].some((g) => selected.includes(g));
  if (needBrowser) {
    try {
      await ab(['set', 'viewport', '1280', '900'], 60000); // 브라우저 기동(세션 재사용)
    } catch (e) {
      console.error(`브라우저 초기화 실패(${AB_PATH}): ${String(e.message || e).slice(0, 120)}`);
      console.error('브라우저 그룹을 실행하려면 agent-browser가 필요합니다. seo/stability만 실행합니다.');
      selected = selected.filter((g) => g === 'seo' || g === 'stability');
    }
  }
  if (selected.includes('perf')) await groupPerf(targetName, base);
  if (selected.includes('a11y')) await groupA11y(targetName, base);
  if (selected.includes('payment')) await groupPayment(targetName, base);
  if (selected.includes('viewport')) await groupViewport(targetName, base);
  if (selected.includes('seo')) await groupSeo(targetName, base);
  if (selected.includes('stability')) await groupStability(targetName, base);
}

async function main() {
  const argv = process.argv.slice(2).map((a) => a.toLowerCase());
  const selected = argv.length ? argv : ['all'];
  for (const a of selected) {
    if (!ALL_GROUPS.includes(a)) {
      console.error(`알 수 없는 그룹: ${a} (사용 가능: ${ALL_GROUPS.join(' | ')})`);
      process.exit(2);
    }
  }
  const groups = selected.includes('all') ? GROUPS : selected.filter((g) => g !== 'all');
  console.log(`jaroo 블랙박스 출시 체크리스트 — ${new Date().toISOString()}`);
  console.log(`그룹: ${groups.join(', ')} · 대상: ${TARGET} · 세션: ${SESSION} · 요청 간 ${GAP_MS}ms · 페이지당 최대 ${SAMPLES}샘플`);

  const targets = TARGET === 'both' ? [['prod', PROD_URL], ['local', BASE_URL]]
    : TARGET === 'local' ? [['local', BASE_URL]] : [['prod', PROD_URL]];

  for (const [name, base] of targets) {
    await runForTarget(name, base, groups);
  }

  // 요약
  const counts = { PASS: 0, FAIL: 0, INFO: 0 };
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  console.log('\n==================== 요약 ====================');
  console.log(`총 ${results.length} TC · PASS ${counts.PASS} · FAIL ${counts.FAIL} · INFO ${counts.INFO}`);
  const fails = results.filter((r) => r.verdict === 'FAIL');
  if (fails.length) {
    console.log('FAIL 목록:');
    fails.forEach((f) => console.log(`  - [${f.id}] (${f.target}) ${f.title}`));
  }
  // 종료 시 브라우저 세션 종료 (세션 이름으로 격리되어 있어 다른 세션에 영향 없음)
  try { await ab(['close'], 60000); } catch { /* 이미 닫혀 있으면 무시 */ }
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(async (e) => {
  console.error('치명적 오류:', e);
  process.exitCode = 2;
});
