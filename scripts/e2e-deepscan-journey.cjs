#!/usr/bin/env node
/**
 * jaroo-mvp-v3 딥스캔 여정 E2E TC 러너 (TC-E2ED-001 / TC-E2ED-002)
 *
 * 두 개의 여정을 검증한다.
 *
 *   TC-E2ED-001  시딩 기반 딥스캔 사용자 여정
 *     - sessionStorage 시딩(applied-home-portfolio) 후 /deepscan 진입
 *     - [현재 dev 환경에서 검증 가능한 구간] 게스트 /deepscan 진입 → 미들웨어 Supabase
 *       인증 게이트(src/lib/supabase/proxy.ts의 PROTECTED_APP_PATHS)에 의한
 *       307 → /login?next=/deepscan 유도 여정 검증
 *     - [인증 세션이 있는 환경에서 실행되는 구간] 로딩 화면 → 브리핑 카드 → 위원 그리드 →
 *       브리핑 순차 노출 → 내러티브 → 결과 전환 (E2E_FORCE_UI_JOURNEY=1 또는 세션 쿠키 존재 시)
 *     - verify-screens-browser.cjs deepscan 스위트가 각 화면의 DOM 계약을 이미 검증하므로
 *       이 여정은 "단계 진행(arrival 순서·소요시간)" 중심으로 검증한다.
 *
 *   TC-E2ED-002  실호출 풀 여정 (실행 결과 매트릭스)
 *     - UI 경로(/deepscan)는 미들웨어 Supabase 인증 게이트로 막혀 있으므로(시딩으로는 우회 불가),
 *       지시서의 대체 시나리오대로 크롤러 API(/api/source/.../deepscan/canonical)를 직접 호출하는
 *       통합 E2E로 실제 데이터 파이프라인(WiseReport/FnGuide/KRX 수집 → LLM 위원회 → 페이로드 빌드)
 *       완주를 검증하고 종목 × 회차별 결과/소요시간/실패 시그니처를 기록한다.
 *     - 참고: 웹 라우트 GET /api/deepscan은 인증 게이트 밖이며 dev(TOSS_SECRET_KEY 미설정)에서
 *       무과금 직행이다 — 다만 브라우저 여정이 막혀 있어 본 러너는 크롤러 직접 호출을 쓴다.
 *     - R1~R4: KR 대형주 4종목(섹터 다양화), R5: 실패 시 동일 조건 1회 재실행(총 5회 한도)으로
 *       재현성(일시적 vs 상시)을 판정한다.
 *
 * 계측 채널:
 *   - 크롤러 콘솔 로그(/tmp/jaroo-dev-stack.log, 읽기 전용)의 "[deepscan-kr] stage sources/committee elapsed"
 *   - 위원 디버그 아티팩트(.omx/context/committee-debug-logs/): 멤버별 request/failure/success
 *     (errorKind·elapsed_ms·upstream code 포함) + kr-committee-<code>-<ts> 서브디렉터리(requestId)
 *   - GET /api/source/deepscan/kr/committee-status?requestId=... (실행 후 최종 상태)
 *
 * Usage:
 *   node scripts/e2e-deepscan-journey.cjs            # 전체: 시딩 여정 + 실호출 매트릭스
 *   node scripts/e2e-deepscan-journey.cjs seeded     # TC-E2ED-001 만 (페이지 자체 실호출 1회 소비)
 *   node scripts/e2e-deepscan-journey.cjs live       # TC-E2ED-002 만 (실호출 최대 5회 소비)
 *   node scripts/e2e-deepscan-journey.cjs --list     # 여정 목록만 출력
 *
 * Environment:
 *   JAROO_BASE_URL           웹 베이스 URL (기본 http://127.0.0.1:3002)
 *   JAROO_CRAWLER_URL        크롤러 베이스 URL (기본 http://127.0.0.1:3040)
 *   E2E_DEEPSCAN_SESSION     agent-browser 세션 이름 (기본 jaroo-e2e-deepscan)
 *   AGENT_BROWSER_BIN        agent-browser 절대 경로 오버라이드
 *   E2E_CRAWLER_LOG          크롤러 콘솔 로그 파일 (기본 /tmp/jaroo-dev-stack.log, 읽기 전용)
 *   E2E_COMMITTEE_DEBUG_ROOT 위원 디버그 아티팩트 루트 (기본 <cwd>/.omx/context/committee-debug-logs)
 *   E2E_LIVE_TARGETS         실호출 대상 CSV 오버라이드 ("name:code:market:sector,...")
 *   E2E_LIVE_TIMEOUT_MS      실호출 1회 클라이언트 타임아웃 (기본 320000 = admission 와치독 300s + 여유)
 *
 * 요구 사항: jaroo dev 스택 기동 중(웹 3002 + 크롤러 3040), agent-browser 설치.
 * 비용 규칙: 스크립트 1회 실행당 실제 딥스캔 파이프라인(LLM 포함) 실행은 최대 5회(매트릭스 한도)다.
 */

'use strict'

const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

/* ------------------------------------------------------------------ *
 * 설정
 * ------------------------------------------------------------------ */

const BASE_URL = (process.env.JAROO_BASE_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '')
const CRAWLER_URL = (process.env.JAROO_CRAWLER_URL || 'http://127.0.0.1:3040').replace(/\/+$/, '')
const SESSION = process.env.E2E_DEEPSCAN_SESSION || 'jaroo-e2e-deepscan'
const AGENT_BROWSER = process.env.AGENT_BROWSER_BIN || '/home/pinion/.npm-global/bin/agent-browser'
const CRAWLER_LOG_PATH = process.env.E2E_CRAWLER_LOG || '/tmp/jaroo-dev-stack.log'
/**
 * 위원 디버그 아티팩트 루트 후보 — 크롤러 프로세스 cwd에 따라 달라진다.
 *  - repo 루트 cwd로 뜬 프로세스: <repo>/.omx/context/committee-debug-logs (flat 파일)
 *  - `npm --prefix packages/crawler run dev` cwd: packages/crawler/.omx/context/committee-debug-logs
 *    (실제 파이프라인은 logDir=kr-committee-<code>-<ts> 서브디렉터리에 멤버별 아티팩트를 남긴다)
 */
const COMMITTEE_DEBUG_ROOTS = (process.env.E2E_COMMITTEE_DEBUG_ROOT
  ? [process.env.E2E_COMMITTEE_DEBUG_ROOT]
  : [
      path.join(process.cwd(), '.omx', 'context', 'committee-debug-logs'),
      path.join(process.cwd(), 'packages', 'crawler', '.omx', 'context', 'committee-debug-logs'),
    ]).map((root) => ({ root, channel: root.includes('packages') ? 'crawler-cwd' : 'repo-root' }))
const RUN_RECORDS_PATH = process.env.E2E_RUN_RECORDS_PATH || '/tmp/e2e-deepscan-run-records.json'
const LIVE_TIMEOUT_MS = Number(process.env.E2E_LIVE_TIMEOUT_MS || 320_000)
const CANONICAL_CRAWLER_PATH = '/api/source/wisereport-fnguide-krx-polygon-fmp-deepscan-package/deepscan/canonical'
const WEB_DEEPSCAN_PATH = '/api/deepscan'
const LIVE_RUN_BUDGET = 5

