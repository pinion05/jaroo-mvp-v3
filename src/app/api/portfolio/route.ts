import { NextResponse } from 'next/server'
import { accountHoldingRowsToPortfolioItems, buildAccountPortfolioHoldingInputs, sanitizeAccountPortfolioItems, type AccountPortfolioHoldingRow } from '@/lib/account-portfolio'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const ACCOUNT_PORTFOLIO_SELECT = [
  'id',
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
  'updated_at',
].join(',')

type AccountPortfolioSupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error?: unknown }>
  }
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (column: string, options: { ascending: boolean }) => Promise<{ data: AccountPortfolioHoldingRow[] | null; error?: { message?: string } | null }>
      }
    }
  }
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error?: { message?: string } | null }>
}

function errorJson(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

async function getAuthenticatedUserId(supabase: AccountPortfolioSupabaseClient) {
  const { data, error } = await supabase.auth.getUser()
  return error || !data.user ? null : data.user.id
}

export async function createAccountPortfolioGetResponse(supabase: AccountPortfolioSupabaseClient) {
  const userId = await getAuthenticatedUserId(supabase)

  if (!userId) {
    return errorJson('auth_required', '로그인이 필요해요.', 401)
  }

  const { data, error } = await supabase
    .from('portfolio_holdings')
    .select(ACCOUNT_PORTFOLIO_SELECT)
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })

  if (error) {
    return errorJson('portfolio_load_failed', error.message ?? '포트폴리오를 불러오지 못했어요.', 500)
  }

  return NextResponse.json({
    ok: true,
    items: accountHoldingRowsToPortfolioItems(data ?? []),
  })
}

export async function createAccountPortfolioPutResponse(request: Request, supabase: AccountPortfolioSupabaseClient) {
  const userId = await getAuthenticatedUserId(supabase)

  if (!userId) {
    return errorJson('auth_required', '로그인이 필요해요.', 401)
  }

  const payload = (await request.json().catch(() => null)) as { items?: unknown } | null
  const items = sanitizeAccountPortfolioItems(payload?.items)

  if (!payload || !Array.isArray(payload.items)) {
    return errorJson('invalid_portfolio_payload', '포트폴리오 항목 배열이 필요해요.', 400)
  }

  if (payload.items.length > 0 && items.length === 0) {
    return errorJson('invalid_portfolio_items', '저장 가능한 포트폴리오 항목이 없어요.', 400)
  }

  const inputs = buildAccountPortfolioHoldingInputs(items)
  const { error } = await supabase.rpc('replace_portfolio_holdings', { p_items: inputs })

  if (error) {
    return errorJson('portfolio_save_failed', error.message ?? '포트폴리오를 저장하지 못했어요.', 500)
  }

  return NextResponse.json({
    ok: true,
    count: inputs.length,
    items,
  })
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  return createAccountPortfolioGetResponse(supabase as unknown as AccountPortfolioSupabaseClient)
}

export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient()
  return createAccountPortfolioPutResponse(request, supabase as unknown as AccountPortfolioSupabaseClient)
}
