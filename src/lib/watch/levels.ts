import type { JarooDeepScanPayload } from '@/../packages/contracts/src/deepscan'

// 워치 알림 강도·이벤트 게이팅 — #222 §3-6/§5-6 원문 기반 순수 로직.
// 최소(minimal)=층1 핵심+안전 하한선만 / 보통(normal, 기본)=층1 전부+주간 요약 /
// 상세(detail)=층1+급등락 5%. 층3(무관 이벤트)은 어느 단계에서도 발송하지 않는다.

export type WatchAlertLevel = 'minimal' | 'normal' | 'detail'

export const WATCH_ALERT_LEVELS: Array<{ value: WatchAlertLevel; label: string; hint: string }> = [
  { value: 'minimal', label: '안 보고 싶어요', hint: '중대 이슈만 월 1~2회' },
  { value: 'normal', label: '적당히 알려줘요', hint: '공시·변화 + 주 1회 요약' },
  { value: 'detail', label: '다 알고 싶어요', hint: '급등락까지 주 3~5회' },
]

export function normalizeAlertLevel(value: unknown): WatchAlertLevel {
  return value === 'minimal' || value === 'normal' || value === 'detail' ? value : 'normal'
}

/** 안전 하한선(끌 수 없음) — 거래정지·상장폐지 등 중대 공시 키워드. */
const SAFETY_DISCLOSURE_KEYWORDS = ['상장폐지', '거래정지', '감사의견 거절', '의견 거절', '회생절차', '기업구조조정']

export type WatchEventKind = 'safety' | 'disclosure' | 'spike'

export type WatchEvent = {
  kind: WatchEventKind
  /** 이벤트 층 — 1=내 종목 직접(알림 대상), 2=배경(detail만 기록), safety=안전 하한선 */
  layer: 1 | 2 | 'safety'
  title: string
}

export type WatchEventTargets = {
  /** 이 사용자(레벨)에게 발송할 이벤트 */
  events: WatchEvent[]
}

function isSafetyTitle(title: string): boolean {
  return SAFETY_DISCLOSURE_KEYWORDS.some((keyword) => title.includes(keyword))
}

function isDisclosureInsight(item: { sourceLabel?: string; label?: string; title?: string }): boolean {
  return `${item.sourceLabel ?? ''}${item.label ?? ''}${item.title ?? ''}`.includes('공시')
}

function collectDisclosureTitles(payload: JarooDeepScanPayload): string[] {
  const items = payload.insights?.items ?? []
  return items
    .filter((item) => isDisclosureInsight(item))
    .map((item) => String(item.title ?? '').trim())
    .filter(Boolean)
}

