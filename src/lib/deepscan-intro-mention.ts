// 스펙 jaroo_dev_spec_v7.md §4 — 인트로(손익 5단계 동적).
// 종목명 + 손익 상황 한 줄, 금액 없이 상황만.
// 판정 기준 = 전체 자산 대비 충격(손익액 / 전체 포트폴리오 평가액). 종목 손익률 아님.
// (종목 −10%여도 전체 비중 작으면 가벼운 톤)
//
// 경계 해석: 스펙 표가 "+3~20%"와 "−3~+3%"에서 +3%를 공유(모호)하므로
// 상단 경계 포함(r >= 3 → 수익 구간)으로 채택. 나머지 구간 동일 규칙 적용.
export function buildProfitIntroMention(input: {
  name: string
  profitAmount: number
  portfolioTotal: number
}): string | null {
  const { name, profitAmount, portfolioTotal } = input

  if (
    !name.trim()
    || !Number.isFinite(profitAmount)
    || !Number.isFinite(portfolioTotal)
    || portfolioTotal <= 0
  ) {
    return null
  }

  const shock = (profitAmount / portfolioTotal) * 100

  if (shock >= 20) {
    return `${name}, 꽤 오르셨네요`
  }
  if (shock >= 3) {
    return `${name}, 수익 구간이에요`
  }
  if (shock > -3) {
    return `${name}, 거의 본전이네요`
  }
  if (shock > -15) {
    return `${name}, 조금 빠졌네요`
  }
  return `${name}, 쉽지 않은 구간이네요`
}
