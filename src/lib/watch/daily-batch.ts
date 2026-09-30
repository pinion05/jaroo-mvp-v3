import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { buildKrDeepScanPayloadViaCrawler, type DeepScanRawInput } from '@/lib/deepscan-runtime/build-payload'
import { sendTelegramMessage } from '@/lib/telegram/telegram-client'
import {
  buildEventMessage,
  buildWeeklySummaryMessage,
  detectStockEvents,
  filterEventsForLevel,
  normalizeAlertLevel,
  priceChangePctBetween,
  shouldSendWeeklySummary,
  type WatchAlertLevel,
} from '@/lib/watch/levels'
import type { JarooDeepScanPayload } from '@/../packages/contracts/src/deepscan'

// 워치 감시 배치 — 하루 한 번(기본 KST 18:00), watch_items에 등록된 종목만 모아
// 딥스캔과 동일한 수집 파이프라인(crawler canonical)으로 데이터를 모아 저장한다.
// #222 §3-7 3단 구조: 매일=지표 감시 '계산만'(LLM✗), 주 1회=주간 요약(템플릿),
// 이벤트 시=알림. 매일 무조건 요약을 보내지 않는다 — 발송은 사용자별 알림 강도 게이트를 따른다.
//
//   1) watch_items 전체 조회 → 종목(code+market) 단위로 묶음. 오늘 이미 수집한 종목은 건너뛴다.
//   2) 종목마다 crawler canonical 수집 → watch_daily_scans upsert.
//   3) 어제(직전 수집분) 대비 이벤트 감지 → 사용자 알림 강도 게이트로 발송 필터.
//      minimal=안전 하한선만 / normal=층1 공시 / detail=층1+급등락 5%.
//   4) 일요일 실행이면 normal·detail에게 주간 요약(템플릿) 발송. minimal은 없다.
//
// 트리거: /api/watch/batch/tick (외부 cron·수동) 또는 src/instrumentation.ts 스케줄러.

const STOCK_DELAY_MS = 1_000
const DEFAULT_MAX_STOCKS_PER_RUN = 50

export type WatchDailyBatchSummary = {
  date: string
  watchedStocks: number
  collected: number
  skippedAlreadyCollected: number
  eventMessagesSent: number
  weeklySummariesSent: number
  failed: Array<{ code: string; reason: string }>
}

function todayInSeoul(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type WatchedStock = {
  code: string
  market: string
  name: string | null
  watcherUserIds: string[]
}

function resolveCurrentPriceText(payload: JarooDeepScanPayload): string | null {
  const strategyPrice = (payload.strategy as { currentPriceText?: string } | null)?.currentPriceText
  if (strategyPrice) return strategyPrice
  const recoveryPrice = (payload.recoveryForecast as { currentPriceText?: string } | null)?.currentPriceText
  if (recoveryPrice) return recoveryPrice
  return null
}

async function listWatchedStocks(): Promise<WatchedStock[]> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.from('watch_items').select('user_id, code, name, market')
  if (error) {
    throw new Error(`watch_items 조회 실패: ${error.message}`)
  }

  const byStock = new Map<string, WatchedStock>()
  for (const row of data ?? []) {
    const code = typeof row.code === 'string' ? row.code : ''
    if (!code) continue
    const market = typeof row.market === 'string' && row.market ? row.market : 'KR'
    const key = `${market}:${code}`
    const stock = byStock.get(key) ?? { code, market, name: null, watcherUserIds: [] }
    if (!stock.name && typeof row.name === 'string' && row.name) {
      stock.name = row.name
    }
    if (typeof row.user_id === 'string' && !stock.watcherUserIds.includes(row.user_id)) {
      stock.watcherUserIds.push(row.user_id)
    }
    byStock.set(key, stock)
  }
  return [...byStock.values()]
}

async function collectStock(stock: WatchedStock): Promise<JarooDeepScanPayload> {
  const rawInput: DeepScanRawInput = {
    instrument: {
      code: stock.code,
      name: stock.name ?? undefined,
      market: stock.market,
    },
    sourceContext: {},
  }
  return buildKrDeepScanPayloadViaCrawler(rawInput)
}

async function storeDailyScan(stock: WatchedStock, date: string, payload: JarooDeepScanPayload): Promise<void> {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('watch_daily_scans').upsert(
    {
      code: stock.code,
      market: stock.market,
      collected_date: date,
      payload,
    },
    { onConflict: 'code,collected_date' },
  )
  if (error) {
    throw new Error(`watch_daily_scans 저장 실패: ${error.message}`)
  }
}

/** 직전 수집분(오늘 제외, 최신) — 이벤트 diff 기준선. */
async function loadPreviousPayload(stock: WatchedStock, today: string): Promise<JarooDeepScanPayload | null> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('watch_daily_scans')
    .select('payload')
    .eq('code', stock.code)
    .lt('collected_date', today)
    .order('collected_date', { ascending: false })
    .limit(1)
  if (error) {
    throw new Error(`watch_daily_scans 이전본 조회 실패: ${error.message}`)
  }
  const row = (data ?? [])[0]
  return row?.payload ? (row.payload as JarooDeepScanPayload) : null
}

/** 사용자별 알림 강도 — 설정 없으면 기본('normal', #222 §3-6). */
async function loadAlertLevelByUser(): Promise<Map<string, WatchAlertLevel>> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.from('watch_settings').select('user_id, alert_level')
  if (error) {
    throw new Error(`watch_settings 조회 실패: ${error.message}`)
  }
  const map = new Map<string, WatchAlertLevel>()
  for (const row of data ?? []) {
    if (typeof row.user_id === 'string') {
      map.set(row.user_id, normalizeAlertLevel(row.alert_level))
    }
  }
  return map
}

