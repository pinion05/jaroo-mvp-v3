# jaroo-paper-trade

JAROO 모의투자(매매체결) 시스템 — 증권사 API처럼 보유종목·매매체결을 제공하는 **단일 컨테이너의 세 번째 사이드카 프로세스**.

- 키움 사업자 모의계좌가 3개월 제한이라 자체 모의투자 시스템을 만들기로 한 것(2026-11-10 자루 회의)의 PoC
- AI 트레이더 캐릭터("소심이" 등)의 계좌·매매 입증 데이터 소스로 쓰는 것이 목적

## 아키텍처 — 단일 컨테이너, 세 프로세스

Railway 하나의 컨테이너에서 `docker-entrypoint.sh`가 세 프로세스를 함께 띄운다. 어느 하나라도 죽으면
나머지를 정리하고 컨테이너가 재시작된다(`wait -n`). 별도 마이크로서비스 컨테이너가 아니다.

```
Railway 프록시 ──▶ web (next start)          $PORT (Railway 주입, 유일한 외부 노출)
                    │
                    ├─ crawler               127.0.0.1:3040 (루프백)
                    └─ paper-trade (본 패키지) 127.0.0.1:3041 (루프백)
```

- **외부에 노출되는 포트는 웹뿐**이다. crawler·paper-trade는 전부 루프백 바인딩이라 컨테이너 밖에서
  접근할 수 없다(Railway 프록시는 웹만 전달).
- `PAPER_TRADE_PORT` **만** 읽고 Railway가 웹에 주입하는 공유 `PORT`는 절대 읽지 않는다 —
  크롤러의 `CRAWLER_PORT` 규칙과 동일(EADDRINUSE 사고 방지).
- 웹 BFF가 같은 컨테이너 안에서 `http://127.0.0.1:3041` 로 호출하는 그림.

로컬 개발도 동일하게 셋이 함께 뜬다 — 루트에서:

```bash
npm run dev               # dev-stack.cjs: web(3000) + crawler(3040) + paper-trade(3041)
npm run dev:paper-trade   # paper-trade만 단독
```

## 설계 원칙 (계약 불변)

| 원칙 | 의미 |
|---|---|
| **quote ZERO** | 이 프로세스에는 시세 개념이 존재하지 않는다. 조회하지도, 저장하지도, **인터페이스로 노출하지도 않는다**. 체결가는 주문의 입력(`priceKrw`)으로 caller가 전달 |
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
[paper-trade 사이드카 프로세스]          ← 원장 책임 ONLY
   계좌·포지션·체결·현금원장 (SQLite)
   외부 네트워크 의존 0 · egress 0
```

- caller가 전달한 가격이 체결되는 순간, "deepscan 소유의 시세"가 **"paper-trade 소유의 체결 사실"**(`orders.executed_price_won`, 불변)로 귀속된다
- 평가손익·총자산(시세 평가)은 caller가 계산한다 — 이 API는 수량·평단가·매입원본만 돌려준다
- 시세 신선도·거래정지 여부 판단도 시세 소유자(caller)의 책임. 이 프로세스는 가격 검증(양의 정수·상한)만 한다

## 스택 · 메모리 설계

Node.js 런타임(`node:http` + `node:sqlite`) — **런타임 의존성 0** (npm 설치 불필요), 빌드 단계 없음
(`.ts` 직접 실행, 타입 스트리핑). 컨테이너를 늘리지 않고 기존 web+crawler 옆 프로세스 하나로 붙는다.

| 항목 | 값 | 비고 |
|---|---|---|
| 힙 상한 | 96MB | `--max-old-space-size=96` (start 스크립트) |
| SQLite 페이지 캐시 | ≈2MB | `PRAGMA cache_size = -2000` |
| 저널 모드 | WAL | 동시 읽기 + 크래시 시 안전한 복구 |
| prepared statement | 생성자에서 1회 사전 준비 | 요청 경로에서 `prepare()` 호출 없음 |
| 요청 바디 상한 | 32KB | 초과 시 `413 payload_too_large`로 즉시 거부·연결 종료 |

## 매매 규칙

- 주문 타입: **시장가뿐** (체결가 = caller 제시 가격)- 매수: `현금차감 = 체결액 + 수수료` / `평단가 = (기존수량×기존평단 + 체결수량×체결가) ÷ 총수량` (반올림)
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
| POST | `/v1/accounts/:id/orders` | 주문 — 세 모드: `{quantity}`(기존) · `{amountKrw}` **fit 매수** · `{ratio}` **ratio 매도** (아래 §fit/ratio) → 즉시 체결 |
| GET | `/v1/accounts/:id/orders` | 체결 내역 (= 매매 입증 데이터) |
| GET | `/v1/accounts/:id/ledger` | 현금 원장 (deposit/buy/sell) |

### 오케스트레이션 예시 (시세 → 주문 → 평가)

```bash
# ① caller가 deepscan에서 현재가 조회 (이 프로세스와 무관한 단계)
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
| `PAPER_TRADE_PORT` | `3041` | 리슨 포트 (crawler 3040 옆, 127.0.0.1 바인딩). Railway가 웹에 주입하는 공유 `PORT`는 **읽지 않는다** (EADDRINUSE 방지 — 크롤러의 `CRAWLER_PORT`와 동일한 규칙) |
| `PAPER_TRADE_DB_PATH` | `./data/paper-trade.db` | SQLite 파일 경로 (워크스페이스 루트 기준. `:memory:` 가능) |
| `BROKER_FEE_BPS` | `1.5` | 수수료 bps |
| `SELL_TAX_BPS` | `15` | 증권거래세 bps (매도) |

