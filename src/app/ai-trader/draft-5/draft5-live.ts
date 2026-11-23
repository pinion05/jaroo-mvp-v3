/**
 * draft-5 실시간 발굴 데모 모드 — ②실증(jaroo_characters.js) 산출물 배선.
 * 오케스트레이터가 public/ai-trader/draft5-live.json 을 놓으면 같은 오리진에서 로드하고,
 * 파일이 없으면 목업 모드로 폴백한다. 이 파일은 스키마/패치/포맷 헬퍼만 담당.
 */

export type Draft5LiveArticle = {
  no: number
  url: string
  head: string
}

export type Draft5LiveDiscovery = {
  stock: string
  reason: string
  /** DRAFT5_NEWS 스타일의 근거기사 번호 (articles[].no 참조) */
  articles: number[]
  urls: string[]
  /** 실제 /api/deepscan 판정 (축소판 실데모) — 없으면 pending 취급 */
  gate?: Draft5LiveGate | null
}

/**
 * 성향 게이트 판정 — pass(문턱 통과·매수 후보) / fail(문턱 미달·관망) /
 * pending(리포트 미도착·Phase 2 대기 칩 유지)
 */
export type Draft5LiveGate = {
  status: 'pass' | 'fail' | 'pending'
  score: number | null
  threshold: number | null
  sizing?: string | null
  weekSignal?: string | null
  debugId?: string | null
}

/** 발굴 종목에 실행한 실제 deepscan 리포트 요약 (사용자와 동일한 리포트) */
export type Draft5LiveDeepscan = {
  code: string
  name: string
  heroScore: number
  scoreLabel: string
  weekSignal: string
  targetPriceText: string
  recoveryHorizonProbabilities?: {
    '3m'?: number | null
    '6m'?: number | null
    '1y'?: number | null
  } | null
  recoveryProbabilityHeadlineText?: string | null
  confidenceLevel?: string | null
  debugId: string
  generatedAt: string
  fetchedAtSec?: number | null
}

export type Draft5LiveCharacterData = {
  name: string
  positive: Draft5LiveDiscovery[]
  negative: Draft5LiveDiscovery[]
  /**
   * 페르소나 LLM이 생성한 손글씨 서사 일기 (gen_diary_for_demo.mjs 산출).
   * 근거 헤드라인·실제 점수·sizing이 문장에 녹아 있다. 없으면 템플릿 폴백.
   */
  diary?: Draft5LiveDiaryText | null
}

/** 캐릭터 일기 텍스트 — mood 이모지 + 서사 문단. 생성 메타는 하위 호환용 옵션 */
export type Draft5LiveDiaryText = {
  mood: string
  paragraphs: string[]
  generatedBy?: string
  generatedAt?: string
}

/** 매트릭스 행 — 캐릭터 이름(소심이·돌진이·배당콕)별 스탠스(1/-1) + 합계 */
export type Draft5LiveMatrixRow = {
  [key: string]: string | number
  stock: string
  sum: number
}

export type Draft5LivePayload = {
  generatedAt: string
  source: string
  articleCount: number
  articles: Draft5LiveArticle[]
  characters: Draft5LiveCharacterData[]
  matrix: Draft5LiveMatrixRow[]
  /** 발굴 종목에 실행한 실제 deepscan 리포트 목록 — 구버전 파일엔 없음(undefined) */
  deepscans?: Draft5LiveDeepscan[]
  deepscanFetchedAt?: string
  /** 캐릭터 이름별 성향 문턱 — 예: { "소심이": 55, ... } */
  thresholds?: Record<string, number>
}

export const DRAFT5_LIVE_JSON_PATH = '/ai-trader/draft5-live.json'

// ---------------------------------------------------------------- 파이프라인 상태 (갱신하기 버튼 폴링용)

export type Draft5LivePipelineStatus = {
  running: boolean
  pid?: number
  startedAt?: string | null
  step?: 'crawl' | 'deepscan' | 'diary' | 'done' | 'error' | string
  stepLabel?: string | null
  progress?: { current: number; total: number } | null
  lastRunAt?: string | null
  lastError?: string | null
  updatedAt?: string | null
}

export const DRAFT5_LIVE_STATUS_PATH = '/ai-trader/draft5-live.status.json'

