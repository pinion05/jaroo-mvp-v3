#!/usr/bin/env node
/**
 * jaroo 블랙박스 패리티·공개 표면 TC 스크립트
 * ------------------------------------------------
 * 원칙:
 *  - 제품 소스/내부 문서에 의존하지 않는다. 기대값 출처는 오직
 *    ① 공개 웹 표준/보안 관행 ② 공개 법령 지식 ③ 일반 UX 관행
 *    ④ 크로스환경 일관성 ⑤ 제품 공개 문구(공개 페이지에 실제 노출되는 문구)
 *  - 관찰은 공개 표면 GET/HEAD 요청과 응답 헤더/본문만.
 *  - 운영(jaroo.kr) 비파괴: 경로당 실제 요청은 캐시로 1~2회로 제한,
 *    재시도 없음, 순차 실행 + 요청 간 정치(polite) 지연.
 *  - 파일을 생성/수정하지 않고 표준 출력으로만 보고한다.
 *
 * 사용법:
 *   node scripts/blackbox-parity.cjs                  # 전체 그룹, local+prod
 *   node scripts/blackbox-parity.cjs headers pages    # 그룹 선택
 *   node scripts/blackbox-parity.cjs --env=local      # 환경 선택(local|prod|both)
 *   node scripts/blackbox-parity.cjs --json           # 원본 관찰 JSON 출력
 * 환경변수:
 *   BASE_URL  로컬 기본값 http://127.0.0.1:3002
 *   PROD_URL  운영 기본값 https://jaroo.kr
 */

'use strict';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');
const PROD_URL = (process.env.PROD_URL || 'https://jaroo.kr').replace(/\/+$/, '');
const UA = 'jaroo-blackbox-parity-tc/1.0 (+non-destructive public-surface probe)';
const TIMEOUT_MS = 15000;
const POLITE_DELAY_PROD_MS = 400; // 운영 요청 간 지연 — 부하 방지

// ---------- CLI ----------
const argv = process.argv.slice(2);
const GROUPS = ['availability', 'headers', 'pages', 'robots', 'parity'];
let envFilter = 'both';
let jsonOnly = false;
const selected = [];
for (const a of argv) {
  if (a.startsWith('--env=')) envFilter = a.slice(6);
  else if (a === '--json') jsonOnly = true;
  else if (a === 'all') selected.push(...GROUPS);
  else if (GROUPS.includes(a)) selected.push(a);
  else {
    console.error(`알 수 없는 인자: ${a}\n사용 가능 그룹: ${GROUPS.join(', ')}`);
    process.exit(2);
  }
}
const runGroups = selected.length ? [...new Set(selected)] : GROUPS;
const wantLocal = envFilter === 'local' || envFilter === 'both';
const wantProd = envFilter === 'prod' || envFilter === 'both';
// parity 그룹은 다른 그룹 관찰에 의존 → 단독 선택 시 전체 수집
const collectAll = runGroups.includes('parity') && runGroups.length === 1;
const effectiveGroups = collectAll ? GROUPS : runGroups;

// ---------- 요청 캐시 (운영 비파괴: 경로·메서드당 1회) ----------
const cache = new Map(); // key: method+' '+absoluteURL
async function request(method, url, { readBody = false } = {}) {
  const key = method + ' ' + url;
  if (cache.has(key)) return cache.get(key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let entry;
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual', // 리다이렉트 체인을 직접 관찰
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
    });
    const headers = {};
    for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
    let body = null;
    if (readBody) body = await res.text();
    entry = { ok: true, url, status: res.status, headers, body };
  } catch (e) {
    entry = { ok: false, url, error: String(e && e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : e) };
  } finally {
    clearTimeout(t);
  }
  cache.set(key, entry);
  if (url.startsWith('https://jaroo') || url.startsWith('http://jaroo')) {
    await new Promise((r) => setTimeout(r, POLITE_DELAY_PROD_MS));
  }
  return entry;
}

