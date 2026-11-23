// KRX 정규장 시간 게이트 — '당일 거래량 0 → 거래 정지' 오탐 방지용(이슈 #276 후속).
//
// 왜 필요한가: 네이버 일별 시세 행이 장전(08:00~08:02경) 거래일 롤오버로 새로 생성되면서
// 정상 종목도 '당일 행 + 거래량 0'이 된다. 개장 직후 무체결 종목도 마찬가지. 즉 거래량 0만으로는
// "정지"와 "아직 거래 없음"을 구분할 수 없으므로, 거래량 폴백 판정은 정규장 시간대로 제한한다.
// 정규장 밖의 거래량 0은 '거래 정지'가 아니라 중립(판단 보류)으로 다룬다.
//
// 판정 기준: 대한민국 표준시(KST, Asia/Seoul) 기준 월~금 09:00:00 ~ 15:30:00(경계 포함).
// 시각·요일 모두 Intl.DateTimeFormat(timeZone: 'Asia/Seoul')로 산출한다 — 서버 타임존과
// 무관하게 동작해야 하므로 UTC getDay/getHours를 직접 쓰지 않는다.

const KST_MARKET_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const KR_MARKET_OPEN_MINUTES = 9 * 60
const KR_MARKET_CLOSE_MINUTES = 15 * 60 + 30

export function isKrRegularMarketWindow(now: Date = new Date()): boolean {
  const parts = KST_MARKET_PARTS_FORMATTER.formatToParts(now)
  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  const weekday = partValue('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false
  }

  const hour = Number(partValue('hour'))
  const minute = Number(partValue('minute'))
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    // 시각 산출 실패 시 오탐 차단이 우선이므로 정규장 밖으로 판정한다(중립 톤 유지).
    return false
  }

  const minutesOfDay = hour * 60 + minute
  return minutesOfDay >= KR_MARKET_OPEN_MINUTES && minutesOfDay <= KR_MARKET_CLOSE_MINUTES
}
