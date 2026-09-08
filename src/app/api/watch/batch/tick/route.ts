import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

import { runWatchDailyBatch } from '@/lib/watch/daily-batch'

export const runtime = 'nodejs'
export const maxDuration = 300

function secretsMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) {
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}

// 워치 감시 배치 수동·외부 트리거 엔드포인트.
//   Authorization: Bearer $WATCH_BATCH_SECRET
// 상시 스케줄러(src/instrumentation.ts)가 있는 환경에서는 스케줄러가 직접 실행하므로
// 이 엔드포인트는 수동 재실행·외부 cron 대체용으로 쓴다. 하루 한 번 의미론은
// watch_daily_scans의 unique(code, collected_date)로 보장된다(재호출 시 이미 수집된
// 종목은 건너뛴다).
export async function POST(request: NextRequest) {
  const secret = process.env.WATCH_BATCH_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'watch-batch-not-configured' }, { status: 503 })
  }
  const authorization = request.headers.get('authorization') ?? ''
  if (!secretsMatch(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const summary = await runWatchDailyBatch()
    return NextResponse.json({ ok: true, summary })
  } catch (error) {
    return NextResponse.json(
      { error: 'watch-batch-failed', message: error instanceof Error ? error.message : '배치 실행 실패' },
      { status: 500 },
    )
  }
}
