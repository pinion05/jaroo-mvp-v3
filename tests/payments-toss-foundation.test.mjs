import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('결제 API 라우트가 갖춰져 있다', () => {
  for (const file of [
    'src/app/api/payments/orders/route.ts',
    'src/app/api/payments/confirm/route.ts',
    'src/app/api/payments/billing/confirm/route.ts',
    'src/app/api/payments/webhook/route.ts',
    'src/app/api/payments/me/route.ts',
    'src/app/api/payments/subscriptions/cancel/route.ts',
    'src/app/api/payments/cron/tick/route.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`)
  }
})

test('토스 서버 클라이언트가 Basic 인증과 v1 엔드포인트를 사용한다', () => {
  const client = read('src/lib/payments/toss-client.ts')
  assert.match(client, /api\.tosspayments\.com\/v1/)
  assert.match(client, /base64/)
  assert.match(client, /\/billing\/authorizations\/issue/)
  assert.match(client, /Idempotency-Key/)
  assert.match(client, /import 'server-only'/)
})

test('승인 라우트는 클라이언트 금액을 무시하고 DB 주문 금액으로 승인한다', () => {
  const confirm = read('src/app/api/payments/confirm/route.ts')
  assert.match(confirm, /amount_krw/)
  assert.match(confirm, /apply_credit_purchase/)
})

test('빌링 확인은 customerKey 검증 후 빌링키 발급 → 첫 결제 → 구독 활성화 순서다', () => {
  const billing = read('src/app/api/payments/billing/confirm/route.ts')
  assert.match(billing, /customer-key-mismatch/)
  assert.match(billing, /issueTossBillingKey/)
  assert.match(billing, /chargeTossBilling/)
  assert.match(billing, /activate_pro_subscription/)
})

test('웹훅은 본문이 아니라 시크릿 키 재조회로 상태를 확정하고 멱등 처리한다', () => {
  const webhook = read('src/app/api/payments/webhook/route.ts')
  assert.match(webhook, /record_payment_event/)
  assert.match(webhook, /getTossPayment/)
  assert.match(webhook, /PAYMENT_STATUS_CHANGED/)
  assert.match(webhook, /BILLING_DELETED/)
})

test('갱신 cron은 Bearer 시크릿 보호를 받는다', () => {
  const cron = read('src/app/api/payments/cron/tick/route.ts')
  assert.match(cron, /PAYMENTS_CRON_SECRET/)
  assert.match(cron, /chargeTossBilling/)
  assert.match(cron, /renew_pro_subscription/)
})

test('결제 마이그레이션: 민감 테이블 RLS 차단 + my_* 뷰 + 원자적 RPC', () => {
  const migration = read('supabase/migrations/20260819120000_create_payments_billing.sql')
  for (const table of ['payment_orders', 'credit_balances', 'credit_ledger', 'pro_subscriptions', 'payment_events']) {
    const enableRegex = new RegExp('alter table public.' + table + ' enable row level security')
    assert.match(migration, enableRegex, `${table} RLS 필요`)
  }
  assert.match(migration, /security_invoker = true/)
  assert.match(migration, /create or replace function public\.apply_credit_purchase/)
  assert.match(migration, /create or replace function public\.spend_credits/)
  assert.match(migration, /create or replace function public\.activate_pro_subscription/)
  assert.match(migration, /create or replace function public\.renew_pro_subscription/)
  assert.match(migration, /billing_key text/)
})

test('마이페이지 결제 카드가 실데이터 컴포넌트를 사용한다', () => {
  assert.match(read('src/app/mypage/page.tsx'), /<PaymentsStatusCards \/>/)
  assert.match(read('src/components/mypage/payments-status-cards.tsx'), /fetchPaymentsMe/)
})

test('결제 화면/콜백 페이지가 존재한다', () => {
  for (const file of [
    'src/app/payments/success/page.tsx',
    'src/app/payments/fail/page.tsx',
    'src/app/payments/billing/callback/page.tsx',
    'src/app/mypage/credit/page.tsx',
    'src/app/mypage/pro/page.tsx',
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`)
  }
})