// 헤더 소문자 키 안전 조회
const h = (res, name) => (res && res.headers ? res.headers[name.toLowerCase()] : undefined);

// ---------- 판정 기록 ----------
const results = [];
const observations = { local: {}, prod: {} };
function record(id, group, env, name, expected, source, actual, verdict) {
  results.push({ id, group, env, name, expected, source, actual, verdict });
}
function brief(s, n = 110) {
  if (s == null) return null;
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ---------- HTML 관찰 유틸 (공개 표면 응답 본문 파싱) ----------
function htmlInfo(html) {
  if (html == null) return null;
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || null;
  const desc = (html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) || [])[1] || null;
  const og = {};
  const ogRe = /<meta[^>]+property="(og:[a-zA-Z:]+)"[^>]+content="([^"]*)"/gi;
  let m;
  while ((m = ogRe.exec(html))) og[m[1]] = m[2];
  const favicons = [...html.matchAll(/<link[^>]+rel="(icon|apple-touch-icon|shortcut icon|alternate icon)"[^>]*>/gi)].map((x) => x[0]);
  const hasHangulTitle = /[가-힣]/.test(title || '');
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return { title, desc, og, favicons, hasHangulTitle, text };
}

// 기대값 출천 상수 (문서의 ①~⑤와 대응)
const SRC = {
  SEC: '① 공개 보안 관행(OWASP/MDN: HTTPS 사이트 HSTS·클릭재킹 방지·MIME 스니핑 방지)',
  STD: '① 공개 웹 표준/관행(robots RFC9309 · sitemap protocol)',
  LAW_CAP: '② 공개 법령(자본시장법 — 무등록 투자자문업 오해 방지 고지 관행)',
  LAW_PRIV: '② 공개 법령(개인정보보호법 — 수집·이용·파기 등 처리 항목 고지)',
  UX: '③ 일반 UX 관행(404 표면·파비콘·OG 태그·한글 타이틀)',
  XENV: '④ 크로스환경 일관성(동일 제품 local↔prod 공개 표면 비교)',
  WORD: '⑤ 제품 공개 문구(운영/로컬 공개 페이지에 실제 노출된 문구)',
};

