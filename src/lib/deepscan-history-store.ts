// 딥스캔 기록 원장(IO) — 서비스 롤로만 접근하는 서버 전용 모듈.
// deepscan-snapshot-store와 같은 경계 규칙: 클라이언트 번들이 이 파일을
// import하지 않는다(스냅샷 스토어 상단 주석 참조).
//
// 저장 원칙:
// - 스캔 성공 시마다 append — 실패해도 스캔 성공 응답에는 영향을 주지 않는다
// - 보존: 유저당 최근 HISTORY_RETENTION_PER_USER건 — 삽입 후 초과분을 prune
//   (payload가 개인화 데이터라 무한 증가를 허용하지 않는다)

import { createClient } from '@supabase/supabase-js'
import { isCanonicalPayload } from '@/lib/deepscan-canonical'
import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

export const HISTORY_RETENTION_PER_USER = 30

export type DeepScanHistoryListRow = {
  id: string
  targetKey: string
  market: string | null
  stockName: string | null
  targetInput: unknown
  chargedCredits: number
  scannedAt: string
}

export type DeepScanHistoryDetailRow = DeepScanHistoryListRow & {
  payload: JarooDeepScanPayload
  priceBasis: number | null
}

function createHistoryServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** 기록 저장(append + 유저당 보존 한도 prune) — 실패해도 스캔 성공 응답에는 영향을 주지 않는다. */
export async function recordScanHistory(input: {
  userId: string
  targetKey: string
  market?: string | null
  stockName?: string | null
  targetInput: unknown
  payload: JarooDeepScanPayload
  priceBasis: number | null
  chargedCredits: number
}): Promise<boolean> {
  const client = createHistoryServiceClient()
  if (!client) return false

  const { error } = await client.from('deepscan_scan_history').insert({
    user_id: input.userId,
    target_key: input.targetKey,
    market: input.market ?? null,
    stock_name: input.stockName ?? null,
    target_input: input.targetInput,
    payload: input.payload,
    price_basis: input.priceBasis,
    charged_credits: input.chargedCredits,
    scanned_at: new Date().toISOString(),
  })
  if (error) {
    console.error('[deepscan-history] record failed', { targetKey: input.targetKey, error: error.message })
    return false
  }

  void pruneScanHistory(client, input.userId)
  return true
}

/** 보존 한도 초과분 삭제 — 삽입 경로 뒤에서 조용히 실행한다(실패는 다음 삽입에서 재시도). */
async function pruneScanHistory(
  client: NonNullable<ReturnType<typeof createHistoryServiceClient>>,
  userId: string,
): Promise<void> {
  const { data: overflow, error } = await client
    .from('deepscan_scan_history')
    .select('id')
    .eq('user_id', userId)
    .order('scanned_at', { ascending: false })
    .range(HISTORY_RETENTION_PER_USER, HISTORY_RETENTION_PER_USER + 49)
  if (error || !overflow || overflow.length === 0) {
    return
  }
  const { error: deleteError } = await client
    .from('deepscan_scan_history')
    .delete()
    .in('id', overflow.map((row) => row.id))
  if (deleteError) {
    console.error('[deepscan-history] prune failed', { userId, error: deleteError.message })
  }
}

/** 기록 목록 — payload는 내리지 않고 복원에 필요한 target_input까지만. */
export async function listScanHistory(
  userId: string,
  limit = 20,
): Promise<DeepScanHistoryListRow[] | null> {
  // 방어 클램프 — 라우트가 이미 1..50으로 정규화하지만 향후 호출처를 위해 내부에서도 강제한다.
  const safeLimit = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), 50) : 20
  const client = createHistoryServiceClient()
  if (!client) return null

  const { data, error } = await client
    .from('deepscan_scan_history')
    .select('id, target_key, market, stock_name, target_input, charged_credits, scanned_at')
    .eq('user_id', userId)
    .order('scanned_at', { ascending: false })
    .limit(safeLimit)
  if (error) {
    console.error('[deepscan-history] list failed', { userId, error: error.message })
    return null
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    targetKey: String(row.target_key ?? ''),
    market: row.market ?? null,
    stockName: row.stock_name ?? null,
    targetInput: row.target_input ?? null,
    chargedCredits: Number(row.charged_credits ?? 0),
    scannedAt: String(row.scanned_at ?? ''),
  }))
}

/** 기록 단건(id) — 본인 소유만. uuid가 아니거나 없으면 null. */
export async function getScanHistoryById(
  userId: string,
  id: string,
): Promise<DeepScanHistoryDetailRow | null> {
  const trimmed = id.trim()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
  if (!isUuid) return null

  const client = createHistoryServiceClient()
  if (!client) return null

  const { data, error } = await client
    .from('deepscan_scan_history')
    .select('id, target_key, market, stock_name, target_input, payload, price_basis, charged_credits, scanned_at')
    .eq('user_id', userId)
    .eq('id', trimmed)
    .maybeSingle()
  if (error || !data) return null
  if (!isCanonicalPayload(data.payload)) return null

  return {
    id: String(data.id),
    targetKey: String(data.target_key ?? ''),
    market: data.market ?? null,
    stockName: data.stock_name ?? null,
    targetInput: data.target_input ?? null,
    payload: data.payload,
    priceBasis: Number.isFinite(Number(data.price_basis)) ? Number(data.price_basis) : null,
    chargedCredits: Number(data.charged_credits ?? 0),
    scannedAt: String(data.scanned_at ?? ''),
  }
}
