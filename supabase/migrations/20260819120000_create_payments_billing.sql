-- 결제/크레딧/구독 기반 (토스페이먼츠 연동).
-- 민감 데이터(billing_key, toss_raw)는 base 테이블에 두고 RLS 전면 차단,
-- 사용자 조회는 security_invoker 뷰(my_*)로 안전한 컬럼만 노출한다.

-- ========== 주문 ==========
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text not null unique,              -- 토스 orderId (서버 생성)
  product_id text not null,
  kind text not null check (kind in ('credit_pack', 'pro_subscription')),
  amount_krw integer not null check (amount_krw > 0),
  credits integer,                            -- credit_pack 인 경우 지급 크레딧
  status text not null default 'PENDING' check (status in ('PENDING', 'DONE', 'FAILED', 'CANCELED')),
  payment_key text,                           -- 토스 paymentKey (승인 후)
  fail_reason text,
  toss_raw jsonb,                             -- 승인 응답 원본(감사)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_orders_user_idx on public.payment_orders (user_id, created_at desc);

-- ========== 크레딧 잔액 ==========
create table if not exists public.credit_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- ========== 크레딧 원장 (append-only) ==========
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,                     -- 양수=적립, 음수=소모
  reason text not null check (reason in ('purchase', 'deepscan', 'grant', 'refund')),
  order_id text references public.payment_orders(order_id),
  ref text,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
-- 구매 적립 멱등성: 같은 주문의 purchase/refund 원장은 1행만 허용
create unique index if not exists credit_ledger_purchase_order_uq
  on public.credit_ledger (order_id) where reason in ('purchase', 'refund');

-- ========== Pro 구독 ==========
create table if not exists public.pro_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'canceled', 'past_due', 'expired')),
  billing_key text,                           -- 토스 빌링키 (서비스롤만 접근)
  card_company text,
  card_number text,                           -- 마스킹된 번호 (43301234****123*)
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== 웹훅 이벤트 (멱등/감사) ==========
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  event_id text unique,                       -- 토스 webhookId/eventId (없으면 payload 해시)
  event_type text not null,
  payment_key text,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ========== RLS: base 테이블은 서비스롤 전용 ==========
alter table public.payment_orders enable row level security;
alter table public.credit_balances enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.pro_subscriptions enable row level security;
alter table public.payment_events enable row level security;
-- 정책 미생성 = authenticated 은 전면 차단. service_role 은 RLS bypass.

grant select, insert, update, delete on table public.payment_orders to service_role;
grant select, insert, update, delete on table public.credit_balances to service_role;
grant select, insert, update, delete on table public.credit_ledger to service_role;
grant select, insert, update, delete on table public.pro_subscriptions to service_role;
grant select, insert, update, delete on table public.payment_events to service_role;

-- updated_at 트리거 재사용 (profiles 마이그레이션에서 정의한 함수)
drop trigger if exists payment_orders_set_updated_at on public.payment_orders;
create trigger payment_orders_set_updated_at
before update on public.payment_orders
for each row execute function public.set_updated_at();

drop trigger if exists pro_subscriptions_set_updated_at on public.pro_subscriptions;
create trigger pro_subscriptions_set_updated_at
before update on public.pro_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists credit_balances_set_updated_at on public.credit_balances;
create trigger credit_balances_set_updated_at
before update on public.credit_balances
for each row execute function public.set_updated_at();

-- ========== 사용자용 뷰 (민감 컬럼 제외) ==========
create or replace view public.my_credit_balance
with (security_invoker = true) as
select user_id, balance, updated_at
from public.credit_balances
where user_id = auth.uid();

create or replace view public.my_credit_history
with (security_invoker = true) as
select id, delta, reason, order_id, ref, balance_after, created_at
from public.credit_ledger
where user_id = auth.uid();

create or replace view public.my_payment_orders
with (security_invoker = true) as
select id, order_id, product_id, kind, amount_krw, credits, status, fail_reason, created_at, updated_at
from public.payment_orders
where user_id = auth.uid();

