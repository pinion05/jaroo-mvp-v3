// OCR 게스트 퍼널 비용 보호(이슈 #224 H1). 게스트 체험은 유지하되
// IP별 호출 빈도를 제한해 서버 LLM 키 비용 낭비를 막는다.
//
// 저장소는 프로세스 메모리다. 배포가 단일 인스턴스(Railway 1 replica, 2026-08
// 실측)라 유효하며, 수평 확장 시 Redis 계열 외부 저장소로 교체해야 한다.
// IP는 x-forwarded-for 기반(Railway가 접속 IP로 설정)이며 best-effort 다.

const HOUR_LIMIT = 5
const DAY_LIMIT = 10
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const hits = new Map<string, number[]>()

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export function checkOcrQuota(ip: string, now: number = Date.now()): { allowed: boolean; retryAfterSec: number } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < DAY_MS)
  const hourHits = recent.filter((t) => now - t < HOUR_MS)

  if (recent.length >= DAY_LIMIT) {
    return { allowed: false, retryAfterSec: Math.ceil((recent[0] + DAY_MS - now) / 1000) }
  }
  if (hourHits.length >= HOUR_LIMIT) {
    return { allowed: false, retryAfterSec: Math.ceil((hourHits[0] + HOUR_MS - now) / 1000) }
  }

  recent.push(now)
  hits.set(ip, recent)
  return { allowed: true, retryAfterSec: 0 }
}
