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

test('웹훅 환불/취소 상태머신: 원자 RPC·부분취소·500 재전송·구독 복구·말료 예약', () => {
  const webhook = read('src/app/api/payments/webhook/route.ts')
  // (a) 전액 환불은 원자적 RPC 로 처리(잔액 차감+원장+주문 CANCELED 단일 트랜잭션)
  assert.match(webhook, /revoke_refunded_credits/)
  assert.doesNotMatch(webhook, /from\('credit_balances'\)\.update/) // 웹훅 라우트에서 잔액 직접 update 금지
  // (b) 부분 취소: cancelAmount 누적합 비례 회수
  assert.match(webhook, /PARTIAL_CANCELED/)
  assert.match(webhook, /revoke_partial_refund_credits/)
  assert.match(webhook, /cancelAmount/)
  // (c) 이벤트 저장 실패 시 500 (토스 재전송 유도)
  assert.match(webhook, /event-record-failed[\s\S]*status: 500/)
  // (d) DONE 복구 분기에 pro_subscription PENDING 주문 포함
  assert.match(webhook, /pro_subscription[\s\S]*renew_pro_subscription/)
  // (e) BILLING_DELETED 는 즉시 canceled 가 아니라 cancel_at_period_end
  assert.match(webhook, /BILLING_DELETED[\s\S]*?cancel_at_period_end: true/)
  assert.doesNotMatch(webhook, /BILLING_DELETED[\s\S]*?status: 'canceled'/)
})

test('환불 RPC 마이그레이션: 멱등 가드·부분 유니크 회피·서비스롤 전용', () => {
  const migration = read('supabase/migrations/20261030060000_add_revoke_refunded_credits_rpc.sql')
  assert.match(migration, /create or replace function public\.revoke_refunded_credits\(\s*p_order_id text/)
  assert.match(migration, /create or replace function public\.revoke_partial_refund_credits/)
  // 주문 DONE→CANCELED 조건부 전환(멱등 가드)
  assert.match(migration, /status = 'DONE'/)
  // refund 원장은 order_id 없이 ref 로 insert(credit_ledger_purchase_order_uq 회피)
  assert.match(migration, /insert into public\.credit_ledger \(user_id, delta, reason, ref, balance_after\)/)
  assert.doesNotMatch(migration, /insert into public\.credit_ledger \(user_id, delta, reason, order_id/)
  // 서비스롤 전용 실행 권한
  assert.match(migration, /grant execute on function public\.revoke_refunded_credits\(text, text\) to service_role/)
  assert.match(migration, /grant execute on function public\.revoke_partial_refund_credits\(text, integer, integer\) to service_role/)
  // renew 멱등 강화: 주문 전환 가드가 기간 연장보다 앞선다
  const renewBody = migration.split('create or replace function public.renew_pro_subscription')[1]
  assert.match(renewBody, /if not found then\s+return false/)
  assert.ok(renewBody.indexOf('update public.payment_orders') < renewBody.indexOf('update public.pro_subscriptions'), '주문 DONE 가드가 기간 연장보다 먼저 와야 한다')
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