/** 실호출 매트릭스 대상 — KR 대형주, 섹터 다양화. R1은 시딩 여정과 실행을 공유한다. */
const DEFAULT_TARGETS = [
  { name: '삼성전자', code: '005930', market: 'KOSPI', sector: 'IT/반도체' },
  { name: 'KB금융', code: '105560', market: 'KOSPI', sector: '금융' },
  { name: '셀트리온', code: '068270', market: 'KOSPI', sector: '바이오' },
  { name: 'LG화학', code: '051910', market: 'KOSPI', sector: '화학' },
]

function resolveTargets() {
  const csv = process.env.E2E_LIVE_TARGETS
  if (!csv) return [...DEFAULT_TARGETS]
  return csv.split(',').map((chunk) => {
    const [name, code, market = 'KOSPI', sector = '지정 안 함'] = chunk.trim().split(':')
    return { name, code, market, sector }
  }).filter((target) => target.code)
}

const argv = process.argv.slice(2)
const LIST_ONLY = argv.includes('--list')
const requestedModes = argv.filter((arg) => !arg.startsWith('--'))
const MODE = requestedModes.includes('seeded') ? 'seeded'
  : requestedModes.includes('live') ? 'live'
    : 'all'

/* ------------------------------------------------------------------ *
 * 공용 유틸
 * ------------------------------------------------------------------ */

