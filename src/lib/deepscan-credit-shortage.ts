import { DEEPSCAN_CREDIT_COST } from '@/lib/payments/products'

// 딥스캔 크레딧 부족(402 insufficient-credits) 안내 — 친절한 예외 화면용 문구·수치 계산.
// 오류가 아니라 '이용권이 모자란 상태'임을 사용자에게 설명하는 게 목적이다.

export type CreditShortageFacts = {
  cost: number
  balance: number
  shortfall: number
  needText: string
  haveText: string
  shortfallText: string
  headline: string
  body: string
}

/** 서버 402 상세(필요/잔여)를 안내 문구로 바꾼다. 값이 없으면 기본 정책값으로 설명한다. */
export function buildCreditShortageFacts(cost: number | null, balance: number | null): CreditShortageFacts {
  const resolvedCost = cost != null && cost > 0 ? cost : DEEPSCAN_CREDIT_COST
  const resolvedBalance = balance != null && balance > 0 ? balance : 0
  const shortfall = Math.max(0, resolvedCost - resolvedBalance)

  return {
    cost: resolvedCost,
    balance: resolvedBalance,
    shortfall,
    needText: `${resolvedCost.toLocaleString()}크레딧`,
    haveText: resolvedBalance > 0 ? `${resolvedBalance.toLocaleString()}크레딧` : '0크레딧',
    shortfallText: `${shortfall.toLocaleString()}크레딧`,
    headline: '크레딧이 살짝 모자라요',
    body:
      `딥스캔 한 번을 돌리려면 ${resolvedCost.toLocaleString()}크레딧이 필요해요. ` +
      `지금은 ${resolvedBalance.toLocaleString()}크레딧이 남아 있어서 분석이 시작되지 않은 것뿐이에요. ` +
      '종목이나 데이터에 문제가 생긴 게 아니니 걱정하지 않으셔도 돼요. 크레딧을 채우면 바로 다시 분석할 수 있어요.',
  }
}