// ================= 그룹 1: 가용성·전환 리다이렉트 =================
async function groupAvailability(want, env) {
  const isProd = env === 'prod';
  const base = isProd ? PROD_URL : BASE_URL;

  if (isProd) {
    // TC-BBP-001: http→https 리다이렉트
    const r = await request('HEAD', 'http://jaroo.kr/');
    const loc = h(r, 'location') || '';
    const ok = r.ok && [301, 308, 302, 307].includes(r.status) && loc.startsWith('https://');
    record('TC-BBP-001', 'availability', 'prod', 'http→https 리다이렉트', 'http:// 요청은 301/308 등으로 https:// 로 전환', SRC.SEC,
      r.ok ? `status=${r.status}, location=${loc || '(없음)'}` : `요청 실패: ${r.error}`, ok ? 'PASS' : 'FAIL');

    // TC-BBP-002: www→apex 정규화
    const w = await request('HEAD', 'https://www.jaroo.kr/');
    const wloc = h(w, 'location') || '';
    const apex = new URL(PROD_URL).host;
    const wOk = w.ok && w.status >= 301 && w.status <= 308 && wloc.includes(apex);
    record('TC-BBP-002', 'availability', 'prod', 'www→apex 정규화', `www 요청은 ${apex} 로 정규화(리다이렉트)` + ` — www이 별도 200으로 서빙되면 관찰`, SRC.UX,
      w.ok ? `status=${w.status}, location=${wloc || '(없음)'}` : `요청 실패: ${w.error}`,
      wOk ? 'PASS' : w.ok && w.status === 200 ? 'OBSERVE' : 'WARN');
    observations.prod['www /'] = w.ok ? `${w.status} ${wloc}` : `ERR ${w.error}`;

    // TC-BBP-003: /login 200
    const lg = await request('HEAD', `${PROD_URL}/login`);
    record('TC-BBP-003', 'availability', 'prod', '/login 가용(200)', '로그인 진입 공개 페이지는 200', SRC.UX,
      lg.ok ? `status=${lg.status}, location=${h(lg, 'location') || '(없음)'}` : `요청 실패: ${lg.error}`,
      lg.ok && lg.status === 200 ? 'PASS' : 'FAIL');
    observations.prod['/login'] = lg.ok ? lg.status : `ERR ${lg.error}`;

    // TC-BBP-005: 비정상 경로 404
    const nf = await request('HEAD', `${PROD_URL}/__bb_noexist__`);
    record('TC-BBP-005', 'availability', 'prod', '비정상 경로 404 표면', '존재하지 않는 경로는 404(200 soft-error/5xx 아님)', SRC.UX,
      nf.ok ? `status=${nf.status}` : `요청 실패: ${nf.error}`, nf.ok && nf.status === 404 ? 'PASS' : nf.ok && nf.status === 403 ? 'WARN' : 'FAIL');
    observations.prod['/__bb_noexist__'] = nf.ok ? nf.status : `ERR ${nf.error}`;

    // 운영 / 전환 관찰 (parity 비교용)
    const root = await request('HEAD', `${PROD_URL}/`);
    observations.prod['/'] = root.ok ? `${root.status} ${h(root, 'location') || ''}`.trim() : `ERR ${root.error}`;
  } else {
    // TC-BBP-004: 로컬 /login 200
    const lg = await request('HEAD', `${BASE_URL}/login`);
    record('TC-BBP-004', 'availability', 'local', '/login 가용(200)', '로그인 진입 공개 페이지는 200', SRC.UX,
      lg.ok ? `status=${lg.status}, location=${h(lg, 'location') || '(없음)'}` : `요청 실패: ${lg.error}`,
      lg.ok && lg.status === 200 ? 'PASS' : 'FAIL');
    observations.local['/login'] = lg.ok ? lg.status : `ERR ${lg.error}`;

    // TC-BBP-006: 로컬 비정상 경로 404
    const nf = await request('HEAD', `${BASE_URL}/__bb_noexist__`);
    record('TC-BBP-006', 'availability', 'local', '비정상 경로 404 표면', '존재하지 않는 경로는 404(200 soft-error/5xx 아님)', SRC.UX,
      nf.ok ? `status=${nf.status}` : `요청 실패: ${nf.error}`, nf.ok && nf.status === 404 ? 'PASS' : nf.ok && nf.status === 403 ? 'WARN' : 'FAIL');
    observations.local['/__bb_noexist__'] = nf.ok ? nf.status : `ERR ${nf.error}`;

    // TC-BBP-007: 로컬 / 전환 관찰 (미인증 → 로그인 전환이 일반 관행; 관찰 중심)
    const root = await request('HEAD', `${BASE_URL}/`);
    const loc = h(root, 'location') || '';
    record('TC-BBP-007', 'availability', 'local', '/ 진입 전환 관찰', '미인증 루트 진입 시 로그인 등으로 전환되는 것이 일반적(제품 공개 표면 관찰)', SRC.UX,
      root.ok ? `status=${root.status}, location=${loc || '(없음)'}` : `요청 실패: ${root.error}`,
      root.ok ? (root.status === 200 || (root.status >= 300 && root.status < 400) ? 'PASS' : 'WARN') : 'FAIL');
    observations.local['/'] = root.ok ? `${root.status} ${loc}`.trim() : `ERR ${root.error}`;
  }
}

