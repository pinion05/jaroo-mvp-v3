#!/usr/bin/env node
/**
 * User-journey E2E tests for Jaroo (비로그인 여정 + 세션 시딩 여정).
 *
 * verify-screens-browser.cjs 가 "화면별 DOM 계약"을 검증한다면, 이 스크립트는
 * "사용자 여정"을 검증한다: 게스트 가드 → 로그인 진입 → 약관 → 홈 둘러보기 → OCR 가드.
 * 브라우저는 agent-browser(Chromium)로 실제 구동하며 세션 이름을 분리해
 * 다른 에이전트/스크립트와 충돌하지 않게 한다.
 *
 * Usage:
 *   node scripts/e2e-journeys.cjs                 # all journeys
 *   node scripts/e2e-journeys.cjs guards login    # selected journeys
 *   node scripts/e2e-journeys.cjs --list          # list journeys
 *   node scripts/e2e-journeys.cjs --keep-open     # leave browser running
 *
 * Environment:
 *   JAROO_BASE_URL      default http://127.0.0.1:3002
 *   JAROO_CRAWLER_URL   default http://127.0.0.1:3040
 *   JAROO_JOURNEY_SESSION  agent-browser session name (default jaroo-e2e-journeys)
 *
 * Requirements: jaroo dev stack running (web 3002 + crawler 3040) and an
 * agent-browser build that supports `--session-name`.
 *
 * 이 스크립트는 Supabase에 쓰기 부작용(회원가입·결제·데이터 변경)을 만들지 않는다.
 * OAuth/이메일 로그인 완료는 범위 밖(리다이렉트 URI 미화이트리스트)이므로 로그인 여정은
 * 미인증 상태의 진입 UI 계약까지만 검증한다.
 */

'use strict'

const { spawnSync } = require('node:child_process')

const BASE_URL = process.env.JAROO_BASE_URL || 'http://127.0.0.1:3002'
const CRAWLER_URL = process.env.JAROO_CRAWLER_URL || 'http://127.0.0.1:3040'
const SESSION = process.env.JAROO_JOURNEY_SESSION || 'jaroo-e2e-journeys'

const argv = process.argv.slice(2)
const KEEP_OPEN = argv.includes('--keep-open')
const LIST_ONLY = argv.includes('--list')
const requestedJourneys = argv.filter((arg) => !arg.startsWith('--'))

/* ------------------------------------------------------------------ *
 * agent-browser helpers (verify-screens-browser.cjs 하우스 패턴)
 * ------------------------------------------------------------------ */

const REQUIRED_FLAG = '--session-name'

function listCandidateBinaries() {
  if (process.env.AGENT_BROWSER_BIN) {
    return [process.env.AGENT_BROWSER_BIN]
  }

  const known = ['/home/pinion/.npm-global/bin/agent-browser', '/home/pinion/.local/bin/agent-browser']
  const lookup = spawnSync('which', ['-a', 'agent-browser'], { encoding: 'utf8', timeout: 10_000 })
  const candidates = `${lookup.stdout || ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return [...new Set([...candidates, ...known])]
}

function describeBinary(binPath) {
  const version = spawnSync(binPath, ['--version'], { encoding: 'utf8', timeout: 15_000 })
  const help = spawnSync(binPath, ['--help'], { encoding: 'utf8', timeout: 15_000 })
  const helpText = `${help.stdout || ''}${help.stderr || ''}`

  return {
    path: binPath,
    version: (version.stdout || '').trim() || '(unknown)',
    supportsSession: helpText.includes(REQUIRED_FLAG),
  }
}

function resolveAgentBrowser() {
  const candidates = listCandidateBinaries()

  if (candidates.length === 0) {
    return { bin: null, inspected: [] }
  }

  const inspected = candidates.map(describeBinary)
  const compatible = inspected.find((entry) => entry.supportsSession)

  return { bin: compatible?.path ?? null, inspected }
}

const { bin: AGENT_BROWSER, inspected: AGENT_BROWSER_CANDIDATES } = resolveAgentBrowser()

function ab(args, { timeoutMs = 90_000, allowFailure = false } = {}) {
  const result = spawnSync(AGENT_BROWSER, ['--session-name', SESSION, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
  })

  if (result.error) {
    if (allowFailure) return { ok: false, stdout: '', stderr: String(result.error) }
    throw new Error(`agent-browser ${args.join(' ')} failed to spawn: ${result.error.message}`)
  }

  const stdout = (result.stdout || '').trim()
  const stderr = (result.stderr || '').trim()
  const ok = result.status === 0 && !stdout.startsWith('✗')

  if (!ok && !allowFailure) {
    throw new Error(`agent-browser ${args.join(' ')} failed:\n${stdout || stderr}`)
  }

  return { ok, stdout, stderr }
}

/**
 * Run JS in the page and decode the result.
 *
 * agent-browser prints the evaluated value as a JSON string, so a page
 * expression of `JSON.stringify(x)` arrives double-encoded. Decode until we
 * reach a non-string value.
 */
function evalJson(expression) {
  const { stdout } = ab(['eval', expression])
  const cleaned = stdout.replace(/^✓\s*/u, '').trim()
  if (!cleaned) return null

  let value = cleaned
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    try {
      const decoded = JSON.parse(value)
      if (decoded === value) break
      value = decoded
    } catch {
      break
    }
  }

  return value
}

function open(url) {
  ab(['open', url])
}

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`], { timeout: ms + 5_000 })
}

