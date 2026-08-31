# 텔레그램 알림 채널 롤백 런북 (PR #225)

feat/telegram-notify-linking 기능 전체를 되돌리는 절차. 스쿼시 머지되므로 git 되돌리기는 커밋 1개면 끝난다.

## 1. 코드 되돌리기 (dev에서 커밋 1개)

```bash
git checkout dev && git pull
git revert <squash-머지-커밋-SHA>   # 텔레그램 관련 코드 6개 파일 전체 복원
git push
```

## 2. DB 정리 (원격 Supabase — additive 테이블이므로 drop으로 완전 제거)

```sql
drop table if exists public.telegram_link_tokens;
drop table if exists public.telegram_links;
```

- 두 테이블은 이 기능 전용이고 다른 테이블이 참조하지 않는다 (FK는 auth.users로의 단방향)
- RLS 정책·인덱스는 테이블 drop 시 함께 제거된다
- 연결된 유저 데이터가 사라지지만, 기능 자체를 끄는 것이므로 손실 아님

⚠️ 이 SQL은 `supabase/migrations/`에 넣지 않는다 — CLI가 미적용 마이그레이션을 자동 push하므로, 롤백 SQL을 마이그레이션으로 두면 다른 환경에서 테이블이 갑자기 drop될 수 있다.

## 3. 봇 수신 끄기 (웹훅 제거)

```bash
# .env.local(또는 Railway env)의 TELEGRAM_BOT_TOKEN 사용
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/deleteWebhook"
```

## 4. Railway 환경변수

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME` 3개 삭제 (선택 — 남겨도 무해, 코드가 없으면 안 쓰임)

## 5. 재도입

git revert 커밋을 다시 revert하면 코드 복원. DB는 위 drop SQL의 역(마이그레이션 20260828090000 재적용)으로 복구. 연결 데이터는 백업 없으면 복구 안 되므로, 롤백 전 유지 가치가 있으면 `telegram_links`를 pg_dump로 백업할 것.