// ================= 그룹 2: 보안 헤더 계약 =================
function cookieFlags(setCookie) {
  if (!setCookie) return null;
  const sc = String(setCookie);
  return {
    httpOnly: /httponly/i.test(sc),
    secure: /secure/i.test(sc),
    sameSite: (sc.match(/samesite=([^;]+)/i) || [])[1] || null,
  };
}
async function groupHeaders(want, env) {
  const isProd = env === 'prod';
  const base = isProd ? PROD_URL : BASE_URL;
  const r = await request('HEAD', `${base}/login`);

  if (!r.ok) {
    record(isProd ? 'TC-BBP-008' : 'TC-BBP-013', 'headers', env, '헤더 관찰 가능', '응답 헤더 관찰 가능', SRC.SEC, `요청 실패: ${r.error}`, 'ERROR');
    return;
  }
  const hs = r.headers;
  observations[env]['headers(/login)'] = {
    hsts: hs['strict-transport-security'] || null,
    xfo: hs['x-frame-options'] || null,
    nosniff: hs['x-content-type-options'] || null,
    csp: hs['content-security-policy'] || null,
    referrer: hs['referrer-policy'] || null,
    cache: hs['cache-control'] || null,
    server: hs['server'] || null,
    xPoweredBy: hs['x-powered-by'] || null,
    setCookie: hs['set-cookie'] || null,
  };

  if (isProd) {
    // TC-BBP-008: HSTS
    const hsts = hs['strict-transport-security'];
    let v = 'FAIL';
    let actual = hsts ? brief(hsts) : 'Strict-Transport-Security 헤더 없음';
    if (hsts) {
      const age = parseInt((hsts.match(/max-age=(\d+)/i) || [])[1] || '0', 10);
      if (age >= 15552000) v = 'PASS';
      else if (age > 0) { v = 'WARN'; actual += ` (max-age ${age} < 15552000 권장)`.replace('15552000', '180일'); }
    }
    record('TC-BBP-008', 'headers', 'prod', 'HSTS(Strict-Transport-Security)', 'HTTPS 운영 사이트는 HSTS 필수 관행 — max-age ≥ 180일(15552000), includeSubDomains 권장', SRC.SEC, actual, v);

    // TC-BBP-009: 클릭재킹 방지
    const xfo = hs['x-frame-options'];
    const csp = hs['content-security-policy'] || '';
    const frameOk = (xfo && /deny|sameorigin/i.test(xfo)) || /frame-ancestors/i.test(csp);
    record('TC-BBP-009', 'headers', 'prod', '클릭재킹 방지(XFO/CSP frame-ancestors)', 'X-Frame-Options: DENY|SAMEORIGIN 또는 CSP frame-ancestors 중 하나 이상', SRC.SEC,
      `X-Frame-Options=${xfo || '없음'}${csp ? '; CSP(frame-ancestors)=' + (csp.match(/frame-ancestors[^;]*/i) || ['없음'])[0] : ''}`,
      frameOk ? 'PASS' : 'FAIL');

    // TC-BBP-010: nosniff
    const nosniff = hs['x-content-type-options'];
    record('TC-BBP-010', 'headers', 'prod', 'MIME 스니핑 방지(nosniff)', 'X-Content-Type-Options: nosniff', SRC.SEC,
      nosniff || '헤더 없음', nosniff && /nosniff/i.test(nosniff) ? 'PASS' : 'FAIL');

    // TC-BBP-011: 캐시 정책 (개인 콘텐츠 HTML)
    const cacheC = hs['cache-control'] || '';
    const noStore = /no-store|no-cache|must-revalidate|private/i.test(cacheC);
    record('TC-BBP-011', 'headers', 'prod', 'HTML 캐시 정책', '앱 HTML 응답은 no-store/no-cache/must-revalidate 등 재검증 정책 권장(민감 동적 표면 캐시 방지 관행)', SRC.SEC,
      cacheC ? brief(cacheC) : 'Cache-Control 헤더 없음', noStore ? 'PASS' : 'WARN');

    // TC-BBP-012: Referrer-Policy
    const rp = hs['referrer-policy'];
    record('TC-BBP-012', 'headers', 'prod', 'Referrer-Policy 존재', 'Referrer-Policy 지정 권장(strict-origin-when-cross-origin 등)', SRC.SEC,
      rp || '헤더 없음', rp ? 'PASS' : 'WARN');

    // TC-BBP-014(운영): 쿠키 플래그 — 공개 GET에서 Set-Cookie가 있을 때만 관찰
    const cf = cookieFlags(hs['set-cookie']);
    record('TC-BBP-014', 'headers', 'prod', '쿠키 플래그 관찰(공개 GET)', '세션 쿠키 발급 시 Secure+HttpOnly(+SameSite) 기대 — 미인증 공개 GET에서는 미발급이 정상', SRC.SEC,
      cf ? `HttpOnly=${cf.httpOnly}, Secure=${cf.secure}, SameSite=${cf.sameSite || '없음'}` : 'Set-Cookie 미발급(공개 GET)',
      cf ? (cf.httpOnly && cf.secure ? 'PASS' : 'WARN') : 'INFO');
  } else {
    // TC-BBP-013: 로컬 헤더 패리티 — XFO/nosniff/referrer 중심 관찰
    const xfo = hs['x-frame-options'], nosniff = hs['x-content-type-options'], rp = hs['referrer-policy'];
    const core = [xfo, nosniff, rp].filter(Boolean).length;
    record('TC-BBP-013', 'headers', 'local', '로컬 핵심 헤더(XFO/nosniff/Referrer) 관찰', '운영과 동일한 핵심 방어 헤더가 로컬에서도 관찰됨(dev 서버는 http이므로 HSTS 제외 정상)', SRC.XENV,
      `X-Frame-Options=${xfo || '없음'}, nosniff=${nosniff || '없음'}, Referrer-Policy=${rp || '없음'}`,
      core === 3 ? 'PASS' : core >= 1 ? 'WARN' : 'FAIL');
  }
}

