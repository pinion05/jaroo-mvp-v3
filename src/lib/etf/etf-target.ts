// /etf 페이지 진입 타깃 복원 + 한국 상장 ETF 가드 (스펙 2026-09-15 D3).
// 우선순위: URL query → sessionStorage 딥스캔 타깃 세션(jaroo:deepscan-target).
// query가 비어 있고 세션도 없으면 empty(안내 상태), 종목이 ETF가 아니면 invalid.

export type EtfPageTarget =
  | { status: 'ok'; code: string; name: string; holding: { shares: number; averagePrice: number } | null }
  | { status: 'invalid' }
  | { status: 'empty' }

const KR_ETF_CODE = /^\d{6}$/

// market 값 허용집합: 홈 홀딩의 marketTone/'etf'와 canonical query의 market 표기를 모두 받는다.
const KR_MARKETS = new Set(['kospi', 'kosdaq', 'kr', 'etf', ''])

export type EtfTargetSessionLike = {
  code?: unknown
  name?: unknown
  market?: unknown
  kind?: unknown
  holding?: unknown
}

function toFinitePositiveNumber(value: string | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseHolding(shares: unknown, averagePrice: unknown): { shares: number; averagePrice: number } | null {
  const sharesNumber = Number(shares)
  const averagePriceNumber = Number(averagePrice)
  if (!Number.isFinite(sharesNumber) || sharesNumber <= 0) return null
  if (!Number.isFinite(averagePriceNumber) || averagePriceNumber <= 0) return null
  return { shares: sharesNumber, averagePrice: averagePriceNumber }
}

export function resolveEtfPageTarget(input: {
  searchParams: URLSearchParams
  readSession: () => EtfTargetSessionLike | null
}): EtfPageTarget {
  const query = input.searchParams
  const code = query.get('code')?.trim() ?? ''
  const ticker = query.get('ticker')?.trim() ?? ''
  const kind = (query.get('kind') ?? '').trim().toLowerCase()
  const market = (query.get('market') ?? '').trim().toLowerCase()

  if (code || ticker || kind) {
    const isKrEtf = KR_ETF_CODE.test(code) && (kind === '' || kind === 'etf') && KR_MARKETS.has(market) && !ticker
    if (!isKrEtf) {
      return { status: 'invalid' }
    }
    const averagePrice = toFinitePositiveNumber(query.get('averagePrice'))
    const shares = toFinitePositiveNumber(query.get('shares'))
    return {
      status: 'ok',
      code,
      name: query.get('name')?.trim() || code,
      holding: averagePrice && shares ? { shares, averagePrice } : null,
    }
  }

  const session = input.readSession()
  if (!session) {
    return { status: 'empty' }
  }

  const sessionCode = String(session.code ?? '')
  const sessionKind = String(session.kind ?? 'etf')
  if (!KR_ETF_CODE.test(sessionCode) || sessionKind !== 'etf') {
    return { status: 'invalid' }
  }

  const holdingInput = session.holding as { shares?: unknown; averagePrice?: unknown } | undefined
  return {
    status: 'ok',
    code: sessionCode,
    name: String(session.name ?? sessionCode),
    holding: parseHolding(holdingInput?.shares, holdingInput?.averagePrice),
  }
}