## 실행

```bash
npm run dev     # node --watch (파일 저장 시 재시작)
npm run start   # 프로덕션 — 힙 96MB 캡
npm test        # node --test "tests/*.test.ts" (28개) — 루트 npm test 체인에 포함
npm run typecheck
```

- `--experimental-transform-types`: `engine.ts`의 생성자 파라미터 프로퍼티(`constructor(public code, ...)`)는
  타입 스트리핑(strip-only)만으로 지울 수 없는 구문이라 변환 모드가 필요하다 (Node 22·24 모두 지원)

## ⚠️ Railway 배포 시 SQLite 파일 휘발성

Railway는 **재배포 시 컨테이너 파일시스템을 처음부터 다시 만든다**. 볼륨 마운트가 없으면 기본 경로의
`paper-trade.db`(계좌·체결·원장 전체)는 배포마다 사라진다 — 모의투자 입증 데이터가 유지되어야 한다면
다음 중 하나를 선택해야 한다:

1. **볼륨 마운트 (권장)** — Railway에서 볼륨을 생성해 컨테이너에 붙이고, 마운트 지점을 향하도록
   `PAPER_TRADE_DB_PATH`를 지정한다 (예: `/data/paper-trade.db`). WAL 모드이므로 같은 볼륨 재부착 시
   체크포인트가 남은 `-wal`/`-shm` 파일도 함께 보존된다.
2. **`:memory:` + 외부 덤프** — 휘발성을 전제로 운영하되, 필요 시점에 `orders` 테이블(append-only)을
   외부 저장으로 내보낸다.

현재는 기본 경로(`./data/paper-trade.db`) 그대로 두어 재배포 시 리셋되는 PoC 동작이며, 계좌 데이터
영구 보존이 필요해지는 시점에 1번을 적용한다.

## 다음 단계 (PoC 범위 밖)

- AI 트레이더 전략 워커: deepscan 조회 → 이 API 주문 (시세/원장 책임 분리의 오케스트레이터)
- 웹 BFF 라우팅: 브라우저에서 사이드카를 직접 못 보므로 웹 API 라우트가 127.0.0.1:3041을 프록시
- 지정가 주문 (미체결 잔량 상태 머신)
- 해외 주식 (FX·결제통화 설계)
- Postgres 이관 (멀티 레플리카) — `store.ts` 인터페이스만 교체
- 수익률 리플레이 — `orders` 테이블(append-only 이벤트 로그)만으로 계좌 재구성

## fit/ratio 주문 (v2 §6 — AI 트레이더 실행 계층 계약)

LLM이 수량이 아닌 **금액 의사(amountKrw)**만 출력하는 v2 계약(D7 개정)의 실행 착점. 수량 치환은 이 컨테이너가 **자기 원장과 함께 트랜잭션 안에서 원자 수행**한다 — 사전 계산의 TOCTOU 없음. 시세 조회는 일절 없다(quote ZERO): 잔고는 서버 원장 소유, 단가는 caller 입력.

```
# fit 매수 — qty = max q s.t. debit(q) ≤ min(amountKrw, cashKrw)   (debit = q×price + 수수료)
POST /v1/accounts/{id}/orders
{ "symbol": "093320", "side": "buy", "amountKrw": 300000, "priceKrw": 31100 }
→ 잔고 300,000원이면 qty=9 체결 (debit(9)=279,942 ≤ 300,000 < debit(10)=311,047)
→ 1주도 못 사면 400 unaffordable

# ratio 매도 — qty = floor(보유수량 × ratio), 전량=1.0 (priceKrw는 체결가 기록·정산용으로 여전히 필수)
POST /v1/accounts/{id}/orders
{ "symbol": "093320", "side": "sell", "ratio": 0.5, "priceKrw": 32000 }
→ 치환 결과 1주 미만이면 400 insufficient_ratio_quantity
```

- 모드 검증: `quantity | amountKrw(매수 전용) | ratio(매도 전용)` 중 **정확히 하나** — 위반 시 400 `invalid_order_mode`
- 수량 치환 수학은 `engine.ts`의 순수 함수(`fitBuyQuantity`·`resolveRatioQuantity`) — BigInt 정확 계산, 수수료 올림 포함
- 설계 원본: `docs/superpowers/specs/2026-11-19-ai-trader-multiturn-loop-design.md` §6
