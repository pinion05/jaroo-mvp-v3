import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  DeepScanBlockState,
  JarooDeepScanCommitteeMember,
  JarooDeepScanPayload,
} from '../../../packages/contracts/src/deepscan'

type UnknownRecord = Record<string, unknown>

export type DeepScanPerfStatus = 'pending' | 'ready' | 'confirmed_missing' | 'failed' | 'blocked'

export type DeepScanPerfFieldState = {
  component: string
  field: string
  status: DeepScanPerfStatus
  detail?: Record<string, unknown>
}

export type DeepScanPerfEvent = {
  schemaVersion: 1
  event: 'field_state'
  observedAt: string
  route?: string
  requestId: string
  target?: {
    name?: string
    code?: string
    ticker?: string
    market?: string
  }
  component: string
  field: string
  status: DeepScanPerfStatus
  elapsedMs: number
  generatedAt?: string
  detail?: Record<string, unknown>
}

export type DeepScanCommitteeProgressLike = {
  requestId: string
  status?: string
  results?: Record<string, unknown>
  errors?: unknown[]
  pending?: string[]
  completed?: number
  updatedAt?: string
  softDeadlineMs?: number
}

export type DeepScanQuickQuoteLike = {
  ok?: boolean
  data?: {
    items?: unknown[]
  }
  items?: unknown[]
}

type PerfRequestState = {
  firstObservedAtMs: number
  seenKeys: Set<string>
}

type PerfRegistry = {
  requests: Map<string, PerfRequestState>
}

type RecordOptions = {
  now?: Date
  startedAt?: Date
  route?: string
}

const MAX_TRACKED_REQUESTS = 200
const DEFAULT_LOG_DIR = join(tmpdir(), 'jaroo-deepscan-perf')
const TERMINAL_STATUSES = new Set<DeepScanPerfStatus>(['ready', 'confirmed_missing', 'failed', 'blocked'])

const MISSING_TEXT_PATTERNS = [
  /데이타가\s*존재하지\s*않습니다/,
  /데이터가\s*존재하지\s*않습니다/,
  /정보\s*없음/,
  /없음$/,
  /미제공/,
  /not\s+available/i,
  /^n\/?a$/i,
]

const FAILED_TEXT_PATTERNS = [
  /조회\s*실패/,
  /수집\s*실패/,
  /오류/,
  /error/i,
  /failed/i,
]

declare global {
  // eslint-disable-next-line no-var
  var __jarooDeepScanPerfRegistry: PerfRegistry | undefined
}

function getRegistry(): PerfRegistry {
  globalThis.__jarooDeepScanPerfRegistry ??= { requests: new Map() }
  return globalThis.__jarooDeepScanPerfRegistry
}

function pruneRegistry(registry: PerfRegistry) {
  while (registry.requests.size > MAX_TRACKED_REQUESTS) {
    const oldestKey = registry.requests.keys().next().value
    if (!oldestKey) {
      break
    }
    registry.requests.delete(oldestKey)
  }
}

