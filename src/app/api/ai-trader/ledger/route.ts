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

  // UI 표시용 종목명 채우기 — 보유·판단 전체 코드를 한 번에 조회(공용 종목은 1회).
  const symbols = traders.flatMap((t) => [
    ...((t.positions ?? []) as Array<{ symbol?: string }>).map((p) => String(p.symbol ?? '')),
    ...((t.judgments ?? []) as Array<{ symbol?: string | null }>).map((j) => String(j.symbol ?? '')),
  ])
  attachSymbolNames(traders as Array<Record<string, unknown>>, await resolveSymbolNames(symbols))

  return NextResponse.json({ ok: true, data: { traders, generatedAt: new Date().toISOString() } })
}

/**
 * 종목 코드 → 종목명. krchart(:13100) /api/analyze 가 {name, symbol}을 돌려준다.
 * 원장(paper-trade·journal)은 심볼 코드만 저장하므로 여기서 UI 표시용 이름을 채운다.
 * 조회 실패·미등록 코드는 맵에 없는 채로 둔다 — 페이지가 코드로 폴백 렌더한다.
 */
async function resolveSymbolNames(symbols: Array<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const KRCHART = process.env.KRCHART_URL ?? 'http://localhost:13100'
  await Promise.all(
    [...new Set(symbols)]
      .filter((s) => /^\d{6}$/.test(s))
      .map(async (symbol) => {
        try {
          const res = await fetch(`${KRCHART}/api/analyze?symbol=${symbol}`, {
            cache: 'no-store',
            signal: timeout(4000),
          })
          if (!res.ok) return
          const body = (await res.json().catch(() => null)) as { name?: string } | null
          const name = body?.name?.trim()
          if (name) map.set(symbol, name)
        } catch {
          // krchart 미응답 — 코드 폴백 유지 (원장 자체에는 영향 없음)
        }
      }),
  )
  return map
}

/** traders 의 보유·판단 항목에 종목명을 붙인다 (in-place, 공용 코드는 한 번만 조회). */
function attachSymbolNames(
  traders: Array<Record<string, unknown>>,
  names: Map<string, string>,
): void {
  for (const t of traders) {
    for (const p of (t.positions ?? []) as Array<{ symbol?: string; name?: string }>) {
      const name = names.get(String(p.symbol ?? ''))
      if (name) p.name = name
    }
    for (const j of (t.judgments ?? []) as Array<{ symbol?: string | null; name?: string }>) {
      const name = names.get(String(j.symbol ?? ''))
      if (name) j.name = name
    }
  }
}
