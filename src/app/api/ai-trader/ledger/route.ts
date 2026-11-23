import { NextResponse } from 'next/server'

/**
 * AI 트레이더 원장 뷰 데이터 — 캐릭터별 계좌(paper-trade) + 판단 로그(ai-trader).
 * 3041/3042는 루프백 전용이라 브라우저가 직접 못 부른다. 이 라우트가 서버에서 모아준다.
 * 공개(내부 확인용) — 사용자 결정 2026-11-20. PROTECTED_APP_PATHS 미추가.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AITRADER = process.env.AITRADER_URL ?? 'http://localhost:3042'
const PAPERTRADE = process.env.PAPERTRADE_URL ?? 'http://localhost:3041'

const timeout = (ms: number) => AbortSignal.timeout(ms)

async function getJson(url: string, ms = 5000): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store', signal: timeout(ms) })
  const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null
  if (!res.ok || !body || body.ok === false) {
    throw new Error(`HTTP ${res.status}: ${url}`)
  }
  return body.data
}

export async function GET() {
  let characters: Array<Record<string, unknown>> = []
  try {
    const data = (await getJson(`${AITRADER}/v1/characters`)) as { items?: Array<Record<string, unknown>> }
    characters = data.items ?? []
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'ai_trader_unreachable', message: `ai-trader(${AITRADER})에 닿지 않습니다 — 서비스 기동 필요` } },
      { status: 503 },
    )
  }

  const traders = await Promise.all(
    characters.map(async (ch) => {
      const slug = String(ch.slug ?? '')
      const accountId = ch.paperTradeAccountId ? String(ch.paperTradeAccountId) : null
      const [journal, account, positions] = await Promise.all([
        getJson(`${AITRADER}/v1/characters/${slug}/journal?limit=30`).catch(() => null),
        accountId ? getJson(`${PAPERTRADE}/v1/accounts/${accountId}`).catch(() => null) : null,
        accountId ? getJson(`${PAPERTRADE}/v1/accounts/${accountId}/positions`).catch(() => null) : null,
      ])
      return {
        slug,
        displayName: ch.displayName ?? slug,
        temperament: ch.temperament ?? null,
        narrativeGoal: ch.narrativeGoal ?? null,
        principles: ch.principles ?? [],
        initialCashKrw: ch.initialCashKrw ?? null,
        cashGoalKrw: ch.cashGoalKrw ?? null,
        accountId,
        account,
        positions: (positions as { items?: unknown[] } | null)?.items ?? [],
        judgments: (journal as { items?: unknown[] } | null)?.items ?? [],
      }
    }),
  )

  return NextResponse.json({ ok: true, data: { traders, generatedAt: new Date().toISOString() } })
}