create or replace view public.my_subscription
with (security_invoker = true) as
select id, user_id, status, card_company, card_number,
       current_period_start, current_period_end, cancel_at_period_end, canceled_at, created_at
from public.pro_subscriptions
where user_id = auth.uid();

grant select on public.my_credit_balance to authenticated;
grant select on public.my_credit_history to authenticated;
grant select on public.my_payment_orders to authenticated;
grant select on public.my_subscription to authenticated;

-- ========== 서비스롤 전용 원자적 RPC ==========
-- 크레딧 팩 구매 확정: 원장 적립 + 잔액 갱신 + 주문 DONE (멱등)
create or replace function public.apply_credit_purchase(
  p_user_id uuid,
  p_order_id text,
  p_credits integer,
  p_payment_key text,
  p_toss_raw jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted boolean := false;
begin
  insert into public.credit_ledger (user_id, delta, reason, order_id, balance_after)
  select p_user_id, p_credits, 'purchase', p_order_id,
         coalesce((select balance from public.credit_balances where user_id = p_user_id for update), 0) + p_credits
  on conflict (order_id) where reason in ('purchase', 'refund') do nothing;

  if found then
    insert into public.credit_balances (user_id, balance)
    values (p_user_id, p_credits)
    on conflict (user_id) do update
      set balance = public.credit_balances.balance + p_credits,
          updated_at = now();

    update public.payment_orders
      set status = 'DONE', payment_key = p_payment_key, toss_raw = coalesce(p_toss_raw, toss_raw), updated_at = now()
      where order_id = p_order_id and user_id = p_user_id and status = 'PENDING';

    v_inserted := true;
  else
    -- 이미 적립된 주문: 결제키만 보강
    update public.payment_orders
      set payment_key = coalesce(payment_key, p_payment_key), updated_at = now()
      where order_id = p_order_id;
  end if;

  return v_inserted;
end;
$$;

-- 크레딧 소모 (딥스캔 등): 잔액 부족 시 false
create or replace function public.spend_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_ref text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    return false;
  end if;

  select balance into v_balance
  from public.credit_balances
  where user_id = p_user_id
  for update;

  if v_balance is null or v_balance < p_amount then
    return false;
  end if;

  update public.credit_balances
  set balance = balance - p_amount, updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
  values (p_user_id, -p_amount, p_reason, p_ref, v_balance - p_amount);

  return true;
end;
$$;

-- Pro 구독 활성화/재활성화 (첫 결제 또는 재구독). 멱등.
create or replace function public.activate_pro_subscription(
  p_user_id uuid,
  p_order_id text,
  p_billing_key text,
  p_card_company text,
  p_card_number text,
  p_period_days integer,
  p_payment_key text,
  p_toss_raw jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.pro_subscriptions (user_id, status, billing_key, card_company, card_number,
                                        current_period_start, current_period_end, cancel_at_period_end, canceled_at)
  values (p_user_id, 'active', p_billing_key, p_card_company, p_card_number,
          now(), now() + make_interval(days => p_period_days), false, null)
  on conflict (user_id) do update
    set status = 'active',
        billing_key = excluded.billing_key,
        card_company = excluded.card_company,
        card_number = excluded.card_number,
        current_period_start = now(),
        current_period_end = now() + make_interval(days => p_period_days),
        cancel_at_period_end = false,
        canceled_at = null,
        updated_at = now();

  update public.payment_orders
  set status = 'DONE', payment_key = p_payment_key, toss_raw = coalesce(p_toss_raw, toss_raw), updated_at = now()
  where order_id = p_order_id and user_id = p_user_id and status = 'PENDING';
end;
$$;

-- 구독 갱신 성공 처리: 기간 연장 + 갱신 주문 DONE. 멱등.
create or replace function public.renew_pro_subscription(
  p_user_id uuid,
  p_order_id text,
  p_period_days integer,
  p_payment_key text,
  p_toss_raw jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_end timestamptz;
begin
  -- 갱신 주문은 항상 새 row(고유 order_id)이므로, DONE 처리 멱등은 status='PENDING' 조건으로 충분.
  select current_period_end into v_current_end
  from public.pro_subscriptions
  where user_id = p_user_id
  for update;

  if v_current_end is null then
    return false;
  end if;

  update public.pro_subscriptions
  set current_period_start = greatest(v_current_end, now()),
      current_period_end = greatest(v_current_end, now()) + make_interval(days => p_period_days),
      status = 'active',
      updated_at = now()
  where user_id = p_user_id;

  update public.payment_orders
  set status = 'DONE', payment_key = p_payment_key, toss_raw = coalesce(p_toss_raw, toss_raw), updated_at = now()
  where order_id = p_order_id and status = 'PENDING';

  return true;
end;
$$;

-- 구독 해지 요청 (사용자): 기간 종료 후 만료 or 즉시 만료
create or replace function public.cancel_my_subscription(p_immediate boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_immediate then
    update public.pro_subscriptions
    set status = 'canceled', cancel_at_period_end = true, canceled_at = now(), updated_at = now()
    where user_id = auth.uid() and status in ('active', 'past_due');
  else
    update public.pro_subscriptions
    set cancel_at_period_end = true, updated_at = now()
    where user_id = auth.uid() and status in ('active', 'past_due');
  end if;
end;
$$;
grant execute on function public.cancel_my_subscription(boolean) to authenticated;

-- 보안: 서비스롤 전용 RPC 는 기본 PUBLIC execute 를 철회한다.
-- (해지하지 않으면 anon/authenticated 가 apply_credit_purchase 등을 직접 호출해
--  크레딧을 무단 적립할 수 있다. cancel_my_subscription 만 사용자 실행 허용.)
revoke execute on function public.apply_credit_purchase(uuid, text, integer, text, jsonb) from public, authenticated, anon;
revoke execute on function public.spend_credits(uuid, integer, text, text) from public, authenticated, anon;
revoke execute on function public.activate_pro_subscription(uuid, text, text, text, text, integer, text, jsonb) from public, authenticated, anon;
revoke execute on function public.renew_pro_subscription(uuid, text, integer, text, jsonb) from public, authenticated, anon;
revoke execute on function public.record_payment_event(text, text, text, jsonb) from public, authenticated, anon;
grant execute on function public.apply_credit_purchase(uuid, text, integer, text, jsonb) to service_role;
grant execute on function public.spend_credits(uuid, integer, text, text) to service_role;
grant execute on function public.activate_pro_subscription(uuid, text, text, text, text, integer, text, jsonb) to service_role;
grant execute on function public.renew_pro_subscription(uuid, text, integer, text, jsonb) to service_role;
grant execute on function public.record_payment_event(text, text, text, jsonb) to service_role;

-- 웹훅 이벤트 기록 (멱등): 신규 삽입 시 true
create or replace function public.record_payment_event(
  p_event_id text,
  p_event_type text,
  p_payment_key text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.payment_events (event_id, event_type, payment_key, payload)
  values (p_event_id, p_event_type, p_payment_key, p_payload)
  on conflict (event_id) do nothing;

  return found;
end;
$$;

comment on table public.payment_orders is '토스페이먼츠 주문 (크레딧 팩 / Pro 구독 첫 결제 / 갱신 결제)';
comment on table public.credit_ledger is '크레딧 적립/소모 append-only 원장';
comment on table public.credit_balances is '사용자 크레딧 현재 잔액 (원장과 함께 갱신)';
comment on table public.pro_subscriptions is 'Jaroo Pro 구독 상태. billing_key 는 서비스롤만 접근';
comment on table public.payment_events is '토스 웹훅 이벤트 멱등 처리 로그';
