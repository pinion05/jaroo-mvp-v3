import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { NO_STORE_PRIVATE_HEADERS, resolveApiUserId } from '@/lib/supabase/api-auth'
import { originAllowedForStateChange } from '@/lib/http-origin-guard'
import type { PortfolioDbRow, PortfolioSaveRow } from '@/lib/portfolio-sync'
import { MAX_PORTFOLIO_REQUEST_BODY_BYTES, getPortfolioRequestBodySizeError, getPortfolioRowsValidationError } from '@/lib/portfolio-validation'

export const runtime = 'nodejs'

export { MAX_PORTFOLIO_ROWS, MAX_PORTFOLIO_REQUEST_BODY_BYTES, getPortfolioRequestBodySizeError, getPortfolioRowsValidationError } from '@/lib/portfolio-validation'

const PORTFOLIO_COLUMNS = [
  'name',
  'code',
  'ticker',
  'market',
  'market_tone',
  'kind',
  'quantity',
  'average_price',
  'average_price_currency',
  'evaluation_amount',
  'identifier_label',
  'sort_order',
  'source',
].join(',')

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_PRIVATE_HEADERS })
}

// 인증 해석은 lib/supabase/api-auth 단일 소스를 쓴다(과거 라우트 로컬 복제본).

export async function GET() {
  const auth = await resolveApiUserId('portfolio')
  if (auth.status === 'unavailable') {
    return jsonNoStore({ error: 'auth-unavailable' }, { status: 503 })
  }
  if (auth.status === 'unauthorized') {
    return jsonNoStore({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const service = createSupabaseServiceClient()
    const { data, error } = await service
      .from('portfolio_holdings')
      .select(PORTFOLIO_COLUMNS)
      .eq('user_id', auth.userId)
      .order('sort_order', { ascending: true })

    if (error) {
      return jsonNoStore({ error: 'load-failed' }, { status: 500 })
    }

    return jsonNoStore({ rows: (data ?? []) as unknown as PortfolioDbRow[] })
  } catch (error) {
    console.error('[portfolio] Portfolio load infrastructure failed', error)
    return jsonNoStore({ error: 'load-failed' }, { status: 503 })
  }
}

export async function POST(request: Request) {
  if (!originAllowedForStateChange(request)) {
    return jsonNoStore({ error: 'origin-not-allowed' }, { status: 403 })
  }
  const auth = await resolveApiUserId('portfolio')
  if (auth.status === 'unavailable') {
    return jsonNoStore({ error: 'auth-unavailable' }, { status: 503 })
  }
  if (auth.status === 'unauthorized') {
    return jsonNoStore({ error: 'unauthorized' }, { status: 401 })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_PORTFOLIO_REQUEST_BODY_BYTES) {
    return jsonNoStore({ error: `request body exceeds ${MAX_PORTFOLIO_REQUEST_BODY_BYTES} bytes.` }, { status: 413 })
  }

  let bodyText: string
  try {
    bodyText = await request.text()
  } catch {
    return jsonNoStore({ error: 'invalid-body' }, { status: 400 })
  }

  const bodySizeError = getPortfolioRequestBodySizeError(bodyText)
  if (bodySizeError) {
    return jsonNoStore({ error: bodySizeError }, { status: 413 })
  }

  let body: { rows?: unknown }
  try {
    body = JSON.parse(bodyText) as { rows?: unknown }
  } catch {
    return jsonNoStore({ error: 'invalid-body' }, { status: 400 })
  }

  const validationError = getPortfolioRowsValidationError(body.rows)
  if (validationError) {
    return jsonNoStore({ error: validationError }, { status: 400 })
  }

  try {
    const service = createSupabaseServiceClient()
    const { data, error } = await service.rpc('sync_user_portfolio', {
      p_user_id: auth.userId,
      p_rows: body.rows as unknown as PortfolioSaveRow[],
    })

    if (error) {
      return jsonNoStore({ error: 'sync-failed' }, { status: 500 })
    }

    return jsonNoStore({ saved: (data as number) ?? 0 })
  } catch (error) {
    console.error('[portfolio] Portfolio sync infrastructure failed', error)
    return jsonNoStore({ error: 'sync-failed' }, { status: 503 })
  }
}
