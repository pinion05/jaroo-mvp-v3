-- 웹훅 환불/취소 상태머신 강화.
-- 1) revoke_refunded_credits: credit_pack 전액 환불(전체 취소)을 원자 처리.
--    주문 DONE→CANCELED 조건부 전환이 멱등 가드다. 원장 refund 행은 order_id 없이
--    ref='order:<order_id>' 로 insert 한다 — 기존 credit_ledger_purchase_order_uq
--    (order_id 부분 유니크, purchase/refund) 를 같은 주문의 purchase 행과 충돌 없이
--    통과시키기 위해서다. 잔액은 전환이 성공한 경우에만 차감한다.
-- 2) revoke_partial_refund_credits: 부분 취소(cancelAmount 누적) 비례 크레딧 회수.
--    이미 회수한 원장 합과의 차분만 회수해 웹훅 재전송/중복 이벤트에 멱등이다.
-- 3) renew_pro_subscription: 멱등 가드(주문 PENDING→DONE 전환 성공)를 기간 연장
--    앞에 둬서, 웹훅 DONE 복구와 cron 갱신이 동일 주문을 동시 처리해도 기간이
--    이중 연장되지 않게 한다.

-- ========== credit_pack 전액 환불 (원자적) ==========
create or replace function public.revoke_refunded_credits(
  p_order_id text,
  p_fail_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_credits integer;
  v_balance integer;
  v_already_revoked integer;
  v_revoke integer;
begin
  -- 멱등 가드: DONE 인 credit_pack 주문만 CANCELED 로 원자 전환한다.
  -- (이미 CANCELED 면 false — 이전 호출에서 원자적으로 완료된 상태)
  update public.payment_orders
  set status = 'CANCELED',
      fail_reason = coalesce(p_fail_reason, fail_reason),
      updated_at = now()
  where order_id = p_order_id
    and kind = 'credit_pack'
    and status = 'DONE'
  returning user_id, credits into v_user_id, v_credits;

  if not found then
    return false;
  end if;

  -- 잔액 row 락 후 회수분 계산: 부분취소로 이미 회수한 분은 제외하고,
  -- 남은 잔액보다 많으면 클램프(이미 사용해 되돌릴 수 없는 만큼은 포기).
  select balance into v_balance
  from public.credit_balances
  where user_id = v_user_id
  for update;

  select coalesce(sum(-delta), 0) into v_already_revoked
  from public.credit_ledger
  where user_id = v_user_id
    and reason = 'refund'
    and ref = 'order:' || p_order_id;

  v_revoke := greatest(
    least(coalesce(v_credits, 0) - v_already_revoked, coalesce(v_balance, 0)),
    0
  );

  if v_revoke > 0 then
    update public.credit_balances
    set balance = coalesce(v_balance, 0) - v_revoke,
        updated_at = now()
    where user_id = v_user_id;

    -- refund 원장은 order_id 없이 insert(부분 유니크와 충돌 회피), 근거는 ref 로 남긴다.
    insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
    values (v_user_id, -v_revoke, 'refund', 'order:' || p_order_id, coalesce(v_balance, 0) - v_revoke);
  end if;

  return true;
end;
$$;

-- ========== credit_pack 부분 환불 (비례 회수, 멱등) ==========
create or replace function public.revoke_partial_refund_credits(
  p_order_id text,
  p_cancel_amount integer,
  p_total_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_credits integer;
  v_balance integer;
  v_already_revoked integer;
  v_target integer;
  v_revoke integer;
begin
  if coalesce(p_cancel_amount, 0) <= 0 or coalesce(p_total_amount, 0) <= 0 then
    return 0;
  end if;

  -- 부분 취소는 주문을 CANCELED 로 바꾸지 않는다(DONE 유지, 잔여 결제 유효).
  select user_id, credits into v_user_id, v_credits
  from public.payment_orders
  where order_id = p_order_id
    and kind = 'credit_pack'
    and status = 'DONE'
  for update;

  if not found then
    return 0;
  end if;

  select balance into v_balance
  from public.credit_balances
  where user_id = v_user_id
  for update;

  select coalesce(sum(-delta), 0) into v_already_revoked
  from public.credit_ledger
  where user_id = v_user_id
    and reason = 'refund'
    and ref = 'order:' || p_order_id;

  -- 목표 회수분 = 지급 크레딧 × (누적 취소금액 / 결제 총액), 지급 크레딧 상한.
  v_target := least(
    round(coalesce(v_credits, 0) * p_cancel_amount::numeric / p_total_amount::numeric)::integer,
    coalesce(v_credits, 0)
  );

  -- 이미 회수한 원장 합과의 차분만 회수(웹훅 재전송·후속 부분취소 누적 모두 멱등).
  v_revoke := least(greatest(v_target - v_already_revoked, 0), coalesce(v_balance, 0));

  if v_revoke <= 0 then
    return 0;
  end if;

  update public.credit_balances
  set balance = coalesce(v_balance, 0) - v_revoke,
      updated_at = now()
  where user_id = v_user_id;

  insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
  values (v_user_id, -v_revoke, 'refund', 'order:' || p_order_id, coalesce(v_balance, 0) - v_revoke);

  return v_revoke;
end;
$$;

-- ========== 갱신 RPC 멱등 강화 ==========
-- 원래는 기간 연장을 먼저 수행해, 같은 갱신 주문에 RPC 가 두 번 호출되면 기간이
-- 이중으로 연장됐다. 주문 PENDING→DONE 전환(원자적 가드)을 앞으로 옮겨,
-- 전환에 성공한 호출만 기간을 연장한다.
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
  -- 멱등 가드: 이 갱신 주문을 처음 확정하는 호출만 통과한다.
  update public.payment_orders
  set status = 'DONE', payment_key = p_payment_key, toss_raw = coalesce(p_toss_raw, toss_raw), updated_at = now()
  where order_id = p_order_id and user_id = p_user_id and status = 'PENDING';

  if not found then
    return false;
  end if;

  select current_period_end into v_current_end
  from public.pro_subscriptions
  where user_id = p_user_id
  for update;

  if v_current_end is null then
    -- 구독 row 가 없으면(첫 결제 활성화 누락 등) 주문만 DONE. 호출자가 활성화으로 이어간다.
    return false;
  end if;

  update public.pro_subscriptions
  set current_period_start = greatest(v_current_end, now()),
      current_period_end = greatest(v_current_end, now()) + make_interval(days => p_period_days),
      status = 'active',
      updated_at = now()
  where user_id = p_user_id;

  return true;
end;
$$;

-- 보안: 신규 RPC 는 서비스롤 전용(기존 결제 RPC 와 동일 정책).
revoke execute on function public.revoke_refunded_credits(text, text) from public, authenticated, anon;
revoke execute on function public.revoke_partial_refund_credits(text, integer, integer) from public, authenticated, anon;
grant execute on function public.revoke_refunded_credits(text, text) to service_role;
grant execute on function public.revoke_partial_refund_credits(text, integer, integer) to service_role;