/**
 * Poll a page expression until `predicate` accepts the decoded value.
 * Returns the last observed value regardless of success so callers can assert
 * on it and report the real value instead of a generic timeout.
 */
function waitFor(expression, predicate, { timeoutMs = 60_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = evalJson(expression)

  while (!predicate(last) && Date.now() < deadline) {
    sleep(intervalMs)
    last = evalJson(expression)
  }

  return last
}

/* ------------------------------------------------------------------ *
 * Console / network hygiene (verify-screens 패턴 재사용)
 * ------------------------------------------------------------------ */

const IGNORED_CONSOLE_PATTERNS = [
  /react-devtools|Download the React DevTools/iu,
  /scroll-behavior: smooth/iu, // Next.js dev hint, not an app fault
  /missing-data-scroll-behavior/iu,
  /\[Fast Refresh\]|\[HMR\]/iu,
]

const CONSOLE_COLLECTION_FAILED = -1

function consoleErrorCount() {
  const { ok, stdout } = ab(['console'], { allowFailure: true })

  if (!ok) {
    return CONSOLE_COLLECTION_FAILED
  }

  return stdout
    .split('\n')
    .filter((line) => /^\[(error|warning)\]/iu.test(line.trim()))
    .filter((line) => !IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(line)))
    .length
}

/**
 * 게스트 하니스는 Supabase 인증 쿠키를 시딩하지 않으므로 인증 게이트 API의
 * 401/403은 설계된 동작이다(verify-screens와 동일한 허용 규칙).
 *
 * /api/ocr 401/403: /ocr는 업로드 세션 마운트 시 자동으로 분석 배치를 실행한다
 * (src/app/ocr/page.tsx autoOcrSessionKeyRef → runOcrBatch). 게스트는 로그인
 * 요건(401)에 걸리고, 127.0.0.1:3002로 접속하면 서버 origin(local이 아닌 host
 * 불일치, src/lib/http-origin-guard.ts) 때문에 그 전에 403이 난다 — 둘 다
 * 설계된 가드로, 게스트 하니스의 환경 한계다.
 */
const EXPECTED_HTTP_FAILURES = [
  { status: 401, pattern: /\/api\/portfolio\b/u },
  { status: 403, pattern: /\/api\/portfolio\b/u },
  { status: 401, pattern: /\/api\/auth\//u },
  { status: 403, pattern: /\/api\/auth\//u },
  { status: 401, pattern: /\/api\/ocr\b/u },
  { status: 403, pattern: /\/api\/ocr\b/u },
]

const NETWORK_COLLECTION_FAILED = -1

function resetNetworkLog() {
  ab(['network', 'requests', '--clear'], { allowFailure: true })
}

function failedRequests() {
  const { ok, stdout } = ab(['network', 'requests'], { allowFailure: true })

  if (!ok) {
    return NETWORK_COLLECTION_FAILED
  }

  return stdout
    .split('\n')
    .map((line) => {
      const match = /^\[[^\]]+\]\s+(\S+)\s+(\S+)\s+\([^)]*\)\s+(\d{3})\s*$/u.exec(line.trim())
      if (!match) {
        return null
      }
      return { method: match[1], url: match[2], status: Number(match[3]) }
    })
    .filter((entry) => entry && entry.status >= 400)
    .filter((entry) => !EXPECTED_HTTP_FAILURES.some(
      (allowed) => allowed.status === entry.status && allowed.pattern.test(entry.url),
    ))
}

/* ------------------------------------------------------------------ *
 * Assertion harness
 * ------------------------------------------------------------------ */

const failures = []
const passes = []

function check(label, actual, expectation) {
  const { pass, detail } = expectation(actual)
  if (pass) {
    passes.push(label)
    console.log(`    ✓ ${label}`)
  } else {
    failures.push(`${label} — ${detail}`)
    console.log(`    ✗ ${label} — ${detail}`)
  }
}

