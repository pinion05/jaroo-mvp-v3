import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import type { PortfolioDbRow, PortfolioSaveRow } from '@/lib/portfolio-sync'

export const runtime = 'nodejs'

export const MAX_PORTFOLIO_ROWS = 200

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

export function getPortfolioRowsValidationError(rows: unknown): string {
  if (!Array.isArray(rows)) {
    return 'rows must be an array.'
  }
  if (rows.length > MAX_PORTFOLIO_ROWS) {
    return `Too many rows. Up to ${MAX_PORTFOLIO_ROWS} rows are supported.`
  }
  return ''
}

async function resolvePortfolioUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) {
      return null
    }
    return data.user.id
  } catch {
    return null
  }
}

export async function GET() {
  const userId = await resolvePortfolioUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const service = createSupabaseServiceClient()
  const { data, error } = await service
    .from('portfolio_holdings')
    .select(PORTFOLIO_COLUMNS)
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'load-failed' }, { status: 500 })
  }

  return NextResponse.json({ rows: (data ?? []) as unknown as PortfolioDbRow[] })
}

export async function POST(request: Request) {
  const userId = await resolvePortfolioUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { rows?: unknown }
  try {
    body = (await request.json()) as { rows?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 })
  }

  const validationError = getPortfolioRowsValidationError(body.rows)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const service = createSupabaseServiceClient()
  const { data, error } = await service.rpc('sync_user_portfolio', {
    p_user_id: userId,
    p_rows: body.rows as unknown as PortfolioSaveRow[],
  })

  if (error) {
    return NextResponse.json({ error: 'sync-failed' }, { status: 500 })
  }

  return NextResponse.json({ saved: (data as number) ?? 0 })
}
