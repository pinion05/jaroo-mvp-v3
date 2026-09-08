// 워치 감시 배치 상시 스케줄러 — 프로세스가 살아 있는 동안 하루 한 번(KST 18:00 기본)
// runWatchDailyBatch를 실행한다. Railway 단일 컨테이너의 상주 Node 프로세스를 전제로 하며,
// 다중 인스턴스로 스케일 아웃하면 인스턴스 수만큼 중복 실행되므로 리더 락 도입이 필요하다.
//
// 부팅 시점에 오늘 배치가 아직 안 돌았고 예약 시각이 지났으면 즉시(30초 후) 보완 실행한다.
// 하루 한 번 의미론 자체는 watch_daily_scans의 unique(code, collected_date)가 보장한다.
//
// 환경변수:
//   WATCH_BATCH_HOUR_KST      실행 시각(시, KST). 기본 18
//   JAROO_DISABLE_SCHEDULER   '1'이면 스케줄러 비활성화(수동 tick만 사용)

import { runWatchDailyBatch } from '@/lib/watch/daily-batch'

const TICK_INTERVAL_MS = 60_000
const BOOT_CATCH_UP_DELAY_MS = 30_000
const DEFAULT_RUN_HOUR_KST = 18

function kstNowParts(): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

let running = false
let lastRunDate: string | null = null

export async function runScheduledWatchBatchIfDue(): Promise<void> {
  if (running) {
    return
  }
  const { date, hour, minute } = kstNowParts()
  const runHour = parseRunHour()
  const due = hour > runHour || (hour === runHour && minute >= 0)
  if (!due || lastRunDate === date) {
    return
  }

  running = true
  try {
    await runWatchDailyBatch()
    lastRunDate = date
  } catch (error) {
    // 실패 시 다음 틱(60초)에 재시도된다. lastRunDate를 갱신하지 않는다.
    console.error('[watch-scheduler] batch failed', error)
  } finally {
    running = false
  }
}

function parseRunHour(): number {
  const parsed = Number(process.env.WATCH_BATCH_HOUR_KST)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : DEFAULT_RUN_HOUR_KST
}

export function startWatchScheduler(): void {
  if (process.env.JAROO_DISABLE_SCHEDULER === '1') {
    console.log('[watch-scheduler] disabled by JAROO_DISABLE_SCHEDULER')
    return
  }
  const runHour = parseRunHour()
  console.log(`[watch-scheduler] started, daily at ${String(runHour).padStart(2, '0')}:00 KST`)

  // 부팅 보완 실행 — 예약 시각이 지났는데 오늘 아직 안 돌렸으면 곧바로 한 번 돌린다.
  setTimeout(() => {
    void runScheduledWatchBatchIfDue()
  }, BOOT_CATCH_UP_DELAY_MS)

  const ticker = setInterval(() => {
    void runScheduledWatchBatchIfDue()
  }, TICK_INTERVAL_MS)
  // 프로세스 정상 종료를 막지 않는다(다른 핸들러가 종료를 소유한다).
  ticker.unref?.()
}
