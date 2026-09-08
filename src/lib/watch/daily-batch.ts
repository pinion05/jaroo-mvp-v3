import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { buildKrDeepScanPayloadViaCrawler, type DeepScanRawInput } from '@/lib/deepscan-runtime/build-payload'
import { sendTelegramMessage } from '@/lib/telegram/telegram-client'
import type { JarooDeepScanPayload } from '@/../packages/contracts/src/deepscan'

// 워치 감시 배치 — 하루 한 번, watch_items에 등록된 종목만 모아 딥스캔과 동일한
// 수집 파이프라인(crawler canonical)으로 데이터를 모아 저장하고, 감시 중인 사용자에게
// 텔레그램으로 오늘의 요약을 보낸다.
//
// 동작 순서:
//   1) watch_items 전체 조회 → 종목(code+market) 단위로 묶음. 하루 한 번 의미론을 위해
//      오늘(Asia/Seoul) 이미 수집된 종목은 건너뛴다.
//   2) 종목마다 crawler canonical(딥스캔 수집 데이터) 요청. 보유 정보 없이 종목 단위로 수집.
//   3) watch_daily_scans에 upsert(unique code+collected_date).
//   4) 해당 종목을 감시 중인 사용자의 telegram_links chat_id 로 요약 메시지 발송.
//
// 트리거: /api/watch/batch/tick (외부 cron·수동) 또는 src/instrumentation.ts 스케줄러.

const STOCK_DELAY_MS = 1_000
const DEFAULT_MAX_STOCKS_PER_RUN = 50

export type WatchDailyBatchSummary = {
  date: string
  watchedStocks: number
  collected: number
  skippedAlreadyCollected: number
  notifiedUsers: number
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

function buildDigestMessage(stock: WatchedStock, payload: JarooDeepScanPayload): string {
  const lines: string[] = []
  const name = stock.name ?? stock.code
  const priceText = resolveCurrentPriceText(payload)
  lines.push(`<b>${escapeHtml(name)}</b> 오늘의 감시 리포트`)
  if (priceText) {
    lines.push(`현재가 ${escapeHtml(priceText)}`)
  }
  const headline = payload.hero?.headline
  if (headline) {
    lines.push('')
    lines.push(escapeHtml(headline))
  }
  const body = payload.hero?.body
  if (body) {
    lines.push(escapeHtml(body))
  }
  return lines.join('\n')
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
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

async function notifyWatchers(stock: WatchedStock, payload: JarooDeepScanPayload): Promise<number> {
  if (stock.watcherUserIds.length === 0) {
    return 0
  }
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('telegram_links')
    .select('user_id, chat_id')
    .in('user_id', stock.watcherUserIds)
  if (error) {
    throw new Error(`telegram_links 조회 실패: ${error.message}`)
  }

  const chatIds = [...new Set((data ?? []).map((row) => String(row.chat_id)).filter(Boolean))]
  let notified = 0
  for (const chatId of chatIds) {
    try {
      const result = await sendTelegramMessage(chatId, buildDigestMessage(stock, payload))
      if (result.ok) {
        notified += 1
      }
    } catch (error) {
      console.error('[watch-daily-batch] telegram send failed', stock.code, error)
    }
  }
  return notified
}

export async function runWatchDailyBatch(options?: { maxStocks?: number }): Promise<WatchDailyBatchSummary> {
  const date = todayInSeoul()
  const summary: WatchDailyBatchSummary = {
    date,
    watchedStocks: 0,
    collected: 0,
    skippedAlreadyCollected: 0,
    notifiedUsers: 0,
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
    try {
      const payload = await collectStock(stock)
      await storeDailyScan(stock, date, payload)
      summary.collected += 1
      summary.notifiedUsers += await notifyWatchers(stock, payload)
    } catch (error) {
      summary.failed.push({
        code: stock.code,
        reason: error instanceof Error ? error.message : '수집 실패',
      })
    }
    await sleep(STOCK_DELAY_MS)
  }

  console.log(
    `[watch-daily-batch] done date=${summary.date} stocks=${summary.watchedStocks} collected=${summary.collected} notified=${summary.notifiedUsers} failed=${summary.failed.length}`,
  )
  return summary
}
