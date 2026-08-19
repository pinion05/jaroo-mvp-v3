# 결제 연동 (토스페이먼츠)

Jaroo 크레딧 팩 일회성 결제와 Jaroo Pro 월 구독(자동결제)의 구현 안내.

## 구성 요소

| 계층 | 파일 | 역할 |
| --- | --- | --- |
| 상품 카탈로그 | `src/lib/payments/products.ts` | 크레딧 팩 3종 + Pro 월 구독 가격의 단일 진실 소스. 딥스캔 1회 = `DEEPSCAN_CREDIT_COST`(10cr) |
| 서버 PG 클라이언트 | `src/lib/payments/toss-client.ts` | 토스 v1 API (승인/조회/취소/빌링키 발급/자동결제 승인/빌링키 삭제). Basic 인증 |
| 브라우저 클라이언트 | `src/lib/payments/client.ts` | SDK v2 로드, 결제창/카드등록창 오픈, 승인 API 호출 |
| 주문 생성 | `src/app/api/payments/orders/route.ts` | 상품 검증 + `PENDING` 주문 row 생성. 금액의 진실 소스 |
| 일회성 승인 | `src/app/api/payments/confirm/route.ts` | DB 금액으로만 승인 + `apply_credit_purchase` 원자적 적립 |
| 구독 첫 결제 | `src/app/api/payments/billing/confirm/route.ts` | authKey→빌링키 발급→첫 결제→구독 활성화 |
| 웹훅 | `src/app/api/payments/webhook/route.ts` | `PAYMENT_STATUS_CHANGED` 등. 본문 불신, 시크릿 키 재조회로 확정. `payment_events` 멱등 |
| 갱신 cron | `src/app/api/payments/cron/tick/route.ts` | 만료 구독 갱신/만료 처리. `Authorization: Bearer $PAYMENTS_CRON_SECRET` |
| 요약 조회 | `src/app/api/payments/me/route.ts` | 잔액/구독/주문 내역 (`my_*` 뷰) |
| 해지 | `src/app/api/payments/subscriptions/cancel/route.ts` | 기간 종료 후 해지(기본) / 즉시 해지 |

## 환경 변수

```bash
# .env.local (로컬) / Railway Variables (운영)
NEXT_PUBLIC_TOSS_CLIENT_KEY=tk_ck_...   # 개발자센터 API 키의 클라이언트 키
TOSS_SECRET_KEY=sk_test_...             # 시크릿 키 (서버 전용, 절대 NEXT_PUBLIC 금지)
PAYMENTS_CRON_SECRET=...                # 갱신 cron 호출용 비밀 (임의 생성)
```

키 발급: https://developers.tosspayments.com/my/api-keys (회원가입만으로 테스트 키 사용 가능).
자동결제(빌링)는 토스와 **추가 계약**이 필요하다. 계약 전에는 테스트 키로만 동작한다.

키가 없어도 앱은 깨지지 않는다: 크레딧/Pro 화면이 "결제 연동 준비 중" 상태로 표시된다.

## 결제 흐름

### 크레딧 팩 (일회성)

1. `/mypage/credit`에서 팩 선택 → `POST /api/payments/orders` (PENDING 주문 생성)
2. SDK `requestPayment()` → 결제창 → 성공 시 `/payments/success?orderId&paymentKey&amount`
3. success 페이지가 `POST /api/payments/confirm` 호출 → 서버가 **DB 주문 금액**으로 토스 승인
4. `apply_credit_purchase` RPC가 원장 적립 + 잔액 갱신 + 주문 DONE (멱등)

### Pro 구독 (자동결제)

1. `/mypage/pro` → 주문 생성 → SDK `requestBillingAuth()` → 카드 등록창
2. 성공 시 `/payments/billing/callback?orderId&customerKey&authKey`
3. 서버가 `POST /v1/billing/authorizations/issue`(빌링키) → `POST /v1/billing/{billingKey}`(첫 결제) → 구독 active
4. 이후 갱신은 cron이 `POST /api/payments/cron/tick`을 호출해 처리 (매일 1회 권장). 토스는 스케줄링을 제공하지 않으므로 자체 구현이다.

### 해지

- 기본: 기간 종료 후 만료 (남은 기간 유지, `cancel_at_period_end=true`)
- 즉시: `immediate: true` — 구독 만료 + 빌링키 삭제

## 보안 설계

- **금액 검증**: 클라이언트가 보낸 `amount`는 전부 무시하고 DB 주문 row 금액으로만 승인한다.
- **RLS**: `payment_orders`/`credit_ledger`/`credit_balances`/`pro_subscriptions`/`payment_events`는 정책 없이 RLS만 켜두어 anon/authenticated 전면 차단. 빌링키는 `pro_subscriptions`에 서비스롤만 접근.
- **뷰**: 사용자 조회는 `security_invoker` 뷰(`my_credit_balance`, `my_subscription` 등)로 민감 컬럼 제외 노출.
- **RPC**: `apply_credit_purchase` 등 서비스롤 전용 함수는 `revoke ... from public` 처리 (Postgres 함수는 기본 PUBLIC 실행 가능하므로 명시 철회 필수). 사용자 실행 허용은 `cancel_my_subscription`뿐.
- **멱등**: 원장 unique index(주문당 적립 1행), `payment_events`(웹훈 이벤트 1회), 토스 API `Idempotency-Key`(갱신 결제).
- **웹훅 불신**: 웹훅 본문을 믿지 않고 `paymentKey`로 재조회(re-query)해 상태를 확정한다.

## 웹훅/로컬 개발

웹훅 URL은 공개 주소여야 한다. 로컬은 ngrok 등으로 터널링해 `/api/payments/webhook`을 등록한다.
개발자센터 → 웹훅 메뉴에서 `PAYMENT_STATUS_CHANGED`, `CANCEL_STATUS_CHANGED`, `BILLING_DELETED` 등록을 권장한다.

## 갱신 cron 운영

매일 1회 (예: KST 09:00) 호출:

```bash
curl -X POST https://<host>/api/payments/cron/tick \
  -H "Authorization: Bearer $PAYMENTS_CRON_SECRET"
```

Railway Cron / GitHub Actions schedule 어느 쪽이든 무관하다. 실패한 갱신은 구독이 `past_due`가 되고 다음 틱에 재시도되며, 7일 유예 후 `expired`된다.

## 마이그레이션 적용

```bash
supabase db push   # 또는 SQL 에디터에 20260819120000_create_payments_billing.sql 실행
```

## 테스트

```bash
npm run test:web:ts      # products.test.ts 포함
node --test tests/payments-toss-foundation.test.mjs
```

테스트 카드: 개발자센터 문서의 테스트 카드 사용. 테스트 클라이언트 키로는 실결제가 일어나지 않는다.
