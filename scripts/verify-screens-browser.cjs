#!/usr/bin/env node
/**
 * Real-browser regression verification for Jaroo screens.
 *
 * Unlike the unit/TS test suite (which only exercises pure helpers), this script
 * drives an actual Chromium instance through agent-browser and asserts that each
 * screen still renders its critical DOM contract after a refactor.
 *
 * Usage:
 *   node scripts/verify-screens-browser.cjs                # all suites
 *   node scripts/verify-screens-browser.cjs deepscan home   # selected suites
 *   node scripts/verify-screens-browser.cjs --list          # list suite names
 *   node scripts/verify-screens-browser.cjs --keep-open     # leave browser running
 *
 * Environment:
 *   JAROO_BASE_URL     default http://localhost:3000
 *   JAROO_CRAWLER_URL  default http://127.0.0.1:3040
 *   VERIFY_SESSION     agent-browser session name (default jaroo-verify)
 *
 * Requirements: `npm run dev` running (web 3000 + crawler 3040) and
 * `agent-browser` on PATH (`agent-browser install` once for bundled Chrome).
 */

'use strict'

const { spawnSync } = require('node:child_process')

const BASE_URL = process.env.JAROO_BASE_URL || 'http://localhost:3000'
const CRAWLER_URL = process.env.JAROO_CRAWLER_URL || 'http://127.0.0.1:3040'
const SESSION = process.env.VERIFY_SESSION || 'jaroo-verify'

const argv = process.argv.slice(2)
const KEEP_OPEN = argv.includes('--keep-open')
const LIST_ONLY = argv.includes('--list')
const requestedSuites = argv.filter((arg) => !arg.startsWith('--'))

/* ------------------------------------------------------------------ *
 * agent-browser helpers
 * ------------------------------------------------------------------ */

/**
 * Resolve which `agent-browser` binary to drive.
 *
 * Multiple installs can coexist (npm global, bun, homebrew) and `npm run`
 * reorders PATH, so the first match is not necessarily the one that supports
 * the flags we need. Pick the first candidate whose help advertises
 * `--session-name`; otherwise report every candidate so the mismatch is obvious.
 *
 * Override explicitly with AGENT_BROWSER_BIN when needed.
 */
const REQUIRED_FLAG = '--session-name'

