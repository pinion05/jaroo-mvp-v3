// /etf 페이지 진입 타깃 복원 + ETF 가드 (스펙 2026-09-15 D3 · 2026-09-16 미국 ETF 확장).
// 우선순위: URL query → sessionStorage 딥스캔 타깃 세션(jaroo:deepscan-target).
// query가 비어 있고 세션도 없으면 empty(안내 상태), 종목이 ETF가 아니면 invalid.
// 한국: 6자리 코드(kospi/kosdaq) · 미국: 1~5자 티커(market 'us').

export type EtfPageTargetMarket = 'kr' | 'us'

export type EtfPageTarget =
  | { status: 'ok'; code: string; market: EtfPageTargetMarket; name: string; holding: { shares: number; averagePrice: number } | null }
  | { status: 'invalid' }
  | { status: 'empty' }

const KR_ETF_CODE = /^\d{6}$/
const US_ETF_SYMBOL = /^[A-Za-z]{1,5}$/

// market 값 허용집합: 홈 홀딩의 marketTone/'etf'와 canonical query의 market 표기를 모두 받는다.
const KR_MARKETS = new Set(['kospi', 'kosdaq', 'kr', 'etf', ''])
const US_MARKETS = new Set(['us', 'usa', 'america', 'nyse', 'nasdaq', 'etf', ''])

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
    if (isKrEtf) {
      const averagePrice = toFinitePositiveNumber(query.get('averagePrice'))
      const shares = toFinitePositiveNumber(query.get('shares'))
      return {
        status: 'ok',
        code,
        market: 'kr',
        name: query.get('name')?.trim() || code,
        holding: averagePrice && shares ? { shares, averagePrice } : null,
      }
    }
    // 미국: ?symbol=VOO(+kind=etf) 또는 code가 티커 형태. ticker 파라미터도 받는다.
    const usSymbol = (query.get('symbol')?.trim() || (US_ETF_SYMBOL.test(code) ? code : '') || (US_ETF_SYMBOL.test(ticker) ? ticker : '')).toUpperCase()
    const isUsEtf =
      US_ETF_SYMBOL.test(usSymbol) && (kind === '' || kind === 'etf') && US_MARKETS.has(market)
    if (isUsEtf) {
      const averagePrice = toFinitePositiveNumber(query.get('averagePrice'))
      const shares = toFinitePositiveNumber(query.get('shares'))
      return {
        status: 'ok',
        code: usSymbol,
        market: 'us',
        name: query.get('name')?.trim() || usSymbol,
        holding: averagePrice && shares ? { shares, averagePrice } : null,
      }
    }
    return { status: 'invalid' }
  }

  const session = input.readSession()
  if (!session) {
    return { status: 'empty' }
  }

  const sessionCode = String(session.code ?? '')
  const sessionKind = String(session.kind ?? 'etf')
  if (sessionKind !== 'etf') {
    return { status: 'invalid' }
  }
  if (KR_ETF_CODE.test(sessionCode)) {
    const holdingInput = session.holding as { shares?: unknown; averagePrice?: unknown } | undefined
    return {
      status: 'ok',
      code: sessionCode,
      market: 'kr',
      name: String(session.name ?? sessionCode),
      holding: parseHolding(holdingInput?.shares, holdingInput?.averagePrice),
    }
  }
  // 미국 홀딩 — code 대신 대문자 티커가 내려온다(page-model이 identifierTicker에서 채운다)
  if (US_ETF_SYMBOL.test(sessionCode)) {
    const holdingInput = session.holding as { shares?: unknown; averagePrice?: unknown } | undefined
    return {
      status: 'ok',
      code: sessionCode.toUpperCase(),
      market: 'us',
      name: String(session.name ?? sessionCode),
      holding: parseHolding(holdingInput?.shares, holdingInput?.averagePrice),
    }
  }
  return { status: 'invalid' }
}
