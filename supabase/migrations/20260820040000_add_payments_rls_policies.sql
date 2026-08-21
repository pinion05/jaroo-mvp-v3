-- payments RLS SELECT 정책 추가.
-- 20260819120000 에서 테이블 5개에 RLS 를 켰지만 정책을 만들지 않아 authenticated 가
-- 전면 차단됐다. security_invoker 뷰(my_*)는 호출자 권한으로 base table 을 읽기
-- 때문에, 소유 행 SELECT 정책이 없으면 잔액/구독/주문이 항상 비어 보인다.
-- (실증: credit_balances balance=30 유저의 my_credit_balance 조회가 [] 반환)
--
-- 쓰기 경로는 그대로 서비스롤/SECURITY DEFINER RPC 로만 허용한다(정책 미부여 = 차단).

alter table public.credit_balances enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.payment_orders enable row level security;
alter table public.pro_subscriptions enable row level security;

create policy credit_balances_select_own
  on public.credit_balances for select
  to authenticated
  using (user_id = auth.uid());

create policy credit_ledger_select_own
  on public.credit_ledger for select
  to authenticated
  using (user_id = auth.uid());

create policy payment_orders_select_own
  on public.payment_orders for select
  to authenticated
  using (user_id = auth.uid());

create policy pro_subscriptions_select_own
  on public.pro_subscriptions for select
  to authenticated
  using (user_id = auth.uid());