function stamp() {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function log(message) {
  console.log(`[${stamp()}] ${message}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ab(args, { timeoutMs = 90_000, allowFailure = false } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      AGENT_BROWSER,
      ['--session-name', SESSION, ...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
    )
    const out = (stdout || '').trim()
    const err = (stderr || '').trim()
    const ok = !out.startsWith('✗')
    if (!ok && !allowFailure) {
      throw new Error(`agent-browser ${args.join(' ')} 실패:\n${out || err}`)
    }
    return { ok, stdout: out, stderr: err }
  } catch (error) {
    if (allowFailure) return { ok: false, stdout: '', stderr: String(error.message || error) }
    throw error
  }
}

/**
 * 페이지에서 JS를 실행하고 결과를 decode한다.
 * agent-browser는 eval 값을 JSON 문자열로 출력하므로 최대 3겹까지 decode한다.
 */
async function evalJson(expression, { allowFailure = false } = {}) {
  const { ok, stdout } = await ab(['eval', expression], { allowFailure })
  if (!ok) return null
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

async function open(url) {
  await ab(['open', url])
}

/** 페이지 표현식이 predicate를 만족할 때까지 폴링한다. 마지막 관측값을 반환한다. */
async function waitFor(expression, predicate, { timeoutMs = 60_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = await evalJson(expression)
  while (!predicate(last) && Date.now() < deadline) {
    await sleep(intervalMs)
    last = await evalJson(expression)
  }
  return last
}

/* ------------------------------------------------------------------ *
 * 네트워크/콘솔 위생 (verify-screens-browser.cjs 패턴 재사용)
 * ------------------------------------------------------------------ */

const IGNORED_CONSOLE_PATTERNS = [
  /react-devtools|Download the React DevTools/iu,
  /scroll-behavior: smooth/iu,
  /missing-data-scroll-behavior/iu,
  /\[Fast Refresh\]|\[HMR\]/iu,
]

/** 시딩 기반 비인증 브라우저에서 설계상 허용되는 인증 게이트 4xx */
const EXPECTED_HTTP_FAILURES = [
  { status: 401, pattern: /\/api\/portfolio\b/u },
  { status: 403, pattern: /\/api\/portfolio\b/u },
  { status: 401, pattern: /\/api\/auth\//u },
  { status: 403, pattern: /\/api\/auth\//u },
]

async function resetNetworkLog() {
  await ab(['network', 'requests', '--clear'], { allowFailure: true })
}

/** 네트워크 로그 파싱. in-flight(상태 없음) 항목도 url을 잡는다. */
async function networkEntries() {
  const { ok, stdout } = await ab(['network', 'requests'], { allowFailure: true })
  if (!ok) return []
  return stdout.split('\n').map((line) => {
    const match = /^\[([^\]]+)\]\s+(\S+)\s+(\S+)\s+\(([^)]*)\)\s*(\d{3})?\s*$/u.exec(line.trim())
    if (!match) return null
    return {
      id: match[1],
      method: match[2],
      url: match[3],
      type: match[4],
      status: match[5] ? Number(match[5]) : null,
    }
  }).filter(Boolean)
}

/** 페이지가 발사한 GET /api/deepscan?... 요청 URL을 찾는다 (R1 실행 공유의 핵심). */
async function captureDeepscanFireUrl({ timeoutMs = 45_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const entries = await networkEntries()
    const fired = entries.find((entry) => entry.method === 'GET' && entry.url.includes(`${WEB_DEEPSCAN_PATH}?`))
    if (fired) return fired.url
    await sleep(intervalMs)
  }
  return null
}

async function collectHygiene() {
  const consoleIssues = []
  const { ok: consoleOk, stdout: consoleOut } = await ab(['console'], { allowFailure: true })
  if (consoleOk) {
    for (const line of consoleOut.split('\n')) {
      if (!/^\[(error|warning)\]/iu.test(line.trim())) continue
      if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(line))) continue
      consoleIssues.push(line.trim().slice(0, 300))
    }
  }

  const httpIssues = []
  const entries = await networkEntries()
  for (const entry of entries) {
    if (entry.status === null || entry.status < 400) continue
    if (EXPECTED_HTTP_FAILURES.some((allowed) => allowed.status === entry.status && allowed.pattern.test(entry.url))) continue
    httpIssues.push(`${entry.status} ${entry.method} ${entry.url}`.slice(0, 300))
  }

  return { consoleIssues, httpIssues }
}

/* ------------------------------------------------------------------ *
 * 세션 시딩 (verify-screens-browser.cjs fixture 패턴과 동일 스키마)
 * ------------------------------------------------------------------ */

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

async function seedPortfolio() {
  // sessionStorage는 origin 스코프 — 먼저 origin에 진입한다.
  await open(`${BASE_URL}/home`)
  await sleep(2_500)
  await ab(['eval', SEED_PORTFOLIO])
  const seeded = await evalJson(`JSON.stringify((sessionStorage.getItem('jaroo:applied-home-portfolio') ?? '').includes('005930'))`)
  return seeded === 'true' || seeded === true
}

/* ------------------------------------------------------------------ *
 * 실호출 계측 — 크롤러 콘솔 로그 + 위원 디버그 아티팩트 감시
 * ------------------------------------------------------------------ */

function createRunRecorder(id, target, requestUrl, transport) {
  return {
    id,
    target,
    transport,
    requestUrl,
    startedAt: new Date().toISOString(),
    t0: Date.now(),
    durationMs: null,
    httpStatus: null,
    requestId: null,
    stage: { sourcesElapsedMs: null, committeeElapsedMs: null, committeeStatus: null, committeeCompleted: null },
    memberEvents: [],
    crawlerLines: [],
    committeeStatusPoll: null,
    payloadSummary: null,
    validationChecks: null,
    verdict: null,
    errorSignature: null,
    errorBodyExcerpt: null,
    dedupeShared: null,
    reproOf: null,
    reproducible: null,
    seenArtifacts: new Set(),
    logOffset: null,
    watchersRunning: true,
  }
}

const RESERVED_ARTIFACT_NAMES = new Set([
  'summary.json', 'source-input.json', 'prompt-map.json', 'runtime-shape.json',
])

function classifyArtifactName(filename) {
  let match = /^request-(.+?)-attempt-(\d+)\.json$/u.exec(filename)
  if (match) return { kind: 'request', member: match[1], attempt: Number(match[2]) }
  match = /^(.+?)-attempt-(\d+)-failure\.json$/u.exec(filename)
  if (match) return { kind: 'attempt-failure', member: match[1], attempt: Number(match[2]) }
  match = /^(.+?)-failure\.json$/u.exec(filename)
  if (match) return { kind: 'failure', member: match[1], attempt: null }
  if (RESERVED_ARTIFACT_NAMES.has(filename)) return null
  if (/^[A-Za-z][A-Za-z0-9]*\.json$/u.test(filename)) return { kind: 'member-result', member: filename.replace(/\.json$/u, ''), attempt: null }
  return null
}

/** 위원 디버그 아티팩트 감시 — 멤버별 request/failure/result 이벤트 + requestId 발견 */
function startArtifactWatcher(rec) {
  const scan = () => {
    if (!rec.watchersRunning) return

    for (const { root, channel } of COMMITTEE_DEBUG_ROOTS) {
      let rootEntries = []
      try {
        rootEntries = fs.readdirSync(root, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of rootEntries) {
        const full = path.join(root, entry.name)
        let mtimeMs = 0
        try {
          mtimeMs = fs.statSync(full).mtimeMs
        } catch {
          continue
        }
        if (mtimeMs < rec.t0 - 1_500) continue

        if (entry.isDirectory()) {
          // kr-committee-<code>-<ts> 서브디렉터리 — 코드가 일치할 때만 requestId로 채택한다
          // (다른 에이전트의 병행 실행 코드는 무시해 교차 오염을 막는다)
          const match = /^kr-committee-([^-]+)-(\d+)$/u.exec(entry.name)
          if (match && !rec.requestId && match[1] === rec.target?.code) {
            rec.requestId = entry.name
            log(`    ↳ requestId 발견(디버그 dir, ${channel}): ${entry.name}`)
          }
          continue
        }

        if (!entry.name.endsWith('.json')) continue
        const seenKey = `${channel}/${entry.name}`
        if (rec.seenArtifacts.has(seenKey)) continue
        const classified = classifyArtifactName(entry.name)
        let parsed = null
        try {
          parsed = JSON.parse(fs.readFileSync(full, 'utf8'))
        } catch {
          parsed = null
        }
        rec.seenArtifacts.add(seenKey)
        if (!classified) continue
        // flat 루트(channel=repo-root)의 파일은 파일명이 고정 overwrite라 타 실행과 구분이 불가능하다.
        // 본 러너 파이프라인(crawler-cwd 서브디렉터리)과 구분해 기록한다.
        rec.memberEvents.push({
          kind: classified.kind,
          member: parsed?.member ?? classified.member,
          attempt: classified.attempt ?? parsed?.attempt ?? null,
          errorKind: parsed?.errorKind ?? null,
          error: typeof parsed?.error === 'string' ? parsed.error : null,
          upstreamCode: parsed?.upstream_result?.error?.code ?? null,
          elapsedMs: parsed?.elapsed_ms ?? null,
          finalStatus: parsed?.finalStatus ?? null,
          timestamp: parsed?.timestamp ?? null,
          channel,
          attribution: channel === 'crawler-cwd' ? '본 러너 실행' : 'flat 루트 — 동시 실행과 구분 불가(참고용)',
          file: entry.name,
        })
        if (classified.kind === 'failure' || classified.kind === 'attempt-failure') {
          log(`    ↳ 위원 멤버 실패[${channel}]: ${classified.member} attempt=${classified.attempt ?? '?'} errorKind=${parsed?.errorKind ?? '?'} upstream=${parsed?.upstream_result?.error?.code ?? '-'} "${parsed?.error ?? ''}"${channel === 'repo-root' ? ' (주의: flat 루트 — 동시 실행 파일일 수 있음)' : ''}`)
        }
      }
    }
  }

  const timer = setInterval(scan, 2_000)
  scan()
  return () => {
    clearInterval(timer)
    rec.watchersRunning = false
  }
}

/** 크롤러 콘솔 로그 감시(읽기 전용) — [deepscan-kr] stage elapsed + requestId */
function startCrawlerLogWatcher(rec) {
  try {
    rec.logOffset = fs.existsSync(CRAWLER_LOG_PATH) ? fs.statSync(CRAWLER_LOG_PATH).size : 0
  } catch {
    rec.logOffset = 0
  }

  const scan = () => {
    if (!rec.watchersRunning) return
    let text = ''
    try {
      const stat = fs.statSync(CRAWLER_LOG_PATH)
      if (stat.size <= rec.logOffset) return
      const fd = fs.openSync(CRAWLER_LOG_PATH, 'r')
      const buffer = Buffer.alloc(stat.size - rec.logOffset)
      fs.readSync(fd, buffer, 0, buffer.length, rec.logOffset)
      fs.closeSync(fd)
      rec.logOffset = stat.size
      text = buffer.toString('utf8')
    } catch {
      return
    }

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trimEnd()
      if (!line) continue
      const stageMatch = /\[deepscan-kr\] stage (sources|committee) elapsed=(\d+)ms/u.exec(line)
      if (stageMatch) {
        if (stageMatch[1] === 'sources') rec.stage.sourcesElapsedMs = Number(stageMatch[2])
        else rec.stage.committeeElapsedMs = Number(stageMatch[2])
        rec.crawlerLines.push(line.slice(0, 300))
        log(`    ↳ 크롤러 스테이지: ${stageMatch[1]} ${(Number(stageMatch[2]) / 1000).toFixed(1)}s`)
        continue
      }
      const requestIdMatch = /requestId=(kr-committee-[^\s.]+)/u.exec(line)
      if (requestIdMatch && !rec.requestId) {
        rec.requestId = requestIdMatch[1]
        log(`    ↳ requestId 발견(크롤러 로그): ${rec.requestId}`)
      }
      if (/\[deepscan-kr\]/u.test(line) || /KR DeepScan crawler is busy/u.test(line)) {
        rec.crawlerLines.push(line.slice(0, 300))
      }
    }
  }

  const timer = setInterval(scan, 2_000)
  return () => {
    clearInterval(timer)
    rec.watchersRunning = false
  }
}

/** 위원회 진행 상태 폴링(크롤러 레이어 증거). requestId가 있을 때만. */
async function pollCommitteeStatus(requestId) {
  if (!requestId) return null
  try {
    const response = await fetch(`${CRAWLER_URL}/api/source/deepscan/kr/committee-status?requestId=${encodeURIComponent(requestId)}`, {
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.json()
    return {
      httpStatus: response.status,
      status: body?.status ?? null,
      completed: body?.completed ?? null,
      pendingCount: Array.isArray(body?.pending) ? body.pending.length : null,
      errorCount: Array.isArray(body?.errors) ? body.errors.length : null,
      resultMemberCount: body?.results && typeof body.results === 'object' ? Object.keys(body.results).length : null,
    }
  } catch (error) {
    return { pollError: String(error.message || error) }
  }
}

/* ------------------------------------------------------------------ *
 * 페이로드 계약 검증 (TC-E2ED-002)
 * ------------------------------------------------------------------ */

const MAJOR_BLOCK_KEYS = ['hero', 'committee', 'insights', 'strategy', 'sellNow', 'portfolioSimulation']

function validateLivePayload(payload) {
  const checks = []
  const push = (label, pass, detail = '') => checks.push({ label, pass, detail })

  const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : null
  push('metadata 존재', Boolean(metadata), '')
  if (!metadata) return { ok: false, checks, summary: null }

  push('metadata.version', typeof metadata.version === 'string' && metadata.version.length > 0, String(metadata.version))
  push('metadata.generatedAt', typeof metadata.generatedAt === 'string' && !Number.isNaN(Date.parse(metadata.generatedAt)), String(metadata.generatedAt))
  push('metadata.degraded 불린', typeof metadata.degraded === 'boolean', String(metadata.degraded))
  push('metadata.debugId', typeof metadata.debugId === 'string' && metadata.debugId.length > 0, String(metadata.debugId))
  push('metadata.inputValidity', Boolean(metadata.inputValidity && typeof metadata.inputValidity === 'object'), JSON.stringify(metadata.inputValidity ?? null)?.slice(0, 120))
  push('metadata.sourceRefs 배열', Array.isArray(metadata.sourceRefs), `count=${Array.isArray(metadata.sourceRefs) ? metadata.sourceRefs.length : 'NA'}`)

  const blockStatus = metadata.blockStatus && typeof metadata.blockStatus === 'object' ? metadata.blockStatus : null
  push('metadata.blockStatus 6블록', Boolean(blockStatus) && MAJOR_BLOCK_KEYS.every((key) => key in (blockStatus ?? {})),
    blockStatus ? JSON.stringify(blockStatus) : 'missing')

  const blockStates = {}
  const fallbacks = []
  const blockErrors = []
  for (const key of MAJOR_BLOCK_KEYS) {
    const block = payload[key]
    const isObject = block && typeof block === 'object'
    blockStates[key] = isObject ? String(block.blockState ?? blockStatus?.[key] ?? 'NA') : 'missing'
    if (isObject && block.fallback?.used) {
      fallbacks.push(`${key}: ${block.fallback.reason ?? block.fallback.label ?? 'fallback'}`)
    }
    if (isObject && block.error) {
      blockErrors.push(`${key}: ${block.error.code ?? 'error'} ${block.error.message ?? ''}`.trim())
    }
  }
  push('6개 메이저 블록 객체 존재', MAJOR_BLOCK_KEYS.every((key) => payload[key] && typeof payload[key] === 'object'),
    JSON.stringify(blockStates))

  push('hero.score 숫자', typeof payload.hero?.score === 'number', String(payload.hero?.score))
  push('hero.headline 본문', typeof payload.hero?.headline === 'string' && payload.hero.headline.length > 0, String(payload.hero?.headline ?? '').slice(0, 80))

  const axes = Array.isArray(payload.committee?.axes) ? payload.committee.axes : []
  const memberTallies = { total: 0, success: 0, error: 0, pending: 0 }
  const axisLabels = []
  for (const axis of axes) {
    axisLabels.push(axis?.label ?? '?')
    for (const member of Array.isArray(axis?.members) ? axis.members : []) {
      memberTallies.total += 1
      const status = String(member?.status ?? '?')
      if (status === 'success') memberTallies.success += 1
      else if (status === 'error') memberTallies.error += 1
      else if (status === 'pending') memberTallies.pending += 1
    }
  }
  push('위원회 axes 존재', axes.length >= 1, `axes=${axes.length} [${axisLabels.join(',')}]`)
  push('위원 9명 그리드', memberTallies.total >= 9, JSON.stringify(memberTallies))
  push('위원 성공 ≥1', memberTallies.success >= 1, JSON.stringify(memberTallies))

  push('인사이트 아이템 ≥1', Array.isArray(payload.insights?.items) && payload.insights.items.length >= 1,
    `items=${Array.isArray(payload.insights?.items) ? payload.insights.items.length : 'NA'}`)
  push('전략 weekSignal', typeof payload.strategy?.weekSignal === 'string', String(payload.strategy?.weekSignal ?? '').slice(0, 60))
  push('전략 목표가 텍스트', typeof payload.strategy?.targetPriceText === 'string', String(payload.strategy?.targetPriceText ?? '').slice(0, 60))
  push('매도/포트폴리오 시뮬레이션 블록',
    Boolean(payload.sellNow && typeof payload.sellNow === 'object') && Boolean(payload.portfolioSimulation && typeof payload.portfolioSimulation === 'object'), '')

  const llm = metadata.llmCommittee && typeof metadata.llmCommittee === 'object' ? metadata.llmCommittee : null
  push('llmCommittee.requestId', Boolean(llm?.requestId), String(llm?.requestId ?? 'NA'))
  push('llmCommittee 상태 기록', Boolean(llm?.status), JSON.stringify(llm ?? null)?.slice(0, 160))

  const sourceTypeCounts = {}
  for (const ref of Array.isArray(metadata.sourceRefs) ? metadata.sourceRefs : []) {
    const type = String(ref?.type ?? '?')
    sourceTypeCounts[type] = (sourceTypeCounts[type] ?? 0) + 1
  }

  const summary = {
    instrument: payload.input?.instrument ?? null,
    degraded: metadata.degraded,
    blockStates,
    fallbacks,
    blockErrors,
    memberTallies,
    llmCommittee: llm ?? null,
    sourceTypeCounts,
    sourceRefCount: Array.isArray(metadata.sourceRefs) ? metadata.sourceRefs.length : 0,
    heroScore: payload.hero?.score ?? null,
    strategyTargetPriceText: payload.strategy?.targetPriceText ?? null,
    insightsItemCount: Array.isArray(payload.insights?.items) ? payload.insights.items.length : 0,
  }

  const ok = checks.every((check) => check.pass)
  return { ok, checks, summary }
}

/* ------------------------------------------------------------------ *
 * 실호출 1회 실행 (매트릭스 레코드)
 * ------------------------------------------------------------------ */

async function fetchWithBusyRetry(url, { maxWaitMs = LIVE_TIMEOUT_MS } = {}) {
  const startedAt = Date.now()
  let attempt = 0
  while (Date.now() - startedAt < maxWaitMs) {
    attempt += 1
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(Math.max(5_000, maxWaitMs - (Date.now() - startedAt))),
      })
      if (response.status === 429 && attempt <= 40) {
        const bodyText = await response.text()
        let retryAfterMs = 3_000
        try {
          const body = JSON.parse(bodyText)
          retryAfterMs = Math.min(Number(body?.error?.details?.retryAfterMs) || 3_000, 8_000)
        } catch { /* 기본값 유지 */ }
        log(`    ↳ 429 busy — ${retryAfterMs}ms 후 재시도 (attempt ${attempt})`)
        await sleep(retryAfterMs)
        continue
      }
      const text = await response.text()
      return { status: response.status, text }
    } catch (error) {
      return { networkError: error }
    }
  }
  return { networkError: new Error(`busy-retry wait exceeded ${maxWaitMs}ms`) }
}

function buildCrawlerCanonicalUrl(target) {
  const searchParams = new URLSearchParams()
  searchParams.set('market', target.market)
  searchParams.set('code', target.code)
  searchParams.set('name', target.name)
  searchParams.set('from', 'e2e-live-matrix')
  searchParams.set('selectedAt', new Date().toISOString())
  return `${CRAWLER_URL}${CANONICAL_CRAWLER_PATH}?${searchParams.toString()}`
}

/** HTTP 응답({status,text} 또는 {networkError})을 런 레코드로 분류한다. */
function classifyRunResponse(rec, result) {
  if (!result) return rec

  if (result.networkError) {
    const message = String(result.networkError.message || result.networkError)
    const isTimeout = result.networkError.name === 'TimeoutError' || /timed out|abort/iu.test(message)
    rec.verdict = 'FAIL'
    rec.errorSignature = isTimeout ? 'client-timeout' : 'network-error'
    rec.errorBodyExcerpt = message.slice(0, 500)
    return rec
  }

  rec.httpStatus = result.status

  if (result.status !== 200) {
    rec.verdict = 'FAIL'
    rec.errorSignature = `http-${result.status}`
    rec.errorBodyExcerpt = (result.text || '').slice(0, 4_000)
    return rec
  }

  let payload = null
  try {
    payload = JSON.parse(result.text)
  } catch {
    rec.verdict = 'FAIL'
    rec.errorSignature = 'non-json-body'
    rec.errorBodyExcerpt = (result.text || '').slice(0, 2_000)
    return rec
  }

  const errorCode = payload?.metadata?.errorCode
  if (errorCode) {
    rec.verdict = 'FAIL'
    rec.errorSignature = `payload-error:${errorCode}`
    rec.errorBodyExcerpt = (result.text || '').slice(0, 4_000)
    rec.stage.committeeStatus = payload?.metadata?.llmCommittee?.status ?? null
    return rec
  }

  const validation = validateLivePayload(payload)
  rec.validationChecks = validation.checks
  rec.payloadSummary = validation.summary
  rec.requestId = rec.requestId ?? payload?.metadata?.llmCommittee?.requestId ?? null
  rec.stage.committeeStatus = payload?.metadata?.llmCommittee?.status ?? null
  rec.stage.committeeCompleted = payload?.metadata?.llmCommittee?.completed ?? null
  rec.verdict = validation.ok ? 'PASS' : 'FAIL'
  if (!validation.ok) {
    const failed = validation.checks.filter((check) => !check.pass)
    rec.errorSignature = `payload-contract:${failed.map((check) => check.label).join(',')}`.slice(0, 300)
    rec.errorBodyExcerpt = failed.map((check) => `${check.label}: ${check.detail}`).join(' | ').slice(0, 2_000)
  }
  return rec
}

async function runLiveOnce({ id, target, requestUrl, transport }) {
  const rec = createRunRecorder(id, target, requestUrl, transport)
  log(`  ▶ ${id} 시작 — ${target.name}(${target.code}) transport=${transport}`)
  log(`    요청: ${decodeURIComponent(requestUrl).slice(0, 180)}`)

  const stopArtifact = startArtifactWatcher(rec)
  const stopLog = startCrawlerLogWatcher(rec)

  const startedAt = Date.now()
  const result = await fetchWithBusyRetry(requestUrl)
  rec.durationMs = Date.now() - startedAt
  await sleep(2_500) // 마지막 아티팩트 플러시 대기
  stopArtifact()
  stopLog()
  rec.watchersRunning = false

  classifyRunResponse(rec, result)

  if (rec.verdict === 'PASS') {
    rec.committeeStatusPoll = await pollCommitteeStatus(rec.requestId)
    const summary = rec.payloadSummary
    log(`  ✓ ${id} PASS — ${(rec.durationMs / 1000).toFixed(1)}s, hero.score=${summary?.heroScore}, 위원 ${JSON.stringify(summary?.memberTallies)}, degraded=${summary?.degraded}, 목표가=${summary?.strategyTargetPriceText ?? '-'}`)
  } else {
    log(`  ✗ ${id} FAIL — ${rec.errorSignature} (${(rec.durationMs / 1000).toFixed(1)}s 경과)`)
  }
  return rec
}

function summarizeRun(rec) {
  const memberFailures = rec.memberEvents.filter((event) => event.kind === 'failure' || event.kind === 'attempt-failure')
  return [
    `run=${rec.id}`,
    `종목=${rec.target?.name}(${rec.target?.code}/${rec.target?.sector})`,
    `transport=${rec.transport}`,
    `시작=${rec.startedAt}`,
    `소요=${rec.durationMs === null ? 'NA' : `${(rec.durationMs / 1000).toFixed(1)}s`}`,
    `HTTP=${rec.httpStatus ?? 'NA'}`,
    `결과=${rec.verdict ?? 'NA'}`,
    `sig=${rec.errorSignature ?? '-'}`,
    `requestId=${rec.requestId ?? '-'}`,
    `stage.sources=${rec.stage.sourcesElapsedMs === null ? 'NA' : `${(rec.stage.sourcesElapsedMs / 1000).toFixed(1)}s`}`,
    `stage.committee=${rec.stage.committeeElapsedMs === null ? 'NA' : `${(rec.stage.committeeElapsedMs / 1000).toFixed(1)}s`}`,
    `llm=${rec.stage.committeeStatus ?? 'NA'}(${rec.stage.committeeCompleted ?? 'NA'} 완료)`,
    `statusPoll=${rec.committeeStatusPoll ? `${rec.committeeStatusPoll.status ?? rec.committeeStatusPoll.pollError}(${rec.committeeStatusPoll.completed ?? '?'}/9)` : 'NA'}`,
    `sources=${rec.payloadSummary ? Object.entries(rec.payloadSummary.sourceTypeCounts ?? {}).map(([type, count]) => `${type}:${count}`).join(',') || '0건' : 'NA'}`,
    `degraded=${rec.payloadSummary?.degraded ?? 'NA'}`,
    `멤버이벤트=${rec.memberEvents.length}(실패 ${memberFailures.length})`,
    rec.dedupeShared === null ? '' : `실행공유=${rec.dedupeShared}`,
    rec.reproOf ? `reproOf=${rec.reproOf} 재현=${rec.reproducible ? 'YES' : 'NO'}` : '',
  ].filter(Boolean).join(' | ')
}

/* ------------------------------------------------------------------ *
 * TC-E2ED-001 — 시딩 기반 사용자 여정
 * ------------------------------------------------------------------ */

async function runSeededJourney() {
  log('=== TC-E2ED-001 시딩 기반 딥스캔 사용자 여정 ===')
  const steps = []
  let uiJourneyBlocked = false

  const record = (id, title, pass, detail, { blocked = false, elapsedMs } = {}) => {
    steps.push({ id, title, pass, detail, blocked, elapsedMs })
    const mark = pass ? '✓' : blocked ? '⊘ BLOCKED' : '✗'
    log(`  ${mark} [${id}] ${title}${elapsedMs !== undefined ? ` (${(elapsedMs / 1000).toFixed(1)}s)` : ''}${detail ? ` — ${detail}` : ''}`)
    return pass
  }

  // J1 시딩
  const j1Start = Date.now()
  const seeded = await seedPortfolio()
  record('J1', '세션 시딩 (applied-home-portfolio 삼성전자 005930)', seeded, seeded ? '' : '시딩 readback 실패', { elapsedMs: Date.now() - j1Start })
  if (!seeded) {
    return { steps, uiJourneyBlocked }
  }

  // J2 게스트 /deepscan 진입 여정 — 현재 환경에서 검증 가능한 구간.
  // /deepscan은 PROTECTED_APP_PATHS(src/lib/supabase/proxy.ts)라 게스트는 307 → /login?next=/deepscan 유도가 설계 동작이다.
  await resetNetworkLog()
  const j2Start = Date.now()
  await open(`${BASE_URL}/deepscan`)
  await sleep(3_000)
  const gate = await evalJson(`JSON.stringify({ url: location.pathname, next: new URLSearchParams(location.search).get('next'), backLink: !!document.querySelector('a[href="/home"], a[href="/"]'), loginHeading: (document.querySelector('h1,h2')?.textContent ?? '').slice(0, 40) })`)
  const gatePass = gate?.url === '/login' && gate?.next === '/deepscan'
  record('J2', '게스트 /deepscan 진입 → 인증 게이트 유도 (307 → /login?next=/deepscan)', gatePass, JSON.stringify(gate), { elapsedMs: Date.now() - j2Start })

  const uiJourneyForced = process.env.E2E_FORCE_UI_JOURNEY === '1'
  if (!uiJourneyForced) {
    // 로딩 화면 이후 구간은 인증 세션이 필요하다. 세션 시딩으로는 우회할 수 없고,
    // 회원가입/로그인 여정은 금지 규칙이므로 이 환경에서는 BLOCKED(환경 제약)로 기록한다.
    uiJourneyBlocked = true
    record('J3', '딥스캔 화면 여정 (로딩 화면 → 브리핑 카드 → 위원 그리드 → 결과 전환)', false,
      '환경 제약: /deepscan은 미들웨어 Supabase 인증 게이트(PROTECTED_APP_PATHS)로 막혀 있어 세션 시딩만으로 진입 불가. '
      + '인증 세션 확보 환경에서 E2E_FORCE_UI_JOURNEY=1로 재실행 필요. 실호출 파이프라인 검증은 TC-E2ED-002(크롤러 직접 호출 통합 E2E)로 대체.',
      { blocked: true })

    const hygiene = await collectHygiene()
    record('J4', '위생 — 게이트 여정 콘솔 에러·HTTP 실패 없음',
      hygiene.consoleIssues.length === 0 && hygiene.httpIssues.length === 0,
      `console=${hygiene.consoleIssues.length} http=${hygiene.httpIssues.length}${hygiene.consoleIssues.length ? ` :: ${hygiene.consoleIssues[0]}` : ''}${hygiene.httpIssues.length ? ` :: ${hygiene.httpIssues[0]}` : ''}`)

    return { steps, uiJourneyBlocked }
  }

  // ---- 이하: 인증 세션이 있는 환경용 풀 UI 여정 (E2E_FORCE_UI_JOURNEY=1) ----
  const journeyStart = Date.now()

  // J3 로딩 화면 진입 + 기본 DOM 계약
  const j3Start = Date.now()
  const shell = await waitFor(
    `JSON.stringify({ h1: document.querySelector('h1')?.textContent ?? null, intro: !!document.querySelector('[aria-label="딥스캔 안내"]') })`,
    (value) => Boolean(value?.h1) && value.intro === true,
    { timeoutMs: 90_000, intervalMs: 3_000 },
  )
  const j3Pass = Boolean(shell?.h1) && shell.intro === true
  record('J3', '/deepscan 진입 → 로딩 화면 (h1 + 딥스캔 안내)', j3Pass, j3Pass ? `h1="${String(shell.h1).slice(0, 30)}"` : `observed=${JSON.stringify(shell)}`, { elapsedMs: Date.now() - j3Start })

  const backControl = await evalJson(`JSON.stringify(!!document.querySelector('[aria-label="홈으로 가기"],[aria-label="뒤로 가기"]'))`)
  const progressHeader = await evalJson(`JSON.stringify(document.querySelector('[aria-label*="딥스캔"]')?.textContent?.match(/\\d{2}:\\d{2}|완료/u)?.[0] ?? null)`)
  record('J3a', '로딩 화면 DOM 계약 (뒤로가기 + 경과시간 헤더)', backControl === true && typeof progressHeader === 'string', `back=${backControl} header=${JSON.stringify(progressHeader)}`)

  // J4 실호출 요청 캡처 (R1 실행 공유의 핵심 — 인증 세션 경로)
  const j4Start = Date.now()
  const capturedUrl = await captureDeepscanFireUrl({ timeoutMs: 45_000 })
  record('J4', 'GET /api/deepscan 실호출 요청 캡처', Boolean(capturedUrl), capturedUrl ? decodeURIComponent(capturedUrl).slice(0, 200) : 'network 로그에서 발사 기록을 못 찾음', { elapsedMs: Date.now() - j4Start })

  // 리플레이(공유 실행 측정) — 캡처 성공 시에만 발사.
  // 폴백 발사 금지: 캡처 없이 임의 URL을 쏘면 selectedAt 불일치로 jobKey가 달라져 2회 실행된다.
  let replayPromise = null
  if (capturedUrl) {
    log('  ↳ 캡처한 동일 URL 리플레이 — 크롤러 admission dedupe로 동일 실행 공유 (LLM 추가 실행 없음)')
    const replayStartMs = Date.now()
    replayPromise = fetchWithBusyRetry(capturedUrl).then((result) => ({
      result,
      url: capturedUrl,
      replayStartMs,
      replayEndMs: Date.now(),
    }))
  }

  // J5 브리핑 카드
  const j5Start = Date.now()
  const briefing = await waitFor(
    `JSON.stringify({ card: !!document.querySelector('[aria-label="오늘 장 기준 시세 브리핑"]'), chart: !!document.querySelector('svg[aria-label="최근 3개월 일봉 차트"]') })`,
    (value) => value?.card === true,
    { timeoutMs: 60_000, intervalMs: 3_000 },
  )
  const j5Pass = briefing?.card === true
  record('J5', '브리핑 카드 도달 (오늘 장 기준 시세 브리핑 + 일봉 차트)', j5Pass && briefing?.chart === true, JSON.stringify(briefing), { elapsedMs: Date.now() - j5Start })

  // J6 위원 그리드
  const j6Start = Date.now()
  const grid = await waitFor(
    `JSON.stringify({ members: document.querySelectorAll('[aria-label="세 팀 분석 진행 상태"] [class*="member"] [class*="memberName"], [aria-label="세 팀 분석 진행 상태"] > div > div').length, stages: !!document.querySelector('[aria-label="분석 단계"]') })`,
    (value) => typeof value?.members === 'number' && value.members >= 9,
    { timeoutMs: 60_000, intervalMs: 3_000 },
  )
  const j6Pass = typeof grid?.members === 'number' && grid.members >= 9
  record('J6', '위원 9명 그리드 + 분석 단계 섹션', j6Pass && grid?.stages === true, JSON.stringify(grid), { elapsedMs: Date.now() - j6Start })

  // J7 브리핑 순차 노출 진행 (시점 A → +15s 시점 B: 비감소·성장)
  const sampleA = await evalJson(`JSON.stringify(document.querySelectorAll('[data-today-briefing-item="true"]').length)`)
  await sleep(15_000)
  const sampleB = await evalJson(`JSON.stringify(document.querySelectorAll('[data-today-briefing-item="true"]').length)`)
  const a = typeof sampleA === 'number' ? sampleA : 0
  const b = typeof sampleB === 'number' ? sampleB : 0
  record('J7', '브리핑 항목 순차 노출 진행 (15s 간격 비감소·≥4)', b >= Math.max(4, a), `A=${a} → B=${b}`)

  // J8 내러티브 카드
  const j8Start = Date.now()
  const narrativeCount = await waitFor(
    `JSON.stringify(document.querySelectorAll('[aria-label="분석가 진행 메시지"] article').length)`,
    (count) => typeof count === 'number' && count >= 1,
    { timeoutMs: 150_000, intervalMs: 4_000 },
  )
  record('J8', '내러티브 카드(분석가 진행 메시지) 노출', typeof narrativeCount === 'number' && narrativeCount >= 1, `count=${JSON.stringify(narrativeCount)}`, { elapsedMs: Date.now() - j8Start })

  // J9 결과 전환 — 완료 전환 카드 OR 오류 카드 중 먼저 관측되는 쪽
  const j9Start = Date.now()
  const outcome = await waitFor(
    `JSON.stringify({ done: !!document.querySelector('[aria-label="완료 전환 상태"]'), error: (document.body.textContent ?? '').includes('딥스캔에 일시적인 문제가 생겼어요') ? 'error-card' : ((document.body.textContent ?? '').includes('로그인 후 딥스캔') ? 'auth-card' : null) })`,
    (value) => value?.done === true || Boolean(value?.error),
    { timeoutMs: 200_000, intervalMs: 4_000 },
  )
  const transitionElapsedMs = Date.now() - journeyStart
  let j9Pass = outcome?.done === true
  let j9Detail = j9Pass
    ? `여정 시작 후 ${Math.round(transitionElapsedMs / 1000)}s에 결과 전환 도달`
    : `오류 카드 관측: ${JSON.stringify(outcome?.error ?? outcome)}`

  if (j9Pass) {
    const inline = await waitFor(
      `JSON.stringify(/세 팀의 의견|종합 결론/u.test(document.body.textContent))`,
      (value) => value === true,
      { timeoutMs: 20_000, intervalMs: 2_000 },
    )
    j9Pass = inline === true
    j9Detail = `여정 시작 후 ${Math.round(transitionElapsedMs / 1000)}s에 결과 전환, 인라인 결과 텍스트=${inline}`
  }
  record('J9', '결과 전환 (완료 전환 카드 → 인라인 결과)', j9Pass, j9Detail, { elapsedMs: Date.now() - j9Start })

  // J10 위생
  const hygiene = await collectHygiene()
  record('J10', '위생 — 콘솔 에러·HTTP 실패 없음',
    hygiene.consoleIssues.length === 0 && hygiene.httpIssues.length === 0,
    `console=${hygiene.consoleIssues.length} http=${hygiene.httpIssues.length}${hygiene.consoleIssues.length ? ` :: ${hygiene.consoleIssues[0]}` : ''}${hygiene.httpIssues.length ? ` :: ${hygiene.httpIssues[0]}` : ''}`)

  // 리플레이(공유 실행) 수거 — R1 계측에 사용
  let replay = null
  if (replayPromise) {
    const replayMeta = await replayPromise
    replay = {
      url: replayMeta.url,
      status: replayMeta.result.status ?? null,
      networkError: replayMeta.result.networkError ? String(replayMeta.result.networkError.message || replayMeta.result.networkError) : null,
      bodyLength: replayMeta.result.text?.length ?? null,
      body: replayMeta.result.text ?? null,
      durationMs: replayMeta.replayEndMs - replayMeta.replayStartMs,
      replayEndMs: replayMeta.replayEndMs,
      transitionElapsedMs,
    }
    log(`  ↳ 리플레이 응답: HTTP=${replay.status ?? replay.networkError} body=${replay.bodyLength ?? 0}자, 발사→응답 ${(replay.durationMs / 1000).toFixed(1)}s`)
  }

  return { steps, uiJourneyBlocked, replay, capturedUrl }
}

/* ------------------------------------------------------------------ *
 * TC-E2ED-002 — 실호출 풀 여정 (실행 결과 매트릭스)
 * ------------------------------------------------------------------ */

async function runLiveMatrix() {
  log('=== TC-E2ED-002 실호출 풀 여정 (실행 결과 매트릭스, 최대 5회) ===')
  const targets = resolveTargets()
  const runs = []

  // UI 경로(/deepscan)가 인증 게이트로 막혀 있어 브라우저 발사 방식은 사용할 수 없다.
  // 모든 회차를 크롤러 canonical 직접 호출로 계측한다(순차 실행 — admission 글로벌 동시 1건).
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    const id = `R${index + 1}`
    const url = buildCrawlerCanonicalUrl(target)
    const rec = await runLiveOnce({ id, target, requestUrl: url, transport: 'crawler-direct' })
    runs.push(rec)
    if (index < targets.length - 1) await sleep(3_000) // admission 슬롯 해제 여유
  }

  return runs
}

/* ------------------------------------------------------------------ *
 * 재현성 판정 (R5) — 실패한 조합 1회 재실행
 * ------------------------------------------------------------------ */

function isEnvironmentConstraintFailure(rec) {
  // 입력 파라미터 자체가 무효한 경우는 재실행해도 동일 결과가 예상된다(재현 판정 무의미).
  const signature = rec.errorSignature ?? ''
  return /http-4\d\d|payload-error:input-invalid/u.test(signature)
}

async function maybeRunRepro(runs) {
  const failed = runs.filter((rec) => rec.verdict === 'FAIL' && rec.id !== 'R5' && rec.target)
  if (failed.length === 0) return null
  const first = failed[0]
  if (isEnvironmentConstraintFailure(first)) {
    log(`  ↳ ${first.id} 실패(${first.errorSignature})는 입력/환경 제약으로 판정 — 재현성 재실행 생략`)
    return null
  }
  if (runs.length >= LIVE_RUN_BUDGET) {
    log(`  ↳ 실행 한도(${LIVE_RUN_BUDGET}회) 도달 — 재현성 재실행 생략`)
    return null
  }
  log(`  ▶ R5 재현성 재실행 — ${first.id}(${first.errorSignature})와 동일 조건`)
  const rec = await runLiveOnce({
    id: 'R5',
    target: { ...first.target, name: `${first.target.name}(재현재실행)` },
    requestUrl: buildCrawlerCanonicalUrl(first.target),
    transport: 'crawler-direct(repro)',
  })
  rec.reproOf = first.id
  rec.reproducible = rec.verdict === 'FAIL'
  log(`  ↳ 재현성 판정: ${first.id} 오류(${first.errorSignature}) → R5 ${rec.verdict} → ${rec.reproducible ? '상시 재현' : '일시적(재현 안 됨)'}`)
  return rec
}

/* ------------------------------------------------------------------ *
 * 프리플라이트 + 메인
 * ------------------------------------------------------------------ */

async function preflight() {
  log('— 프리플라이트 —')
  try {
    const response = await fetch(`${CRAWLER_URL}/api/source/system/health`, { signal: AbortSignal.timeout(10_000) })
    const body = await response.json()
    log(`  ✓ 크롤러 ${CRAWLER_URL} — status=${body?.data?.status} uptime=${Math.round(body?.data?.uptimeSec ?? 0)}s`)
  } catch (error) {
    throw new Error(`크롤러 헬스체크 실패: ${error.message}`)
  }
  try {
    const response = await fetch(`${BASE_URL}/deepscan`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    log(`  ✓ 웹 ${BASE_URL} — /deepscan HTTP ${response.status}`)
    if (response.status === 307 || response.status === 302) {
      const location = response.headers.get('location') ?? ''
      log(`  ! UI 게이트 감지: /deepscan → ${location} (미들웨어 Supabase 인증 게이트 — 브라우저 여정은 게스트 구간만 검증, 실호출은 크롤러 직접 호출로 대체)`)
    }
  } catch (error) {
    throw new Error(`웹 헬스체크 실패: ${error.message}`)
  }
  const help = await ab(['--help'], { timeoutMs: 20_000, allowFailure: true })
  if (!help.ok || !help.stdout.includes('--session-name')) {
    throw new Error(`agent-browser(${AGENT_BROWSER}) 확인 실패 — --session-name 미지원 또는 실행 불가`)
  }
  log(`  ✓ agent-browser ${AGENT_BROWSER} (세션 ${SESSION})`)
  if (!fs.existsSync(CRAWLER_LOG_PATH)) {
    log(`  ! 크롤러 로그 미발견: ${CRAWLER_LOG_PATH} — 스테이지 계측은 아티팩트·응답으로 대체`)
  } else {
    log(`  ✓ 크롤러 로그(읽기 전용): ${CRAWLER_LOG_PATH}`)
  }
  const presentRoots = COMMITTEE_DEBUG_ROOTS.filter(({ root }) => fs.existsSync(root))
  if (presentRoots.length === 0) {
    log(`  ! 위원 디버그 루트 미존재(첫 실행 때 생성됨): ${COMMITTEE_DEBUG_ROOTS.map(({ root }) => root).join(', ')}`)
  } else {
    log(`  ✓ 위원 디버그 아티팩트 루트: ${presentRoots.map(({ root, channel }) => `${root} [${channel}]`).join(', ')}`)
  }
}

function printSummary({ steps, runs, reproRun }) {
  console.log('\n──────── 실행 요약 ────────')
  if (steps && steps.length > 0) {
    const executable = steps.filter((step) => !step.blocked)
    const passed = executable.filter((step) => step.pass).length
    const blockedCount = steps.length - executable.length
    const verdict = executable.length > 0 && passed === executable.length && blockedCount === 0
      ? 'PASS'
      : blockedCount > 0 && passed === executable.length
        ? 'FAIL(환경 제약 — BLOCKED 구간 존재)'
        : 'FAIL'
    console.log(`TC-E2ED-001 시딩 여정: ${passed}/${executable.length} PASS + BLOCKED ${blockedCount}건 → ${verdict}`)
    for (const step of steps) {
      const mark = step.pass ? '✓' : step.blocked ? '⊘' : '✗'
      console.log(`  ${mark} [${step.id}] ${step.title}${step.elapsedMs !== undefined ? ` (${(step.elapsedMs / 1000).toFixed(1)}s)` : ''}${step.pass ? '' : ` — ${step.detail}`}`)
    }
  }
  if (runs && runs.length > 0) {
    console.log('TC-E2ED-002 실호출 매트릭스:')
    for (const rec of runs) {
      console.log(`  ${summarizeRun(rec)}`)
    }
    if (reproRun) {
      console.log(`  재현성: R5(repro of ${reproRun.reproOf}) verdict=${reproRun.verdict} → ${reproRun.reproducible ? '상시 재현' : '일시적(재현 안 됨)'}`)
    }
    const runPass = runs.every((rec) => rec.verdict === 'PASS')
    console.log(`TC-E2ED-002 종합: ${runPass ? 'PASS' : 'FAIL'} (실행 ${runs.length}회)`)
  }
}

async function main() {
  if (LIST_ONLY) {
    console.log('TC-E2ED-001  시딩 기반 딥스캔 사용자 여정 (seeded)')
    console.log('TC-E2ED-002  실호출 풀 여정 — 실행 결과 매트릭스 (live)')
    return
  }

  log(`모드=${MODE} BASE_URL=${BASE_URL} CRAWLER_URL=${CRAWLER_URL}`)
  await preflight()

  let journeyResult = null
  let runs = []
  let reproRun = null

  if (MODE === 'all' || MODE === 'seeded') {
    journeyResult = await runSeededJourney()
  }
  if (MODE === 'all' || MODE === 'live') {
    runs = await runLiveMatrix()
  }

  reproRun = await maybeRunRepro(runs)
  printSummary({ steps: journeyResult?.steps ?? null, runs, reproRun })

  // 런 레코드 전문 덤프 — TC 문서 작성용 증거 (저장소 외부 /tmp에만 기록)
  try {
    const serializable = {
      executedAt: new Date().toISOString(),
      mode: MODE,
      baseUrl: BASE_URL,
      crawlerUrl: CRAWLER_URL,
      journey: journeyResult ? { steps: journeyResult.steps, uiJourneyBlocked: journeyResult.uiJourneyBlocked ?? false } : null,
      runs: runs.map((rec) => ({
        ...rec,
        seenArtifacts: [...rec.seenArtifacts],
        validationChecks: rec.validationChecks?.filter((check) => !check.pass) ?? null,
      })),
      reproRun: reproRun ?? null,
    }
    fs.writeFileSync(RUN_RECORDS_PATH, JSON.stringify(serializable, null, 2))
    log(`런 레코드 덤프: ${RUN_RECORDS_PATH}`)
  } catch (dumpError) {
    log(`! 런 레코드 덤프 실패: ${dumpError.message}`)
  }

  const journeySteps = journeyResult?.steps ?? []
  const journeyOk = journeySteps.filter((step) => !step.blocked).every((step) => step.pass) && journeySteps.every((step) => !step.blocked)
  const runsOk = runs.length === 0 || runs.every((rec) => rec.verdict === 'PASS')
  if (journeyOk && runsOk) {
    log('최종: PASS')
    process.exitCode = 0
  } else {
    log('최종: FAIL — 위 요약의 ✗/⊘ 항목 참조 (⊘ = 환경 제약 BLOCKED)')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`[e2e-deepscan-journey] 치명 오류: ${error.message}`)
  process.exitCode = 1
})