// ================= 그룹 3: 공개 페이지 계약 =================
const DISCLAIMER_KEYS = ['투자자문업', '참고 정보', '책임'];
async function groupPages(want, env) {
  const isProd = env === 'prod';
  const base = isProd ? PROD_URL : BASE_URL;

  // /login 렌더 계약 (GET 1회)
  const lg = await request('GET', `${base}/login`, { readBody: true });
  const li = lg.ok && lg.status === 200 ? htmlInfo(lg.body) : null;
  observations[env]['/login html'] = li ? { title: li.title, ogKeys: Object.keys(li.og).sort(), favicons: li.favicons.length } : `status=${lg.ok ? lg.status : lg.error}`;

  if (isProd) {
    // TC-BBP-015: 한글 타이틀+desc+OG
    const ogNeed = ['og:title', 'og:description', 'og:image', 'og:url'];
    const ogHave = ogNeed.filter((k) => li && li.og[k]);
    record('TC-BBP-015', 'pages', 'prod', '/login 메타 계약(한글 타이틀·desc·OG)', '한글 타이틀 + description + 주요 OG 태그(og:title/description/image/url) 존재', `${SRC.UX}`,
      li ? `title="${li.title}", desc=${li.desc ? '있음' : '없음'}, OG ${ogHave.length}/${ogNeed.length}` : `렌더 실패(status=${lg.ok ? lg.status : lg.error})`,
      li && li.hasHangulTitle && li.desc && ogHave.length === 4 ? 'PASS' : li ? 'FAIL' : 'ERROR');

    // TC-BBP-016: 파비콘
    record('TC-BBP-016', 'pages', 'prod', '/login 파비콘(icon/apple-touch-icon)', 'favicon icon 링크 및 apple-touch-icon 링크 존재', SRC.UX,
      li ? `icon 링크 ${li.favicons.filter((f) => /"(icon|shortcut icon|alternate icon)"/.test(f)).length}건, apple-touch-icon ${li.favicons.filter((f) => /apple-touch-icon/.test(f)).length}건` : '렌더 실패',
      li && li.favicons.some((f) => /"(icon|shortcut icon|alternate icon)"/.test(f)) ? 'PASS' : li ? 'FAIL' : 'ERROR');
  } else if (li) {
    observations.local['/login disclaimer-context'] = 'local /login 본문에 투자자문 고지 직접 포함 여부: ' + (DISCLAIMER_KEYS.every((k) => li.text.includes(k)) ? '포함' : '미포함(약관 페이지에 위임 가능 — 관찰)');
  }

  // /terms (GET 1회)
  const tm = await request('GET', `${base}/terms`, { readBody: true });
  const ti = tm.ok && tm.status === 200 ? htmlInfo(tm.body) : null;
  observations[env]['/terms'] = tm.ok ? tm.status : `ERR ${tm.error}`;
  if (ti) observations[env]['/terms title'] = ti.title;

  if (isProd) {
    // TC-BBP-017: 투자자문업 아님 고지
    const hasAll = ti && DISCLAIMER_KEYS.every((k) => ti.text.includes(k));
    const sentence = ti ? (ti.text.match(/[^.]{0,90}투자자문업[^.]{0,120}\./) || [''])[0] : '';
    record('TC-BBP-017', 'pages', 'prod', '/terms 투자자문업 아님 고지', '투자자문업이 아님을 밝히는 고지(투자자문업·참고 정보·책임 표현) 존재 — 자본시장법상 무등록 자문 오해 방지 관행', SRC.LAW_CAP,
      sentence ? `고지 문구 관찰: "${brief(sentence, 160)}"` : ti ? '관련 문구 미발견' : `렌더 실패(status=${tm.ok ? tm.status : tm.error})`,
      hasAll ? 'PASS' : ti ? 'FAIL' : 'ERROR');

    // TC-BBP-018: 면책 조항
    const hasDisclaimer = ti && /(책임.{0,30}(지지 않습니다|없습니다)|면책)/.test(ti.text);
    record('TC-BBP-018', 'pages', 'prod', '/terms 면책·책임 소재 조항', '투자 판단 책임이 이용자/회원에게 있고 서비스가 이에 대한 책임을 지지 않는다는 취지 조항 존재(면책 고지 관행)', SRC.LAW_CAP,
      ti ? (hasDisclaimer ? '책임/면책 관련 문구 관찰됨' : '책임/면책 관련 문구 미발견') : '렌더 실패',
      hasDisclaimer ? 'PASS' : ti ? 'FAIL' : 'ERROR');

    // TC-BBP-019: 개인정보처리방침
    const pv = await request('GET', `${PROD_URL}/privacy`, { readBody: true });
    const pi = pv.ok && pv.status === 200 ? htmlInfo(pv.body) : null;
    observations.prod['/privacy'] = pv.ok ? pv.status : `ERR ${pv.error}`;
    const privNeed = ['개인정보', '수집', '이용'];
    const hasPriv = pi && privNeed.every((k) => pi.text.includes(k)) && /파기|보관|보유/.test(pi.text);
    record('TC-BBP-019', 'pages', 'prod', '/privacy 개인정보 처리 항목', '개인정보처리방침에 수집·이용·파기(또는 보관) 항목 존재 — 개인정보보호법 고지 관행', SRC.LAW_PRIV,
      pi ? `title="${pi.title}", 항목 키워드(${privNeed.join('/')}${/파기|보관|보유/.test(pi.text) ? '/파기|보관' : ''}) 관찰` : `렌더 실패(status=${pv.ok ? pv.status : pv.error})`,
      hasPriv ? 'PASS' : pi ? 'FAIL' : 'ERROR');
  } else {
    // TC-BBP-020: 로컬 동일 페이지 계약 (패리티)
    const pv = await request('GET', `${BASE_URL}/privacy`, { readBody: true });
    observations.local['/privacy'] = pv.ok ? pv.status : `ERR ${pv.error}`;
    const liOk = li && li.hasHangulTitle && li.desc && li.og['og:title'];
    const tmOk = ti && DISCLAIMER_KEYS.every((k) => ti.text.includes(k));
    const pi = pv.ok && pv.status === 200 ? htmlInfo(pv.body) : null;
    const pvOk = pi && ['개인정보', '수집', '이용'].every((k) => pi.text.includes(k));
    const okCount = [liOk, tmOk, pvOk].filter(Boolean).length;
    record('TC-BBP-020', 'pages', 'local', '로컬 공개 3페이지 계약(메타·고지·개인정보)', '운영과 동일 계약(한글 타이틀/OG/투자자문 고지/개인정보 항목)이 로컬에서도 관찰', SRC.XENV,
      `login=${liOk ? '충족' : '미충족'}, terms=${tmOk ? '충족' : '미충족'}, privacy=${pvOk ? '충족' : '미충족'}`,
      okCount === 3 ? 'PASS' : 'WARN');
    if (ti) observations.local['/terms disclaimer'] = DISCLAIMER_KEYS.every((k) => ti.text.includes(k));
  }
}

