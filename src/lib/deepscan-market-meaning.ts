// '오늘 시장 속에서는?' 브리핑 문구 — 시장 방향(상승/하락/혼조/횡보) × 내 종목 방향 ×
// 격차(시장 평균 대비 %p)로 분기하는 순수 로직. 컴포넌트와 무관하게 단독 테스트한다.
//
// 2026-11-02: 기존 5분기('덜 따라온 상태예요' 포함)를 24분기 매트릭스로 확장.
// 코스피 +1.5%·코스닥 +1.3%·내 종목 −10.24% 같은 정반대 흐름이 '아직 덜 따라온'
// (곧 따라올 것 같은 뉘앙스)으로 표시되던 문제를 '시장 대비 약세' 계열 문구로 교정.
// 지수명(코스피/S&P 500)은 시장별로 달라 문구에는 넣지 않는다(중립 표기).

export const MARKET_MEANING_THRESHOLDS = Object.freeze({
  /** 이 범위 이내는 '제자리'로 본다 (지수·종목 공용, %) */
  flatPct: 0.2,
  /** 시장 대비 유의미한 격차 (%p) */
  gapPct: 0.5,
  /** 크게 벌어진 격차 (%p) */
  bigGapPct: 3,
  /** 종목 급등/급락 기준 (%) */
  bigMovePct: 5,
})

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function buildMarketMeaning(firstPct: number | null, secondPct: number | null, stockPct: number | null): string {
  if (!isFiniteNumber(stockPct)) {
    return '내 종목의 장중 등락률을 확인하는 중이에요.'
  }

  const marketValues = [firstPct, secondPct].filter(isFiniteNumber)
  if (marketValues.length === 0) {
    return '시장 지수와 내 종목 흐름을 맞춰 보는 중이에요.'
  }

  const { flatPct, gapPct, bigGapPct, bigMovePct } = MARKET_MEANING_THRESHOLDS
  const marketAverage = marketValues.reduce((sum, value) => sum + value, 0) / marketValues.length
  const gap = stockPct - marketAverage
  const isStockUp = stockPct > flatPct
  const isStockDown = stockPct < -flatPct

  // 혼조장 — 두 지수가 유의미하게 반대 방향일 때는 평균이 무의미하므로 방향 갈림을 먼저 안내한다.
  if (
    marketValues.length === 2
    && ((marketValues[0] >= flatPct && marketValues[1] <= -flatPct) || (marketValues[0] <= -flatPct && marketValues[1] >= flatPct))
  ) {
    if (isStockUp) return '지수마다 방향이 갈린 날이에요. 내 종목은 오르는 쪽이에요.'
    if (isStockDown) return '지수마다 방향이 갈린 날이에요. 내 종목은 내리는 쪽이에요.'
    return '지수마다 방향이 갈린 날이에요. 내 종목은 제자리예요.'
  }

  // 시장 상승
  if (marketAverage >= flatPct) {
    if (isStockUp) {
      if (stockPct >= bigMovePct && gap >= 0) return '시장 오르는 흐름을 앞서며 크게 뛰고 있어요.'
      if (gap >= bigGapPct) return '시장보다 한층 강하게 오르고 있어요.'
      if (gap >= gapPct) return '시장보다 앞서 오르고 있어요.'
      if (gap > -gapPct) return '시장 오름세를 곧잘 따라가고 있어요.'
      return '시장 오르는 흐름을 다 따라가지 못했어요.'
    }
    if (isStockDown) {
      if (stockPct <= -bigMovePct) return '시장이 오르는 동안 혼자 크게 내려갔어요. 시장 대비 뚜렷한 약세예요.'
      return '시장은 오르는데 혼자 내려가고 있어요. 시장 대비 약세예요.'
    }
    return '시장은 오르는데 내 종목은 제자리에 있어요.'
  }

  // 시장 하락
  if (marketAverage <= -flatPct) {
    if (isStockUp) return '시장이 내리는 가운데 거꾸로 오르고 있어요. 시장 대비 강세예요.'
    if (isStockDown) {
      if (gap <= -bigGapPct) return '시장보다 훨씬 크게 내려가고 있어요. 시장 대비 약세예요.'
      if (gap <= -gapPct) return '시장 하락을 더 크게 받고 있어요.'
      if (gap >= gapPct) return '시장 하락 속에서도 비교적 버티고 있어요.'
      return '시장 하락을 함께 받고 있어요.'
    }
    return '시장이 내리는 동안에도 잘 버티고 있어요.'
  }

  // 시장 횡보
  if (isStockUp) {
    if (stockPct >= 1) return '조용한 시장에서 혼자 오르고 있어요.'
    return '조용한 시장에서 살짝 오르고 있어요.'
  }
  if (isStockDown) {
    if (stockPct <= -1) return '조용한 시장에서 혼자 내려가고 있어요.'
    return '조용한 시장에서 살짝 내려가고 있어요.'
  }
  return '시장도 내 종목도 조용한 흐름이에요.'
}
