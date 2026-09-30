// 딥스캔 스냅샷 정책 — 클라이언트가 import해도 안전한 순수 함수만 둔다.
// (서비스 롤 IO는 deepscan-snapshot-store.ts — 절대 이 파일을 import하지 않는다.
//  이 분리가 없으면 page.tsx가 supabase-js를 클라이언트 번들로 끌어들인다.)
//
// 정책 요점:
// - 기본 경로(재열람)는 스냅샷 히트 — 과금 0, 대기 0. 갱신은 명시적 refresh=1만.
// - 무한 캐시 방어 2겹: TTL 24h 안전캡 + 가격 드리프트 프로브(±5%).

import { parseOcrNumber } from '@/lib/screenshot-ocr'
import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

/** 스냅샷 신선도 안전캡. 명시적 refresh 는 TTL과 무관하게 항상 새로 돈다. */
export const DEEPSCAN_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000

/** 드리프트 프로브 임계치(%) — 이 이상 움직이면 재분석 넛지를 띄운다 */
export const DEEPSCAN_PRICE_DRIFT_ALERT_PCT = 5

export function resolveDeepScanSnapshotKey(input: { code?: string | null; ticker?: string | null }): string | null {
  const code = input.code?.trim()
  if (code) return code
  const ticker = input.ticker?.trim().toUpperCase()
  return ticker || null
}

/** 스냅샷 저장용 가격 기준 — payload 전략 블록의 현재가 문구에서 추출 */
export function extractSnapshotPriceBasis(payload: JarooDeepScanPayload | null | undefined): number | null {
  const priceText = payload?.strategy?.currentPriceText
  if (typeof priceText !== 'string' || !priceText.trim()) return null
  const parsed = parseOcrNumber(priceText)
  if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export function isSnapshotFresh(scannedAt: string, nowMs: number = Date.now(), ttlMs: number = DEEPSCAN_SNAPSHOT_TTL_MS): boolean {
  const scannedMs = Date.parse(scannedAt)
  if (!Number.isFinite(scannedMs)) return false
  return nowMs - scannedMs < ttlMs
}

/**
 * 가격 드리프트(%) — 부호 유지. 기준가가 없거나 0 이하면 null.
 * 화면은 절댓값으로 임계 비교, 부호로 상승/하락 표기한다.
 */
export function computePriceDriftPct(basis: number | null | undefined, live: number | null | undefined): number | null {
  if (!Number.isFinite(Number(basis)) || !Number.isFinite(Number(live))) return null
  const b = Number(basis)
  const l = Number(live)
  if (b <= 0 || l <= 0) return null
  return ((l - b) / b) * 100
}

/** 캐시 히트 응답용 페이로드 — metadata.deepScanCache 표식을 얹은 복사본 */
export function buildSnapshotCacheAnnotatedPayload(
  payload: JarooDeepScanPayload,
  snapshot: { scannedAt: string; chargedCredits: number },
): JarooDeepScanPayload {
  return {
    ...payload,
    metadata: {
      ...payload.metadata,
      deepScanCache: {
        hit: true,
        scannedAt: snapshot.scannedAt,
        savedCredits: snapshot.chargedCredits > 0 ? snapshot.chargedCredits : undefined,
      },
    },
  }
}