// ================= 그룹 4: robots / sitemap =================
async function groupRobots(want, env) {
  const isProd = env === 'prod';
  const base = isProd ? PROD_URL : BASE_URL;
  const rb = await request('GET', `${base}/robots.txt`, { readBody: true });
  const sm = await request('GET', `${base}/sitemap.xml`, { readBody: true });
  observations[env]['/robots.txt'] = rb.ok ? rb.status : `ERR ${rb.error}`;
  observations[env]['/sitemap.xml'] = sm.ok ? sm.status : `ERR ${sm.error}`;

  const idBase = isProd ? { r: 'TC-BBP-021', s: 'TC-BBP-022' } : { r: 'TC-BBP-023', s: 'TC-BBP-023' };
  if (isProd) {
    // robots: 200이면 text/plain + RFC9309 형식; 404면 '미제공' 관찰(FAIL 아님 — 공개 의사결정)
    let v = 'OBSERVE', actual = `status=${rb.status}`;
    if (rb.ok && rb.status === 200) {
      const ct = h(rb, 'content-type') || '';
      const looksRobots = /user-agent/i.test(rb.body || '');
      actual = `status=200, content-type=${ct}, 본문 형식=${looksRobots ? 'User-agent 라인 관찰' : '예상 밖 형식'}`;
      v = looksRobots && /text\/plain/i.test(ct) ? 'PASS' : 'WARN';
    } else if (rb.ok && rb.status === 404) {
      actual = 'status=404 — robots.txt 미제공(색인 통제 의사 없음: 공개 서비스 관행상 제공 권장, 관찰)';
      v = 'WARN';
    }
    record(idBase.r, 'robots', 'prod', '/robots.txt 동작', '200(text/plain, RFC9309 형식)이면 PASS — 404는 미제공 관찰(WARN)', SRC.STD, actual, v);

    let sv = 'OBSERVE', sActual = `status=${sm.status}`;
    if (sm.ok && sm.status === 200) {
      const ct = h(sm, 'content-type') || '';
      const looksXml = /<(urlset|sitemapindex)/i.test(sm.body || '');
      sActual = `status=200, content-type=${ct}, XML 형식=${looksXml ? 'urlset/sitemapindex 관찰' : '예상 밖'}`;
      sv = looksXml ? 'PASS' : 'WARN';
    } else if (sm.ok && sm.status === 404) {
      sActual = 'status=404 — sitemap 미제공(SEO 관행상 제공 권장, 관찰)';
      sv = 'WARN';
    }
    record(idBase.s, 'robots', 'prod', '/sitemap.xml 동작', '200(application/xml, urlset)이면 PASS — 404는 미제공 관찰(WARN)', SRC.STD, sActual, sv);
  } else {
    // TC-BBP-023: 로컬 robots/sitemap 패리티 — 상태만 관찰 기록
    record('TC-BBP-023', 'robots', 'local', '로컬 /robots.txt·/sitemap.xml 관찰', '운영과 동일 동작(제공 여부·상태) — 차이는 패리티 항목에서 평가', SRC.XENV,
      `robots.txt=${rb.ok ? rb.status : 'ERR'}, sitemap.xml=${sm.ok ? sm.status : 'ERR'}`, 'INFO');
  }
}

