-- telegram_link_tokens 에 쓰기 전용 RLS 정책 추가.
-- 링크 라우트(/api/telegram/link POST·DELETE)가 유저 스코프 클라이언트로 토큰을
-- insert/delete 하는데, 이 테이블은 RLS enable + 정책 0개(deny-all)라 그대로면
-- 42501 로 항상 실패한다(PR #225 리뷰 blocker). SELECT 정책은 의도적으로 없다 —
-- 토큰 값은 클라이언트가 절대 읽지 않고, 조회는 웹훅의 service role 만 한다.

create policy telegram_link_tokens_insert_own
  on public.telegram_link_tokens for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy telegram_link_tokens_delete_own
  on public.telegram_link_tokens for delete
  to authenticated
  using (auth.uid() = user_id);

-- 컨벤션 정비: payments RLS 마이그레이션과 같이 to authenticated 를 명시한다.
drop policy if exists telegram_links_select_own on public.telegram_links;
create policy telegram_links_select_own
  on public.telegram_links for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists telegram_links_delete_own on public.telegram_links;
create policy telegram_links_delete_own
  on public.telegram_links for delete
  to authenticated
  using (auth.uid() = user_id);
