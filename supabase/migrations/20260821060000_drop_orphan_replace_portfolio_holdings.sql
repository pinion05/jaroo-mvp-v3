-- 고아 RPC 제거: replace_portfolio_holdings(jsonb)
--
-- 배경: 2026-06-29 PR #152(codex, "Add account portfolio restore") 작업 중
-- 프로덕션에 직접 적용됐던 함수다. 당시 PR 은 머지되지 않았고, 이후
-- 20260706120000_portfolio_autosave 마이그레이션이 같은 기능(포트폴리오
-- 전체 교체)을 sync_user_portfolio 로 표준화했다. sync_user_portfolio 는
-- SECURITY DEFINER + 서비스롤 전용 호출이라 권한 경계도 더 명확하다.
--
-- 애플리케이션 코드는 sync_user_portfolio 만 호출하며
-- replace_portfolio_holdings 참조는 dev 전역(src/tests/packages)에서 0건,
-- 일반 의존 객체(뷰/트리거)도 없다(프로덕션 pg_depend 확인). 남아 있어도
-- 호출부가 없는 고아 객체이므로 제거한다.
--
-- 확인 사항(2026-08-21, 프로덕션 hrfpnawmlcoaygipulpm):
--   - pg_proc: security_definer = false, plpgsql, auth.uid() 기반
--   - 현재 함수 시그니처: replace_portfolio_holdings(p_items jsonb) returns integer

drop function if exists public.replace_portfolio_holdings(p_items jsonb);
