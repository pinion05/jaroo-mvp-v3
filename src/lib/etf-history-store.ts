// ETF 조회 기록 원장(IO) — 서비스 롤로만 접근하는 서버 전용 모듈.
// deepscan-history-store와 같은 경계 규칙: 클라이언트 번들이 이 파일을
// import하지 않는다(상단 주석 참조). payload 계약만 다르다 —
// deepscan은 isCanonicalPayload(JarooDeepScanPayload), ETF는 아래
// isEtfLedgerPayload(jaroo-etf-profile-v1)가 진실 소스다.
//
// 저장 원칙(deepscan 원장과 동일):
// - /api/etf/profile 조회 성공 시마다 append — 기록 실패해도 조회 응답에는 영향을 주지 않는다
// - 보존: 유저당 최근 ETF_HISTORY_RETENTION_PER_USER건 — 삽입 후 초과분을 prune

import { createClient } from '@supabase/supabase-js'
import type { EtfProfileJson } from './etf/etf-view-model'

export const ETF_HISTORY_RETENTION_PER_USER = 30

export type EtfHistoryListRow = {
  id: string
  targetKey: string
  market: string | null
  stockName: string | null
  targetInput: unknown
  chargedCredits: number
  scannedAt: string
}

export type EtfHistoryDetailRow = EtfHistoryListRow & {
  payload: EtfProfileJson
  priceBasis: number | null
}

/** 원장 payload 판별 — jaroo-etf-profile-v1 계약을 충족하는지(읽기 경로 가드). */
export function isEtfLedgerPayload(payload: unknown): payload is EtfProfileJson {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Partial<EtfProfileJson>
  return (
    candidate.schemaVersion === 'jaroo-etf-profile-v1' &&
    candidate.ok === true &&
    typeof candidate.code === 'string' &&
    candidate.code.trim().length > 0 &&
    typeof candidate.name === 'string' &&
    (candidate.market === 'kospi' || candidate.market === 'kosdaq')
  )
}

/** 기준가(원장 price_basis) — 일봉 마지막 종가. 일봉이 비면 null. */
export function resolveEtfPriceBasis(profile: EtfProfileJson): number | null {
  const last = profile.daily?.[profile.daily.length - 1]
  return typeof last?.close === 'number' && Number.isFinite(last.close) ? last.close : null
}

function createEtfHistoryServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** 기록 저장(append + 유저당 보존 한도 prune) — 실패해도 조회 응답에는 영향을 주지 않는다. */
export async function recordEtfHistory(input: {
  userId: string
  profile: EtfProfileJson
}): Promise<boolean> {
  const client = createEtfHistoryServiceClient()
  if (!client) return false

  const { error } = await client.from('etf_scan_history').insert({
    user_id: input.userId,
    target_key: input.profile.code,
    market: input.profile.market,
    stock_name: input.profile.name,
    target_input: { code: input.profile.code },
    payload: input.profile,
    price_basis: resolveEtfPriceBasis(input.profile),
    charged_credits: 0, // ETF 열람은 무과금(공개 시세성 데이터)
    scanned_at: new Date().toISOString(),
  })
  if (error) {
    console.error('[etf-history] record failed', { targetKey: input.profile.code, error: error.message })
    return false
  }

  void pruneEtfHistory(client, input.userId)
  return true
}

/** 보존 한도 초과분 삭제 — 삽입 경로 뒤에서 조용히 실행한다(실패는 다음 삽입에서 재시도). */
async function pruneEtfHistory(
  client: NonNullable<ReturnType<typeof createEtfHistoryServiceClient>>,
  userId: string,
): Promise<void> {
  const { data: overflow, error } = await client
    .from('etf_scan_history')
    .select('id')
    .eq('user_id', userId)
    .order('scanned_at', { ascending: false })
    .range(ETF_HISTORY_RETENTION_PER_USER, ETF_HISTORY_RETENTION_PER_USER + 49)
  if (error || !overflow || overflow.length === 0) {
    return
  }
  const { error: deleteError } = await client
    .from('etf_scan_history')
    .delete()
    .in('id', overflow.map((row) => row.id))
  if (deleteError) {
    console.error('[etf-history] prune failed', { userId, error: deleteError.message })
  }
}

/** 기록 목록 — payload는 내리지 않고 재진입에 필요한 target_input까지만. */
export async function listEtfHistory(
  userId: string,
  limit = 20,
): Promise<EtfHistoryListRow[] | null> {
  // 방어 클램프 — 라우트가 이미 1..50으로 정규화하지만 향후 호출처를 위해 내부에서도 강제한다.
  const safeLimit = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), 50) : 20
  const client = createEtfHistoryServiceClient()
  if (!client) return null

  const { data, error } = await client
    .from('etf_scan_history')
    .select('id, target_key, market, stock_name, target_input, charged_credits, scanned_at')
    .eq('user_id', userId)
    .order('scanned_at', { ascending: false })
    .limit(safeLimit)
  if (error) {
    console.error('[etf-history] list failed', { userId, error: error.message })
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

/** 기록 단건(id) — 본인 소유만. uuid가 아니거나 계약 위반 payload면 null. */
export async function getEtfHistoryById(
  userId: string,
  id: string,
): Promise<EtfHistoryDetailRow | null> {
  const trimmed = id.trim()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
  if (!isUuid) return null

  const client = createEtfHistoryServiceClient()
  if (!client) return null

  const { data, error } = await client
    .from('etf_scan_history')
    .select('id, target_key, market, stock_name, target_input, payload, price_basis, charged_credits, scanned_at')
    .eq('user_id', userId)
    .eq('id', trimmed)
    .maybeSingle()
  if (error || !data) return null
  if (!isEtfLedgerPayload(data.payload)) return null

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

/** 코드별 최근 분석(스냅샷 대용) — 신선도 판정은 호출처(deepscan과 같은 TTL 정책).
 *  원장의 (user, code) 최신 행을 읽는다. 재열람 캐시 히트·가격 드리프트 기준으로 쓴다. */
export async function lookupLatestEtfAnalysis(
  userId: string,
  code: string,
): Promise<{ payload: EtfProfileJson; scannedAt: string } | null> {
  const client = createEtfHistoryServiceClient()
  if (!client) return null

  const { data, error } = await client
    .from('etf_scan_history')
    .select('payload, scanned_at')
    .eq('user_id', userId)
    .eq('target_key', code)
    .order('scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  if (!isEtfLedgerPayload(data.payload)) return null
  return { payload: data.payload, scannedAt: String(data.scanned_at ?? '') }
}