// ================= 그룹 5: 크로스환경 패리티 종합 =================
function groupParity() {
  // TC-BBP-024: 관찰된 공개 표면의 local↔prod 의미 있는 차이 나열
  const diffs = [];
  const keys = new Set([...Object.keys(observations.local), ...Object.keys(observations.prod)]);
  for (const k of keys) {
    const l = observations.local[k], p = observations.prod[k];
    if (l === undefined || p === undefined) continue;
    const norm = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/\s+/g, ' ').trim();
    if (norm(l) !== norm(p)) diffs.push({ key: k, local: brief(norm(l), 90), prod: brief(norm(p), 90) });
  }
  // 경로 상태코드 비교
  const pathKeys = ['/login', '/terms', '/privacy', '/robots.txt', '/sitemap.xml', '/__bb_noexist__'];
  for (const pk of pathKeys) {
    const l = observations.local[pk], p = observations.prod[pk];
    if (l === undefined || p === undefined) continue;
    if (String(l) !== String(p)) diffs.push({ key: pk + ' (상태)', local: String(l), prod: String(p) });
  }
  const diffLines = diffs.map((d) => `${d.key}: local=${d.local} vs prod=${d.prod}`).join(' | ') || '유의미 차이 없음';
  record('TC-BBP-024', 'parity', 'both', '공개 표면 종합 패리티', '동일 공개 표면의 상태·헤더·문구가 환경 간 일관(차이는 리스크 평가 대상, dev 빌드 차이는 감안)', SRC.XENV,
    diffs.length ? `${diffs.length}건 차이 관찰 — ${diffLines}` : '전 항목 일치 관찰',
    diffs.length ? 'OBSERVE' : 'PASS');
}

