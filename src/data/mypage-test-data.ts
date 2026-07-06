// 명시적 테스트 데이터 — 크레딧/결제/관심종목/알림/히스토리 백엔드 구현 전까지 화면 표시용.
// 실제 연동 시 이 파일을 제거하고 API로 교체한다. (C2: 가짜 데이터가 아닌 명시적 테스트 데이터)
export const MYPAGE_TEST_DATA = {
  credit: {
    deepScanLeft: 4,
    scanTotal: 12,
    creditBalance: 1200,
  },
  pro: {
    pricePerMonth: 4900,
  },
  watchlistCount: 3,
  notifications: {
    analysisDone: true,
    plungeAlert: true,
    marketing: false,
  },
  appVersion: 'v1.0.3',
}

// /mypage/watchlist 표시용 테스트 데이터
export const WATCHLIST_TEST_DATA = [
  { name: '삼성전자', market: 'KOSPI', code: '005930', qty: '1주', rate: '+31.5%', dir: 'up' as const, dot: '#E5484D' },
  { name: 'LG디스플레이', market: 'KOSPI', code: '034220', qty: '16주', rate: '+1.3%', dir: 'up' as const, dot: '#E5484D' },
  { name: 'SFA반도체', market: 'KOSDAQ', code: '036540', qty: '23주', rate: '−14.3%', dir: 'down' as const, dot: '#2B6BE6' },
]

// /mypage/history 표시용 테스트 데이터
export const HISTORY_TEST_DATA = [
  { name: 'LG디스플레이', date: '05.28 14:32', label: '강세', labelTone: 'navy' as const, summary: '1–2주 관찰 · 목표가 17,500원', dot: '#E5484D' },
  { name: '삼성전자', date: '05.27 09:15', label: '강세', labelTone: 'navy' as const, summary: '보유 유지 · 상승 여력 충분', dot: '#E5484D' },
  { name: 'SFA반도체', date: '05.26 20:41', label: '관찰', labelTone: 'amber' as const, summary: '추세 이탈 여부 주시 필요', dot: '#2B6BE6' },
]