function listCandidateBinaries() {
  if (process.env.AGENT_BROWSER_BIN) {
    return [process.env.AGENT_BROWSER_BIN]
  }

  const lookup = spawnSync('which', ['-a', 'agent-browser'], { encoding: 'utf8', timeout: 10_000 })
  const candidates = (lookup.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return [...new Set(candidates)]
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
 * reach a non-string value (or the payload genuinely is a string).
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
 * on it and report the real number instead of a generic timeout.
 */
function waitFor(expression, predicate, { timeoutMs = 60_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = evalJson(expression)

  while (!predicate(last) && Date.now() < deadline) {
    sleep(intervalMs)
    last = evalJson(expression)
  }

  return last
}

/**
 * Count real application console problems.
 *
 * Framework/dev-tooling notices are excluded: they appear on every page in dev
 * mode and would otherwise mask genuine regressions.
 *
 * Returns CONSOLE_COLLECTION_FAILED when the log could not be read at all
 * (dead session, timeout, CDP drop). A sentinel is used instead of 0 so a
 * collection failure can never be mistaken for "no errors".
 */
const IGNORED_CONSOLE_PATTERNS = [
  /react-devtools|Download the React DevTools/iu,
  /scroll-behavior: smooth/iu,           // Next.js dev hint, not an app fault
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

/**
 * Assert the page produced no console errors, keeping "clean" and
 * "could not be checked" as distinct outcomes.
 */
function checkConsoleClean() {
  const count = consoleErrorCount()

  if (count === CONSOLE_COLLECTION_FAILED) {
    check('콘솔 에러 없음', 'console 수집 실패 (세션 종료/타임아웃)', expect.equals(0))
    return
  }

  check('콘솔 에러 없음', count, expect.equals(0))
}

/* ------------------------------------------------------------------ *
 * Network failures
 * ------------------------------------------------------------------ */

/**
 * A console check alone cannot see HTTP failures: the app swallows most fetch
 * errors in try/catch, so a 500 from an API route produces a silently degraded
 * screen and a green console. These checks read the actual request log.
 *
 * Expected-by-design statuses are allowlisted rather than ignoring 4xx wholesale:
 * the harness drives an unauthenticated browser (it seeds sessionStorage, not
 * Supabase auth cookies), so auth-gated routes legitimately answer 401/403.
 */
const EXPECTED_HTTP_FAILURES = [
  { status: 401, pattern: /\/api\/portfolio\b/u },
  { status: 403, pattern: /\/api\/portfolio\b/u },
  { status: 401, pattern: /\/api\/auth\//u },
  { status: 403, pattern: /\/api\/auth\//u },
]

const NETWORK_COLLECTION_FAILED = -1

/**
 * Drop the accumulated request log.
 *
 * `agent-browser network requests` reports every request made since the
 * session started, so without this a single failure in an early suite is
 * re-reported by every later suite and the real culprit becomes ambiguous.
 * Call this right before navigating in each suite.
 */
function resetNetworkLog() {
  ab(['network', 'requests', '--clear'], { allowFailure: true })
}

/**
 * Parse `agent-browser network requests` lines of the form
 *   [requestId] METHOD url (Type) status
 * Entries without a trailing status (redirects, still in flight) are skipped:
 * only an explicit status code is unambiguous enough to fail a run on.
 */
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

/**
 * Fail on any server fault or unexpected client error observed on the screen.
 */
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
 * Session fixtures
 * ------------------------------------------------------------------ */

/**
 * Seed the applied-home-portfolio session so /home and /deepscan resolve a
 * target without requiring auth or an OCR round trip. Schema must satisfy
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

/**
 * Seed a screenshot upload session so /ocr renders instead of bouncing to
 * /screenshot. Schema must satisfy sanitizeScreenshotUploadSession():
 * { broker: string, uploads: [{ id, fileName, imageDataUrl: 'data:image/...' }] }.
 *
 * A 1x1 transparent PNG is enough — the suite only asserts the shell renders,
 * and no OCR request is triggered without user action.
 */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

const SEED_UPLOAD_SESSION = `
sessionStorage.setItem('jaroo:screenshot-ocr-upload', JSON.stringify({
  broker: '키움증권',
  uploads: [{ id: 'verify-1', fileName: 'verify.png', imageDataUrl: '${TINY_PNG}' }]
}));
JSON.stringify('seeded')
`

function seedUploadSession() {
  open(`${BASE_URL}/screenshot`)
  sleep(1_500)
  ab(['eval', SEED_UPLOAD_SESSION])
}

/* ------------------------------------------------------------------ *
 * Suites
 * ------------------------------------------------------------------ */

const suites = {
  /**
   * DeepScan loading screen — guards the 4-module split of
   * deepscan-loading-screen.tsx (screen / types / utils / briefing-card).
   */
  deepscan: {
    description: 'DeepScan 로딩 화면 + 브리핑 카드 + 위원 그리드 + 결과 전환',
    async run() {
      seedPortfolio()
      resetNetworkLog()
      open(`${BASE_URL}/deepscan`)
      sleep(9_000)

      check('종목명 헤더 렌더링 (h1)',
        evalJson(`JSON.stringify(document.querySelector('h1')?.textContent ?? null)`),
        expect.truthy())

      check('인트로 제목 렌더링',
        evalJson(`JSON.stringify(document.querySelector('[aria-label="딥스캔 안내"] h2')?.textContent ?? null)`),
        expect.contains('분석가'))

      check('뒤로가기 컨트롤 (BackControl)',
        evalJson(`JSON.stringify(!!document.querySelector('[aria-label="홈으로 가기"],[aria-label="뒤로 가기"]'))`),
        expect.equals(true))

      check('브리핑 카드 (briefing-card.tsx)',
        evalJson(`JSON.stringify(!!document.querySelector('[aria-label="오늘 장 기준 시세 브리핑"]'))`),
        expect.equals(true))

      check('일봉 차트 SVG (buildChartGeometry)',
        evalJson(`JSON.stringify(!!document.querySelector('svg[aria-label="최근 3개월 일봉 차트"]'))`),
        expect.equals(true))

      check('차트 라인 path 좌표 생성',
        evalJson(`JSON.stringify((document.querySelector('svg[aria-label="최근 3개월 일봉 차트"] path')?.getAttribute('d') ?? '').length)`),
        expect.atLeast(50))

      check('진행률 헤더 + 경과시간 (formatElapsedTime)',
        evalJson(`JSON.stringify(document.querySelector('[aria-label*="딥스캔"]')?.textContent ?? null)`),
        expect.matches(/\d{2}:\d{2}|완료/u))

      check('위원 9명 그리드 (committeeMembers)',
        evalJson(`JSON.stringify(document.querySelectorAll('[aria-label="세 팀 분석 진행 상태"] [class*="member"] [class*="memberName"], [aria-label="세 팀 분석 진행 상태"] > div > div').length)`),
        expect.atLeast(9))

      check('세부 진행 단계 섹션',
        evalJson(`JSON.stringify(!!document.querySelector('[aria-label="분석 단계"]'))`),
        expect.equals(true))

      // Sequential reveal is time-driven; wait past the briefing cadence.
      sleep(26_000)

      check('브리핑 항목 6개 순차 노출 (TodayBriefingItem)',
        evalJson(`JSON.stringify(document.querySelectorAll('[data-today-briefing-item="true"]').length)`),
        expect.atLeast(6))

      check('브리핑 항목에 데이터 문구 채워짐',
        evalJson(`JSON.stringify(Array.from(document.querySelectorAll('[data-today-briefing-item="true"]')).filter(el => el.textContent.trim().length > 20).length)`),
        expect.atLeast(5))

      check('시장 비교 항목 (TodayMarketBriefing)',
        evalJson(`JSON.stringify(Array.from(document.querySelectorAll('[data-today-briefing-item="true"]')).some(el => /코스피|S&P|NASDAQ|코스닥/u.test(el.textContent)))`),
        expect.equals(true))

      // `atLeast(1)` passed even if the tone mapping had collapsed to a single
      // incidental element. The seeded holding carries profitRate -8.2, so a
      // loss tone must actually be applied somewhere.
      check('금융 색상 토큰 적용 (financialToneClass)',
        evalJson(`JSON.stringify(document.querySelectorAll('[class*="gain"],[class*="loss"],[class*="financialNeutral"],[class*="todayUp"],[class*="todayDown"]').length)`),
        expect.atLeast(3))

      check('손실 톤이 실제로 매핑됨',
        evalJson(`JSON.stringify(document.querySelectorAll('[class*="loss"],[class*="todayDown"]').length)`),
        expect.atLeast(1))

      // Narrative cards unlock at TEAM_BRIDGE_DONE_SECONDS (~73s) or as soon as
      // the real payload arrives, whichever comes first. Poll rather than guess.
      const narrativeCount = waitFor(
        `JSON.stringify(document.querySelectorAll('[aria-label="분석가 진행 메시지"] article').length)`,
        (count) => typeof count === 'number' && count >= 1,
        { timeoutMs: 90_000 },
      )
      check('내러티브 카드 렌더링 (buildLoadingStages)', narrativeCount, expect.atLeast(1))

      check('내러티브 카드에 팀명 표시',
        evalJson(`JSON.stringify(Array.from(document.querySelectorAll('[aria-label="분석가 진행 메시지"] article')).some(el => /팀/u.test(el.textContent)))`),
        expect.equals(true))

      // The payload eventually flips resultsReady, which mounts the inline
      // results slot under the loading shell (buildCompletionState path).
      const completed = waitFor(
        `JSON.stringify(!!document.querySelector('[aria-label="완료 전환 상태"]'))`,
        (ready) => ready === true,
        { timeoutMs: 120_000 },
      )
      check('완료 전환 카드 (buildCompletionState)', completed, expect.equals(true))

      check('인라인 결과 연결',
        evalJson(`JSON.stringify(/세 팀의 의견|종합 결론/u.test(document.body.textContent))`),
        expect.equals(true))

      checkConsoleClean()
      checkNoFailedRequests()
    },
  },

  /** Home screen — portfolio donut, holdings list, market score. */
  home: {
    description: '홈 화면 도넛 차트 + 종목 리스트 + 요약',
    async run() {
      seedPortfolio()
      resetNetworkLog()
      open(`${BASE_URL}/home`)
      sleep(7_000)

      check('포트폴리오 요약 영역',
        evalJson(`JSON.stringify(!!document.querySelector('[aria-label="홈 포트폴리오 요약"]'))`),
        expect.equals(true))

      check('도넛 차트 렌더링',
        evalJson(`JSON.stringify(!!document.querySelector('[aria-label="보유 종목 비중 원차트"]'))`),
        expect.equals(true))

      // `/[0-9,]+원/` also matched a fallback "0원", so a broken valuation
      // pipeline stayed green. Require the seeded holding's actual value.
      check('총 평가액이 0원이 아님',
        evalJson(`JSON.stringify((() => {
          const amounts = (document.body.textContent.match(/[0-9][0-9,]*원/gu) || [])
            .map((raw) => Number(raw.replace(/[^0-9]/gu, '')))
            .filter((value) => Number.isFinite(value) && value > 0)
          return amounts.length
        })())`),
        expect.atLeast(1))

      check('보유 종목 카드 존재',
        evalJson(`JSON.stringify(Array.from(document.querySelectorAll('button')).filter(b => /삼성전자/u.test(b.textContent)).length)`),
        expect.atLeast(1))

      check('하단 네비게이션 (app-bottom-nav)',
        evalJson(`JSON.stringify(document.querySelectorAll('[aria-label="주요 화면"] a').length)`),
        expect.atLeast(6))

      checkConsoleClean()
      checkNoFailedRequests()
    },
  },

  /**
   * OCR review screen.
   *
   * /ocr redirects to /screenshot when there is no upload session, and both
   * pages share the 340px inline-style shell. Asserting only on a shared
   * selector would pass on the redirect target, so this suite seeds an upload
   * session and pins the pathname before checking OCR-specific markup.
   */
  ocr: {
    description: 'OCR 검수 화면 셸 렌더링',
    async run() {
      seedUploadSession()
      resetNetworkLog()
      open(`${BASE_URL}/ocr`)
      sleep(6_000)

      check('/ocr 경로 유지 (리다이렉트 아님)',
        evalJson(`JSON.stringify(window.location.pathname)`),
        expect.equals('/ocr'))

      check('OCR 전용 셸 마운트 (.jaroo-ocr-page)',
        evalJson(`JSON.stringify(!!document.querySelector('.jaroo-ocr-page'))`),
        expect.equals(true))

      check('OCR 프레임 렌더링',
        evalJson(`JSON.stringify(!!document.querySelector('.jaroo-ocr-frame'))`),
        expect.equals(true))

      // Replaces a bare `body.textContent.length >= 50` check, which an
      // infinite loading spinner also satisfied.
      //
      // `.jaroo-ocr-body` sits *inside* the `requestState === 'loading'` gate,
      // so it only mounts once the OCR request resolves. A single-shot check
      // was flaky; poll instead. Both the success and the `hasOcrError`
      // branches render this shell, so reaching it proves the flow settled
      // rather than hanging on the spinner forever.
      check('OCR 본문 셸 렌더링 (로딩 게이트 통과)',
        waitFor(
          `JSON.stringify(!!document.querySelector('.jaroo-ocr-body'))`,
          (value) => value === true,
          { timeoutMs: 45_000, intervalMs: 2_000 },
        ),
        expect.equals(true))

      check('포트폴리오 적용 버튼 존재',
        evalJson(`JSON.stringify(!!document.querySelector('.jaroo-ocr-apply-btn'))`),
        expect.equals(true))

      checkConsoleClean()
      checkNoFailedRequests()
    },
  },

  /**
   * /ocr guard: without an upload session the page must bounce to /screenshot.
   * Pairs with the `ocr` suite so a broken redirect cannot hide behind the
   * shared shell markup.
   */
  'ocr-redirect': {
    description: 'OCR 세션 없을 때 /screenshot 리다이렉트 가드',
    async run() {
      resetNetworkLog()
      open(`${BASE_URL}/home`)
      sleep(1_500)
      ab(['eval', `sessionStorage.removeItem('jaroo:screenshot-ocr-upload'); JSON.stringify('cleared')`])

      resetNetworkLog()
      open(`${BASE_URL}/ocr`)
      const pathname = waitFor(
        `JSON.stringify(window.location.pathname)`,
        (value) => value === '/screenshot',
        { timeoutMs: 15_000, intervalMs: 1_000 },
      )

      check('세션 없음 → /screenshot 리다이렉트', pathname, expect.equals('/screenshot'))

      checkConsoleClean()
      checkNoFailedRequests()
    },
  },

  /** Screenshot upload entry point. */
  screenshot: {
    description: '스크린샷 업로드 화면 렌더링',
    async run() {
      resetNetworkLog()
      open(`${BASE_URL}/screenshot`)
      sleep(4_000)

      check('/screenshot 경로 유지', evalJson(`JSON.stringify(location.pathname)`), expect.equals('/screenshot'))

      // A page-specific shell class. `body.textContent.length` alone used to
      // satisfy this suite, which meant the whole upload UI could be deleted
      // without turning the run red.
      check('업로드 화면 셸 마운트',
        evalJson(`JSON.stringify(!!document.querySelector('.jaroo-upload-frame'))`),
        expect.equals(true))

      // The one interaction this screen exists for.
      check('업로드 존 버튼 존재',
        evalJson(`JSON.stringify(!!document.querySelector('button.jaroo-upload-upzone'))`),
        expect.equals(true))

      // Camera / file / photo pickers must all be wired up.
      check('파일 선택 input 3종',
        evalJson(`JSON.stringify(document.querySelectorAll('input.jaroo-upload-file-input[type="file"]').length)`),
        expect.equals(3))

      check('업로드 예시 안내 렌더링',
        evalJson(`JSON.stringify(/이렇게 보이는 화면/u.test(document.body.textContent))`),
        expect.equals(true))

      checkConsoleClean()
      checkNoFailedRequests()
    },
  },
}

/* ------------------------------------------------------------------ *
 * Preflight
 * ------------------------------------------------------------------ */

/**
 * Probe a health endpoint.
 *
 * Uses Node's global fetch (available on the project's Node 20.9+ baseline)
 * rather than shelling out to curl, so a missing/failing binary can never be
 * misreported as an HTTP problem. Failures return a diagnostic string such as
 * `error:ECONNREFUSED` so preflight can name the real cause.
 */
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
    console.error(`  ✗ web ${BASE_URL} not healthy (status ${web}). Run: npm run dev`)
    process.exit(2)
  }
  console.log(`  ✓ web ${BASE_URL} healthy`)

  const crawler = await httpStatus(`${CRAWLER_URL}/api/source/system/health`)
  if (crawler !== '200') {
    console.warn(`  ! crawler ${CRAWLER_URL} not healthy (status ${crawler}). DeepScan data may degrade.`)
  } else {
    console.log(`  ✓ crawler ${CRAWLER_URL} healthy`)
  }

  if (!AGENT_BROWSER) {
    if (AGENT_BROWSER_CANDIDATES.length === 0) {
      console.error('  ✗ agent-browser not found on PATH. Install it, then run `agent-browser install`.')
    } else {
      console.error(`  ✗ no agent-browser build on PATH supports ${REQUIRED_FLAG}:`)
      for (const candidate of AGENT_BROWSER_CANDIDATES) {
        console.error(`      ${candidate.path} (${candidate.version})`)
      }
      console.error('    Pin a compatible build with AGENT_BROWSER_BIN=/path/to/agent-browser')
    }
    process.exit(2)
  }

  const version = spawnSync(AGENT_BROWSER, ['--version'], { encoding: 'utf8', timeout: 15_000 })
  if (version.error) {
    console.error(`  ✗ agent-browser unavailable (${version.error.code ?? version.error.message}).`)
    process.exit(2)
  }
  if (version.status !== 0) {
    console.error(`  ✗ agent-browser exited ${version.status}: ${(version.stderr || '').trim()}`)
    process.exit(2)
  }
  console.log(`  ✓ agent-browser ${(version.stdout || '').trim()} (${AGENT_BROWSER})`)
  console.log('')
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  if (LIST_ONLY) {
    console.log('Available suites:')
    for (const [name, suite] of Object.entries(suites)) {
      console.log(`  ${name.padEnd(12)} ${suite.description}`)
    }
    return
  }

  await preflight()

  const selected = requestedSuites.length > 0 ? requestedSuites : Object.keys(suites)
  const unknown = selected.filter((name) => !suites[name])
  if (unknown.length > 0) {
    console.error(`Unknown suite(s): ${unknown.join(', ')}`)
    console.error(`Available: ${Object.keys(suites).join(', ')}`)
    process.exit(2)
  }

  const startedAt = Date.now()

  for (const name of selected) {
    const suite = suites[name]
    console.log(`Suite: ${name} — ${suite.description}`)
    try {
      await suite.run()
    } catch (error) {
      failures.push(`${name} suite threw — ${error.message}`)
      console.log(`    ✗ suite threw: ${error.message}`)
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
