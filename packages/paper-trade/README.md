# jaroo-paper-trade

JAROO 모의투자(매매체결) 시뮬레이터 — **증권사 API처럼** 보유종목·매매체결을 제공하는 독립 마이크로서비스 PoC.

- 키움 사업자 모의계좌가 3개월 제한이라 자체 모의투자 시스템을 만들기로 한 것(2026-11-10 자루 회의)의 PoC
- AI 트레이더 캐릭터("소심이" 등)의 계좌·매매 입증 데이터 소스로 쓰는 것이 목적

## 설계 원칙

| 원칙 | 의미 |
|---|---|
| **quote ZERO** | 이 컨테이너에는 시세 개념이 존재하지 않는다. 조회하지도, 저장하지도, **인터페이스로 노출하지도 않는다**. 체결가는 주문의 입력(`priceKrw`)으로 caller가 전달 |
| **cache ZERO** | 계좌·포지션·체결을 메모리에 두지 않음. 모든 읽기는 DB SELECT → 프로세스 무상태 |
| **DB fetch only** | SQLite가 유일한 진실 소스. 파생값(평가손익 등)은 저장하지 않고 요청 시 계산 |
| **정수 금액 연산** | 부동소수점 배제. 금액=원 단위 정수, 평단가=centi-won(원×100), 곱셈 중간값은 BigInt |
| **장시간 무시** | caller가 가격을 제시하면 언제든 체결 |
| **한국 주식만** | 6자리 종목코드(KOSPI/KOSDAQ/ETF). 해외 티커는 501 (`kr_symbol_only`) |

## 데이터 책임 분할

```
[오케스트레이터: AI 트레이터 루프 / 웹 BFF]
   ① deepscan에서 현재가 조회          ← 시세 책임: deepscan
   ② POST /orders {.., priceKrw}       ← 가격을 실어 보냄
        │
        ▼
[paper-trade 컨테이너]                 ← 원장 책임 ONLY
   계좌·포지션·체결·현금원장 (SQLite)
   외부 네트워크 의존 0 · egress 0
```

- caller가 전달한 가격이 체결되는 순간, "deepscan 소유의 시세"가 **"paper-trade 소유의 체결 사실"**(`orders.executed_price_won`, 불변)로 귀속된다
- 평가손익·총자산(시세 평가)은 caller가 계산한다 — 이 API는 수량·평단가·매입원본만 돌려준다
- 시세 신선도·거래정지 여부 판단도 시세 소유자(caller)의 책임. 이 컨테이너는 가격 검증(양의 정수·상한)만 한다

## 스택

Hono + Bun + `bun:sqlite` (네이티브 의존 0, 빌드 단계 없음) — 의존성은 hono 하나.

## 매매 규칙

- 주문 타입: **시장가뿐** (체결가 = caller 제시 가격)
- 매수: `현금차감 = 체결액 + 수수료` / `평단가 = (기존수량×기존평단 + 체결수량×체결가) ÷ 총수량` (반올림)
- 매도: `현금증가 = 체결액 − 수수료 − 증권거래세` / 평단가 불변 / 실현손익 = 현금증가 − 평단×수량
- 수수료 **0.015%** (매수·매도), 증권거래세 **0.15%** (매도만) — 원 단위 올림, env로 조정 가능
- 모든 기록 시각(체결·원장·계좌)은 **한국 표준시(KST, UTC+9) ISO8601** — 예: `2026-11-10T17:03:54.123+09:00`

## API

모든 응답은 `{ ok: true, data }` 또는 `{ ok: false, error: { code, message, ... } }`.

| Method | Path | 설명 |
|---|---|---|
| POST | `/v1/accounts` | 계좌 생성 `{ name, initialCashKrw }` |
| GET | `/v1/accounts` | 계좌 목록 |
| GET | `/v1/accounts/:id` | 요약 — 현금·매입원본·실현손익 누계·수수료 누계 (시세 평가 없음) |
| GET | `/v1/accounts/:id/positions` | 보유종목 — 수량·평단가·매입원본 (**현재가·평가손익 필드 없음**) |
| POST | `/v1/accounts/:id/orders` | 주문 `{ symbol, side, quantity, priceKrw, name?, market? }` → 즉시 체결 |
| GET | `/v1/accounts/:id/orders` | 체결 내역 (= 매매 입증 데이터) |
| GET | `/v1/accounts/:id/ledger` | 현금 원장 (deposit/buy/sell) |

### 오케스트레이션 예시 (시세 → 주문 → 평가)

```bash
# ① caller가 deepscan에서 현재가 조회 (이 컨테이너와 무관한 단계)
PRICE=$(curl -s "https://jaroo.kr/api/quotes/current?codes=005930" \
  | python3 -c "import json,sys; print(int(json.load(sys.stdin)['data']['items'][0]['price']))")

# ② 계좌 생성 (AI 트레이더 캐릭터 1개 = 계좌 1개)
AC=$(curl -s -X POST http://localhost:3041/v1/accounts \
  -H 'content-type: application/json' -d '{"name":"소심이","initialCashKrw":10000000}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['accountId'])")

# ③ 가격을 실어 주문 → 즉시 체결
curl -s -X POST http://localhost:3041/v1/accounts/$AC/orders \
  -H 'content-type: application/json' \
  -d "{\"symbol\":\"005930\",\"side\":\"buy\",\"quantity\":10,\"priceKrw\":$PRICE,\"name\":\"삼성전자\"}"

# ④ 보유종목 (수량·평단만) — 평가손익은 caller가 ①의 시세로 직접 계산
curl -s http://localhost:3041/v1/accounts/$AC/positions
```

### 에러 코드

| code | HTTP | 상황 |
|---|---|---|
| `insufficient_cash` / `insufficient_quantity` | 400 | 현금·수량 부족 |
| `invalid_symbol` / `invalid_side` / `invalid_quantity` / `invalid_price` / `invalid_name` / `invalid_initial_cash` | 400 | 입력 검증 실패 (가격 누락 포함) |
| `account_not_found` | 404 | 없는 계좌 |
| `kr_symbol_only` | 501 | 해외 심볼 (PoC 범위 밖) |
| `order_too_large` | 400 | 1회 체결액 상한(10조원) 초과 |

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3041` | 리슨 포트 (crawler 3040 옆) |
| `DB_PATH` | `./data/paper-trade.db` | SQLite 파일 (`:memory:` 가능) |
| `BROKER_FEE_BPS` | `1.5` | 수수료 bps |
| `SELL_TAX_BPS` | `15` | 증권거래세 bps (매도) |

## 실행

```bash
bun install
bun test          # 27 tests (엔진 수학 + API e2e + 재시작 정합성)
bun src/index.ts
```

## Docker

```bash
docker build -t jaroo-paper-trade .
docker run -d -p 3041:3041 -v "$PWD/data:/data" --name jaroo-paper-trade jaroo-paper-trade
```

`oven/bun:1-alpine` 기반. 네트워크 egress가 필요 없으므로 격리 네트워크로도 운영 가능.

## 다음 단계 (PoC 범위 밖)

- AI 트레이더 전략 워커: deepscan 조회 → 이 API 주문 (시세/원장 책임 분리의 오케스트레이터)
- 지정가 주문 (미체결 잔량 상태 머신)
- 해외 주식 (FX·결제통화 설계)
- Postgres 이관 (멀티 레플리카) — `store.ts` 인터페이스만 교체
- 수익률 리플레이 — `orders` 테이블(append-only 이벤트 로그)만으로 계좌 재구성
