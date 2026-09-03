// 딥스캔 스냅샷 저장소(IO) — 서비스 롤로만 접근하는 서버 전용 모듈.
// 순수 정책(TTL·드리프트·키 정규화)은 deepscan-snapshot-policy.ts —
// 클라이언트(page.tsx)는 정책만 import하고 이 파일은 절대 import하지 않는다.
// (supabase-js가 클라이언트 번들로 새어 들어가는 것을 구조적으로 차단)
//
// 저장 원칙:
// - (user_id, 종목) 단위 최신 1행 upsert — 결과는 보유 수량·평단이 반영된 개인화 데이터
// - 읽기는 canonical 재검증을 통과한 경우만 반환(깨진 스냅샷 = 자동 미스)
// - 저장 실패는 스캔 성공 응답에 영향을 주지 않는다

import { createClient } from '@supabase/supabase-js'
import { isCanonicalPayload } from '@/lib/deepscan-canonical'
import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

export type DeepScanSnapshotRow = {
  payload: JarooDeepScanPayload
  scannedAt: string
  chargedCredits: number
  priceBasis: number | null
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

