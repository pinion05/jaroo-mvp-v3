// 스펙 jaroo_dev_spec_v7.md §4 — 인트로(손익 동적 멘트). 종목명 + 손익 상황 한 줄, 금액 없이.
//
// 2축 판정:
//   ① 종목 손익률(profitAmount / costBasis) — 화면 헤더에 크게 보이는 '현재가 기준 ±%'와
//      일치해야 하는 축. 이 축이 문구의 '상황'을 결정한다.
//   ② 전체 대비 충격(profitAmount / portfolioTotal) — 비중에 따라 톤(강도)을 조절한다.
//      비중이 작으면 가볍게, 크면 무겁게.
//
// 2026-11-02: 종목 자체 −50%(SOOP 사례)인데 전체 비중이 작다는 이유로 "거의 본전이네요"가
// 뜨던 모순을 교정했다. "거의 본전"은 이제 종목 손익률이 −3~+3%일 때만 말한다.
// 원금(costBasis)을 알 수 없는 호출은 기존 5단계(전체 대비 충격 기준)로 폴백한다.
export function buildProfitIntroMention(input: {
  name: string
  profitAmount: number
  portfolioTotal: number
  /** 이 종목의 매입 원금 — 종목 손익률 계산에 쓴다. 없으면 전체 대비 충격 기준으로 폴백. */
  costBasis?: number
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
  // 강도 판정은 절대값으로 — 하락 충격은 음수로 나오므로 양수 문턱과 그대로 비교하면 안 된다.
  const weight = Math.abs(shock)
  const stockRate = typeof input.costBasis === 'number' && Number.isFinite(input.costBasis) && input.costBasis > 0
    ? (profitAmount / input.costBasis) * 100
    : null

  // 폴백 — 원금을 모르면 기존 5단계(전체 대비 충격 기준)
  if (stockRate === null) {
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

  // 큰 수익(종목 +20%↑) — 전체를 끌어올리는 수준이면 그 공을 인정한다.
  if (stockRate >= 20) {
    return weight >= 10 ? `${name}, 포트폴리오를 크게 끌어올렸네요` : `${name}, 꽤 오르셨네요`
  }

  // 수익(+3~+20%) — 비중이 커서 실감 나면 '쌓이고 있어요'.
  if (stockRate >= 3) {
    return weight >= 3 ? `${name}, 수익이 쌓이고 있어요` : `${name}, 수익 구간이에요`
  }

  // 본전 근처(−3~+3%) — "거의 본전"은 오직 이 구간에서만.
  if (stockRate > -3) {
    return `${name}, 거의 본전이네요`
  }

  // 소폭 하락(−3~−15%) — 비중이 크면 '눈에 띄게'.
  if (stockRate > -15) {
    return weight >= 3 ? `${name}, 눈에 띄게 빠졌네요` : `${name}, 조금 빠졌네요`
  }

  // 큰 하락(−15~−40%) — 비중에 따라 3단계.
  if (stockRate > -40) {
    if (weight >= 15) {
      return `${name}, 부담이 큰 하락이네요`
    }
    return weight >= 3 ? `${name}, 많이 빠졌네요` : `${name}, 많이 내려온 종목이에요`
  }

  // 깊은 하락(−40%↓) — 절반 가까이 내려앉은 상태. '본전' 언어는 쓰지 않는다.
  if (weight >= 15) {
    return `${name}, 정말 쉽지 않은 구간이네요`
  }
  return weight >= 3 ? `${name}, 깊은 하락을 겪고 있네요` : `${name}, 깊이 내려앉은 종목이에요`
}