export function parsePriceFromText(text: string | undefined | null): number | null {
  if (!text) return null
  const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

/** 어제 대비 오늘의 신규 공시 제목 (층1 이벤트). 이전 스냅샷이 없으면 빈 배열. */
export function findNewDisclosureTitles(today: JarooDeepScanPayload, previous: JarooDeepScanPayload | null): string[] {
  const previousTitles = new Set(collectDisclosureTitles(previous ?? ({ insights: { items: [] } } as unknown as JarooDeepScanPayload)))
  return collectDisclosureTitles(today).filter((title) => !previousTitles.has(title))
}

/** 전일 대비 가격 변화율(%, 부호 있음). 계산 불가 시 null. */
export function priceChangePctBetween(today: JarooDeepScanPayload, previous: JarooDeepScanPayload | null): number | null {
  const todayPrice = parsePriceFromText(today.strategy?.currentPriceText ?? today.recoveryForecast?.currentPriceText)
  const previousPrice = parsePriceFromText(previous?.strategy?.currentPriceText ?? previous?.recoveryForecast?.currentPriceText)
  if (todayPrice == null || previousPrice == null || previousPrice <= 0) return null
  return ((todayPrice - previousPrice) / previousPrice) * 100
}

/**
 * 두 스냅샷을 비교해 이벤트를 뽑는다.
 * - safety: 안전 하한선 공시(모든 레벨 발송)
 * - disclosure: 신규 공시(층1 — normal 이상)
 */
export function detectStockEvents(today: JarooDeepScanPayload, previous: JarooDeepScanPayload | null): WatchEvent[] {
  const events: WatchEvent[] = []
  const newTitles = previous ? findNewDisclosureTitles(today, previous) : []
  for (const title of newTitles) {
    events.push({ kind: isSafetyTitle(title) ? 'safety' : 'disclosure', layer: isSafetyTitle(title) ? 'safety' : 1, title })
  }
  // 이전 스냅샷이 없어도 오늘 새로 수집된 공시 중 안전 키워드는 즉시 안전 이벤트로 본다.
  if (!previous) {
    for (const title of collectDisclosureTitles(today)) {
      if (isSafetyTitle(title)) {
        events.push({ kind: 'safety', layer: 'safety', title })
      }
    }
  }
  return events.filter((event, index, values) => values.findIndex((other) => other.kind === event.kind && other.title === event.title) === index)
}

/** 급등락(detail 전용, 층1의 확장 — 5% 이상). */
export function isSpikeEvent(priceChangePct: number | null): boolean {
  return priceChangePct != null && Math.abs(priceChangePct) >= 5
}

/** 레벨별 발송 게이트 — #222 §3-6 매핑(최소=층1 핵심 / 보통=층1 / 상세=층1+층2급 급등락). */
export function filterEventsForLevel(events: WatchEvent[], level: WatchAlertLevel, priceChangePct: number | null): WatchEventTargets {
  const safety = events.filter((event) => event.layer === 'safety')
  if (level === 'minimal') {
    return { events: safety }
  }
  const disclosure = events.filter((event) => event.layer === 1)
  const spike = level === 'detail' && isSpikeEvent(priceChangePct)
    ? [{ kind: 'spike' as const, layer: 1 as const, title: `가격 ${priceChangePct! > 0 ? '+' : ''}${priceChangePct!.toFixed(1)}% 급등락` }]
    : []
  return { events: [...safety, ...disclosure, ...spike] }
}

/** 주간 요약 발송 대상 — minimal은 주간 요약도 없다(#222 §3-6). */
export function shouldSendWeeklySummary(level: WatchAlertLevel): boolean {
  return level !== 'minimal'
}

export function escapeTelegramHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export type WatchDigestStock = {
  name: string
  priceText: string | null
}

export function buildEventMessage(stockName: string, priceText: string | null, events: WatchEvent[], deepscanUrl: string): string {
  const lines: string[] = []
  const price = priceText ? `현재가 ${escapeTelegramHtml(priceText)}` : null
  for (const event of events) {
    if (event.kind === 'safety') {
      lines.push(`<b>${escapeTelegramHtml(stockName)}</b>`)
      lines.push(`⚠️ 반드시 확인: ${escapeTelegramHtml(event.title)}`)
      if (price) lines.push(price)
      lines.push(`<a href="${deepscanUrl}">딥스캔 결과 보기</a>`)
      lines.push('')
    } else if (event.kind === 'spike') {
      lines.push(`<b>${escapeTelegramHtml(stockName)}</b> ${escapeTelegramHtml(event.title)}`)
      if (price) lines.push(price)
      lines.push(`<a href="${deepscanUrl}">딥스캔 결과 보기</a>`)
      lines.push('')
    } else {
      lines.push(`<b>${escapeTelegramHtml(stockName)}</b> 새 공시가 나왔어요`)
      lines.push(escapeTelegramHtml(event.title))
      if (price) lines.push(price)
      lines.push(`<a href="${deepscanUrl}">딥스캔 결과 보기</a>`)
      lines.push('')
    }
  }
  return lines.join('\n').trim()
}

export type WeeklyStockRow = {
  name: string
  priceText: string | null
  weekChangePct: number | null
  eventCount: number
}

/** 주 1회 요약(템플릿, LLM✗) — normal·detail 대상. 특이사항이 없으면 그렇게 말한다. */
export function buildWeeklySummaryMessage(rows: WeeklyStockRow[], deepscanUrl: string): string {
  const lines: string[] = ['<b>주간 감시 요약</b>']
  const eventRows = rows.filter((row) => row.eventCount > 0)
  for (const row of rows) {
    const change = row.weekChangePct == null ? '' : ` (${row.weekChangePct > 0 ? '+' : ''}${row.weekChangePct.toFixed(1)}%)`
    const note = row.eventCount > 0 ? `이번 주 이벤트 ${row.eventCount}건` : '특이사항 없음'
    lines.push(`· ${escapeTelegramHtml(row.name)} ${row.priceText ? escapeTelegramHtml(row.priceText) : ''}${change} — ${note}`)
  }
  if (eventRows.length === 0) {
    lines.push('')
    lines.push('이번 주는 특이사항 없었어요.')
  }
  lines.push(`<a href="${deepscanUrl}">딥스캔에서 확인하기</a>`)
  return lines.join('\n')
}
