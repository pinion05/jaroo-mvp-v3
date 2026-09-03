// 딥스캔 스냅샷 캐시 — "기본 히트, 명시적 미스" 정책의 서버 구현.
//
// 설계 요점:
// 1. 딥스캔 결과는 사용자 포트폴리오(보유 수량·평단)가 반영된 개인화 결과다.
//    따라서 캐시 키는 종목이 아니라 (user_id, 종목) 이어야 한다.
// 2. 기본 경로(다시 열기)는 스냅샷 히트 — 과금 0, 대기 0.
//    갱신은 오직 명시적 '다시 분석'(refresh=1)으로만 일어난다.
// 3. 무한 캐시의 함정(오래된 분석)은 두 겹으로 막는다:
//    - TTL 24h 안전캡(공시·기술 지표는 일 단위로 의미가 바뀐다)
//    - 가격 드리프트 프로브(무료 시세로 ±5% 이동 감지 → 화면에서 재분석 넛지)
// 4. 저장은 서비스 롤(service_role)만 — RLS deny-all, 클라이언트 직접 접근 불가.

import { createClient } from '@supabase/supabase-js'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { isCanonicalPayload } from '@/lib/deepscan-canonical'
import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

/** 스냅샷 신선도 안전캡. 명시적 refresh 는 TTL과 무관하게 항상 새로 돈다. */
export const DEEPSCAN_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000

/** 드리프트 프로브 임계치(%) — 이 이상 움직이면 재분석 넛지를 띄운다 */
export const DEEPSCAN_PRICE_DRIFT_ALERT_PCT = 5

export type DeepScanSnapshotRow = {
  payload: JarooDeepScanPayload
  scannedAt: string
  chargedCredits: number
  priceBasis: number | null
}

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

function createSnapshotServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** 최근 스냅샷 조회 — 페이로드 형태가 깨졌으면(계약 불일치) 없는 것으로 취급한다. */
export async function lookupDeepScanSnapshot(userId: string, targetKey: string): Promise<DeepScanSnapshotRow | null> {
  const client = createSnapshotServiceClient()
  if (!client) return null

  const { data, error } = await client
    .from('deepscan_snapshots')
    .select('payload, scanned_at, charged_credits, price_basis')
    .eq('user_id', userId)
    .eq('target_key', targetKey)
    .maybeSingle()

  if (error || !data) return null
  if (!isCanonicalPayload(data.payload)) return null

  return {
    payload: data.payload,
    scannedAt: String(data.scanned_at ?? ''),
    chargedCredits: Number(data.charged_credits ?? 0),
    priceBasis: Number.isFinite(Number(data.price_basis)) ? Number(data.price_basis) : null,
  }
}

/** 스냅샷 저장(upsert) — 실패해도 스캔 성공 응답에는 영향을 주지 않는다. */
export async function saveDeepScanSnapshot(input: {
  userId: string
  targetKey: string
  market?: string | null
  payload: JarooDeepScanPayload
  priceBasis: number | null
  chargedCredits: number
}): Promise<boolean> {
  const client = createSnapshotServiceClient()
  if (!client) return false

  const { error } = await client.from('deepscan_snapshots').upsert(
    {
      user_id: input.userId,
      target_key: input.targetKey,
      market: input.market ?? null,
      payload: input.payload,
      price_basis: input.priceBasis,
      charged_credits: input.chargedCredits,
      scanned_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,target_key' },
  )
  if (error) {
    console.error('[deepscan-snapshot] save failed', { targetKey: input.targetKey, error: error.message })
    return false
  }
  return true
}