const expect = {
  truthy: () => (actual) => ({
    pass: Boolean(actual),
    detail: `expected truthy, got ${JSON.stringify(actual)}`,
  }),
  equals: (want) => (actual) => ({
    pass: actual === want,
    detail: `expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`,
  }),
  /** 값 동등성(배열/객체 비교용) — === 는 참조 비교라 배열 리터럴에 쓰면 안 된다. */
  equalsJson: (want) => (actual) => ({
    pass: JSON.stringify(actual) === JSON.stringify(want),
    detail: `expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`,
  }),
  inSet: (set) => (actual) => ({
    pass: set.includes(actual),
    detail: `expected one of ${JSON.stringify(set)}, got ${JSON.stringify(actual)}`,
  }),
  atLeast: (min) => (actual) => ({
    pass: typeof actual === 'number' && actual >= min,
    detail: `expected >= ${min}, got ${JSON.stringify(actual)}`,
  }),
  contains: (needle) => (actual) => ({
    pass: typeof actual === 'string' && actual.includes(needle),
    detail: `expected to contain ${JSON.stringify(needle)}, got ${JSON.stringify(actual)}`,
  }),
  matches: (regex) => (actual) => ({
    pass: typeof actual === 'string' && regex.test(actual),
    detail: `expected to match ${regex}, got ${JSON.stringify(actual)}`,
  }),
}

function checkConsoleClean() {
  const count = consoleErrorCount()

  if (count === CONSOLE_COLLECTION_FAILED) {
    check('콘솔 에러 없음', 'console 수집 실패 (세션 종료/타임아웃)', expect.equals(0))
    return
  }

  check('콘솔 에러 없음', count, expect.equals(0))
}

function checkNoFailedRequests() {
  const failed = failedRequests()

  if (failed === NETWORK_COLLECTION_FAILED) {
    check('HTTP 실패 응답 없음', 'network 수집 실패 (세션 종료/타임아웃)', expect.equals(0))
    return
  }

  if (failed.length > 0) {
    const summary = failed.map((entry) => `${entry.status} ${entry.method} ${entry.url}`).join(', ')
    check('HTTP 실패 응답 없음', summary, expect.equals(0))
    return
  }

  check('HTTP 실패 응답 없음', 0, expect.equals(0))
}

/* ------------------------------------------------------------------ *
 * HTTP-level helpers (Node fetch — 서버 리다이렉트 검증용)
 * ------------------------------------------------------------------ */

/** redirect: 'manual' 로 서버 응답 그대로 확인한다. */
async function httpProbe(path) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(`${BASE_URL}${path}`, { signal: controller.signal, redirect: 'manual' })
    const location = response.headers.get('location') || ''
    return { status: response.status, location }
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'TIMEOUT' : error?.cause?.code ?? error?.code ?? error?.name ?? 'UNKNOWN'
    return { status: 0, location: '', error: String(reason) }
  } finally {
    clearTimeout(timer)
  }
}

/** 서버 리다이렉트 계약 검증 (상태코드 + Location). */
function checkServerRedirect(label, path, { statuses, locationPredicate, locationDesc }) {
  return async () => {
    const probe = await httpProbe(path)
    check(`${label} — 상태코드`, probe.status, expect.inSet(statuses))
    if (probe.error) return
    check(`${label} — Location ${locationDesc}`, probe.location, locationPredicate)
  }
}

/** 게스트 하니스 기준 상태 정리: localStorage/ sessionStorage 키 제거. */
function clearGuestState() {
  open(`${BASE_URL}/login`)
  sleep(2_000)
  ab(['eval', `(() => { localStorage.clear(); sessionStorage.clear(); return JSON.stringify('cleared'); })()`])
}

/* ------------------------------------------------------------------ *
 * Session fixtures (verify-screens 홈 시딩 fixture 재사용)
 * ------------------------------------------------------------------ */

/**
 * applied-home-portfolio 시딩. Schema must satisfy
 * readAppliedHomePortfolio(): { broker: string, rows: AppliedHomePortfolioRow[] }.
 */
const SEED_PORTFOLIO = `
sessionStorage.setItem('jaroo:applied-home-portfolio', JSON.stringify({
  broker: '키움증권',
  appliedAt: new Date().toISOString(),
  rows: [{
    name: '삼성전자', quantity: '10', averagePrice: '78000',
    profitRate: '-8.2', evaluationAmount: '716000',
    resolvedName: '삼성전자', resolvedCode: '005930',
    resolvedMarket: 'KOSPI', resolvedMarketTone: 'kospi', resolvedKind: 'stock'
  }]
}));
sessionStorage.removeItem('jaroo:deepscan-target');
JSON.stringify('seeded')
`

function seedPortfolio() {
  // sessionStorage is origin-scoped, so land on the origin before writing.
  open(`${BASE_URL}/home`)
  sleep(1_500)
  ab(['eval', SEED_PORTFOLIO])
}

/** 로그인 동의 게이트 상태 키(src/lib/terms.ts: TERMS_CONSENT_STORAGE_KEY). */
const TERMS_CONSENT_STORAGE_KEY = 'jaroo:terms-consent:v1'

/* ------------------------------------------------------------------ *
 * Journeys
 * ------------------------------------------------------------------ */

