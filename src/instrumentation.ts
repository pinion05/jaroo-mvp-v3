// Next.js 서버 인스턴스 기동 시 1회 호출되는 훅.
// Railway 단일 컨테이너의 상주 프로세스이므로 여기서 워치 감시 배치 스케줄러를 띄운다.
// 개발(dev) 환경에서는 자동 실행하지 않는다 — 수동 트리거는
//   curl -X POST -H "Authorization: Bearer $WATCH_BATCH_SECRET" .../api/watch/batch/tick

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return
  }
  if (process.env.NODE_ENV !== 'production') {
    return
  }
  const mod = await import('@/lib/watch/scheduler')
  mod.startWatchScheduler()
}