// ================= 실행 =================
(async () => {
  const envs = [];
  if (wantProd) envs.push('prod');
  if (wantLocal) envs.push('local');
  const fns = {
    availability: groupAvailability,
    headers: groupHeaders,
    pages: groupPages,
    robots: groupRobots,
  };
  for (const g of effectiveGroups) {
    if (!fns[g]) continue; // parity는 마지막에 별도 실행
    for (const e of envs) await fns[g](true, e); // 각 그룹 함수는 env별 분기 포함
  }
  if (runGroups.includes('parity')) groupParity();

  // ---- 출력 ----
  if (jsonOnly) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE_URL, prodUrl: PROD_URL, results, observations }, null, 2));
    return;
  }
  const V = { PASS: '✅ PASS', FAIL: '❌ FAIL', WARN: '⚠️ WARN', OBSERVE: '🔍 OBSERVE', INFO: 'ℹ️ INFO', ERROR: '💥 ERROR' };
  const counts = {};
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const w = (s, n) => String(s).padEnd(n);
  console.log(`\n=== jaroo 블랙박스 패리티·공개 표면 TC ===`);
  console.log(`로컬: ${BASE_URL}  운영: ${PROD_URL}  (UA: ${UA})`);
  console.log(`그룹: ${runGroups.join(', ')}  환경: ${envFilter}\n`);
  for (const r of results) {
    console.log(`${V[r.verdict] || r.verdict}  ${r.id} [${r.group}/${r.env}] ${r.name}`);
    console.log(`        기대: ${brief(r.expected, 120)}  (출처: ${r.source})`);
    console.log(`        실제: ${brief(r.actual, 130)}`);
  }
  console.log(`\n--- 판정 분포 ---`);
  for (const k of ['PASS', 'FAIL', 'WARN', 'OBSERVE', 'INFO', 'ERROR']) if (counts[k]) console.log(`${V[k]}  ${counts[k]}`);
  const totalReq = cache.size;
  console.log(`\n실제 HTTP 요청 수(캐시 후): ${totalReq} — 운영 경로당 1~2회 제한 준수`);
})();
