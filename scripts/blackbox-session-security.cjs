#!/usr/bin/env node
/**
 * jaroo 블랙박스 TC — 세션·보안·캐시 계약 (TC-BBS-001 ~ TC-BBS-018)
 * 대상: 운영 https://jaroo.kr (기본값, BB_BASE_URL 로 변경 가능)
 * 브라우저: CDP 9225 헤드리스 Chrome(jaroo-qa 격리 프로필, 운영 세션 내장)
 *           — 9222(사용자 실사용 브라우저)에는 절대 접속하지 않는다.
 *
 * 사용:
 *   node scripts/blackbox-session-security.cjs [group ...]
 *   groups: cookies | cache | logout | relogin | guards | api | persistence | all
 *   env: BB_BASE_URL(기본 https://jaroo.kr), BB_CDP(기본 9225),
 *        BB_EMAIL / BB_NAME(개인정보 마커, 기본 내장 계정)
 *
 * 블랙박스 원칙:
 *   - 제품 소스/내부 문서를 읽지 않고, 공개 보안 관행(OWASP), 공개 표준(RFC/MDN),
 *     OAuth/UX 관행, 크로스환경 일관성만으로 기대값을 도출한다.
 *   - 읽기·로그인/로그아웃만 수행한다(포트폴리오/딥스캔/OCR/결제 쓰기 금지).
 *   - 순차 실행, 최소 반복(운영 부하 최소화). 브라우저 종료 금지(자기 탭만 정리).
 *   - 쿠키/토큰 값은 로그에 마스킹한다(값 길이+접두어만 출력).
 *
 * 판정: PASS(기대 충족) / WARN(기대 대비 완화 필요·관찰) / FAIL(기대 위반) / BLOCK(관측 불가)
 */
'use strict';

const BASE = (process.env.BB_BASE_URL || 'https://jaroo.kr').replace(/\/+$/, '');
const CDP_PORT = Number(process.env.BB_CDP || 9225);
const ACCOUNT_EMAIL = process.env.BB_EMAIL || 'myungsugood0505@gmail.com';
const ACCOUNT_NAME = process.env.BB_NAME || '박명철';
// 프로필에 심어진 계정 식별 마커(별칭 표기 차이 허용)
const EMAIL_RE_SRC = 'myungsugood0505|myungsufood0505|0505@gmail';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (s, n) => String(s).padEnd(n, ' ');
const nowIso = () => new Date().toISOString();

function maskValue(v) {
  if (v == null) return null;
  const s = String(v);
  if (!s.length) return '(empty)';
  return `${s.slice(0, 6)}…(${s.length}bytes)`;
}

function log(msg) {
  process.stdout.write(`[${nowIso()}] ${msg}\n`);
}

/* ------------------------------------------------------------------ */
/* 판정 수집                                                          */
/* ------------------------------------------------------------------ */
const results = [];
function tc(id, name, verdict, expected, source, observed, note) {
  results.push({ id, name, verdict, expected, source, observed, note: note || null });
  const icon = { PASS: '✅ PASS', FAIL: '❌ FAIL', WARN: '⚠️ WARN', BLOCK: '⛔ BLOCK' }[verdict] || verdict;
  log(`${icon}  ${id} ${name}`);
  if (expected) log(`        기대: ${expected}`);
  if (source) log(`        출처: ${source}`);
  if (observed) log(`        관찰: ${observed}`);
  if (note) log(`        비고: ${note}`);
  log('');
}