const journeys = {
  /**
   * TC-E2EJ-001 비로그인 가드 여정.
   *
   * 기대동작은 소스에서 확정했다:
   *   - src/lib/supabase/proxy.ts  PROTECTED_APP_PATHS = ['/mypage', '/deepscan', '/payments']
   *     → 게스트는 /login?next=<원래경로> 로 서버 리다이렉트(307).
   *   - src/app/page.tsx           게스트는 / → /login (307, next 없음).
   *   - /home 은 게스트 체험 funnel(둘러보기)로 "의도적으로 개방" — 리다이렉트가
   *     아니라 /home 에 머물러야 정상이다(댓글: "홈/스크린샷/OCR/병합/ETF/쉐어카드는
   *     게스트 체험 funnel로 개방").
   */
  guards: {
    id: 'TC-E2EJ-001',
    description: '비로그인 가드: / · /mypage · /deepscan → /login, /home 은 게스트 개방',
    async run() {
      clearGuestState()

      console.log('    · HTTP 레벨 (서버 응답, redirect: manual)')
      await checkServerRedirect('루트 / 게스트', '/', {
        statuses: [307, 302],
        locationPredicate: expect.equals('/login'),
        locationDesc: '= /login',
      })()
      await checkServerRedirect('/mypage 게스트', '/mypage', {
        statuses: [307, 302],
        locationPredicate: expect.matches(/^\/login\?next=%2Fmypage$/u),
        locationDesc: '= /login?next=%2Fmypage',
      })()
      await checkServerRedirect('/deepscan 게스트', '/deepscan', {
        statuses: [307, 302],
        locationPredicate: expect.matches(/^\/login\?next=%2Fdeepscan$/u),
        locationDesc: '= /login?next=%2Fdeepscan',
      })()
      await checkServerRedirect('/home 게스트 (개방 경로)', '/home', {
        statuses: [200],
        locationPredicate: expect.equals(''),
        locationDesc: '없음(200 유지)',
      })()

      console.log('    · 브라우저 레벨 (실제 탐색 결과)')
      resetNetworkLog()
      open(`${BASE_URL}/`)
      const rootPath = waitFor('JSON.stringify(window.location.pathname)', (p) => p === '/login', { timeoutMs: 15_000 })
      check('브라우저: / → /login 도착', rootPath, expect.equals('/login'))

      resetNetworkLog()
      open(`${BASE_URL}/mypage`)
      const mypage = waitFor(
        'JSON.stringify(window.location.pathname + window.location.search)',
        (v) => typeof v === 'string' && v.startsWith('/login'),
        { timeoutMs: 15_000 },
      )
      check('브라우저: /mypage → /login?next=/mypage', mypage, expect.equals('/login?next=%2Fmypage'))

      resetNetworkLog()
      open(`${BASE_URL}/deepscan`)
      const deepscan = waitFor(
        'JSON.stringify(window.location.pathname + window.location.search)',
        (v) => typeof v === 'string' && v.startsWith('/login'),
        { timeoutMs: 15_000 },
      )
      check('브라우저: /deepscan → /login?next=/deepscan', deepscan, expect.equals('/login?next=%2Fdeepscan'))

      resetNetworkLog()
      open(`${BASE_URL}/home`)
      sleep(5_000)
      check('브라우저: /home 경로 유지 (게스트 개방)', evalJson('JSON.stringify(window.location.pathname)'), expect.equals('/home'))
      // 포트폴리오 세션이 없는 게스트 /home은 빈 상태(온보딩 CTA)를 렌더한다 —
      // 하단 네비 없이 전면 준비 화면("포트폴리오 준비" + 스크린샷 추가 CTA)이 설계 동작.
      check('게스트 /home 빈 상태 CTA (스크린샷 추가하기)',
        evalJson(`JSON.stringify(document.body.textContent.includes('스크린샷 추가하기'))`), expect.equals(true))
      check('게스트 /home 참고용 고지 노출',
        evalJson(`JSON.stringify(/투자 자문·권유가 아니며/u.test(document.body.textContent))`), expect.equals(true))
      checkConsoleClean()
      checkNoFailedRequests()
    },
  },

  /**
   * TC-E2EJ-002 로그인 페이지 여정.
   *
   * DOM 계약(src/app/login/page.tsx): 브랜드 "Jaroo", 히어로 문구
   * "MTS 스크린샷 한 장으로 / 내 주식을 AI가 진단", 동의 게이트(필수 체크박스,
   * 미동의 시 시작 버튼 disabled — 이 스택은 devAutoLogin 미주입으로 게이트 활성),
   * Google 시작 버튼, 게스트 버튼. window.__JAROO_ENV__ 는 루트 레이아웃이
   * 서버 런타임 env에서 supabaseUrl/supabaseAnonKey 를 주입한다.
   */
  login: {
    id: 'TC-E2EJ-002',
    description: '로그인 페이지 렌더 + 동의 게이트 + __JAROO_ENV__ Supabase 주입',
    async run() {
      clearGuestState()
      resetNetworkLog()
      open(`${BASE_URL}/login`)
      sleep(5_000)

      check('/login 경로 유지', evalJson('JSON.stringify(window.location.pathname)'), expect.equals('/login'))
      check('문서 타이틀', evalJson('JSON.stringify(document.title)'), expect.contains('Jaroo'))
      check('브랜드 문구 "Jaroo"', evalJson('JSON.stringify(document.body.textContent.includes(\'Jaroo\'))'), expect.equals(true))
      check('히어로 카피 "MTS 스크린샷 한 장으로"',
        evalJson('JSON.stringify(document.body.textContent.includes(\'MTS 스크린샷 한 장으로\'))'), expect.equals(true))
      check('히어로 카피 "내 주식을 AI가 진단"',
        evalJson('JSON.stringify(document.body.textContent.includes(\'내 주식을 AI가 진단\'))'), expect.equals(true))

      // 동의 게이트: 필수 체크박스 + 약관 링크
      check('동의 체크박스 (필수)',
        evalJson(`JSON.stringify(!!document.querySelector('input[type="checkbox"]'))`), expect.equals(true))
      check('동의 문구 "만 14세 이상"',
        evalJson(`JSON.stringify(document.body.textContent.includes('만 14세 이상'))`), expect.equals(true))
      check('동의 문구에 /terms 링크',
        evalJson(`JSON.stringify(!!document.querySelector('a[href="/terms"]'))`), expect.equals(true))
      check('동의 문구에 /privacy 링크',
        evalJson(`JSON.stringify(!!document.querySelector('a[href="/privacy"]'))`), expect.equals(true))

      // 시작 버튼 3종 + 게스트
      const startButtons = evalJson(`JSON.stringify([
        '이메일로 시작하기', 'Google로 시작하기', '카카오로 시작하기'
      ].map((t) => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.includes(t))))`)
      check('시작 버튼 3종 (이메일/Google/카카오)', startButtons, expect.equalsJson([true, true, true]))
      check('게스트 버튼 "게스트로 둘러보기"',
        evalJson(`JSON.stringify(Array.from(document.querySelectorAll('button')).some((b) => b.textContent.includes('게스트로 둘러보기')))`), expect.equals(true))

      // 런타임 env 주입 — Supabase 설정이 첫 페인트 전에 심겨야 OAuth 클라이언트가 초기화된다.
      check('__JAROO_ENV__ 주입 확인',
        evalJson(`JSON.stringify(typeof window.__JAROO_ENV__ === 'object' && window.__JAROO_ENV__ !== null)`), expect.equals(true))
      check('supabaseUrl 주입 (supabase.co)',
        evalJson(`JSON.stringify((window.__JAROO_ENV__?.supabaseUrl ?? '').includes('supabase.co'))`), expect.equals(true))
      check('supabaseAnonKey 주입 (비어있지 않음)',
        evalJson(`JSON.stringify((window.__JAROO_ENV__?.supabaseAnonKey ?? '').length >= 20)`), expect.equals(true))

      // 동의 게이트 상호작용: 미동의 → 시작 버튼 disabled, 체크 → enabled.
      // (page.tsx: disabled={pending || (!devAutoLoginEnabled && !termsAgreed)} —
      //  devAutoLogin 이 주입된 QA 스택에서는 게이트가 우회되므로 분기한다.
      //  현재 dev 스택은 devAutoLogin 미주입 → 게이트 활성이 기대 동작.)
      const devAutoLogin = evalJson(`JSON.stringify(window.__JAROO_ENV__?.devAutoLogin === true)`)
      if (devAutoLogin === true) {
        console.log('    · devAutoLogin 주입 스택 — 동의 게이트 우회 경로로 확인')
        check('devAutoLogin 시 Google 버튼 enabled',
          evalJson(`JSON.stringify(Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Google로 시작하기'))?.disabled ?? null)`), expect.equals(false))
      } else {
        check('미동의 시 Google 버튼 disabled',
          evalJson(`JSON.stringify(Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Google로 시작하기'))?.disabled ?? null)`), expect.equals(true))
        ab(['eval', `(() => { const box = document.querySelector('input[type="checkbox"]'); box.click(); return JSON.stringify(box.checked); })()`])
        sleep(1_000)
        check('동의 후 Google 버튼 enabled',
          evalJson(`JSON.stringify(Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Google로 시작하기'))?.disabled ?? null)`), expect.equals(false))
        check('동의 시각이 localStorage에 기록됨',
          evalJson(`JSON.stringify(!Number.isNaN(Date.parse(localStorage.getItem('${TERMS_CONSENT_STORAGE_KEY}') ?? '')))`), expect.equals(true))
      }

      checkConsoleClean()
      checkNoFailedRequests()
    },
  },

  /**
   * TC-E2EJ-003 약관/정책 여정.
   *
   * /terms · /privacy 는 게스트에게 개방(가드 목록 밖)이어야 하고, 투자자문업 아님
   * 고지(terms 제3조), 면책(terms 제8조), 개인정보보호법(privacy 제1조) 노출을 검증.
   * 링크 경로: /login 동의 문구(게스트 접근 가능)와 /mypage 설정 행(로그인 필요 —
   * 게스트 여정 범위 밖으로 문서에 명시).
   */
  legal: {
    id: 'TC-E2EJ-003',
    description: '약관/정책 문서 진입 + 투자자문업 아님·면책·PIPA 고지 + 링크 경로',
    async run() {
      // 직접 진입
      resetNetworkLog()
      open(`${BASE_URL}/terms`)
      sleep(4_000)

      check('/terms 경로 유지 (게스트 개방)', evalJson('JSON.stringify(window.location.pathname)'), expect.equals('/terms'))
      check('약관 타이틀', evalJson('JSON.stringify(document.title)'), expect.contains('서비스 이용약관'))
      check('시행일/버전 메타 노출',
        evalJson('JSON.stringify(/시행일 2026-08-20 · 버전 v1/u.test(document.body.textContent))'), expect.equals(true))
      check('제1조 (목적) 섹션',
        evalJson(`JSON.stringify(!!Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.includes('제1조')))`), expect.equals(true))
      check('"투자자문업…아닌" 고지 (제3조)',
        evalJson(`JSON.stringify(/투자자문업·투자일임업[\\s\\S]*업무가 아닌/u.test(document.body.textContent))`), expect.equals(true))
      check('"투자 권유…수익 보장이 아니며" 문구',
        evalJson(`JSON.stringify(document.body.textContent.includes('투자 권유, 매수·매도의 청약·권유, 수익 보장이 아니며'))`), expect.equals(true))
      check('제8조 (회사의 면책) 섹션',
        evalJson(`JSON.stringify(!!Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.includes('제8조')))`), expect.equals(true))
      check('면책 본문 "정확성·신뢰성을 보장하지 않으며"',
        evalJson(`JSON.stringify(document.body.textContent.includes('정확성·신뢰성을 보장하지 않으며'))`), expect.equals(true))

      resetNetworkLog()
      open(`${BASE_URL}/privacy`)
      sleep(4_000)

      check('/privacy 경로 유지 (게스트 개방)', evalJson('JSON.stringify(window.location.pathname)'), expect.equals('/privacy'))
      check('개인정보처리방침 타이틀', evalJson('JSON.stringify(document.title)'), expect.contains('개인정보처리방침'))
      check('개인정보보호법(PIPA) 근거 고지',
        evalJson(`JSON.stringify(document.body.textContent.includes('개인정보보호법에 따라'))`), expect.equals(true))
      check('제9조 개인정보 보호책임자 섹션',
        evalJson(`JSON.stringify(!!Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.includes('제9조')))`), expect.equals(true))
      check('만 14세 미만 아동 조항',
        evalJson(`JSON.stringify(!!Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.includes('만 14세 미만')))`), expect.equals(true))

      // 링크 경로: /login 동의 문구 → 각 문서로 이동 가능해야 한다.
      resetNetworkLog()
      open(`${BASE_URL}/login`)
      sleep(4_000)
      ab(['eval', `(() => { const a = document.querySelector('a[href="/terms"]'); if (!a) return JSON.stringify('missing'); a.click(); return JSON.stringify('clicked'); })()`])
      const termsPath = waitFor('JSON.stringify(window.location.pathname)', (p) => p === '/terms', { timeoutMs: 15_000 })
      check('링크 경로: /login → /terms 이동', termsPath, expect.equals('/terms'))

      open(`${BASE_URL}/login`)
      sleep(4_000)
      ab(['eval', `(() => { const a = document.querySelector('a[href="/privacy"]'); if (!a) return JSON.stringify('missing'); a.click(); return JSON.stringify('clicked'); })()`])
      const privacyPath = waitFor('JSON.stringify(window.location.pathname)', (p) => p === '/privacy', { timeoutMs: 15_000 })
      check('링크 경로: /login → /privacy 이동', privacyPath, expect.equals('/privacy'))

      checkConsoleClean()
      checkNoFailedRequests()
    },
  },

  /**
   * TC-E2EJ-004 홈 여정 (세션 시딩).
   *
   * verify-screens의 홈 시딩 fixture(jaroo:applied-home-portfolio)를 재사용해
   * 로그인 없이 /home 의 도넛·종목 리스트·요약을 검증하고, 종목 카드 클릭
   * (상세 토글 — 순수 클라이언트 상태, 서버 부작용 없음)까지 확인한다.
   */
  home: {
    id: 'TC-E2EJ-004',
    description: '홈 여정(시딩): 도넛 차트 + 종목 리스트 + 요약 + 카드 클릭 토글',
    async run() {
      seedPortfolio()
      resetNetworkLog()
      open(`${BASE_URL}/home`)
      sleep(7_000)

      check('/home 경로 유지', evalJson('JSON.stringify(window.location.pathname)'), expect.equals('/home'))
      check('포트폴리오 요약 영역',
        evalJson(`JSON.stringify(!!document.querySelector('[aria-label="홈 포트폴리오 요약"]'))`), expect.equals(true))
      check('도넛 차트 (보유 종목 비중 원차트)',
        evalJson(`JSON.stringify(!!document.querySelector('[aria-label="보유 종목 비중 원차트"]'))`), expect.equals(true))
      check('총 평가액 0원 아님 (시딩 값 반영)',
        evalJson(`JSON.stringify((() => {
          const amounts = (document.body.textContent.match(/[0-9][0-9,]*원/gu) || [])
            .map((raw) => Number(raw.replace(/[^0-9]/gu, '')))
            .filter((value) => Number.isFinite(value) && value > 0)
          return amounts.length
        })())`), expect.atLeast(1))
      check('보유 종목 카드 "삼성전자"',
        evalJson(`JSON.stringify(Array.from(document.querySelectorAll('button')).filter((b) => /삼성전자/u.test(b.textContent)).length)`), expect.atLeast(1))
      // 하단 네비는 app-bottom-nav.tsx NAV_ITEMS 단일 소스 — 홈·워치·스캔·기록·마이 5슬롯.
      check('하단 네비게이션 5슬롯 (주요 화면)',
        evalJson(`JSON.stringify(document.querySelectorAll('[aria-label="주요 화면"] a').length)`), expect.equals(5))

      // 종목 카드 클릭 상호작용: aria-expanded 토글(순수 클라이언트 상태).
      // React 상태 반영은 클릭 이후 비동기이므로 클릭 → 대기 → 별도 eval 로 관측한다.
      check('종목 카드 클릭 가능', evalJson(`JSON.stringify(Array.from(document.querySelectorAll('button[aria-expanded]')).some((b) => /삼성전자/u.test(b.textContent)))`), expect.equals(true))
      ab(['eval', `(() => { const row = Array.from(document.querySelectorAll('button[aria-expanded]')).find((b) => /삼성전자/u.test(b.textContent)); if (!row) return JSON.stringify('missing'); row.click(); return JSON.stringify('clicked'); })()`])
      const expandedRow = waitFor(
        `JSON.stringify((() => {
          const row = Array.from(document.querySelectorAll('button[aria-expanded]')).find((b) => b.getAttribute('aria-expanded') === 'true' && /삼성전자/u.test(b.textContent));
          return row ? row.closest('article')?.textContent.slice(0, 200) ?? null : null;
        })())`,
        (text) => typeof text === 'string' && text.length > 0,
        { timeoutMs: 10_000, intervalMs: 1_000 },
      )
      check('클릭 후 상세 펼침 (aria-expanded=true)', expandedRow, expect.truthy())
      check('펼친 상세 카드에 현재가/평단/평가금액 노출',
        evalJson(`JSON.stringify((() => {
          const row = Array.from(document.querySelectorAll('button[aria-expanded]')).find((b) => b.getAttribute('aria-expanded') === 'true');
          const card = row?.closest('article')?.textContent ?? '';
          return ['현재가', '평단', '평가금액'].every((label) => card.includes(label));
        })())`), expect.equals(true))

      checkConsoleClean()
      checkNoFailedRequests()
    },
  },

  /**
   * TC-E2EJ-005 OCR 가드 여정.
   *
   * OCR 업로드 세션(jaroo:screenshot-ocr-upload) 없이 /ocr 접근 시 설계된 가드는
   * 클라이언트 리다이렉트 → /screenshot 이다(verify-screens 'ocr-redirect'와 동일
   * 계약). /screenshot 도착 후 업로드 화면이 정상 렌더되는지까지 확인한다.
   */
  'ocr-guard': {
    id: 'TC-E2EJ-005',
    description: 'OCR 세션 없이 /ocr 접근 → /screenshot 가드 리다이렉트',
    async run() {
      open(`${BASE_URL}/home`)
      sleep(1_500)
      ab(['eval', `sessionStorage.removeItem('jaroo:screenshot-ocr-upload'); JSON.stringify('cleared')`])

      resetNetworkLog()
      open(`${BASE_URL}/ocr`)
      const pathname = waitFor(
        'JSON.stringify(window.location.pathname)',
        (value) => value === '/screenshot',
        { timeoutMs: 15_000 },
      )

      check('세션 없음 → /screenshot 리다이렉트', pathname, expect.equals('/screenshot'))
      check('가드 후 업로드 화면 셸 렌더링',
        evalJson(`JSON.stringify(!!document.querySelector('.jaroo-upload-frame'))`), expect.equals(true))
      check('가드 후 업로드 버튼 존재',
        evalJson(`JSON.stringify(!!document.querySelector('button.jaroo-upload-upzone'))`), expect.equals(true))
      check('/ocr 콘텐츠가 남지 않음 (완전 이탈)',
        evalJson(`JSON.stringify(!document.querySelector('.jaroo-ocr-page'))`), expect.equals(true))

      // 세션 있을 때는 /ocr 에 머물러야 한다(가드의 반대편 계약).
      const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
      ab(['eval', `sessionStorage.setItem('jaroo:screenshot-ocr-upload', JSON.stringify({
        broker: '키움증권',
        uploads: [{ id: 'journey-1', fileName: 'journey.png', imageDataUrl: '${TINY_PNG}' }]
      })); JSON.stringify('seeded')`])
      resetNetworkLog()
      open(`${BASE_URL}/ocr`)
      const kept = waitFor('JSON.stringify(window.location.pathname)', (p) => p === '/ocr', { timeoutMs: 15_000 })
      check('세션 있음 → /ocr 경로 유지', kept, expect.equals('/ocr'))

      checkConsoleClean()
      checkNoFailedRequests()
    },
  },
}