async function loadChatIdsByUser(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map()
  }
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.from('telegram_links').select('user_id, chat_id').in('user_id', userIds)
  if (error) {
    throw new Error(`telegram_links 조회 실패: ${error.message}`)
  }
  const map = new Map<string, string>()
  for (const row of data ?? []) {
    if (typeof row.user_id === 'string' && typeof row.chat_id === 'string' && row.chat_id) {
      map.set(row.user_id, row.chat_id)
    }
  }
  return map
}

function deepscanUrl(): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? 'https://test.jaroo.kr').replace(/\/+$/, '')}/deepscan`
}

async function sendToUser(chatId: string, text: string): Promise<boolean> {
  try {
    const result = await sendTelegramMessage(chatId, text)
    return result.ok
  } catch (error) {
    console.error('[watch-daily-batch] telegram send failed', error)
    return false
  }
}

export async function runWatchDailyBatch(options?: { maxStocks?: number }): Promise<WatchDailyBatchSummary> {
  const date = todayInSeoul()
  const summary: WatchDailyBatchSummary = {
    date,
    watchedStocks: 0,
    collected: 0,
    skippedAlreadyCollected: 0,
    eventMessagesSent: 0,
    weeklySummariesSent: 0,
    failed: [],
  }

  const stocks = await listWatchedStocks()
  summary.watchedStocks = stocks.length
  if (stocks.length === 0) {
    return summary
  }

  const supabase = createSupabaseServiceClient()
  const { data: alreadyCollected, error } = await supabase
    .from('watch_daily_scans')
    .select('code')
    .eq('collected_date', date)
  if (error) {
    throw new Error(`watch_daily_scans 조회 실패: ${error.message}`)
  }
  const collectedTodayCodes = new Set((alreadyCollected ?? []).map((row) => String(row.code)))

  const alertLevelByUser = await loadAlertLevelByUser()
  const chatIdsByUser = await loadChatIdsByUser(stocks.flatMap((stock) => stock.watcherUserIds))
  const isSunday = new Date().getDay() === 0
  // 주간 요약: 오늘 수집분을 기준으로 어제~직전 수집분까지의 변화를 요약한다.
  const weeklyRowsByUser = new Map<string, Array<{ name: string; priceText: string | null; weekChangePct: number | null; eventCount: number }>>()

  const maxStocks = options?.maxStocks ?? DEFAULT_MAX_STOCKS_PER_RUN
  let processed = 0
  for (const stock of stocks) {
    if (processed >= maxStocks) {
      break
    }
    if (collectedTodayCodes.has(stock.code)) {
      summary.skippedAlreadyCollected += 1
      continue
    }

    processed += 1
    const stockName = stock.name ?? stock.code
    const priceText = { current: null as string | null }
    try {
      const payload = await collectStock(stock)
      await storeDailyScan(stock, date, payload)
      summary.collected += 1
      priceText.current = resolveCurrentPriceText(payload)

      const previous = await loadPreviousPayload(stock, date)
      const events = detectStockEvents(payload, previous)
      const priceChangePct = priceChangePctBetween(payload, previous)

      // 사용자별 강도 게이트로 발송.
      for (const userId of stock.watcherUserIds) {
        const level = alertLevelByUser.get(userId) ?? 'normal'
        const targets = filterEventsForLevel(events, level, priceChangePct)
        const chatId = chatIdsByUser.get(userId)
        if (!chatId || targets.events.length === 0) {
          // 주간 요약 집계(발송은 일요일에 일괄) — 이벤트 수는 레벨 무관하게 '층1+안전' 기준으로 센다.
          if (isSunday && shouldSendWeeklySummary(level)) {
            const rows = weeklyRowsByUser.get(userId) ?? []
            rows.push({ name: stockName, priceText: priceText.current, weekChangePct: priceChangePct, eventCount: events.length })
            weeklyRowsByUser.set(userId, rows)
          }
          continue
        }

        const message = buildEventMessage(stockName, priceText.current, targets.events, deepscanUrl())
        const sent = await sendToUser(chatId, message)
        if (sent) {
          summary.eventMessagesSent += 1
        }
        if (isSunday && shouldSendWeeklySummary(level)) {
          const rows = weeklyRowsByUser.get(userId) ?? []
          rows.push({ name: stockName, priceText: priceText.current, weekChangePct: priceChangePct, eventCount: events.length })
          weeklyRowsByUser.set(userId, rows)
        }
      }
    } catch (error) {
      summary.failed.push({
        code: stock.code,
        reason: error instanceof Error ? error.message : '수집 실패',
      })
    }
    await sleep(STOCK_DELAY_MS)
  }

  // 주 1회 요약(일요일) — normal·detail 대상 템플릿 발송.
  if (isSunday) {
    for (const [userId, rows] of weeklyRowsByUser) {
      const chatId = chatIdsByUser.get(userId)
      if (!chatId) continue
      const sent = await sendToUser(chatId, buildWeeklySummaryMessage(rows, deepscanUrl()))
      if (sent) {
        summary.weeklySummariesSent += 1
      }
    }
  }

  console.log(
    `[watch-daily-batch] done date=${summary.date} stocks=${summary.watchedStocks} collected=${summary.collected} events=${summary.eventMessagesSent} weekly=${summary.weeklySummariesSent} failed=${summary.failed.length}`,
  )
  return summary
}
