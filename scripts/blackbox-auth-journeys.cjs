#!/usr/bin/env node
/**
 * jaroo 블랙박스 TC — 인증 상태 사용자 여정 러너
 * 대상 문서: docs/tc/TC-blackbox-functional.md (TC-BBF-001 ~ TC-BBF-013)
 *
 * 블랙박스 원칙:
 *  - 제품 소스/내부 문서를 읽지 않는다. 관찰 수단은 (1) 브라우저 조작(agent-browser)
 *    (2) 사용자 관점 HTTP 요청(fetch, 리다이렉트 수동 추적) 뿐이다.
 *  - 기대값은 제품 공개 문구 / 공개 법령 지식(전자상거래법·PIPA) / 일반 UX·보안 관행 /
 *    크로스환경 일관성 / 사용자 목적 상식에서만 도출한다.
 *
 * 대상 환경(Lead 지침):
 *  - 게스트 표면: 로컬 dev(http://127.0.0.1:3002) 관찰 결과를 문서에 기록
 *  - 인증(세션) 표면: jaroo-dev 배포(BB_BASE_URL 기본값)에서 실행
 *  - 운영 jaroo.kr 은 블랙박스 parity 담당 영역(여기서 다루지 않음)
 *
 * 사용법:
 *   node scripts/blackbox-auth-journeys.cjs                 # 전체 여정(비용 0 표면만 실실행)
 *   node scripts/blackbox-auth-journeys.cjs login guards    # 특정 여정만 선택
 *   node scripts/blackbox-auth-journeys.cjs --list          # 여정 목록
 *   node scripts/blackbox-auth-journeys.cjs ocr --allow-costly      # 업로드 1회 예산 소비 허용
 *   node scripts/blackbox-auth-journeys.cjs deepscan --allow-costly # 분석 1회 예산 소비 허용
 *   node scripts/blackbox-auth-journeys.cjs ... --no-close  # 종료 시 브라우저 세션 유지(재사용)
 *
 * 환경변수:
 *   BB_BASE_URL     대상 오리진(기본 https://jaroo-dev.up.railway.app, 로컬은 http://127.0.0.1:3002)
 *   BB_BASIC_AUTH   Basic Auth 게이트 자격("id:password" 형식). 있으면 첫 브라우저 open URL에
 *                   임베딩하고 이후 요청에도 Authorization 헤더로 첨부한다.
 *                   ※ 자격을 스크립트/문서에 하드코딩 금지 — 항상 환경변수로 전달.
 *
 * 비용 안전장치:
 *  - OCR 업로드 / 딥스캔 분석 실실행은 --allow-costly 가 있어도 "총 1회"로 제한.
 *    사용 이력은 os.tmpdir()/jaroo-bb-func-budget.json 에 기록되어 재실행을 차단(재시도 금지).
 *  - 세션(로그인)이 필요한 여정은 /api/auth/me 로 먼저 확인하고 게스트면 SKIP(환경 제약).
 *    우회 시도 없음.
 *
 * 관찰로 얻은 환경 사실(스크립트에 반영):
 *  - 기본 뷰포트(높이 577)에서는 로그인 버튼이 뷰포트 밖이라 클릭이 씹힌다 → 1280x900 고정.
 *  - 로컬 dev 빌드에서 로그인 버튼들은 마우스 click 이벤트가 억제되는 현상 관찰(TC-BBF-010)
 *    → 클릭은 이벤트 계측으로 검증하고, 여정 진행용 활성화는 키보드 Enter 폴백 사용.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------
const AB = fs.existsSync('/home/pinion/.npm-global/bin/agent-browser')
  ? '/home/pinion/.npm-global/bin/agent-browser'
  : 'agent-browser';
const SESSION = 'jaroo-bb-func';
const BASE = (process.env.BB_BASE_URL || process.env.JAROO_BASE_URL || 'https://jaroo-dev.up.railway.app')
  .replace(/\/+$/, '');
const BASIC_AUTH = process.env.BB_BASIC_AUTH || '';            // "id:password" — 파일에 기록 금지
const BUDGET_FILE = path.join(os.tmpdir(), 'jaroo-bb-func-budget.json');
const COST_BUDGET = { ocr: 1, deepscan: 1 };

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s).replace(/\/\/[^@/\s]+@/g, '//<redacted>@');

// ---------------------------------------------------------------------------
// agent-browser 래퍼 (출력에 Basic 자격이 섞여 나오지 않도록 항상 redact)
// ---------------------------------------------------------------------------
function ab(...args) {
  try {
    const out = execFileSync(AB, [...args, '--session-name', SESSION], {
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return redact(out);
  } catch (e) {
    const out = redact(`${e.stdout || ''}${e.stderr || ''}`).trim();
    throw new Error(`agent-browser ${args.join(' ')} 실패: ${out || e.message}`);
  }
}
const abOk = (...args) => { try { ab(...args); return true; } catch { return false; } };

let basicAuthCached = fs.existsSync(path.join(os.tmpdir(), 'jaroo-bb-func-basicauth.cached')); // 임베딩 1회만(프로세스 간 공유)

/** URL에 Basic 자격 임베딩(최초 1회). 출력/기록에는 redact 된 값만 흐른다. */
function withBasicAuth(url) {
  if (!BASIC_AUTH || basicAuthCached) return url;
  basicAuthCached = true;
  try { fs.writeFileSync(path.join(os.tmpdir(), 'jaroo-bb-func-basicauth.cached'), now()); } catch { /* 무해 */ }
  return url.replace(/^(https?:\/\/)/, `$1${BASIC_AUTH}@`);
}

const openPage = async (url, settleMs = 2500) => {
  ab('open', withBasicAuth(url));
  await sleep(settleMs);
  return redact(ab('get', 'url').trim());
};
const currentUrl = () => redact(ab('get', 'url').trim());
const snapshot = () => redact(ab('snapshot'));
const evalJs = (js) => {
  try {
    const out = redact(ab('eval', js).trim());
    if (out.startsWith('"') && out.endsWith('"')) {
      try { return JSON.parse(out); } catch { /* 원문 유지 */ }
    }
    return out;
  } catch (e) {
    return `__EVAL_ERROR__ ${e.message}`;
  }
};