/* ------------------------------------------------------------------ */
/* CDP 클라이언트 (브라우저 레벨 WebSocket)                             */
/* ------------------------------------------------------------------ */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id != null && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`));
        else p.res(m.result);
        return;
      }
      if (m.method) {
        const key = `${m.sessionId || ''}|${m.method}`;
        const h = this.handlers.get(key);
        if (h) h(m.params || {});
      }
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.rej(new Error('CDP websocket closed'));
      this.pending.clear();
    });
  }
  static async connect(port) {
    const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()));
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP websocket connect timeout')), 8000);
      ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('CDP websocket error')); }, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId, timeoutMs = 45000) {
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { res, rej, method, timer });
      this.ws.send(JSON.stringify(msg));
    });
  }
  on(sessionId, method, fn) { this.handlers.set(`${sessionId || ''}|${method}`, fn); }
}

/* ------------------------------------------------------------------ */
/* 탭(페이지 세션) + 네트워크 레코더                                    */
/* ------------------------------------------------------------------ */
class Tab {
  constructor(cdp, targetId, sessionId) {
    this.cdp = cdp;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.requests = new Map(); // requestId -> 기록
    this._loadResolve = null;
    cdp.on(sessionId, 'Page.loadEventFired', () => {
      if (this._loadResolve) { const r = this._loadResolve; this._loadResolve = null; r(); }
    });
    const rec = (method) => {
      cdp.on(sessionId, `Network.${method}`, (p) => this._onNetwork(method, p));
    };
    ['requestWillBeSent', 'responseReceived', 'responseReceivedExtraInfo', 'requestWillBeSentExtraInfo', 'loadingFailed'].forEach(rec);
  }

  static async create(cdp, url = 'about:blank') {
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = new Tab(cdp, targetId, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    return tab;
  }

  async close() {
    try { await this.cdp.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* 탭 정리 실패는 무시 */ }
  }

  _entry(id) {
    if (!this.requests.has(id)) {
      this.requests.set(id, { id, url: null, method: null, type: null, status: null, headers: {}, setCookies: [], redirects: 0, failed: null });
    }
    return this.requests.get(id);
  }
  _onNetwork(method, p) {
    const e = this._entry(p.requestId);
    try {
      if (method === 'requestWillBeSent') {
        e.url = p.request.url; e.method = p.request.method;
        if (p.type) e.type = p.type;
        if (p.redirectResponse) e.redirects += 1;
      } else if (method === 'responseReceived') {
        e.url = p.response.url; e.status = p.response.status; e.type = p.type || e.type;
        e.headers = Object.assign({}, p.response.headers);
      } else if (method === 'responseReceivedExtraInfo') {
        const h = p.headers || {};
        const sc = h['set-cookie'] || h['Set-Cookie'];
        if (sc) {
          const arr = Array.isArray(sc) ? sc : [sc];
          for (const c of arr) e.setCookies.push(c);
        }
        if (p.statusCode && !e.status) e.status = p.statusCode;
      } else if (method === 'loadingFailed') {
        e.failed = p.errorText;
      }
    } catch { /* 기록 오류 무시 */ }
  }

  resetRecorder() { this.requests.clear(); }

  docRequests() {
    return [...this.requests.values()].filter((r) => r.type === 'Document' && r.url && r.url.startsWith('http'));
  }
  findRequest(pred) { return [...this.requests.values()].find(pred); }

  async eval(expression) {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, this.sessionId);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception && r.exceptionDetails.exception.description;
      throw new Error(`page eval error: ${d || r.exceptionDetails.text}`);
    }
    return r.result ? r.result.value : undefined;
  }

  async url() { return this.eval('location.href').catch(() => null); }

  waitLoad(timeoutMs = 20000) {
    return new Promise((res) => {
      const t = setTimeout(() => { this._loadResolve = null; res(null); }, timeoutMs);
      this._loadResolve = () => { clearTimeout(t); res(true); };
    });
  }

  /** 문서 이동 + URL/렌더 안정화 대기(SPA 리디렉션 흡수) */
  async navigate(url, { settleMs = 1600 } = {}) {
    const loaded = this.waitLoad(20000);
    try { await this.cdp.send('Page.navigate', { url }, this.sessionId); } catch (e) {
      log(`  (navigate 경고: ${e.message})`);
    }
    await loaded;
    let prev = '\u0000';
    for (let i = 0; i < 45; i++) {
      await sleep(400);
      const st = await this.eval('({u:location.href,r:document.readyState})').catch(() => null);
      if (st) {
        if (st.r === 'complete' && st.u === prev) break;
        prev = st.u;
      }
    }
    await sleep(settleMs);
    return this.url();
  }
}

/* ------------------------------------------------------------------ */
/* 페이지 컨텍스트 헬퍼(주입 JS)                                        */
/* ------------------------------------------------------------------ */
function exprMarkers() {
  return `(function(){
    var t = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ');
    var emailRe = new RegExp(${JSON.stringify(EMAIL_RE_SRC)}, 'i');
    return {
      href: location.href, ready: document.readyState, title: document.title || '',
      hasLogout: /로그아웃/.test(t),
      hasLoginCta: /로그인|구글.{0,8}시작|google.{0,10}(시작|계속|로 로그인)|sign in with google/i.test(t),
      hasEmail: emailRe.test(t),
      hasName: t.indexOf(${JSON.stringify(ACCOUNT_NAME)}) !== -1,
      hasMoney: /총 평가액|평가액|손익|평가금액|수익률/.test(t),
      hasMyPageStuff: /내 종목 관리|분석 기록|회원 탈퇴|텔레그램 알림|크레딧 충전/.test(t),
      hasDeepscanUi: /딥스캔|스캔하기|진단|스크린샷을|분석 시작/.test(t),
      navType: (performance.getEntriesByType && performance.getEntriesByType('navigation')[0] || {}).type || null,
      persisted: window.__bbPersisted === undefined ? null : !!window.__bbPersisted,
      textHead: t.slice(0, 400)
    };
  })()`;
}

/** 텍스트 정규식과 일치하는 보이는 요소 클릭(가장 깊은 = 가장 구체적인 요소) */
function exprClickText(reSrc, flags, allowContainerText) {
  return `(function(a){
    var re = new RegExp(a.src, a.flags);
    var sels = 'a,button,[role="button"],[role="link"],[onclick],[data-email],div,span,li,label';
    var els = Array.prototype.slice.call(document.querySelectorAll(sels));
    function depth(e){ var d=0; while(e){ d++; e=e.parentElement; } return d; }
    var hits = [];
    for (var i=0;i<els.length;i++){
      var el = els[i];
      var rect = el.getBoundingClientRect(); if (rect.width < 2 || rect.height < 2) continue;
      var st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.pointerEvents === 'none') continue;
      var aria = el.getAttribute('aria-label') || '';
      var own = Array.prototype.slice.call(el.childNodes)
        .filter(function(n){ return n.nodeType === 3; })
        .map(function(n){ return n.textContent; }).join(' ').replace(/\\s+/g,' ').trim();
      var full = (el.innerText || '').replace(/\\s+/g,' ').trim();
      var hit = (aria && re.test(aria)) || (own && re.test(own)) ||
        (a.container && full && re.test(full) && full.length < 140);
      if (hit) hits.push({ el: el, d: depth(el), label: (full || aria).slice(0, 60) });
    }
    if (!hits.length) return null;
    hits.sort(function(x, y){ return y.d - x.d; });
    try { hits[0].el.scrollIntoView({ block: 'center' }); } catch(e){}
    hits[0].el.click();
    return hits[0].label;
  })(${JSON.stringify({ src: reSrc, flags: flags || 'i', container: !!allowContainerText })})`;
}

/** 지정 계정(EMAIL_RE)과 일치하는 구글 계정 선택 항목만 클릭 — 다른 계정 클릭 금지 */
function exprClickAccount() {
  return `(function(a){
    var re = new RegExp(a.src, 'i');
    var els = Array.prototype.slice.call(document.querySelectorAll('[data-email],[email]'));
    for (var i=0;i<els.length;i++){
      var em = els[i].getAttribute('data-email') || els[i].getAttribute('email') || '';
      if (!em || !re.test(em)) continue;
      var r = els[i].getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      try { els[i].scrollIntoView({ block: 'center' }); } catch(e){}
      els[i].click();
      return em;
    }
    return null;
  })(${JSON.stringify({ src: EMAIL_RE_SRC })})`;
}

function exprClickSel(css) {
  return `(function(a){
    var els = Array.prototype.slice.call(document.querySelectorAll(a.css));
    for (var i=0;i<els.length;i++){
      var el = els[i]; var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      try { el.scrollIntoView({ block: 'center' }); } catch(e){}
      el.click();
      return (el.innerText || el.getAttribute('aria-label') || a.css).replace(/\\s+/g,' ').trim().slice(0,60);
    }
    return null;
  })(${JSON.stringify({ css })})`;
}

function exprFetch(url, extraHeaders) {
  return `(async function(a){
    function cut(o){ try { return JSON.stringify(o).slice(0, 300); } catch(e){ return null; } }
    try {
      var r1 = await fetch(a.url, { credentials: 'include', redirect: 'manual', headers: a.headers });
      var out = { phase: 'manual', status: r1.status, type: r1.type };
      if (r1.type === 'opaqueredirect' || (r1.status >= 300 && r1.status < 400)) {
        var r2 = await fetch(a.url, { credentials: 'include', redirect: 'follow', headers: a.headers });
        out.follow = { status: r2.status, url: r2.url, redirected: r2.redirected,
          contentType: (r2.headers.get('content-type') || '') };
        try { out.follow.bodyHead = cut(await r2.json()); } catch(e){ out.follow.bodyHead = null; }
      } else {
        try { out.bodyHead = cut(await r1.json()); } catch(e){ out.bodyHead = null; }
      }
      return out;
    } catch(e){ return { error: String(e) }; }
  })(${JSON.stringify({ url, headers: extraHeaders || { accept: 'application/json' } })})`;
}

/* ------------------------------------------------------------------ */
/* 공통 관찰 유틸                                                      */
/* ------------------------------------------------------------------ */
async function markers(tab) { return tab.eval(exprMarkers()).catch(() => null); }

function personalExposed(m) {
  if (!m) return false;
  return !!(m.hasName || m.hasEmail || m.hasMoney || m.hasMyPageStuff);
}

async function cookieStore(tab) {
  const r = await tab.cdp.send('Network.getCookies', { urls: [BASE] }, tab.sessionId);
  return r.cookies || [];
}
const isAuthCookie = (c) => /-auth-token/i.test(c.name);

function cookieSummary(cookies) {
  return cookies.map((c) => {
    const auth = isAuthCookie(c);
    const sameSite = c.sameSite && c.sameSite !== 'unspecified' ? c.sameSite : '(미지정)';
    return `${c.name}${auth ? ' [인증]' : ''}: httpOnly=${c.httpOnly}, secure=${c.secure}, sameSite=${sameSite}, session=${c.session ? 'session' : `expires=${new Date(c.expires * 1000).toISOString().slice(0, 16)}`}, value=${maskValue(c.value)}`;
  });
}

function cookieFlagsVerdict(cookies) {
  const auth = cookies.filter(isAuthCookie);
  if (!auth.length) return { verdict: 'BLOCK', detail: '인증 쿠키(sb-*-auth-token*) 관찰 안 됨(로그인 상태 아님?)' };
  const bad = [];
  for (const c of auth) {
    if (!c.httpOnly) bad.push(`${c.name}: HttpOnly 없음`);
    if (!c.secure) bad.push(`${c.name}: Secure 없음`);
    const ss = (c.sameSite || '').toLowerCase();
    if (ss === 'none') bad.push(`${c.name}: SameSite=None`);
    else if (!ss || ss === 'unspecified') bad.push(`${c.name}: SameSite 미지정`);
  }
  if (bad.some((b) => b.includes('HttpOnly 없음') || b.includes('Secure 없음') || b.includes('SameSite=None'))) {
    return { verdict: 'FAIL', detail: bad.join('; ') };
  }
  if (bad.length) return { verdict: 'WARN', detail: bad.join('; ') };
  return { verdict: 'PASS', detail: `인증 쿠키 ${auth.length}개 모두 HttpOnly+Secure+SameSite 명시` };
}

function cacheControlVerdict(cc) {
  const v = (cc || '').toLowerCase();
  if (v.includes('no-store')) return { verdict: 'PASS', detail: `no-store (${cc})` };
  if (v.includes('no-cache')) return { verdict: 'WARN', detail: `no-cache만 존재(${cc}) — no-store 권장` };
  if (!v) return { verdict: 'FAIL', detail: 'Cache-Control 헤더 부재' };
  if (/max-age\s*=\s*[1-9]/.test(v)) return { verdict: 'FAIL', detail: `캐시 허용(${cc})` };
  return { verdict: 'WARN', detail: `해석 필요(${cc})` };
}

function lastDocFor(recorder, routePath) {
  const docs = recorder.docRequests().filter((r) => {
    try { const u = new URL(r.url); return u.pathname === routePath; } catch { return false; }
  });
  return docs.length ? docs[docs.length - 1] : null;
}

function headerVal(req, name) {
  const k = Object.keys(req.headers || {}).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? req.headers[k] : null;
}

/* ------------------------------------------------------------------ */
/* 여정 루틴                                                           */
/* ------------------------------------------------------------------ */
async function probeAuthed(tab) {
  await tab.navigate(`${BASE}/mypage`);
  const m = await markers(tab);
  return { authed: !!(m && (m.hasLogout || m.hasMyPageStuff || m.hasName)), markers: m };
}

async function ensureAuthed(tab, journeyLog) {
  const p = await probeAuthed(tab);
  if (p.authed) return true;
  log('  (게스트 상태 감지 → 재로그인 선행)');
  const ok = await doLogin(tab, journeyLog);
  return ok;
}

async function ensureGuest(tab, journeyLog) {
  const p = await probeAuthed(tab);
  if (!p.authed) return true;
  log('  (인증 상태 감지 → 로그아웃 선행)');
  await doLogout(tab, journeyLog);
  return true;
}

/**
 * 재로그인 여정: (게스트) 랜딩/로그인 → 구글 계정 선택 → 콜백 → /home
 * 관찰 기록: 경유 URL, 동의(consent) 화면, Set-Cookie, 소요시간
 */
async function doLogin(tab, jl) {
  const t0 = Date.now();
  await tab.navigate(`${BASE}/`);
  let m = await markers(tab);
  jl.visited.push(m ? m.href : await tab.url());
  jl.loginStartUrl = m ? m.href : null;

  // 1) 로그인 페이지/게이트: 구글 버튼 (필요하면 확인/동의 버튼도 시도)
  let googleClicked = false;
  let gateClicked = null;
  for (let i = 0; i < 25; i++) {
    const u = await tab.url().catch(() => '');
    if (/accounts\.google\.com|supabase\.co\/auth|\/auth\/callback/.test(u)) { googleClicked = true; break; }
    const g = await tab.eval(exprClickText('구글|google', 'i', false)).catch(() => null);
    if (g) {
      googleClicked = true;
      jl.loginButtonText = g;
      log(`  (구글 로그인 버튼 클릭: "${g}")`);
      break;
    }
    // 서비스 자체 동의 게이트가 먼저 나타날 수 있음: 확인/동의/계속
    const c = await tab.eval(exprClickText('^(\\s*동의\\s*|\\s*확인\\s*|\\s*계속\\s*|\\s*시작하기\\s*)$', 'i', false)).catch(() => null);
    if (c && c !== gateClicked) {
      gateClicked = c;
      jl.serviceGateClicks.push(c);
      log(`  (게이트 버튼 클릭: "${c}")`);
    }
    await sleep(800);
  }
  if (!googleClicked) { jl.loginError = '구글 로그인 버튼을 찾지 못함'; return false; }

  // 2) 구글 계정 선택/동의 → 콜백 → /home 폴링
  let accountClicked = false;
  let consentClicked = false;
  for (let i = 0; i < 90; i++) {
    const u = (await tab.url().catch(() => '')) || '';
    if (/accounts\.google\.com/.test(u)) {
      jl.googleUrls.add(u.split('?')[0]);
      if (/challenge\/pwd|\/password/i.test(u)) jl.googlePasswordChallenge = true;
      // 동의 화면 판정은 경로(pathname) 기준으로만 — continue 파라미터 내 'consent' 오탐 방지
      try { const gp = new URL(u).pathname; if (/consent/i.test(gp) && !/challenge/i.test(gp)) jl.consentGoogleSeen = true; } catch { /* 무시 */ }
      if (!accountClicked) {
        // 지정 계정과 일치하는 항목만 선택(미일치 시 클릭하지 않음 — 비밀번호 유도 방지)
        let c = await tab.eval(exprClickAccount()).catch(() => null);
        if (!c) c = await tab.eval(exprClickText(EMAIL_RE_SRC, 'i', true)).catch(() => null);
        if (c) { accountClicked = true; log(`  (구글 계정 선택: "${c}")`); }
        else if (i > 12 && !jl.loginError) jl.loginError = '일치하는 구글 계정 선택 항목을 찾지 못함';
      } else if (!consentClicked) {
        const c = await tab.eval(exprClickText('^(계속|continue|allow|허용|동의)', 'i', false)).catch(() => null);
        if (c) { consentClicked = true; jl.consentClicked.push(c); log(`  (동의 버튼 클릭: "${c}")`); }
      }
    } else if (/\/auth\/callback/.test(u)) {
      jl.callbackUrl = u;
    } else if (new RegExp(BASE.replace(/https?:/, 'https?:')).test(u)) {
      const mm = await markers(tab);
      if (mm && /\/(home|mypage)(\?|$)/.test(mm.href) && (mm.hasLogout || mm.hasName || mm.hasMyPageStuff)) {
        jl.finalUrl = mm.href;
        break;
      }
    }
    await sleep(1000);
  }
  m = await markers(tab);
  jl.finalUrl = m ? m.href : await tab.url();
  jl.loginMs = Date.now() - t0;
  return !!m; // 여정 성패 판정은 호출부에서 마커 기준으로 수행
}

/** 로그아웃 여정: /mypage → 로그아웃 버튼 → 안정화. 반환: 직전(인증) 마커 */
async function doLogout(tab, jl) {
  await tab.navigate(`${BASE}/mypage`);
  const before = await markers(tab);
  // bfcache/pageshow 관찰용 리스너 주입
  await tab.eval(`window.__bbPersisted = undefined;
    window.addEventListener('pageshow', function(e){ window.__bbPersisted = e.persisted; });`).catch(() => {});
  let clicked = null;
  for (let i = 0; i < 12 && !clicked; i++) {
    clicked = await tab.eval(exprClickText('^\\s*로그아웃\\s*$', 'i', false)).catch(() => null);
    if (!clicked) await sleep(600);
  }
  jl.logoutClicked = clicked;
  if (!clicked) { jl.logoutError = '로그아웃 버튼 미발견'; return before; }
  log(`  (로그아웃 버튼 클릭: "${clicked}")`);
  // 안정화: 개인 마커 소실 + URL 안정
  for (let i = 0; i < 24; i++) {
    await sleep(600);
    const m = await markers(tab);
    if (m && !m.hasLogout && !m.hasMyPageStuff && !m.hasName) break;
  }
  await sleep(1200);
  const after = await markers(tab);
  jl.afterLogoutUrl = after ? after.href : null;
  return before;
}

/* ------------------------------------------------------------------ */
/* TC 그룹 구현                                                        */
/* ------------------------------------------------------------------ */

/** G1 cookies — TC-BBS-001, 002 (+003은 재로그인 관찰에서 채움) */
async function groupCookies(tab, jl) {
  await ensureAuthed(tab, jl);
  await tab.navigate(`${BASE}/home`);
  const cookies = await cookieStore(tab);
  log('  쿠키 스토어(CDP 관찰, 값 마스킹):');
  for (const line of cookieSummary(cookies)) log(`    - ${line}`);
  const v = cookieFlagsVerdict(cookies);
  const authCount = cookies.filter(isAuthCookie).length;
  tc('TC-BBS-001', '세션 쿠키 플래그 계약(HttpOnly·Secure·SameSite)', v.verdict,
    '인증 쿠키는 HttpOnly + Secure + SameSite(Lax 이상)로 발급되어야 함',
    'OWASP Session Management Cheat Sheet (쿠키 속성)',
    `jaroo.kr 쿠키 ${cookies.length}개 중 인증 쿠키 ${authCount}개 관찰 — ${v.detail}`);

  // TC-BBS-002: document.cookie 비가시성
  const docCookie = await tab.eval('document.cookie').catch(() => null);
  const names = (docCookie || '').split(/;\s*/).filter(Boolean).map((p) => p.split('=')[0]);
  const leaked = names.filter((n) => isAuthCookie({ name: n }));
  tc('TC-BBS-002', 'document.cookie 세션 토큰 비가시성(HttpOnly)', leaked.length ? 'FAIL' : 'PASS',
    '인증 세션 쿠키는 document.cookie에서 관찰되지 않아야 함(XSS 토큰 탈취 차단)',
    'OWASP Session Management Cheat Sheet (HttpOnly)',
    `document.cookie 쿠키명 ${names.length}개: [${names.join(', ') || '없음'}] — 인증 쿠키 노출 ${leaked.length ?
      `⇒ ${leaked.join(', ')} (값 길이 기준 세션 페이로드 포함)` : '없음'}`,
    leaked.length ? '세션 토큰이 JS 접근 가능 상태 — XSS 시 토큰 탈취 가능' : null);
}

/** G2 cache — TC-BBS-004 (인증 문서 응답). 로그아웃 여정(005~007)은 별도 함수 */
async function groupCacheDocs(tab, jl) {
  await ensureAuthed(tab, jl);
  const routes = ['/home', '/mypage', '/deepscan'];
  const rows = [];
  for (const r of routes) {
    tab.resetRecorder();
    await tab.navigate(`${BASE}${r}`);
    const doc = lastDocFor(tab, r) || tab.docRequests().slice(-1)[0];
    const cc = doc ? headerVal(doc, 'cache-control') : null;
    const vv = cacheControlVerdict(cc);
    rows.push({ route: r, status: doc ? doc.status : null, cacheControl: cc, verdict: vv.verdict, detail: vv.detail, url: doc ? doc.url : null });
    log(`  ${r}: status=${doc ? doc.status : '?'} cache-control=${cc || '(부재)'}`);
  }
  const worst = rows.map((x) => x.verdict).reduce(rank, 'PASS');
  tc('TC-BBS-004', '민감 페이지(인증) Cache-Control no-store', worst,
    '/home·/mypage·/deepscan 문서 응답은 no-store로 캐시 금지되어야 함',
    'OWASP(민감 정보 캐시 금지)·MDN Cache-Control 표준 관행',
    rows.map((x) => `${x.route}: HTTP ${x.status ?? '?'}, Cache-Control=${x.cacheControl || '부재'} [${x.verdict}]`).join(' | '));
}

async function tcBackAfterLogout(tab, jl) {
  // 히스토리 구성: /home → /mypage (인증) → 로그아웃 → back
  await tab.navigate(`${BASE}/home`);
  await tab.navigate(`${BASE}/mypage`);
  await tab.eval(`window.__bbPersisted = undefined;
    window.addEventListener('pageshow', function(e){ window.__bbPersisted = e.persisted; });`).catch(() => {});
  const authedM = await markers(tab);
  const cookiesBeforeLogout = await cookieStore(tab);
  const authTokenCookies = cookiesBeforeLogout.filter(isAuthCookie);
  await doLogout(tab, jl);
  const guestCookies = await cookieStore(tab);
  const postLogoutUrl = await tab.url();

  // back ×2 관찰(개인정보 노출 여부)
  const backs = [];
  for (let i = 0; i < 2; i++) {
    await tab.eval('history.back()').catch(() => {});
    await sleep(2200);
    const m = await markers(tab);
    backs.push(m ? {
      href: m.href, persisted: m.persisted, navType: m.navType,
      exposed: personalExposed(m), hasName: m.hasName, hasMoney: m.hasMoney, hasMyPageStuff: m.hasMyPageStuff,
    } : { href: await tab.url(), exposed: false });
    if (!backs[i].exposed) break; // 노출 없으면 더 볼 필요 없음
  }
  const anyExposed = backs.some((b) => b.exposed);
  const bfcacheUsed = backs.some((b) => b.persisted === true || b.navType === 'back-forward');
  tc('TC-BBS-005', '로그아웃 직후 뒤로가기 개인정보 캐시 노출', anyExposed ? 'FAIL' : 'PASS',
    '로그아웃 후 뒤로가기 시 개인 페이지(이름·평가액·마이페이지 데이터)가 캐시/bfcache로 재노출되지 않아야 함',
    'OWASP Authentication/Session Management(로그아웃 시 클라이언트 잔여 세션 정보 제거)',
    `로그아웃 후 위치=${postLogoutUrl}; back 결과=[${backs.map((b) =>
      `${b.href} (노출=${b.exposed}${b.persisted != null ? `, pageshow.persisted=${b.persisted}` : ''}${b.navType ? `, nav=${b.navType}` : ''})`).join(' → ')}]`,
    bfcacheUsed && !anyExposed ? 'bfcache/히스토리 복귀 감지 — 개인정보는 미노출(가드 동작)' :
      anyExposed ? '출시 핵심 리스크: 로그아웃 후 개인 데이터 잔존' : null);

  // TC-BBS-006: 쿠키 폐기 (+ 서버 폐기 관찰: 로그아웃 네트워크 호출)
  const remainAuth = guestCookies.filter(isAuthCookie);
  const logoutNet = tab.findRequest((r) => /\/auth\/v1\/logout|signout/i.test(r.url || ''));
  tc('TC-BBS-006', '로그아웃 후 인증 쿠키 폐기', remainAuth.length ? 'FAIL' : 'PASS',
    '로그아웃 시 인증 쿠키는 브라우저에서 제거(또는 즉시 만료)되어야 함',
    'OWASP Session Management Cheat Sheet(로그아웃 = 클라이언트·서버 자격 폐기)',
    `로그아웃 전 인증 쿠키 ${authTokenCookies.length}개 → 후 ${remainAuth.length}개(${remainAuth.map((c) => c.name).join(', ') || '없음'}); ` +
    `로그아웃 네트워크 호출: ${logoutNet ? `${logoutNet.method} ${logoutNet.url.replace(/([?&](code|token)=)[^&]+/g, '$1…')} → ${logoutNet.status}` : '미관찰(클라이언트/다른 경로일 수 있음)'}`);

  // (참고) 폐기 전 액세스 토큰 재사용 — 서버側 세션 취소 관찰(읽기 전용 GET)
  const accessCookie = authTokenCookies.find((c) => /\.0$/.test(c.name)) || authTokenCookies[0];
  if (accessCookie && accessCookie.value) {
    // 청크 쿠키 값은 조립 없이 .0 청크만으로는 불완전할 수 있음 — 값이 base64- 접두면 JSON 조립 시도
    let token = null;
    try {
      const chunks = authTokenCookies
        .filter((c) => /^sb-.+-auth-token\.\d+$/.test(c.name))
        .sort((a, b) => Number((a.name.match(/\.(\d+)$/) || [0, 0])[1]) - Number((b.name.match(/\.(\d+)$/) || [0, 0])[1]));
      if (chunks.length) {
        const joined = chunks.map((c) => c.value).join('').replace(/^base64-/, '');
        const json = JSON.parse(Buffer.from(joined, 'base64').toString('utf8'));
        token = json.access_token || null;
      }
    } catch { token = null; }
    if (token) {
      await tab.navigate(`${BASE}/login`).catch(() => {});
      const replay = await tab.eval(exprFetch(`${BASE}/api/auth/me`, { authorization: `Bearer ${token}` })).catch(() => null);
      const st = replay && replay.status;
      tc('TC-BBS-006', '로그아웃 후 구 액세스 토큰 재사용(서버 폐기 관찰)', st === 401 || st === 403 ? 'PASS' : (st ? 'WARN' : 'BLOCK'),
        '로그아웃된 액세스 토큰은 서버에서도 거부(401/403)되어야 함',
        'OWASP Session Management(서버 측 세션 무효화)',
        `구 토큰으로 GET /api/auth/me → HTTP ${st}${replay && replay.follow ? ` (follow ${replay.follow.status})` : ''}`,
        st === 200 ? '짧은 만료의 무상태 JWT로 인한 잔여 유효 기간일 수 있음 — 만료 정책 확인 권장' : null);
    } else {
      log('  (액세스 토큰 조립 불가 — 재사용 관찰 생략)');
    }
  }

  // TC-BBS-007: 게스트 보호 경로 가드(/mypage 신규 내비게이션)
  tab.resetRecorder();
  await tab.navigate(`${BASE}/mypage`);
  const gm = await markers(tab);
  const guestDoc = lastDocFor(tab, '/mypage') || tab.docRequests().slice(-1)[0];
  const exposed = personalExposed(gm);
  const gate = gm && (gm.hasLoginCta || /\/login/.test(gm.href));
  tc('TC-BBS-007', '로그아웃 후 보호 경로(/mypage) 가드', exposed ? 'FAIL' : (gate ? 'PASS' : 'WARN'),
    '게스트의 /mypage 직접 접근은 개인정보 미노출 + 로그인 유도(리디렉션/게이트)되어야 함',
    'OWASP Access Control(인증 후 자원 접근 제어)·UX 관행',
    `게스트 /mypage → 최종 ${gm ? gm.href : '?'} (문서 HTTP ${guestDoc ? guestDoc.status : '?'}), 개인 마커(이름/평가액/마이페이지)=${exposed}, 로그인 게이트=${!!gate}${gm ? `, 게이트 텍스트 단서: "${gm.textHead.slice(0, 80)}"` : ''}`);
}

/** G4 relogin — TC-BBS-008, 009, 003(Set-Cookie 관찰) */
async function groupRelogin(tab, jl) {
  await ensureGuest(tab, jl);
  tab.resetRecorder();
  const ok = await doLogin(tab, jl);
  const m = await markers(tab);

  tc('TC-BBS-008', '재로그인 여정(구글 계정 선택 → 콜백 → /home)', (m && /\/home/.test(m.href) && (m.hasLogout || m.hasName)) ? 'PASS' : (ok ? 'WARN' : 'BLOCK'),
    '로그아웃 후 재로그인은 저장된 구글 세션으로 계정 선택만으로 완료되어 /home에 도달해야 함',
    'OAuth 2.0 / Google 로그인 UX 관행(기존 동의·세션 재사용)',
    `경유: ${[jl.loginStartUrl, ...jl.googleUrls, jl.callbackUrl, jl.finalUrl].filter(Boolean).map((u) => String(u).split('?')[0]).join(' → ')}; ` +
    `최종=${m ? m.href : '?'} (이름=${m ? m.hasName : '?'}, 로그아웃 버튼=${m ? m.hasLogout : '?'}), 소요 ${((jl.loginMs || 0) / 1000).toFixed(1)}s`,
    jl.googlePasswordChallenge ? '구글 비밀번호 재확인(challenge/pwd) 관찰 — 프로필의 구글 세션이 만료되면 비밀번호 입력 요구(자동화 불가 구간)' :
      jl.loginError ? `자동화 이슈: ${jl.loginError}` : null);

  // TC-BBS-009: 동의 게이트
  const consentNotes = [];
  if (jl.consentGoogleSeen) consentNotes.push('구글 동의(consent) 화면 등장');
  if (jl.consentClicked.length) consentNotes.push(`동의 버튼 클릭: ${jl.consentClicked.join(', ')}`);
  if (jl.serviceGateClicks.length) consentNotes.push(`서비스 게이트 버튼: ${jl.serviceGateClicks.join(', ')}`);
  if (jl.callbackUrl && /consent=/.test(jl.callbackUrl)) consentNotes.push('콜백에 consent 파라미터 확인(서비스 동의 타임스탬프 추정)');
  if (!consentNotes.length) consentNotes.push(jl.loginError || jl.googlePasswordChallenge ?
    '재로그인 미완료(구글 재인증 요구 등)로 동의 게이트 관찰 불가' :
    '동의 재확인 화면 없이 계정 선택(또는 자동)만으로 진행');
  tc('TC-BBS-009', '재로그인 시 동의(consent) 게이트 동작', jl.loginError ? 'BLOCK' : (jl.consentGoogleSeen ? 'WARN' : 'PASS'),
    '이미 동의한 사용자의 재로그인은 불필요한 재동의를 요구하지 않아야 함(계정 선택만으로 진행)',
    'OAuth 2.0 UX 관행(Google Identity Platform: 기존 동의는 생략)',
    consentNotes.length ? consentNotes.join('; ') : '동의 재확인 화면 없이 계정 선택(또는 자동)만으로 진행',
    jl.consentGoogleSeen ? '재동의 화면 관찰 — 권한 변경이 없었다면 스킵 권장' : null);

  // TC-BBS-003: 로그인 시 Set-Cookie 네트워크 관찰 (+ 로그인 후 쿠키 스토어 대비)
  const postLoginCookies = await cookieStore(tab);
  const postAuth = postLoginCookies.filter(isAuthCookie);
  const jarooSets = [...tab.requests.values()].filter((r) => (r.url || '').startsWith(BASE) && r.setCookies.length);
  const sbSets = [...tab.requests.values()].filter((r) => /supabase\.co/.test(r.url || '') && r.setCookies.length);
  const allSets = jarooSets.flatMap((r) => r.setCookies.map((c) => ({ url: r.url, c })));
  const setInfo = allSets.map(({ url, c }) => `${new URL(url).host}: ${c.split(';')[0].split('=')[0]} [${cookieAttrText(c)}]`);
  const attrBad = allSets.filter(({ c }) => {
    const noHttpOnly = !/httponly/i.test(c);
    const noSecure = !/secure/i.test(c);
    const ssNone = /samesite\s*=\s*none/i.test(c);
    return (noHttpOnly || noSecure || ssNone) && /auth|token|session/i.test(c);
  });
  // Set-Cookie 헤더 부재 + 로그인 후 인증 쿠키 존재 ⇒ 클라이언트 JS(document.cookie) 설정 확증
  const viaJs = !allSets.length && postAuth.length > 0;
  const v003 = allSets.length ? (attrBad.length ? 'FAIL' : 'PASS') : (viaJs ? 'FAIL' : 'WARN');
  tc('TC-BBS-003', '로그인 시 세션 쿠키 발급 방식(Set-Cookie 플래그)', v003,
    '세션 쿠키는 Set-Cookie(HttpOnly; Secure; SameSite)로 발급되어야 함',
    'OWASP Session Management Cheat Sheet(Set-Cookie 속성)',
    allSets.length ?
      `Set-Cookie 관찰 ${allSets.length}건: ${setInfo.join(' | ')}` :
      `jaroo.kr 응답에서 Set-Cookie 헤더 미관찰 + 로그인 직후 인증 쿠키 ${postAuth.length}개 생성 ⇒ 클라이언트 JS(document.cookie) 설정으로 확증 — HttpOnly 설정 불가 구조(OWASP 권고 미충족, TC-BBS-001/002 참조)`,
    viaJs ? 'BFF 패턴 또는 서버 발급 HttpOnly 쿠키 전환 권장(OWASP Session Management)' : (sbSets.length ? ` (supabase.co 도메인 Set-Cookie ${sbSets.length}건 별도 관찰 — jaroo.kr로 전송되지 않음)` : ''));
}

function cookieAttrText(setCookieStr) {
  const flags = [];
  if (/httponly/i.test(setCookieStr)) flags.push('HttpOnly');
  if (/secure/i.test(setCookieStr)) flags.push('Secure');
  const m = /samesite\s*=\s*(lax|strict|none)/i.exec(setCookieStr);
  flags.push(m ? `SameSite=${m[1]}` : 'SameSite미지정');
  return flags.join('+');
}

/** G5 guards — 게스트(TC-BBS-010~013) & 인증(TC-BBS-014) 매트릭스 */
const GUARD_ROUTES = [
  ['/home', 'TC-BBS-010'],
  ['/mypage', 'TC-BBS-011'],
  ['/deepscan', 'TC-BBS-012'],
  ['/ocr', 'TC-BBS-013'],
];

async function guestGuardMatrix(tab, jl) {
  log('  — 게스트 매트릭스 —');
  for (const [r, id] of GUARD_ROUTES) {
    await tab.navigate(`${BASE}${r}`);
    const m = await markers(tab);
    // 강한 개인식별(이름·이메일)만 FAIL — 가이드/샘플 텍스트(예: "평가금액" 안내문)는 약한 신호로만 기록
    const strict = !!(m && (m.hasName || m.hasEmail));
    const soft = !!(m && (m.hasMoney || m.hasMyPageStuff));
    const gate = !!(m && (m.hasLoginCta || /\/login/.test(m.href)));
    const verdict = strict ? 'FAIL' : (soft && !gate ? 'WARN' : 'PASS');
    tc(id, `게스트 가드: ${r} 접근`, verdict,
      '게스트 접근 시 개인식별정보(이름·이메일·실제 보유 데이터) 미노출 + 로그인 유도(리디렉션/CTA)',
      'OWASP Access Control(인증 게이트)·UX 관행',
      `최종 URL=${m ? m.href : '?'}; 개인식별=${strict}; 약한 마커(가이드 텍스트 포함 가능)=${soft}; 로그인 게이트=${gate}; 화면 단서="${m ? m.textHead.slice(0, 90) : '?'}"`,
      soft && !strict ? '약한 마커는 업로드 가이드의 예시 데이터(삼성전자 등)에서 기인할 수 있음 — 개인식별정보 아님' : null);
  }
}

async function authGuardMatrix(tab, jl) {
  log('  — 인증 매트릭스 —');
  await ensureAuthed(tab, jl);
  await tab.navigate(`${BASE}/mypage`).catch(() => {});
  const pre = await markers(tab);
  const authedOk = !!(pre && !/\/login/.test(pre.href) && (pre.hasLogout || pre.hasMyPageStuff || pre.hasName));
  if (!authedOk) {
    tc('TC-BBS-014', '인증 상태 보호 라우트 정상 접근(4 라우트)', 'BLOCK',
      '인증 사용자는 4개 라우트 모두 로그인 게이트 없이 이용 가능해야 함',
      'UX 관행(인증 후 자원 접근 허용)·크로스환경 일관성',
      `인증 상태 확보 실패(최종 ${pre ? pre.href : '?'}) — 게스트 상태로 측정 무효`,
      '구글 프로필 세션 재인증 후 재실행 필요');
    return;
  }
  const authRows = [];
  for (const [r] of GUARD_ROUTES) {
    await tab.navigate(`${BASE}${r}`);
    const m = await markers(tab);
    const onLogin = m && /\/login/.test(m.href);
    const personal = !!(m && !onLogin && (m.hasName || m.hasMoney || m.hasMyPageStuff || m.hasLogout || m.hasDeepscanUi));
    authRows.push({ route: r, url: m ? m.href : '?', gated: !!onLogin, personal });
    log(`  ${r}: 최종=${authRows[authRows.length - 1].url} 게이트=${onLogin} 작업UI/개인=${personal}`);
  }
  const blockedRows = authRows.filter((x) => x.gated || !x.personal);
  tc('TC-BBS-014', '인증 상태 보호 라우트 정상 접근(4 라우트)', blockedRows.length ? 'WARN' : 'PASS',
    '인증 사용자는 4개 라우트 모두 로그인 게이트 없이 이용 가능해야 함',
    'UX 관행(인증 후 자원 접근 허용)·크로스환경 일관성',
    authRows.map((x) => `${x.route}→${x.url.replace(BASE, '')} [게이트=${x.gated}, 콘텐츠=${x.personal}]`).join(' | '),
    blockedRows.length ? '일부 라우트에서 게이트/콘텐츠 상태 이상 — 원인 확인 필요' : null);
}

async function groupGuards(tab, jl) {
  await ensureGuest(tab, jl);
  await guestGuardMatrix(tab, jl);
  await authGuardMatrix(tab, jl);
}

/** G6 api — TC-BBS-015(게스트 401) / TC-BBS-016(인증 200) */
async function guestApiContract(tab, jl) {
  const apis = ['/api/auth/me', '/api/portfolio', '/api/payments/me'];
  await ensureGuest(tab, jl);
  await tab.navigate(`${BASE}/login`).catch(() => {});
  const guestRows = [];
  for (const p of apis) {
    const r = await tab.eval(exprFetch(`${BASE}${p}`)).catch((e) => ({ error: String(e) }));
    guestRows.push({ p, r });
    log(`  게스트 ${p} → status=${r.status}${r.follow ? ` (follow ${r.follow.status} ${r.follow.url || ''})` : ''} ${r.error || ''}`);
  }
  const verdictRow = (p, r) => {
    if (r.error) return 'BLOCK';
    // /me 계열(신원·결제 요약): 익명 컨텍스트(200 + guest 스코프 + 개인정보 미포함)는 허용(경고),
    // 개인식별정보가 담기면 FAIL. 명백한 개인데이터 API(/api/portfolio)는 401 필수.
    if (p === '/api/auth/me' || p === '/api/payments/me') {
      if (r.status === 401 || r.status === 403) return 'PASS';
      if (r.status === 200) {
        const body = String(r.bodyHead || '');
        const personalLeak = new RegExp(`${ACCOUNT_NAME}|0505@gmail|access_token|refresh_token`, 'i').test(body);
        if (personalLeak) return 'FAIL';
        return /"authScope"\s*:\s*"guest"/.test(body) ? 'WARN' : 'FAIL';
      }
      return 'WARN';
    }
    if (r.status === 401) return 'PASS';
    if (r.status === 403) return 'WARN';
    if (r.status === 200) return 'FAIL';
    return 'WARN';
  };
  const v1 = guestRows.map((x) => verdictRow(x.p, x.r));
  tc('TC-BBS-015', 'API 인증 계약: 게스트 호출 401', v1.reduce(rank, 'PASS'),
    '개인 데이터 API(/api/portfolio·/api/payments/me)는 게스트에 401. /api/auth/me는 익명 컨텍스트(200 + 개인정보 미포함) 또는 401',
    'RFC 9110 §15.5.1(401 Unauthorized)·OWASP API Security·REST 관행(/me 익명 컨텍스트)',
    guestRows.map((x) => `${x.p}: HTTP ${x.r.status}${x.r.follow ? ` → follow ${x.r.follow.status} (${(x.r.follow.contentType || '').split(';')[0]})` : ''}${x.r.bodyHead ? ` body=${String(x.r.bodyHead).slice(0, 60)}` : ''}${x.r.error ? ` err=${x.r.error}` : ''}`).join(' | '),
    v1.includes('FAIL') ? '게스트에게 개인 데이터 반환 — 즉시 수정 필요' :
      (v1.includes('WARN') ? '게스트 스코프 응답(개인정보 미포함) — 401 계약과 설계 상이, API 계약 문서화 권장' : null));
}

/** G6 api — TC-BBS-016(인증 200) 절반 */
async function authApiContract(tab, jl) {
  await ensureAuthed(tab, jl);
  await tab.navigate(`${BASE}/mypage`).catch(() => {});
  const am = await markers(tab);
  const authedOk = !!(am && !/\/login/.test(am.href) && (am.hasLogout || am.hasMyPageStuff || am.hasName));
  const apis = ['/api/auth/me', '/api/portfolio'];
  const authRows = [];
  for (const p of apis) {
    const r = await tab.eval(exprFetch(`${BASE}${p}`)).catch((e) => ({ error: String(e) }));
    authRows.push({ p, r });
  }
  const v2 = authRows.map((x) => (x.r.error ? 'BLOCK' : (x.r.status >= 200 && x.r.status < 300 ? 'PASS' : 'FAIL')));
  if (!authedOk) v2.fill('BLOCK');
  tc('TC-BBS-016', 'API 인증 계약: 인증 상태 정상 응답', v2.reduce(rank, 'PASS'),
    '인증 상태 동일 API 호출은 2xx + 개인 데이터 정상 반환',
    'RFC 9110(2xx 성공 의미론)·크로스환경 일관성',
    authRows.map((x) => `${x.p}: HTTP ${x.r.status}${x.r.bodyHead ? ` body=${String(x.r.bodyHead).slice(0, 80)}` : ''}${x.r.error ? ` err=${x.r.error}` : ''}`).join(' | ') +
    (authedOk ? '' : ' — 인증 상태 확인 실패로 측정 무효'),
    authedOk ? null : '재로그인 실패(구글 세션 제약) — 프로필 재인증 후 재실행 필요');
}

/** G6 api — 단독 실행용(게스트→인증 순서로 상태 보장) */
async function groupApi(tab, jl) {
  await guestApiContract(tab, jl);
  await authApiContract(tab, jl);
}

/** G7 persistence — TC-BBS-017(새로고침) / TC-BBS-018(새 탭) */
async function groupPersistence(tab, jl) {
  await ensureAuthed(tab, jl);
  await tab.navigate(`${BASE}/home`);
  const before = await markers(tab);
  await tab.cdp.send('Page.reload', {}, tab.sessionId).catch(() => {});
  await sleep(2500);
  let m = null;
  for (let i = 0; i < 10; i++) { m = await markers(tab); if (m && m.ready === 'complete') break; await sleep(500); }
  const kept = m && (m.hasName || m.hasLogout || m.hasMyPageStuff);
  tc('TC-BBS-017', '새로고침 후 세션 유지', kept ? 'PASS' : 'FAIL',
    '새로고침 후에도 로그인 상태(개인화 콘텐츠)가 유지되어야 함',
    'UX 관행(세션 지속성)·크로스환경 일관성',
    `reload /home: 이름=${m ? m.hasName : '?'}, 로그아웃버튼=${m ? m.hasLogout : '?'}, 마이데이터=${m ? m.hasMyPageStuff : '?'} (이전: 이름=${before ? before.hasName : '?'})`);

  const t2 = await Tab.create(tab.cdp, `${BASE}/home`);
  await sleep(3500);
  let m2 = null;
  for (let i = 0; i < 8; i++) { m2 = await t2.eval(exprMarkers()).catch(() => null); if (m2 && m2.ready === 'complete') break; await sleep(600); }
  const kept2 = m2 && (m2.hasName || m2.hasLogout || m2.hasMyPageStuff);
  tc('TC-BBS-018', '새 탭 재오픈 후 세션 유지', kept2 ? 'PASS' : 'FAIL',
    '새 탭에서 서비스 재오픈 시 로그인 상태가 유지되어야 함',
    'UX 관행(세션 지속성)·쿠키 기반 세션 일관성',
    `새 탭 /home: 이름=${m2 ? m2.hasName : '?'}, 로그아웃버튼=${m2 ? m2.hasLogout : '?'}, URL=${m2 ? m2.href : '?'}`);
  await t2.close();
}

function rank(a, b) {
  const order = { PASS: 0, WARN: 1, BLOCK: 2, FAIL: 3 };
  return order[a] >= order[b] ? a : b;
}

/* ------------------------------------------------------------------ */
/* 메인                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  const argv = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  const wants = argv.length ? argv : ['all'];
  log(`jaroo 블랙박스 세션·보안·캐시 TC — 대상=${BASE} (CDP ${CDP_PORT}, 9222 미접속 원칙)`);
  log(`그룹: ${wants.join(', ')} | 계정 마커: ${ACCOUNT_EMAIL.replace(/(.{3}).*(@.*)/, '$1…$2')}\n`);

  const cdp = await CDP.connect(CDP_PORT);
  const tab = await Tab.create(cdp, 'about:blank');
  const jl = {
    visited: [], googleUrls: new Set(), consentClicked: [], serviceGateClicks: [],
    callbackUrl: null, finalUrl: null, loginStartUrl: null, loginMs: 0,
  };

  const cleanup = async () => { await tab.close().catch(() => {}); };
  process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

  try {
    if (wants.includes('all')) {
      // 단일 여정(운영 부하 최소화): 인증 검사 → 로그아웃 → 게스트 검사 →
      // 재로그인 1회(캡처 포함) → 인증 검사. 로그인/로그아웃 각 1회만 수행.
      await groupPersistence(tab, jl);   // TC-017/018 (인증 상태, 무부작용)
      await groupCookies(tab, jl);       // TC-001/002 (인증 상태)
      await groupCacheDocs(tab, jl);     // TC-004 (인증 상태 문서 응답)
      await tcBackAfterLogout(tab, jl);  // TC-005/006/007 (로그아웃 발생 → 게스트)
      await guestGuardMatrix(tab, jl);   // TC-010~013 (게스트)
      await guestApiContract(tab, jl);   // TC-015 (게스트)
      await groupRelogin(tab, jl);       // TC-008/009/003 (재로그인, Set-Cookie 캡처)
      await authGuardMatrix(tab, jl);    // TC-014 (인증)
      await authApiContract(tab, jl);    // TC-016 (인증)
    } else {
      if (wants.includes('cookies')) await groupCookies(tab, jl);
      if (wants.includes('cache')) { await groupCacheDocs(tab, jl); await tcBackAfterLogout(tab, jl); }
      if (wants.includes('logout')) { await ensureAuthed(tab, jl); await tcBackAfterLogout(tab, jl); }
      if (wants.includes('guards')) await groupGuards(tab, jl);
      if (wants.includes('auth')) await authGuardMatrix(tab, jl);
      if (wants.includes('api')) await groupApi(tab, jl);
      if (wants.includes('relogin')) await groupRelogin(tab, jl);
      if (wants.includes('persistence')) await groupPersistence(tab, jl);
    }
  } catch (e) {
    log(`\n⚠️ 실행 중 오류: ${e.stack || e.message}`);
  } finally {
    await cleanup();
  }

  // 요약
  const counts = { PASS: 0, WARN: 0, FAIL: 0, BLOCK: 0 };
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  log('================ 요약 ================');
  log(`TC ${results.length}건: PASS=${counts.PASS} WARN=${counts.WARN} FAIL=${counts.FAIL} BLOCK=${counts.BLOCK}`);
  for (const r of results.filter((x) => x.verdict === 'FAIL' || x.verdict === 'WARN')) {
    log(`  - [${r.verdict}] ${r.id} ${r.name}`);
  }
  process.stdout.write('SUMMARY_JSON ' + JSON.stringify({ base: BASE, cdp: CDP_PORT, ranAt: nowIso(), counts, results }) + '\n');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