/** 파이프라인 진행 상황 로드 — 파일 없으면 null (실행 이력 없음) */
export async function fetchDraft5LiveStatus(): Promise<Draft5LivePipelineStatus | null> {
  try {
    const res = await fetch(DRAFT5_LIVE_STATUS_PATH, {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as Draft5LivePipelineStatus
    if (!data || typeof data.running !== 'boolean') return null
    return data
  } catch {
    return null
  }
}

export const DRAFT5_LIVE_CHARACTER_NAMES = ['소심이', '돌진이', '배당콕'] as const

/** 스탠스 값 규약: 1 = 긍정, -1 = 부정, 그 외 = 무판정 */
export type Draft5LiveStance = 1 | -1 | 0

export function liveStanceOf(row: Draft5LiveMatrixRow, characterName: string): Draft5LiveStance {
  const value = Number(row[characterName] ?? 0)
  if (value === 1) return 1
  if (value === -1) return -1
  return 0
}

/** 같은 오리진 JSON 로드 — 실패 시 null(목업 폴백) */
export async function fetchDraft5Live(): Promise<Draft5LivePayload | null> {
  try {
    // AbortSignal.timeout: 어떤 환경(호스트명별 dev 프록시 동작 차이 등)에서도
    // promise가 영구 미해결로 남아 배너가 "확인 중…"에 갇히는 일을 방지한다.
    const res = await fetch(DRAFT5_LIVE_JSON_PATH, {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as Draft5LivePayload
    if (!data || !Array.isArray(data.characters) || data.characters.length === 0) return null
    return data
  } catch {
    return null
  }
}

export function findLiveCharacter(payload: Draft5LivePayload, characterKey: string): Draft5LiveCharacterData | null {
  return (
    payload.characters.find((candidate) => liveNameToKey(candidate.name) === characterKey) ?? null
  )
}

function liveNameToKey(name: string): string | null {
  if (name === '소심이') return 'sosim'
  if (name === '돌진이') return 'doljin'
  if (name === '배당콕') return 'baedang'
  return null
}

/** 발굴 칩의 게이트 뷰 — gate 필드가 없으면 pending으로 정규화 */
export function gateViewOf(discovery: Draft5LiveDiscovery): Draft5LiveGateView {
  const gate = discovery.gate
  return {
    stock: discovery.stock,
    status: gate?.status ?? 'pending',
    score: gate?.score ?? null,
    threshold: gate?.threshold ?? null,
    sizing: gate?.sizing ?? null,
  }
}

/** 게이트에 대응하는 deepscan 리포트 — debugId 우선, 종목명 폴백 */
export function findReportForGate(
  payload: Draft5LivePayload,
  stock: string,
  debugId?: string | null,
): Draft5LiveDeepscan | null {
  const reports = payload.deepscans ?? []
  if (reports.length === 0) return null
  if (debugId) {
    const byId = reports.find((report) => report.debugId === debugId)
    if (byId) return byId
  }
  return reports.find((report) => report.name === stock) ?? null
}

export type Draft5LiveGateCounts = {
  total: number
  pass: number
  fail: number
  pending: number
  decided: number
}

/** 전 캐릭터 positive 발굴 기준 게이트 판정 집계 */
export function liveGateCounts(payload: Draft5LivePayload): Draft5LiveGateCounts {
  let pass = 0
  let fail = 0
  let pending = 0
  let total = 0
  for (const characterData of payload.characters) {
    for (const discovery of characterData.positive) {
      total += 1
      const status = discovery.gate?.status ?? 'pending'
      if (status === 'pass') pass += 1
      else if (status === 'fail') fail += 1
      else pending += 1
    }
  }
  return { total, pass, fail, pending, decided: pass + fail }
}

/** '2026-11-16T19:43:51+09:00' → '11/16 19:43 KST' */
export function formatLiveStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')} KST`
}

/** 일기 날짜 헤더용 — { dateLabel: '11월 16일', weekday: '월' } */
export function liveDateParts(iso: string): { dateLabel: string; weekday: string } | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const month = get('month').replace(/[^0-9]/g, '')
  const day = get('day').replace(/[^0-9]/g, '')
  if (!month || !day) return null
  return { dateLabel: `${month}월 ${day}일`, weekday: get('weekday') || '' }
}

// ---------------------------------------------------------------- 실시간 발굴 기반 일기 템플릿 (캐릭터 말투 · 실제 deepscan 점수 주입)

export type Draft5LiveGateView = {
  stock: string
  status: 'pass' | 'fail' | 'pending'
  score: number | null
  threshold: number | null
  sizing: string | null
}

export type Draft5LiveDiary = {
  mood: string
  paragraphs: string[]
  /** 대표 발굴 종목 (일기에서 언급한 것) */
  mentionedStocks: string[]
  /** 게이트 통과(매수 후보) — 칩/서사에 실점수 노출 */
  passViews: Draft5LiveGateView[]
  /** 게이트 미달(관망) — PASS 스탬프 서사에 실점수 노출 */
  failViews: Draft5LiveGateView[]
  pendingCount: number
}

export function buildLiveDiary(
  characterKey: string,
  positive: Draft5LiveDiscovery[],
  negative: Draft5LiveDiscovery[],
): Draft5LiveDiary {
  const views: Draft5LiveGateView[] = positive.map((discovery) => gateViewOf(discovery))
  const pass = views.filter((view) => view.status === 'pass')
  const fail = views.filter((view) => view.status === 'fail')
  const pendingCount = views.filter((view) => view.status === 'pending').length
  const builder = LIVE_DIARY_TEMPLATES[characterKey] ?? LIVE_DIARY_TEMPLATES.sosim
  const built = builder(pass, fail, pendingCount, negative)
  const mentionedStocks =
    pass.length + fail.length > 0
      ? [...pass, ...fail].slice(0, 2).map((view) => view.stock)
      : positive.length > 0
        ? [positive[0].stock]
        : []
  return {
    mood: built.mood,
    paragraphs: built.paragraphs,
    mentionedStocks,
    passViews: pass,
    failViews: fail,
    pendingCount,
  }
}

type Draft5LiveGateViewSpec = Draft5LiveGateView

type LiveDiaryTemplate = (
  pass: Draft5LiveGateViewSpec[],
  fail: Draft5LiveGateViewSpec[],
  pendingCount: number,
  negative: Draft5LiveDiscovery[],
) => { mood: string; paragraphs: string[] }

const LIVE_DIARY_TEMPLATES: Record<string, LiveDiaryTemplate> = {
  sosim: (pass, fail, pendingCount, negative) => {
    const paragraphs: string[] = []
    if (pass.length > 0) {
      const a = pass[0]
      paragraphs.push(
        `오늘 뉴스에서 ${a.stock} 좋아 보여서 바로 deepscan을 돌려봤어… 돌렸더니 ${a.score}점! 내 문턱 ${a.threshold}점 통과야. ${a.sizing ?? '반 티켓'}만 살 거야. 약속할게.`,
      )
    } else if (fail.length > 0) {
      const f = fail[0]
      paragraphs.push(
        `오늘 뉴스에서 ${f.stock} 좋아 보여서 deepscan을 돌려봤는데… ${f.score}점이라 역시 못 사겠어 😰. 내 문턱은 ${f.threshold}점인데 안 넘었어.`,
      )
    } else {
      paragraphs.push(
        `오늘 발굴 ${pendingCount}종목 — deepscan 리포트를 기다리는 중이야. 통과하면 반 티켓, 아니면 관망. 일단 손은 안 대.`,
      )
    }
    if (pass.length > 0 && fail.length > 0) {
      const f = fail[0]
      paragraphs.push(
        `${f.stock}도 좋아 보였는데 ${f.score}점 — 문턱 ${f.threshold} 미달이라 역시 못 사겠어 😰. 뉴스가 아무리 좋아도 리포트가 안 넘어가면 안 사는 거야.`,
      )
    } else if (pendingCount > 0) {
      paragraphs.push(`아직 판정 대기 ${pendingCount}종목이 남았어. 리포트 도착하면 다시 볼게. 여행자금은 소중하니까.`)
    } else if (negative.length > 0) {
      paragraphs.push(`${negative[0].stock} 같은 건 뉴스는 화려해 보여도 멀리서 지켜볼래. 여행자금은 소중하니까.`)
    } else {
      paragraphs.push('오늘도 무사히 마침. 안 사서 수수료 0원 — 이것도 실력이라고 하자.')
    }
    return { mood: pass.length > 0 ? '🥹' : fail.length > 0 ? '😰' : '😥', paragraphs }
  },
  doljin: (pass, fail, pendingCount, negative) => {
    const paragraphs: string[] = []
    if (pass.length > 0) {
      const a = pass[0]
      paragraphs.push(
        `오늘 스캔에서 ${a.stock} 발굴 → deepscan ${a.score}점!! 내 문턱 ${a.threshold} 통과. ${a.sizing ?? '큰 비중'} 규칙 그대로 간다.`,
      )
    } else if (fail.length > 0) {
      const f = fail[0]
      paragraphs.push(
        `${f.stock} 발굴했는데 deepscan ${f.score}점… 문턱 ${f.threshold} 미달. 오늘은 참는다. 대기 모드도 전략이다.`,
      )
    } else {
      paragraphs.push(`오늘 발굴 ${pendingCount}종목 — 전부 판정 대기다. 리포트 붙으면 바로 문턱 35랑 비교할 거고.`)
    }
    if (pass.length > 0 && fail.length > 0) {
      const f = fail[0]
      paragraphs.push(`${f.stock}은 ${f.score}점 — 문턱 ${f.threshold} 미달이라 패스. 떨어지는 게 무서워서가 아니라 규칙이라서다.`)
    } else if (pendingCount > 0) {
      paragraphs.push(`판정 대기 ${pendingCount}종목 — 리포트 오는 대로 즉시 스캔 돌린다. 규칙은 규칙.`)
    } else if (negative.length > 0) {
      paragraphs.push(`${negative[0].stock}은(는) 부정 판정 패스. 다음 기회를 위한 워밍업이다.`)
    } else {
      paragraphs.push('오늘도 스캔 완료. 계좌는 살아있다.')
    }
    return { mood: pass.length > 0 ? '🔥' : fail.length > 0 ? '😤' : '😎', paragraphs }
  },
  baedang: (pass, fail, pendingCount, negative) => {
    const paragraphs: string[] = []
    if (pass.length > 0) {
      const a = pass[0]
      paragraphs.push(
        `${a.stock} — 뉴스에서 배당 냄새가 났다. deepscan ${a.score}점, 내 문턱 ${a.threshold} 통과. ${a.sizing ?? '중간 비중'}으로 들어갈 각이다.`,
      )
    } else if (fail.length > 0) {
      const f = fail[0]
      paragraphs.push(`${f.stock}까지 deepscan을 돌렸지만 ${f.score}점 — 문턱 ${f.threshold} 미달. 오늘은 커피와 대기다.`)
    } else {
      paragraphs.push(`오늘 발굴 ${pendingCount}종목 모두 리포트 대기. 판정이 나오면 배당 종목부터 훑을 것이다.`)
    }
    if (pass.length > 0 && fail.length > 0) {
      const f = fail[0]
      paragraphs.push(`${f.stock}은 ${f.score}점 미달. 점수 미달이면 배당이 있어도 못 산다 — 규칙은 규칙이다.`)
    } else if (pendingCount > 0) {
      paragraphs.push(`대기 ${pendingCount}종목. 리포트는 기다려주지만, 기회는 기다려주지 않는다 — 둘 다 놓치지 말자.`)
    } else if (negative.length > 0) {
      paragraphs.push(`${negative[0].stock}은 부정 판정. 배당 없는 실직자에게 자리는 없다.`)
    } else {
      paragraphs.push('주가는 날씨고, 배당은 계절이다. 계절은 기다리면 온다.')
    }
    return { mood: pass.length > 0 ? '🙂' : fail.length > 0 ? '☕' : '🧘', paragraphs }
  },
  gachi: (pass, fail, pendingCount, negative) => {
    const paragraphs: string[] = []
    if (pass.length > 0) {
      const a = pass[0]
      paragraphs.push(
        `${a.stock} 발굴 → deepscan ${a.score}점. 내 문턱 ${a.threshold} 통과 — 밸류 원칙상 ${a.sizing ?? '분할'}부터. 표가 내 편이다.`,
      )
    } else if (fail.length > 0) {
      const f = fail[0]
      paragraphs.push(
        `${f.stock} 표는 그럴듯했는데 deepscan ${f.score}점 — 문턱 ${f.threshold} 미달. 관망도 포지션이다.`,
      )
    } else {
      paragraphs.push(`오늘 발굴 ${pendingCount}종목 — 리포트 대기 구간. 점수가 나오기 전까지는 아무 것도 사지 않는다.`)
    }
    if (pass.length > 0 && fail.length > 0) {
      const f = fail[0]
      paragraphs.push(`${f.stock}은 ${f.score}점으로 문턱 ${f.threshold} 미달. 공포가 아니라 계산이 말한 것이다.`)
    } else if (pendingCount > 0) {
      paragraphs.push(`대기 ${pendingCount}종목은 리포트 도착 후 재판정. 기회는 도망가지 않는다, 늦게 올 뿐이다.`)
    } else if (negative.length > 0) {
      paragraphs.push(`${negative[0].stock}은 부정. 계산기가 두 번 말한 결과다.`)
    } else {
      paragraphs.push('기록은 남는다. 다음 표를 위해.')
    }
    return { mood: pass.length > 0 ? '🧮' : fail.length > 0 ? '🧐' : '🤓', paragraphs }
  },
}

// ---------------------------------------------------------------- 표시용

export type Draft5LiveStanceTone = 'profit' | 'loss' | 'muted'

export function stanceTone(stance: Draft5LiveStance): Draft5LiveStanceTone {
  if (stance === 1) return 'profit'
  if (stance === -1) return 'loss'
  return 'muted'
}