export function resetDeepScanPerfTraceForTests() {
  globalThis.__jarooDeepScanPerfRegistry = { requests: new Map() }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function hasMissingMeaning(text: string) {
  return MISSING_TEXT_PATTERNS.some((pattern) => pattern.test(text.trim()))
}

function hasFailedMeaning(text: string) {
  return FAILED_TEXT_PATTERNS.some((pattern) => pattern.test(text.trim()))
}

function isZeroPriceText(text: string) {
  const numeric = Number(text.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(numeric) && numeric === 0
}

function classifyText(value: unknown, options: { zeroMeansMissing?: boolean } = {}): DeepScanPerfStatus | null {
  const text = normalizeText(value)
  if (!text) {
    return null
  }

  if (hasFailedMeaning(text)) {
    return 'failed'
  }

  if (hasMissingMeaning(text) || (options.zeroMeansMissing && isZeroPriceText(text))) {
    return 'confirmed_missing'
  }

  return 'ready'
}

function classifyNumber(value: unknown): DeepScanPerfStatus | null {
  return typeof value === 'number' && Number.isFinite(value) ? 'ready' : null
}

function classifyArrayCount(value: unknown) {
  if (!Array.isArray(value)) {
    return null
  }

  return value.length > 0 ? 'ready' : 'confirmed_missing'
}

function blockStatusToPerfStatus(blockState: DeepScanBlockState): DeepScanPerfStatus {
  if (blockState === 'ok') {
    return 'ready'
  }
  if (blockState === 'blocked') {
    return 'blocked'
  }
  return 'failed'
}

function pushState(states: DeepScanPerfFieldState[], state: DeepScanPerfFieldState | null) {
  if (state) {
    states.push(state)
  }
}

function blockState(component: string, block: { blockState: DeepScanBlockState; error?: unknown } | undefined): DeepScanPerfFieldState | null {
  if (!block) {
    return null
  }

  const error = asRecord(block.error)
  return {
    component,
    field: 'blockState',
    status: blockStatusToPerfStatus(block.blockState),
    ...(error ? { detail: { errorCode: error.code, errorMessage: error.message } } : {}),
  }
}

function textState(component: string, field: string, value: unknown, options?: { zeroMeansMissing?: boolean }): DeepScanPerfFieldState | null {
  const status = classifyText(value, options)
  return status ? { component, field, status } : null
}

function numberState(component: string, field: string, value: unknown): DeepScanPerfFieldState | null {
  const status = classifyNumber(value)
  return status ? { component, field, status } : null
}

function arrayState(component: string, field: string, value: unknown): DeepScanPerfFieldState | null {
  const status = classifyArrayCount(value)
  return status ? { component, field, status, detail: { count: Array.isArray(value) ? value.length : 0 } } : null
}

function hasNumericField(record: UnknownRecord | null, field: string) {
  return typeof record?.[field] === 'number' && Number.isFinite(record[field])
}

function memberIdentity(member: JarooDeepScanCommitteeMember, index: number) {
  return normalizeText(member.shortLabel) ?? normalizeText(member.title) ?? `member-${index + 1}`
}

function collectCommitteeMemberStates(payload: JarooDeepScanPayload, states: DeepScanPerfFieldState[]) {
  const members = payload.committee.axes.flatMap((axis) => axis.members)
  const uniqueMembers = new Map<string, JarooDeepScanCommitteeMember>()

  members.forEach((member, index) => {
    uniqueMembers.set(memberIdentity(member, index), member)
  })

  const totals = { success: 0, error: 0, pending: 0 }
  for (const [key, member] of uniqueMembers) {
    totals[member.status] += 1
    const status: DeepScanPerfStatus = member.status === 'success' ? 'ready' : member.status === 'error' ? 'failed' : 'pending'
    states.push({
      component: 'committee',
      field: `member.${key}`,
      status,
      detail: {
        score: member.score,
        confidence: member.confidence,
        errorKind: member.error?.kind,
      },
    })
  }

  if (uniqueMembers.size > 0) {
    states.push({ component: 'committee', field: 'members.success', status: totals.success > 0 ? 'ready' : 'pending', detail: { count: totals.success } })
    states.push({ component: 'committee', field: 'members.error', status: totals.error > 0 ? 'failed' : 'pending', detail: { count: totals.error } })
    states.push({ component: 'committee', field: 'members.pending', status: totals.pending > 0 ? 'pending' : 'ready', detail: { count: totals.pending } })
  }
}

export function collectDeepScanPayloadFieldStates(payload: JarooDeepScanPayload): DeepScanPerfFieldState[] {
  const states: DeepScanPerfFieldState[] = []

  pushState(states, blockState('hero', payload.hero))
  pushState(states, numberState('hero', 'score', payload.hero.score))
  pushState(states, textState('hero', 'headline', payload.hero.headline))
  pushState(states, textState('hero', 'statusText', payload.hero.statusText))

  pushState(states, blockState('committee', payload.committee))
  pushState(states, arrayState('committee', 'axes', payload.committee.axes))
  payload.committee.axes.forEach((axis, index) => {
    pushState(states, numberState('committee', `axis.${axis.label || index + 1}.score`, axis.score))
  })
  collectCommitteeMemberStates(payload, states)

  pushState(states, blockState('insights', payload.insights))
  pushState(states, arrayState('insights', 'items', payload.insights.items))
  pushState(states, arrayState('insights', 'summaryTags', payload.insights.summaryTags))

  pushState(states, blockState('strategy', payload.strategy))
  pushState(states, textState('strategy', 'weekSignal', payload.strategy.weekSignal))
  pushState(states, textState('strategy', 'scenarioProbability', payload.strategy.scenarioProbability))
  pushState(states, textState('strategy', 'currentPriceText', payload.strategy.currentPriceText))
  pushState(states, textState('strategy', 'targetPriceText', payload.strategy.targetPriceText, { zeroMeansMissing: true }))
  pushState(states, buildLoadingConsensusState(payload))
  pushState(states, arrayState('strategy', 'scenarioDetails', payload.strategy.scenarioDetails))
  pushState(states, arrayState('strategy', 'otherScenarios', payload.strategy.otherScenarios))

  pushState(states, blockState('sellNow', payload.sellNow))
  pushState(states, textState('sellNow', 'realizedText', payload.sellNow.realizedText))
  pushState(states, arrayState('sellNow', 'rows', payload.sellNow.rows))

  pushState(states, blockState('portfolioSimulation', payload.portfolioSimulation))
  pushState(states, numberState('portfolioSimulation', 'beforeScore', payload.portfolioSimulation.beforeScore))
  pushState(states, numberState('portfolioSimulation', 'afterScore', payload.portfolioSimulation.afterScore))
  pushState(states, textState('portfolioSimulation', 'deltaLabel', payload.portfolioSimulation.deltaLabel))
  pushState(states, buildLoadingPerformanceCommentState(payload))

  const llmCommittee = payload.metadata.llmCommittee
  if (llmCommittee) {
    states.push({
      component: 'metadata',
      field: 'llmCommittee.status',
      status: llmCommittee.status === 'complete' ? 'ready' : llmCommittee.status === 'error' ? 'failed' : llmCommittee.status === 'partial' ? 'pending' : 'confirmed_missing',
      detail: {
        completed: llmCommittee.completed,
        pending: llmCommittee.pending,
        errors: llmCommittee.errors,
        softDeadlineMs: llmCommittee.softDeadlineMs,
      },
    })
  }

  return states
}

function isNoDataConsensusBody(body: string) {
  return /데[이]?타가\s*존재하지\s*않습니다|데[이]?터가\s*존재하지\s*않습니다|최근\s*3개월\s*이내에\s*제시된\s*의견이\s*없습니다|목표가\s*미제공|목표가\s*조회\s*실패/u.test(body)
}

function buildLoadingConsensusState(payload: JarooDeepScanPayload): DeepScanPerfFieldState {
  const consensus = payload.insights.items.find((item) => item.sourceLabel === '증권사 의견' || item.label === '컨센서스')
  const body = normalizeText(consensus?.body)

  if (!body) {
    return { component: 'loadingQuickFacts', field: 'analystConsensus', status: 'confirmed_missing' }
  }

  if (hasFailedMeaning(body)) {
    return { component: 'loadingQuickFacts', field: 'analystConsensus', status: 'failed' }
  }

  if (isNoDataConsensusBody(body)) {
    return { component: 'loadingQuickFacts', field: 'analystConsensus', status: 'confirmed_missing' }
  }

  const hasTargetPrice = /평균\s*목표가\s*[0-9,]+(?:\.\d+)?\s*(KRW|USD|원|달러)?/iu.test(body)
  return {
    component: 'loadingQuickFacts',
    field: 'analystConsensus',
    status: hasTargetPrice ? 'ready' : 'confirmed_missing',
    detail: {
      sourceLabel: consensus?.sourceLabel,
      label: consensus?.label,
      date: consensus?.date,
    },
  }
}

function buildLoadingPerformanceCommentState(payload: JarooDeepScanPayload): DeepScanPerfFieldState {
  const comment = payload.insights.items.find((item) => item.sourceLabel === '기업실적코멘트' || item.title === '기업실적코멘트')
  const body = normalizeText(comment?.body)

  return {
    component: 'loadingQuickFacts',
    field: 'performanceComment',
    status: body ? 'ready' : 'confirmed_missing',
    detail: body ? { date: comment?.date } : undefined,
  }
}

export function collectDeepScanCommitteeProgressFieldStates(progress: DeepScanCommitteeProgressLike): DeepScanPerfFieldState[] {
  const states: DeepScanPerfFieldState[] = []
  const results = asRecord(progress.results) ?? {}
  const errors = Array.isArray(progress.errors) ? progress.errors : []
  const pending = Array.isArray(progress.pending) ? progress.pending : []
  const completed = typeof progress.completed === 'number' ? progress.completed : Object.keys(results).length

  states.push({
    component: 'committee',
    field: 'poll.status',
    status: progress.status === 'complete' ? 'ready' : progress.status === 'error' ? 'failed' : progress.status === 'not_found' ? 'pending' : 'pending',
    detail: { status: progress.status, completed, pending: pending.length, errors: errors.length, softDeadlineMs: progress.softDeadlineMs },
  })

  states.push({ component: 'committee', field: 'poll.completed', status: completed > 0 ? 'ready' : 'pending', detail: { count: completed } })

  for (const [memberKey, result] of Object.entries(results)) {
    const record = asRecord(result)
    states.push({
      component: 'committee',
      field: `member.${memberKey}`,
      status: 'ready',
      detail: {
        score: record?.score,
        confidence: record?.confidence,
      },
    })
  }

  for (const memberKey of pending) {
    states.push({ component: 'committee', field: `member.${memberKey}`, status: 'pending' })
  }

  errors.forEach((error, index) => {
    const record = asRecord(error)
    const memberKey = normalizeText(record?.member) ?? normalizeText(record?.memberKey) ?? `error-${index + 1}`
    states.push({
      component: 'committee',
      field: `member.${memberKey}`,
      status: 'failed',
      detail: {
        errorKind: record?.kind,
        errorMessage: record?.message,
      },
    })
  })

  return states
}

export function collectDeepScanQuickQuoteFieldStates(body: DeepScanQuickQuoteLike): DeepScanPerfFieldState[] {
  const items = Array.isArray(body.data?.items) ? body.data.items : Array.isArray(body.items) ? body.items : []
  const states: DeepScanPerfFieldState[] = []

  for (const item of items) {
    const record = asRecord(item)
    if (!record) {
      continue
    }

    const codeOrTicker = normalizeText(record.code) ?? normalizeText(record.ticker) ?? 'unknown'
    const fieldPrefix = items.length > 1 ? `${codeOrTicker}.` : ''
    const hasCurrentPrice = hasNumericField(record, 'price')
    const hasTradingVolume = hasNumericField(record, 'volume')
    const hasWeek52High = hasNumericField(record, 'week52High')
    const hasWeek52Low = hasNumericField(record, 'week52Low')

    states.push({
      component: 'loadingQuickFacts',
      field: `${fieldPrefix}quote.currentPrice`,
      status: hasCurrentPrice ? 'ready' : 'confirmed_missing',
      detail: { source: record.source, code: record.code, ticker: record.ticker },
    })
    states.push({
      component: 'loadingQuickFacts',
      field: `${fieldPrefix}quote.tradingVolume`,
      status: hasTradingVolume ? 'ready' : 'confirmed_missing',
      detail: { source: record.source, code: record.code, ticker: record.ticker },
    })
    states.push({
      component: 'loadingQuickFacts',
      field: `${fieldPrefix}week52Position`,
      status: hasCurrentPrice && hasWeek52High && hasWeek52Low ? 'ready' : 'confirmed_missing',
      detail: {
        source: record.source,
        code: record.code,
        ticker: record.ticker,
        hasCurrentPrice,
        hasWeek52High,
        hasWeek52Low,
      },
    })
  }

  if (states.length === 0) {
    states.push({ component: 'loadingQuickFacts', field: 'quote.currentPrice', status: body.ok === false ? 'failed' : 'confirmed_missing' })
    states.push({ component: 'loadingQuickFacts', field: 'week52Position', status: body.ok === false ? 'failed' : 'confirmed_missing' })
  }

  return states
}

function buildTarget(payload: JarooDeepScanPayload): DeepScanPerfEvent['target'] {
  return {
    name: payload.input.instrument.name,
    code: payload.input.instrument.code,
    ticker: payload.input.instrument.ticker,
    market: payload.input.instrument.market,
  }
}

function getPayloadRequestId(payload: JarooDeepScanPayload) {
  return payload.metadata.llmCommittee?.requestId || payload.metadata.debugId
}

function getLogDir() {
  return process.env.JAROO_DEEPSCAN_PERF_LOG_DIR || DEFAULT_LOG_DIR
}

function getLogFileName(date: Date) {
  return `${date.toISOString().slice(0, 10)}.jsonl`
}

function buildStateKey(state: DeepScanPerfFieldState) {
  return `${state.component}\u0000${state.field}\u0000${state.status}`
}

async function appendEvents(events: DeepScanPerfEvent[], observedAt: Date) {
  if (events.length === 0) {
    return
  }

  const logDir = getLogDir()
  await mkdir(logDir, { recursive: true })
  await appendFile(join(logDir, getLogFileName(observedAt)), events.map((event) => JSON.stringify(event)).join('\n') + '\n')
}

function buildEvents(params: {
  requestId: string
  states: DeepScanPerfFieldState[]
  observedAt: Date
  startedAt?: Date
  route?: string
  generatedAt?: string
  target?: DeepScanPerfEvent['target']
}) {
  const registry = getRegistry()
  const state = registry.requests.get(params.requestId) ?? {
    firstObservedAtMs: params.startedAt?.getTime() ?? params.observedAt.getTime(),
    seenKeys: new Set<string>(),
  }
  registry.requests.set(params.requestId, state)
  pruneRegistry(registry)

  const elapsedMs = Math.max(0, params.observedAt.getTime() - state.firstObservedAtMs)
  const events: DeepScanPerfEvent[] = []

  for (const fieldState of params.states) {
    const key = buildStateKey(fieldState)
    if (state.seenKeys.has(key)) {
      continue
    }

    state.seenKeys.add(key)
    events.push({
      schemaVersion: 1,
      event: 'field_state',
      observedAt: params.observedAt.toISOString(),
      route: params.route,
      requestId: params.requestId,
      target: params.target,
      component: fieldState.component,
      field: fieldState.field,
      status: fieldState.status,
      elapsedMs,
      generatedAt: params.generatedAt,
      detail: fieldState.detail,
    })
  }

  return events
}

export async function recordDeepScanPayloadPerf(payload: JarooDeepScanPayload, options: RecordOptions = {}) {
  const observedAt = options.now ?? new Date()
  const events = buildEvents({
    requestId: getPayloadRequestId(payload),
    states: collectDeepScanPayloadFieldStates(payload),
    observedAt,
    startedAt: options.startedAt,
    route: options.route,
    generatedAt: payload.metadata.generatedAt,
    target: buildTarget(payload),
  })

  await appendEvents(events, observedAt)
  return events
}

export async function recordDeepScanCommitteeProgressPerf(progress: DeepScanCommitteeProgressLike, options: RecordOptions = {}) {
  const observedAt = options.now ?? new Date()
  const events = buildEvents({
    requestId: progress.requestId,
    states: collectDeepScanCommitteeProgressFieldStates(progress),
    observedAt,
    startedAt: options.startedAt,
    route: options.route,
    generatedAt: progress.updatedAt,
  })

  await appendEvents(events, observedAt)
  return events
}

function buildQuickQuoteRequestId(body: DeepScanQuickQuoteLike, observedAt: Date) {
  const items = Array.isArray(body.data?.items) ? body.data.items : Array.isArray(body.items) ? body.items : []
  const firstItem = asRecord(items[0])
  const targetKey = normalizeText(firstItem?.code) ?? normalizeText(firstItem?.ticker) ?? 'unknown'
  return `quick-quote:${targetKey}:${observedAt.getTime()}`
}

function buildQuickQuoteTarget(body: DeepScanQuickQuoteLike): DeepScanPerfEvent['target'] {
  const items = Array.isArray(body.data?.items) ? body.data.items : Array.isArray(body.items) ? body.items : []
  const firstItem = asRecord(items[0])

  return {
    name: normalizeText(firstItem?.name),
    code: normalizeText(firstItem?.code),
    ticker: normalizeText(firstItem?.ticker),
    market: normalizeText(firstItem?.market),
  }
}

export async function recordDeepScanQuickQuotePerf(body: DeepScanQuickQuoteLike, options: RecordOptions = {}) {
  const observedAt = options.now ?? new Date()
  const events = buildEvents({
    requestId: buildQuickQuoteRequestId(body, observedAt),
    states: collectDeepScanQuickQuoteFieldStates(body),
    observedAt,
    startedAt: options.startedAt,
    route: options.route,
    target: buildQuickQuoteTarget(body),
  })

  await appendEvents(events, observedAt)
  return events
}

function parseEventLine(line: string): DeepScanPerfEvent | null {
  try {
    const parsed = JSON.parse(line) as DeepScanPerfEvent
    if (parsed?.schemaVersion === 1 && parsed.event === 'field_state' && typeof parsed.elapsedMs === 'number') {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

async function readPerfEvents(limit: number) {
  const logDir = getLogDir()
  let files: string[]
  try {
    files = (await readdir(logDir)).filter((file) => file.endsWith('.jsonl')).sort()
  } catch {
    return []
  }

  const lines: string[] = []
  for (const file of files) {
    try {
      lines.push(...(await readFile(join(logDir, file), 'utf8')).split('\n').filter(Boolean))
    } catch {
      // Ignore partially unavailable daily files. Summary is best-effort telemetry.
    }
  }

  return lines.slice(-limit).map(parseEventLine).filter((event): event is DeepScanPerfEvent => !!event)
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function round(value: number | null) {
  return value === null ? null : Math.round(value)
}

export async function summarizeDeepScanPerfEvents(options: { limit?: number; status?: DeepScanPerfStatus } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 5000, 1), 100_000)
  const events = (await readPerfEvents(limit)).filter((event) => !options.status || event.status === options.status)
  const groups = new Map<string, DeepScanPerfEvent[]>()

  for (const event of events) {
    const key = `${event.component}\u0000${event.field}\u0000${event.status}`
    const group = groups.get(key) ?? []
    group.push(event)
    groups.set(key, group)
  }

  const fields = [...groups.entries()].map(([key, group]) => {
    const [component, field, status] = key.split('\u0000') as [string, string, DeepScanPerfStatus]
    const elapsed = group.map((event) => event.elapsedMs)
    const count = group.length
    const averageMs = elapsed.reduce((sum, value) => sum + value, 0) / count

    return {
      component,
      field,
      status,
      count,
      minMs: Math.min(...elapsed),
      p50Ms: round(percentile(elapsed, 0.5)),
      p90Ms: round(percentile(elapsed, 0.9)),
      p95Ms: round(percentile(elapsed, 0.95)),
      maxMs: Math.max(...elapsed),
      averageMs: Math.round(averageMs),
      sampleTargets: [...new Set(group.map((event) => event.target?.ticker || event.target?.code || event.target?.name).filter(Boolean))].slice(0, 5),
      lastObservedAt: group.map((event) => event.observedAt).sort().at(-1),
    }
  }).sort((left, right) => (left.p50Ms ?? Number.MAX_SAFE_INTEGER) - (right.p50Ms ?? Number.MAX_SAFE_INTEGER) || right.count - left.count)

  const terminalFields = fields.filter((field) => TERMINAL_STATUSES.has(field.status))

  return {
    ok: true,
    logDir: getLogDir(),
    eventCount: events.length,
    fieldCount: fields.length,
    generatedAt: new Date().toISOString(),
    rankedTerminalFields: terminalFields.slice(0, 100),
    fields,
  }
}
