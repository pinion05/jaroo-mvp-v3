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

function ab(args, { timeoutMs = 90_000, allowFailure = false } = {}) {
  const result = spawnSync('agent-browser', ['--session-name', SESSION, ...args], {
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
 */
const IGNORED_CONSOLE_PATTERNS = [
  /react-devtools|Download the React DevTools/iu,
  /scroll-behavior: smooth/iu,           // Next.js dev hint, not an app fault
  /missing-data-scroll-behavior/iu,
  /\[Fast Refresh\]|\[HMR\]/iu,
]

function consoleErrorCount() {
  const { stdout } = ab(['console'], { allowFailure: true })
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

      check('금융 색상 토큰 적용 (financialToneClass)',
        evalJson(`JSON.stringify(document.querySelectorAll('[class*="gain"],[class*="loss"],[class*="financialNeutral"],[class*="todayUp"],[class*="todayDown"]').length)`),
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

      check('콘솔 에러 없음', consoleErrorCount(), expect.equals(0))
    },
  },

  /** Home screen — portfolio donut, holdings list, market score. */
  home: {
    description: '홈 화면 도넛 차트 + 종목 리스트 + 요약',
    async run() {
      seedPortfolio()
      open(`${BASE_URL}/home`)
      sleep(7_000)

      check('포트폴리오 요약 영역',
        evalJson(`JSON.stringify(!!document.querySelector('[aria-label="홈 포트폴리오 요약"]'))`),
        expect.equals(true))

      check('도넛 차트 렌더링',
        evalJson(`JSON.stringify(!!document.querySelector('[aria-label="보유 종목 비중 원차트"]'))`),
        expect.equals(true))

      check('총 평가액 표시',
        evalJson(`JSON.stringify(/[0-9,]+원/u.test(document.body.textContent))`),
        expect.equals(true))

      check('보유 종목 카드 존재',
        evalJson(`JSON.stringify(Array.from(document.querySelectorAll('button')).filter(b => /삼성전자/u.test(b.textContent)).length)`),
        expect.atLeast(1))

      check('하단 네비게이션 (app-bottom-nav)',
        evalJson(`JSON.stringify(document.querySelectorAll('[aria-label="주요 화면"] a').length)`),
        expect.atLeast(6))

      check('콘솔 에러 없음', consoleErrorCount(), expect.equals(0))
    },
  },

  /**
   * OCR review screen. This page ships its own 340px shell with inline styles
   * instead of JarooShell, so there is deliberately no shared bottom nav.
   */
  ocr: {
    description: 'OCR 검수 화면 셸 렌더링',
    async run() {
      open(`${BASE_URL}/ocr`)
      sleep(5_000)

      check('페이지 본문 렌더링',
        evalJson(`JSON.stringify(document.body.textContent.trim().length)`),
        expect.atLeast(50))

      check('자체 업로드 셸 마운트',
        evalJson(`JSON.stringify(!!document.querySelector('.jaroo-upload-page, [class*="uploadPage"]'))`),
        expect.equals(true))

      check('콘솔 에러 없음', consoleErrorCount(), expect.equals(0))
    },
  },

  /** Screenshot upload entry point. */
  screenshot: {
    description: '스크린샷 업로드 화면 렌더링',
    async run() {
      open(`${BASE_URL}/screenshot`)
      sleep(4_000)

      check('페이지 본문 렌더링',
        evalJson(`JSON.stringify(document.body.textContent.trim().length)`),
        expect.atLeast(50))

      check('콘솔 에러 없음', consoleErrorCount(), expect.equals(0))
    },
  },
}

/* ------------------------------------------------------------------ *
 * Preflight
 * ------------------------------------------------------------------ */

function httpStatus(url) {
  const result = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', url], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  return (result.stdout || '').trim()
}

function preflight() {
  console.log('Preflight')

  const web = httpStatus(`${BASE_URL}/api/health`)
  if (web !== '200') {
    console.error(`  ✗ web ${BASE_URL} not healthy (status ${web}). Run: npm run dev`)
    process.exit(2)
  }
  console.log(`  ✓ web ${BASE_URL} healthy`)

  const crawler = httpStatus(`${CRAWLER_URL}/api/source/system/health`)
  if (crawler !== '200') {
    console.warn(`  ! crawler ${CRAWLER_URL} not healthy (status ${crawler}). DeepScan data may degrade.`)
  } else {
    console.log(`  ✓ crawler ${CRAWLER_URL} healthy`)
  }

  const version = spawnSync('agent-browser', ['--version'], { encoding: 'utf8', timeout: 15_000 })
  if (version.status !== 0) {
    console.error('  ✗ agent-browser unavailable. Install it and run `agent-browser install`.')
    process.exit(2)
  }
  console.log(`  ✓ agent-browser ${(version.stdout || '').trim()}`)
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

  preflight()

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
