-- 크레딧 환불 RPC — spend_credits 의 대칭 연산.
-- §6-6: 딥스캔 실패 시 유저에게 아무것도 전달되지 않았다면 차감분을 돌려준다.
-- service role 전용으로만 노출한다(클라이언트가 직접 환불시키는 경로 방지).

create or replace function public.refund_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text default 'refund',
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
  if p_amount is null or p_amount <= 0 then
    return false;
  end if;

  select balance into v_balance
  from public.credit_balances
  where user_id = p_user_id
  for update;

  -- 잔액 행이 없다는 것은 차감된 적도 없다는 뜻 — 환불할 것이 없다.
  if v_balance is null then
    return false;
  end if;

  update public.credit_balances
  set balance = balance + p_amount,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
  values (p_user_id, p_amount, p_reason, p_ref, v_balance + p_amount);

  return true;
end;
$$;

revoke execute on function public.refund_credits(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.refund_credits(uuid, integer, text, text) to service_role;