/* ------------------------------------------------------------------ *
 * Preflight
 * ------------------------------------------------------------------ */

async function httpStatus(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    return String(response.status)
  } catch (error) {
    if (error?.name === 'AbortError') {
      return 'error:TIMEOUT'
    }
    return `error:${error?.cause?.code ?? error?.code ?? error?.name ?? 'UNKNOWN'}`
  } finally {
    clearTimeout(timer)
  }
}

async function preflight() {
  console.log('Preflight')

  const web = await httpStatus(`${BASE_URL}/api/health`)
  if (web !== '200') {
    console.error(`  ✗ web ${BASE_URL} not healthy (status ${web}). Start the jaroo dev stack (web 3002).`)
    process.exit(2)
  }
  console.log(`  ✓ web ${BASE_URL} healthy`)

  const crawler = await httpStatus(`${CRAWLER_URL}/api/source/system/health`)
  if (crawler !== '200') {
    console.warn(`  ! crawler ${CRAWLER_URL} not healthy (status ${crawler}). 여정 결과에는 영향 없음(크롤러 미사용).`)
  } else {
    console.log(`  ✓ crawler ${CRAWLER_URL} healthy`)
  }

  if (!AGENT_BROWSER) {
    if (AGENT_BROWSER_CANDIDATES.length === 0) {
      console.error('  ✗ agent-browser not found. Install it, then run `agent-browser install`.')
    } else {
      console.error(`  ✗ no agent-browser build supports ${REQUIRED_FLAG}:`)
      for (const candidate of AGENT_BROWSER_CANDIDATES) {
        console.error(`      ${candidate.path} (${candidate.version})`)
      }
      console.error('    Pin a compatible build with AGENT_BROWSER_BIN=/path/to/agent-browser')
    }
    process.exit(2)
  }

  const version = spawnSync(AGENT_BROWSER, ['--version'], { encoding: 'utf8', timeout: 15_000 })
  if (version.error || version.status !== 0) {
    console.error(`  ✗ agent-browser unavailable (${version.error?.code ?? version.error?.message ?? version.status}).`)
    process.exit(2)
  }
  console.log(`  ✓ agent-browser ${(version.stdout || '').trim()} (${AGENT_BROWSER})`)
  console.log(`  ✓ session: ${SESSION}`)
  console.log('')
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  if (LIST_ONLY) {
    console.log('Available journeys:')
    for (const [name, journey] of Object.entries(journeys)) {
      console.log(`  ${journey.id}  ${name.padEnd(10)} ${journey.description}`)
    }
    return
  }

  await preflight()

  const selected = requestedJourneys.length > 0 ? requestedJourneys : Object.keys(journeys)
  const unknown = selected.filter((name) => !journeys[name])
  if (unknown.length > 0) {
    console.error(`Unknown journey(s): ${unknown.join(', ')}`)
    console.error(`Available: ${Object.keys(journeys).join(', ')}`)
    process.exit(2)
  }

  const startedAt = Date.now()

  for (const name of selected) {
    const journey = journeys[name]
    console.log(`Journey: ${journey.id} ${name} — ${journey.description}`)
    try {
      await journey.run()
    } catch (error) {
      failures.push(`${journey.id} ${name} journey threw — ${error.message}`)
      console.log(`    ✗ journey threw: ${error.message}`)
    }
    console.log('')
  }

  if (!KEEP_OPEN) {
    ab(['close'], { allowFailure: true })
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log('─'.repeat(60))
  console.log(`Summary: ${passes.length} passed, ${failures.length} failed  (${elapsedSec}s)`)

  if (failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const failure of failures) {
      console.log(`  - ${failure}`)
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
