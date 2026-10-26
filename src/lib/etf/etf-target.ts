// /etf 페이지 진입 타깃 복원 + ETF/ETN 가드 (스펙 2026-09-15 D3 · 2026-09-16 미국 ETF 확장).
// 우선순위: URL query → sessionStorage 딥스캔 타깃 세션(jaroo:deepscan-target).
// query가 비어 있고 세션도 없으면 empty(안내 상태), 종목이 ETF/ETN이 아니면 invalid.
// 한국: 6자리 코드(kospi/kosdaq) · 미국: 1~5자 티커(market 'us').
// ETN 수용(런타임 실측 시나리오 #2): /etf?code=530092가 '한국 상장 ETF만 분석할 수
// 있어요' invalid 카드가 아니라 ETN 프로필(발행사·기초지수·보수)을 렌더한다. ETF
// 조회 기록 원장 오염은 웹 쓰기 경로(appendEtfHistory→isEtfLedgerPayload)가 차단한다.

export type EtfPageTargetMarket = 'kr' | 'us'

export type EtfPageTarget =
  | { status: 'ok'; code: string; market: EtfPageTargetMarket; name: string; holding: { shares: number; averagePrice: number } | null }
  | { status: 'invalid' }
  | { status: 'empty' }

const KR_ETF_CODE = /^\d{6}$/
const US_ETF_SYMBOL = /^[A-Za-z]{1,5}$/

// market 값 허용집합: 홈 홀딩의 marketTone/'etf'와 canonical query의 market 표기를 모두 받는다.
// 'etn' — ETN 종목의 market 표기(유니버스 market 'ETN' 소문자화)도 교환상품 타깃으로 받는다.
const KR_MARKETS = new Set(['kospi', 'kosdaq', 'kr', 'etf', 'etn', ''])
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

  // KR 교환상품 kind 허용: 'etf'·'etn'·무표기(bare /etf?code=...). 주식('stock')과
  // 그 외 값은 조기 invalid다.
  if (code || ticker || kind) {
    const isKrEtf = KR_ETF_CODE.test(code) && (kind === '' || kind === 'etf' || kind === 'etn') && KR_MARKETS.has(market) && !ticker
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
  // 세션(딥스캔 타깃)은 교환상품 'etf'·'etn'만 타깃으로 받는다 — 주식 세션은 invalid.
  if (sessionKind !== 'etf' && sessionKind !== 'etn') {
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