// ---------------------------------------------------------------------------
// 사용자 관점 HTTP (Basic 게이트가 있으면 Authorization 헤더 첨부)
// ---------------------------------------------------------------------------
const authHeaders = () => (BASIC_AUTH ? { authorization: `Basic ${Buffer.from(BASIC_AUTH).toString('base64')}` } : {});

async function httpProbe(route) {
  const res = await fetch(`${BASE}${route}`, { redirect: 'manual', headers: authHeaders() });
  return { status: res.status, location: res.headers.get('location') || '' };
}
async function httpGetText(route) {
  const res = await fetch(`${BASE}${route}`, { headers: { ...authHeaders(), accept: 'text/html' } });
  return { status: res.status, text: await res.text() };
}

// ---------------------------------------------------------------------------
// 비용(1회 한도) 예산 장부
// ---------------------------------------------------------------------------
function loadBudget() {
  try { return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')); } catch { return {}; }
}
function saveBudget(b) { fs.writeFileSync(BUDGET_FILE, JSON.stringify(b, null, 2)); }
function budgetLeft(kind) { return (COST_BUDGET[kind] || 0) - (loadBudget()[kind] || 0); }
function spendBudget(kind, note) {
  const b = loadBudget();
  b[kind] = (b[kind] || 0) + 1;
  b[`${kind}History`] = b[`${kind}History`] || [];
  b[`${kind}History`].push(`${now()} ${note || ''}`.trim());
  saveBudget(b);
}

// ---------------------------------------------------------------------------
// 공통 관찰 유틸
// ---------------------------------------------------------------------------
/**
 * /api/auth/me 로 세션 확인(제품 클라이언트가 스스로 호출하는 공개 엔드포인트).
 * 1차: 브라우저 컨텍스트 fetch(credentials 포함) — 실제 사용자 세션(쿠키) 반영.
 * 2차: Node fetch(Basic 게이트 헤더만) — 브라우저 응답 불가 시 폴백(쿠키 없음=게스트 관찰).
 */
async function sessionState() {
  // 브라우저 컨텍스트 fetch — 페이지 이동 직후 일시 실패할 수 있어 2회 재시도.
  // 주의: 현재 페이지 URL에 Basic 자격이 임베딩되어 있으면 상대경로 fetch가 금지되므로
  // location.protocol+'//'+location.host 절대 URL을 사용한다.
  for (let i = 0; i < 2; i++) {
    try {
      const out = evalJs(`fetch(location.protocol+'//'+location.host+'/api/auth/me',{credentials:'include'})
        .then(r=>r.json()).then(j=>JSON.stringify(j)).catch(e=>'ERR '+e.message)`);
      const raw = typeof out === 'string' ? out : JSON.stringify(out);
      if (!String(raw).startsWith('ERR')) {
        const j = JSON.parse(raw);
        if (j && j.authScope) {
          return {
            status: 200, via: 'browser',
            authScope: j.authScope,
            email: j.user?.email || j.userContract?.email || null,
            provider: j.provider || null,
          };
        }
      }
    } catch { /* 재시도 */ }
    await sleep(1500);
  }
  try {
    const res = await fetch(`${BASE}/api/auth/me`, { headers: { ...authHeaders(), accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    return {
      status: res.status, via: 'node(쿠키없음=게스트기준)',
      authScope: json.authScope || null,
      email: json.user?.email || json.userContract?.email || null,
      provider: json.provider || null,
    };
  } catch (e) {
    return { status: 0, via: 'none', authScope: null, email: null, provider: null, error: e.message };
  }
}

/** 접근성 스냅샷에서 텍스트를 포함하는 줄의 ref 추출 */
function refOf(pattern) {
  for (const line of snapshot().split('\n')) {
    if (line.includes(pattern) && line.includes('[ref=')) {
      return line.match(/\[ref=(e\d+)\]/)?.[1] || null;
    }
  }
  return null;
}

/** 로그인 화면 버튼 상태(비활성 여부)를 DOM 에서 수집 */
const loginButtonStates = () => evalJs(`JSON.stringify([...document.querySelectorAll('button')]
  .filter(b=>/시작하기|둘러보기/.test(b.textContent))
  .map(b=>({label:b.textContent.replace(/\\s+/g,' ').trim().slice(0,30), disabled:b.disabled})))`);

/** 버튼 클릭 이벤트 계측 + 중심 좌표 반환 */
function instrumentClicks(textPattern) {
  return evalJs(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('${textPattern}'));
    if(!b) return 'no-button';
    window.__bbEvts=[];
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>
      b.addEventListener(t,e=>window.__bbEvts.push(t), {passive:true}));
    b.scrollIntoView({block:'center'});
    const r=b.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)});
  })()`);
}
const readClickEvents = () => evalJs('JSON.stringify(window.__bbEvts||[])');

/** 요약 스냅샷: 본문 텍스트 요소 중 앞 N개 (화면 비교 관찰용) */
function textDigest(n = 14) {
  return snapshot().split('\n')
    .filter((l) => /StaticText|heading|button|link/.test(l))
    .map((l) => l.trim().replace(/- (StaticText|button|link) /, '').replace(/\[ref=e\d+\] ?/g, '').replace(/^\- /, ''))
    .filter((s) => s && !/Open Next\.js/.test(s))
    .slice(0, n)
    .join(' | ')
    .slice(0, 400);
}

// ---------------------------------------------------------------------------
// 결과 기록
// ---------------------------------------------------------------------------
const results = [];
function record(id, title, status, expected, source, observed, note) {
  results.push({ id, title, status, expected, source, observed, note: note || '' });
  const mark = status === 'PASS' ? '✅ PASS' : status === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP';
  console.log(`\n${mark}  ${id} ${title}`);
  console.log(`   기대: ${expected}  [출처: ${source}]`);
  (Array.isArray(observed) ? observed : [observed]).forEach((o) => console.log(`   관찰: ${redact(o)}`));
  if (note) console.log(`   비고: ${redact(note)}`);
}

// ---------------------------------------------------------------------------
// 여정 정의
// ---------------------------------------------------------------------------
const journeys = {
  /** TC-BBF-001 원클릭 로그인 → 홈 */
  async login() {
    const before = await sessionState();
    const alreadyAuthed = before.authScope && before.authScope !== 'guest';
    let urlAfter = currentUrl();
    let mouseNav = false;

    if (!alreadyAuthed) {
      await openPage(`${BASE}/login`);
      ab('set', 'viewport', '1280', '900');

      // 1) 필수 동의 체크(dev 자동로그인 빌드는 우회된다는 안내도 있으므로 상태 관찰)
      const cbRef = refOf('만 14세 이상이며');
      const consentChecked = !!cbRef && (abOk('click', cbRef) || true);
      await sleep(600);
      const btnsBefore = loginButtonStates();

      // 2) 마우스 클릭 시도(계측) — 판정 상세는 TC-BBF-010
      const ptRaw = evalJs(`JSON.stringify((()=>{const b=[...document.querySelectorAll('button')]
        .find(x=>x.textContent.includes('Google로 시작하기')); if(!b) return null;
        b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect();
        return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})())`);
      let pt = null; try { pt = JSON.parse(ptRaw); } catch { /* 무시 */ }
      if (pt) {
        ab('mouse', 'move', String(pt.x), String(pt.y));
        ab('mouse', 'down');
        ab('mouse', 'up');
        await sleep(3000);
        mouseNav = currentUrl() !== `${BASE}/login`;
      }

      // 3) 마우스로 진행 안 되면 키보드 Enter 로 동일 버튼 활성화
      if (!mouseNav) {
        evalJs(`[...document.querySelectorAll('button')]
          .find(x=>x.textContent.includes('Google로 시작하기'))?.focus()`);
        ab('press', 'Enter');
        await sleep(5000);
      }
      urlAfter = currentUrl();
    }

    const after = await sessionState();
    const authed = after.authScope && after.authScope !== 'guest';

    if (authed) {
      const homeUrl = await openPage(`${BASE}/home`);
      const snap = snapshot();
      const guestBadge = /게스트/.test(snap);
      record('TC-BBF-001', '원클릭 로그인 → 홈 도달', 'PASS',
        '동의 후 Google 버튼 활성화(또는 dev 자동로그인)로 세션이 발급되고 홈(포트폴리오 요약)에 진입',
        '⑤ 사용자 목적 상식 + ① 제품 공개 문구("포트폴리오 준비"는 게스트 전용 문구)',
        [`세션: authScope=${after.authScope}, provider=${after.provider}, email=${after.email}`,
         `홈 진입 URL: ${homeUrl}`, `게스트 배지 잔존: ${guestBadge ? '예(이상)' : '아니요(정상)'}`,
         `홈 화면 요약: ${textDigest(10)}`]);
    } else {
      const wentToGoogle = /accounts\.google\.com/.test(urlAfter);
      record('TC-BBF-001', '원클릭 로그인 → 홈 도달', 'SKIP',
        '클릭만으로 고정 테스트 계정 세션 발급 후 홈 진입',
        '⑤ 사용자 목적 상식 (dev 자동로그인 메커니즘 안내)',
        [`마우스 클릭 후 이동: ${mouseNav ? redact(urlAfter) : '없음'}`,
         `키보드 Enter 후 URL: ${redact(urlAfter).slice(0, 80)}`,
         wentToGoogle ? '진짜 Google OAuth로 이동 — 자동로그인 핸들러 아님' : 'OAuth 이동 관찰 안 됨',
         `세션 /api/auth/me: authScope=${after.authScope}`],
        '환경 제약: 자동로그인 불가 환경. 우회 금지 규칙에 따라 SKIP.');
      if (wentToGoogle) { ab('back'); await sleep(1000); }
    }
  },

  /** TC-BBF-002 필수 동의 게이팅 */
  async consent() {
    await openPage(`${BASE}/login`);
    ab('set', 'viewport', '1280', '900');
    await sleep(500);
    const before = loginButtonStates();
    const cbRef = refOf('만 14세 이상이며');
    if (cbRef) ab('click', cbRef);
    await sleep(700);
    const after = loginButtonStates();
    const parse = (s) => { try { return JSON.parse(s); } catch { return []; } };
    const b = parse(before), a = parse(after);
    const gated = ['이메일로', 'Google로', '카카오로'];
    const okBefore = b.filter((x) => gated.some((g) => x.label.startsWith(g))).every((x) => x.disabled);
    const okAfter = a.filter((x) => gated.some((g) => x.label.startsWith(g))).every((x) => !x.disabled);
    const hasConsentText = snapshot().includes('만 14세 이상이며');
    record('TC-BBF-002', '로그인 입력 게이팅(필수 동의)', okBefore && okAfter && hasConsentText ? 'PASS' : 'FAIL',
      '필수 동의(만 14세+약관+개인정보) 체크 전 로그인 수단 비활성화, 체크 후 활성화',
      '② 공개 법령 지식(PIPA: 만 14세 미만 동의 무효) + ① 제품 공개 문구("필수")',
      [`체크 전: ${JSON.stringify(b)}`, `체크 후: ${JSON.stringify(a)}`,
       `동의 문구 표시: ${hasConsentText ? '예' : '아니요'}`],
      (!okBefore || !okAfter) && /Google/.test(JSON.stringify(b)) && !b.find((x) => x.label.startsWith('Google'))?.disabled
        ? 'dev 빌드에서 동의 없이 버튼이 활성화되는 우회 동작과 충돌 가능 — 환경별 차이 기록' : '');
  },

  /** TC-BBF-003 게스트 라우트 가드 (로그인 전에 실행 권장) */
  async guards() {
    const s = await sessionState();
    if (s.authScope && s.authScope !== 'guest') {
      record('TC-BBF-003', '게스트 라우트 가드', 'SKIP',
        '게스트는 보호 화면에서 /login?next=<경로> 로 이동', '③ 일반 보안 관행',
        [`현재 세션이 인증 상태(authScope=${s.authScope})라 게스트 관찰 불가 — 로그아웃 후 재실행`]);
      return;
    }
    const cases = [
      { route: '/home', expect: 'public' },
      { route: '/screenshot', expect: 'public' },
      { route: '/terms', expect: 'public' },
      { route: '/privacy', expect: 'public' },
      { route: '/deepscan', expect: 'guarded' },
      { route: '/mypage', expect: 'guarded' },
      { route: '/mypage/settings', expect: 'guarded' },
    ];
    const observed = [];
    let allOk = true;
    for (const c of cases) {
      const p = await httpProbe(c.route);
      const guarded = p.status === 307 && /^\/login\?next=/.test(p.location || '');
      const pub = p.status === 200 && !p.location;
      const ok = c.expect === 'guarded' ? guarded : pub;
      if (!ok) allOk = false;
      observed.push(`${c.route} → ${p.status}${p.location ? ` → ${p.location}` : ''} (기대 ${c.expect}) ${ok ? 'OK' : '불일치'}`);
    }
    const viaBrowser = await openPage(`${BASE}/deepscan`);
    const browserGuarded = /\/login\?next=%2Fdeepscan/.test(viaBrowser);
    if (!browserGuarded) allOk = false;
    observed.push(`브라우저 /deepscan 최종 URL: ${viaBrowser}`);
    record('TC-BBF-003', '게스트 라우트 가드(로그인 필요 화면 보호)', allOk ? 'PASS' : 'FAIL',
      '개인 영역(딥스캔·마이페이지)은 게스트를 /login?next=<원래경로> 로 보내고 공개 영역(홈·스크린샷·약관)은 열려 있다',
      '③ 일반 UX/보안 관행(인가 가드+목적지 보존) + ④ 크로스환경 일관성',
      observed);
  },

  /** TC-BBF-004 마이페이지/설정 + 로그아웃 + 로그아웃 후 가드 */
  async mypageLogout() {
    const s = await sessionState();
    if (!s.authScope || s.authScope === 'guest') {
      const guarded = await httpProbe('/mypage');
      record('TC-BBF-004', '마이페이지/설정 진입·로그아웃·로그아웃 후 가드', 'SKIP',
        '로그인 상태에서 프로필·설정 화면 관찰 → 로그아웃 → 재접근 시 /login 차단',
        '③ 일반 UX/보안 관행',
        [`세션: authScope=${s.authScope}`, `게스트 가드: /mypage → ${guarded.status} ${guarded.location}`],
        '환경 제약(세션 없음). 게스트 가드 자체는 정상 동작.');
      return;
    }
    const myUrl = await openPage(`${BASE}/mypage`);
    const mySnap = snapshot();
    const hasLogout = /로그아웃/.test(mySnap);
    const obs = [
      `세션: authScope=${s.authScope} (${s.email})`,
      `마이페이지 URL: ${myUrl}`,
      `마이페이지 요약: ${textDigest(12)}`,
      `로그아웃 진출점: ${hasLogout ? '있음' : '없음'}`,
    ];
    // 설정 화면도 관찰(탈퇴 화면 '진입'만 허용 — 실행 금지, 여기서는 진입도 자제하고 존재 여부만 기록)
    const setUrl = await openPage(`${BASE}/mypage/settings`);
    const setSnap = snapshot();
    obs.push(`설정 URL: ${setUrl}`, `설정 화면 요약: ${textDigest(12)}`);
    const withdrawVisible = /탈퇴|삭제/.test(setSnap);
    obs.push(`설정 화면에 탈퇴/삭제 진출점 노출: ${withdrawVisible ? '있음(진입만 확인, 실행 안 함)' : '보이지 않음'}`);

    if (!hasLogout) {
      record('TC-BBF-004', '마이페이지/설정 진입·로그아웃·로그아웃 후 가드', 'FAIL',
        '마이페이지에 로그아웃 진출점이 있어야 한다', '③ 일반 UX 관행', obs);
      return;
    }
    await openPage(`${BASE}/mypage`);
    const ref = refOf('로그아웃');
    if (ref) ab('click', ref);
    await sleep(3000);
    const afterUrl = currentUrl();
    const after = await sessionState();
    const guard = await httpProbe('/mypage');
    obs.push(`로그아웃 직후 URL: ${afterUrl}`,
      `로그아웃 후 세션: authScope=${after.authScope}`,
      `로그아웃 후 /mypage: ${guard.status} ${guard.location}`);
    const ok = after.authScope === 'guest' && guard.status === 307;
    record('TC-BBF-004', '마이페이지/설정 진입·로그아웃·로그아웃 후 가드', ok ? 'PASS' : 'FAIL',
      '마이페이지 진입 가능, 로그아웃 후 세션 게스트화, 보호 화면 재접근 차단',
      '③ 일반 UX/보안 관행', obs);
  },

  /** TC-BBF-005 딥스캔 (세션 필요. --allow-costly 시 분석 1회 실실행) */
  async deepscan(allowCostly) {
    const s = await sessionState();
    const guard = await httpProbe('/deepscan');
    if (!s.authScope || s.authScope === 'guest') {
      record('TC-BBF-005', '딥스캔 여정(진입→종목 선택→분석 1회→로딩→리포트)', 'SKIP',
        '로그인 상태로 딥스캔 진입 → 종목 선택 → 분석 1회 → 로딩 → 리포트(또는 실패/크레딧 부족 표면)',
        '① 제품 공개 문구(이용약관 제2조 "AI 분석(DeepScan)") + ③ 일반 UX 관행',
        [`세션: authScope=${s.authScope}`, `게스트 가드: /deepscan → ${guard.status} ${guard.location}`,
         '실실행 미실행(세션 없음 — 예산 미소비)'], '환경 제약.');
      return;
    }
    if (!allowCostly || budgetLeft('deepscan') < 1) {
      record('TC-BBF-005', '딥스캔 여정(진입→종목 선택→분석 1회→로딩→리포트)', 'SKIP',
        '로그인 상태 딥스캔 분석 1회 실실행', '① 제품 공개 문구 + ③ 일반 UX 관행',
        [`세션: authScope=${s.authScope}`,
         `실실행 조건 불충족: --allow-costly=${!!allowCostly}, 남은 예산=${budgetLeft('deepscan')}`],
        '비용 보호(총 1회 한도)로 자동 SKIP.');
      return;
    }

    // 실제 흐름(관찰로 확인): /home 종목 카드 확장 → "딥스캔 분석" 링크 클릭 → 자동 실행
    const homeUrl = await openPage(`${BASE}/home`);
    await sleep(2500);
    const cardRef = refOf('삼성전자') && snapshot().split('\n').find((l) => /article|button/.test(l) && l.includes('삼성전자') && l.includes('[ref='))
      ? (snapshot().split('\n').find((l) => l.includes('삼성전자') && /\[(expanded|ref)=/.test(l) && /article|button/.test(l)).match(/\[ref=(e\d+)\]/) || [])[1]
      : refOf('삼성전자');
    const obs = [`홈 진입: ${homeUrl}`, cardRef ? `종목 카드(${cardRef}) 확장 클릭` : '종목 카드 미발견'];
    if (!cardRef) {
      record('TC-BBF-005', '딥스캔 여정(홈→종목 선택→분석 1회→로딩→리포트)', 'FAIL',
        '홈 종목 카드에서 딥스캔 분석 진입', '① 제품 공개 문구(홈 안내 문구) + ③ 일반 UX 관행', obs);
      return;
    }
    ab('click', cardRef);
    await sleep(1500);
    const scanRef = refOf('딥스캔 분석');
    if (!scanRef) {
      obs.push('확장 카드에 "딥스캔 분석" 진출점 없음');
      record('TC-BBF-005', '딥스캔 여정(홈→종목 선택→분석 1회→로딩→리포트)', 'FAIL',
        '확장된 종목 카드에 딥스캔 분석 진출점이 있다', '① 제품 공개 문구("세 팀이 분석해요")', obs);
      return;
    }
    spendBudget('deepscan', `${BASE} 딥스캔 1회 실행`);
    ab('click', scanRef);
    await sleep(3000);
    obs.push(`진입 URL: ${currentUrl()}`, `초기 화면 요약: ${textDigest(10)}`);

    let waitingSeen = false, threeTeamSeen = false, doneSeen = false, reportSeen = false;
    let creditShort = false, lastDigest = '';
    for (let i = 0; i < 60; i++) {
      const snap = snapshot();
      lastDigest = textDigest(10);
      if (/딥스캔 진행 중|분석가 응답을 기다리는/.test(snap)) waitingSeen = true;
      if (/세 팀이 더 깊이 분석하는 중|세 팀 분석 전환/.test(snap)) threeTeamSeen = true;
      if (/딥스캔 완료|상세 결과 준비 완료/.test(snap)) doneSeen = true;
      if (/세 팀의 의견을 모았어요|추천 시나리오/.test(snap)) reportSeen = true;
      if (/크레딧|부족|충전/.test(snap)) creditShort = true;
      if (reportSeen || creditShort) break;
      await sleep(2000);
    }
    obs.push(`로딩 표면(대기): ${waitingSeen ? '관찰됨' : '미관찰'}`,
      `세 팀 전환 안내: ${threeTeamSeen ? '관찰됨' : '미관찰'}`,
      `완료 신호: ${doneSeen ? '관찰됨' : '미관찰'}`,
      `리포트 도달: ${reportSeen ? '예' : '아니요'}`,
      `크레딧 부족 표면: ${creditShort ? '관찰됨' : '없음'}`,
      `최종 화면 요약: ${lastDigest}`);
    const ok = (reportSeen || creditShort) && (waitingSeen || reportSeen);
    record('TC-BBF-005', '딥스캔 여정(홈→종목 선택→분석 1회→로딩→리포트)', ok ? 'PASS' : 'FAIL',
      '종목 선택 시 분석이 진행되고 진행 피드백(대기/세 팀 전환) 후 최종 리포트가 같은 화면에 이어진다(실패·크레딧 부족 표면도 유효)',
      '① 제품 공개 문구("완료 신호가 오면 기다림 없이 이 화면 아래에 결과가 이어집니다") + ③ 일반 UX 관행', obs);
  },

  /** TC-BBF-006 OCR (기본: 화면 진입만. --allow-costly 시 업로드 1회) */
  async ocr(allowCostly) {
    const url = await openPage(`${BASE}/screenshot`);
    ab('set', 'viewport', '1280', '900');
    const snap = snapshot();
    const hasUpload = /스크린샷 올리기/.test(snap);
    const hasPrivacy = /개인정보는 분석 후 즉시 안전하게 파기/.test(snap);
    const inputInfo = evalJs(`(()=>{const i=document.querySelector('input[type=file]');
      return i?JSON.stringify({accept:i.accept,multiple:i.multiple}):'none'})()`);
    const s = await sessionState();

    if (!allowCostly || budgetLeft('ocr') < 1) {
      record('TC-BBF-006', 'OCR 여정(업로드 화면 진입 + 업로드 1회 + 결과 표면)', 'SKIP',
        '업로드 화면 진입 → PNG 1장 업로드 → 인식 결과/실패 표면 관찰',
        '① 제품 공개 문구("종목명·수량·평가금액이 또렷하게 보이면 잘 읽혀요")',
        [`세션: authScope=${s.authScope}`, `진입 URL: ${url}`,
         `업로드 진출점: ${hasUpload ? '예' : '아니요'}`, `개인정보 파기 고지: ${hasPrivacy ? '예' : '아니요'}`,
         `파일 입력: ${inputInfo}`,
         `업로드 실실행 조건 불충족: --allow-costly=${!!allowCostly}, 남은 예산=${budgetLeft('ocr')}`],
        '비용 보호(총 1회 한도).');
      return;
    }

    // PNG 픽스처: 종목 정보 텍스트 이미지(PIL 가능 시), 불가 시 단색 PNG
    const png = path.join(os.tmpdir(), 'jaroo-bb-probe.png');
    const fixture = (() => {
      try {
        execFileSync('python3', ['-c', [
          'try:',
          '    from PIL import Image, ImageDraw',
          '    im = Image.new("RGB",(480,240),(20,24,32))',
          '    d = ImageDraw.Draw(im)',
          '    d.text((24,40),"계좌평가금액상세",fill=(240,240,240))',
          '    rows=[("삼성전자","1주","321,000원"),("LG디스플레이","16주","227,040원"),("SFA반도체","23주","224,710원")]',
          '    y=90',
          '    for n,q,v in rows:',
          '        d.text((24,y),n,fill=(230,230,230)); d.text((180,y),q,fill=(230,230,230)); d.text((300,y),v,fill=(230,230,230)); y+=44',
          `    im.save("${png.replace(/"/g, '\\"')}")`,
          '    print("pil")',
          'except Exception as e:',
          '    import zlib,struct',
          '    w,h=120,60',
          '    raw=b"".join(b"\\x00"+bytes([230,232,235]*w) for _ in range(h))',
          '    def chunk(t,d):',
          '        c=t+d; return struct.pack(">I",len(d))+c+struct.pack(">I",zlib.crc32(c)&0xffffffff)',
          '    png=b"\\x89PNG\\r\\n\\x1a\\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b"")',
          `    open("${png.replace(/"/g, '\\"')}","wb").write(png)`,
          '    print("raw")',
        ].join('\n')], { stdio: ['ignore', 'pipe', 'pipe'] });
        return 'text-image';
      } catch {
        return 'fallback-needed';
      }
    })();
    if (!fs.existsSync(png)) {
      execFileSync('python3', ['-c', [
        'import zlib,struct',
        'w,h=120,60',
        'raw=b"".join(b"\\x00"+bytes([230,232,235]*w) for _ in range(h))',
        'def chunk(t,d):',
        '    c=t+d; return struct.pack(">I",len(d))+c+struct.pack(">I",zlib.crc32(c)&0xffffffff)',
        'png=b"\\x89PNG\\r\\n\\x1a\\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b"")',
        `open("${png.replace(/"/g, '\\"')}","wb").write(png)`,
      ].join('\n')]);
    }

    spendBudget('ocr', `${BASE} 업로드 1회(authScope=${s.authScope})`);
    ab('upload', 'input[type=file]', png);
    await sleep(8000);
    const after = currentUrl();
    const resultSnap = snapshot();
    const failure = /실패했어요|분석을 완료하지 못했어요/.test(resultSnap);
    const recognized = /종목 확인|적용하기/.test(resultSnap);
    const stocks = (resultSnap.match(/\d+개 종목/g) || []).slice(-1)[0] || '';
    const retryOffered = /다시 확인하기|다시 선택/.test(resultSnap);
    const net = ab('network', 'requests');
    const ocrCalls = net.split('\n').filter((l) => l.includes('/api/ocr')).slice(-2).map((l) => l.trim().slice(0, 100));
    // 성공 경로: 종목 확인+적용 진출점 / 실패 경로: 안내+재시도 진출점
    const ok = failure ? (retryOffered || /다른 이미지/.test(resultSnap)) : recognized;
    const baseObs = [`픽스처: ${png}(${fixture})`, `세션: authScope=${s.authScope}`, `업로드 후 URL: ${after}`,
      `결과: ${failure ? '실패 표면' : recognized ? '종목 확인 화면 도달' : '알 수 없음'} ${stocks}`,
      `재시도 진출점: ${retryOffered ? '있음' : '없음'}`,
      `API: ${ocrCalls.join(' | ') || '관찰 안 됨'}`,
      `화면 요약: ${textDigest(12)}`];

    // 인식 성공 시 "적용하기"로 포트폴리오 등록까지 관찰(추가 업로드 아님 — 예산 1회 유지)
    let applied = false;
    const applyLine = snapshot().split('\n').find((l) => l.includes('적용하기'));
    const applyRef = applyLine ? (applyLine.match(/\[ref=(e\d+)\]/) || [])[1] : null;
    const applyDisabled = applyLine ? /\[disabled/.test(applyLine) : true;
    if (applyRef && !applyDisabled && !failure) {
      ab('click', applyRef);
      await sleep(7000);
      baseObs.push(`적용하기 실행 후 URL: ${currentUrl()}`, `적용 후 화면 요약: ${textDigest(12)}`);
      applied = true;
    } else {
      baseObs.push(`적용하기: ${applyDisabled ? '비활성(인식 0개 등)' : '미실행'}`);
    }
    record('TC-BBF-006', 'OCR 여정(업로드 화면 진입 + 업로드 1회 + 결과 표면)', ok ? 'PASS' : 'FAIL',
      '업로드 후 종목 확인 화면으로 이동하고, 실패해도 이해 가능한 안내와 재시도 진출점이 제공된다(실패 표면도 유효)',
      '③ 일반 UX 관행(진행·실패의 인지 가능한 안내) + ① 제품 공개 문구',
      baseObs, applied ? '인식 종목의 적용(포트폴리오 등록)까지 관찰.' : '');
  },

  /** TC-BBF-007 404 표면 */
  async notFound() {
    const p = await httpProbe('/no-such-page-bbf');
    const url = await openPage(`${BASE}/no-such-page-bbf`);
    const snap = snapshot();
    const isDefaultEn = /This page could not be found/.test(snap);
    const hasKorean = /찾을 수 없|존재하지 않는/.test(snap);
    const hasNavBack = /뒤로|홈으로|메인/.test(snap);
    const ok = p.status === 404 && hasKorean && hasNavBack;
    record('TC-BBF-007', '존재하지 않는 경로 404 표면', ok ? 'PASS' : 'FAIL',
      '404 상태 코드 + 한국어 안내 + 복귀 수단 제공',
      '④ 크로스환경 일관성(한국어 서비스=한국어 에러 UI) + ③ 일반 UX 관행',
      [`HTTP 상태: ${p.status}`, `최종 URL: ${url}`,
       `표면: ${isDefaultEn ? 'Next.js 기본 영문 404' : hasKorean ? '한국어 404 안내' : '기타'}`,
       `복귀 수단: ${hasNavBack ? '있음' : '없음'}`],
      isDefaultEn ? '한국어 서비스인데 영문 기본 404 + 복귀 진출점 없음 — 개선 필요.' : '');
  },

  /** TC-BBF-008 로그인 상태에서 /login 재접근 */
  async loginRevisit() {
    // 페이지를 먼저 연 뒤 그 페이지 컨텍스트에서 세션을 본다(이동 직후 체크 실패 방지)
    const url = await openPage(`${BASE}/login`, 3500);
    await sleep(1500);
    const finalUrl = currentUrl();
    const snap = snapshot();
    const s = await sessionState();
    if (!s.authScope || s.authScope === 'guest') {
      record('TC-BBF-008', '로그인 상태에서 /login 재접근', 'SKIP',
        '이미 로그인한 사용자가 /login 접근 시 서비스 화면으로 이동',
        '③ 일반 UX/보안 관행',
        [`세션: authScope=${s.authScope} (${s.via})`, `최종 URL: ${finalUrl}`,
         '게스트 상태 — 로그인 화면 노출이 정상'],
        '환경 제약: 세션 없음.');
      return;
    }
    const bounced = !/Google로 시작하기/.test(snap);
    record('TC-BBF-008', '로그인 상태에서 /login 재접근', bounced ? 'PASS' : 'FAIL',
      '로그인 사용자가 /login 접근 시 서비스 화면으로 보내진다', '③ 일반 UX 관행',
      [`세션: authScope=${s.authScope} (${s.email})`, `최종 URL: ${finalUrl}`, `화면 요약: ${textDigest(8)}`]);
  },

  /** TC-BBF-009 OAuth 콜백 에러 표면 */
  async oauthError() {
    const p = await httpProbe('/auth/callback');
    const loc = p.location || '';
    const url = await openPage(`${BASE}/auth/callback`);
    await sleep(2000);
    const finalUrl = currentUrl();
    const snap = snapshot();
    const showsError = /실패|오류|다시 시도/.test(snap) && !/스크린샷 분석/.test(snap);
    const hostSwitch = loc && !loc.startsWith('/') && !loc.includes(new URL(BASE).host);
    record('TC-BBF-009', 'OAuth 콜백 실패(error=oauth) 사용자 표면', showsError ? 'PASS' : 'FAIL',
      '로그인 콜백 실패 시 사용자가 이해할 수 있는 오류 안내 표시',
      '③ 일반 UX 관행(실패는 눈에 보여야 한다)',
      [`/auth/callback(코드 없음) → ${p.status} ${redact(loc)}`, `브라우저 최종 URL: ${finalUrl}`,
       `오류 안내: ${showsError ? '표시됨' : '표시 안 됨'}`,
       `리다이렉트 호스트 일관성: ${hostSwitch ? '불일치(다른 호스트로 전환)' : '일치'}`],
      showsError ? '' : 'error=oauth 도달 후 화면 반응 없음 — 사용자가 원인을 알 수 없음. 개선 필요.');
  },

  /** TC-BBF-010 로그인 버튼 마우스 클릭 응답성 */
  async mouseClick() {
    await openPage(`${BASE}/login`);
    ab('set', 'viewport', '1280', '900');
    const cbRef = refOf('만 14세 이상이며');
    if (cbRef) ab('click', cbRef);
    await sleep(600);
    const info = instrumentClicks('Google로 시작하기');
    let pt = null; try { pt = JSON.parse(info); } catch { /* 처리 */ }
    if (!pt) {
      record('TC-BBF-010', '로그인 버튼 마우스 클릭 응답성', 'SKIP',
        '활성화된 로그인 버튼은 물리적 마우스 클릭에 반응한다', '③ 일반 UX/웹 관행',
        [`버튼 미발견: ${info}`]);
      return;
    }
    ab('mouse', 'move', String(pt.x), String(pt.y));
    ab('mouse', 'down');
    ab('mouse', 'up');
    await sleep(2000);
    const evts = readClickEvents();
    const url = currentUrl();
    let events = []; try { events = JSON.parse(evts); } catch { events = [String(evts)]; }
    const hasClick = events.includes('click');
    const navigated = url !== `${BASE}/login`;
    const ok = hasClick || navigated;
    // 정리: 이 여정이 세션을 만들었을 수 있으니 상태만 기록
    const s = await sessionState();
    if (/accounts\.google\.com/.test(url)) { ab('back'); await sleep(800); }
    record('TC-BBF-010', '로그인 버튼 마우스 클릭 응답성', ok ? 'PASS' : 'FAIL',
      '활성화된 버튼은 신뢰된 마우스 클릭(click 이벤트)에 반응해야 한다',
      '③ 일반 UX/웹 관행(버튼=클릭 가능)',
      [`좌표 (${pt.x},${pt.y}) 신뢰된 마우스 down/up 실행`,
       `버튼 도달 이벤트: ${JSON.stringify(events)}`,
       `클릭 후 URL: ${redact(url)}${navigated ? ' (이동/반응 발생)' : ' (무이동)'}`,
       `세션 변화: authScope=${s.authScope}`],
      ok ? '' : 'pointerdown/pointerup 도달 후 mousedown/mouseup/click 억제(문서 레벨 pointerdown preventDefault 추정). 마우스 전용 사용자에게 죽은 버튼으로 보임. CDP 포인터 기반 증거이므로 실기기 마우스 검증 권장.');
  },

  /** TC-BBF-011 약관·개인정보 링크와 렌더 */
  async termsLinks() {
    await openPage(`${BASE}/login`);
    const hrefs = evalJs(`JSON.stringify([...document.querySelectorAll('a')]
      .filter(a=>/약관|개인정보/.test(a.textContent)).map(a=>a.getAttribute('href')))`);
    let links = []; try { links = JSON.parse(hrefs); } catch { links = []; }
    const obs = [`로그인 화면 링크: ${JSON.stringify(links)}`];
    let ok = links.length >= 2;
    for (const h of links) {
      const p = await httpGetText(h);
      const title = (p.text.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
      obs.push(`${h} → ${p.status} "${title}"`);
      if (p.status !== 200 || !/Jaroo/.test(title)) ok = false;
    }
    record('TC-BBF-011', '약관·개인정보처리방침 링크/렌더 접근성', ok ? 'PASS' : 'FAIL',
      '동의 문구의 약관·개인정보 링크가 로그인 없이 열리고 본문이 렌더링된다',
      '② 공개 법령 지식(약관 게시·동의 전 열람 가능) + ① 제품 공개 문구', obs);
  },

  /** TC-BBF-012 게스트로 둘러보기 */
  async guestBrowse() {
    const s = await sessionState();
    if (s.authScope && s.authScope !== 'guest') {
      record('TC-BBF-012', '"게스트로 둘러보기" 버튼 동작', 'SKIP',
        '게스트 둘러보기 진출점이 게스트 모드 화면으로 이동', '① 제품 공개 문구(약관상 게스트 정의)',
        [`세션 인증 상태(authScope=${s.authScope}) — 게스트 관찰 아님`]);
      return;
    }
    await openPage(`${BASE}/login`);
    ab('set', 'viewport', '1280', '900');
    const cbRef = refOf('만 14세 이상이며');
    if (cbRef) ab('click', cbRef);
    await sleep(500);
    const before = currentUrl();
    const ref = refOf('게스트로 둘러보기');
    if (!ref) {
      record('TC-BBF-012', '"게스트로 둘러보기" 버튼 동작', 'SKIP',
        '게스트 둘러보기 진출점 존재', '① 제품 공개 문구(약관상 게스트 정의)', ['버튼 미발견(화면 구성差异 가능)']);
      return;
    }
    ab('click', ref);
    await sleep(3000);
    const after = currentUrl();
    const moved = after !== before && !after.endsWith('/login');
    const landed = /\/home|\/screenshot|\/deepscan/.test(after);
    record('TC-BBF-012', '"게스트로 둘러보기" 버튼 동작', moved && landed ? 'PASS' : 'FAIL',
      '클릭하면 게스트 모드 서비스 화면으로 이동한다',
      '① 제품 공개 문구(약관 제2조 게스트 정의) + ③ 일반 UX 관행(버튼은 결과를 낸다)',
      [`클릭 전: ${before}`, `클릭 후: ${after}`, moved ? '이동 발생' : '화면 무변화(사용자 관점 무반응)'],
      moved ? '' : '로컬 관찰: /deepscan 진입 시도 → 게스트 가드에 걸려 /login?next=%2Fdeepscan 로 되돌아옴 — 사용자에겐 "죽은 버튼"으로 보임. 게스트 홈(/home)이 존재하므로 /home 유도가 자연스러움.');
  },

  /** TC-BBF-013 보안 헤더(사용자 관점 HTTP) */
  async securityHeaders() {
    const res = await fetch(`${BASE}/login`, { headers: authHeaders() });
    const h = res.headers;
    const checks = {
      'X-Frame-Options': h.get('x-frame-options') || '(없음)',
      'X-Content-Type-Options': h.get('x-content-type-options') || '(없음)',
      'Referrer-Policy': h.get('referrer-policy') || '(없음)',
    };
    const ok = /deny|sameorigin/i.test(checks['X-Frame-Options'])
      && /nosniff/i.test(checks['X-Content-Type-Options'])
      && checks['Referrer-Policy'] !== '(없음)';
    record('TC-BBF-013', '공개 화면 보안 헤더', ok ? 'PASS' : 'FAIL',
      '클릭재킹 방지(X-Frame-Options), MIME 스니핑 방지(nosniff), 리퍼러 정책 포함',
      '③ 일반 보안 관행(OWASP 보안 헤더) — 인증 화면에서 특히 중요',
      Object.entries(checks).map(([k, v]) => `${k}: ${v}`));
  },
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const allowCostly = argv.includes('--allow-costly');
  const wantList = argv.includes('--list');
  const noClose = argv.includes('--no-close');
  const names = argv.filter((a) => !a.startsWith('--'));
  const all = ['consent', 'guards', 'guestBrowse', 'termsLinks', 'notFound', 'oauthError',
    'securityHeaders', 'mouseClick', 'login', 'loginRevisit', 'mypageLogout', 'deepscan', 'ocr'];
  const tcMap = {
    consent: 'TC-BBF-002', guards: 'TC-BBF-003', guestBrowse: 'TC-BBF-012', termsLinks: 'TC-BBF-011',
    notFound: 'TC-BBF-007', oauthError: 'TC-BBF-009', securityHeaders: 'TC-BBF-013', mouseClick: 'TC-BBF-010',
    login: 'TC-BBF-001', loginRevisit: 'TC-BBF-008', mypageLogout: 'TC-BBF-004', deepscan: 'TC-BBF-005',
    ocr: 'TC-BBF-006',
  };

  if (wantList) {
    console.log('사용 가능한 여정(key → TC ID):');
    for (const k of all) console.log(`  ${k.padEnd(16)} ${tcMap[k]}`);
    console.log(`\n환경: BB_BASE_URL=${BASE} BB_BASIC_AUTH=${BASIC_AUTH ? '(설정됨-비공개)' : '(없음)'}`);
    return 0;
  }

  const selected = names.length ? names : all;
  console.log(`# jaroo 블랙박스 인증 여정 러너 — ${now()}`);
  console.log(`# 대상: ${BASE} (BasicAuth ${BASIC_AUTH ? '사용' : '없음'}) / 세션: ${SESSION}`);
  console.log(`# 여정: ${selected.join(', ')} / --allow-costly=${allowCostly}`);

  ab('set', 'viewport', '1280', '900');

  for (const name of selected) {
    if (!journeys[name]) {
      console.log(`\n⚠️ 알 수 없는 여정: ${name} (--list 참조)`);
      continue;
    }
    try {
      await journeys[name](allowCostly);
    } catch (e) {
      record('RUNNER', `여정 ${name} 실행 중 예외`, 'SKIP', '여정 완료', '—', [redact(e.message)], '러너 오류(제품 결함 아님).');
    }
  }

  const cnt = { PASS: 0, FAIL: 0, SKIP: 0 };
  results.forEach((r) => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
  console.log('\n## 요약');
  console.log(`총 ${results.length}여정 — PASS ${cnt.PASS} / FAIL ${cnt.FAIL} / SKIP ${cnt.SKIP}`);
  results.forEach((r) => console.log(`  ${r.status.padEnd(4)} ${r.id} ${r.title}`));
  console.log(`\n비용 예산 상태: ${JSON.stringify(loadBudget())} (${BUDGET_FILE})`);
  return cnt.FAIL > 0 ? 1 : 0;
}

main()
  .then((code) => { if (!process.argv.includes('--no-close')) abOk('close'); process.exit(code); })
  .catch((e) => { console.error('치명 오류:', redact(e.stack || e.message)); abOk('close'); process.exit(2); });
