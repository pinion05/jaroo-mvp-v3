// 명시적 테스트 데이터 — 크레딧/결제/알림 백엔드 구현 전까지 mypage 화면 표시용.
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
