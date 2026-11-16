# AI 트레이더 캐릭터 파이프라인 (매매 루프 + 메모리) — 설계 (이슈 #361)

- **작성일**: 2026-11-16
- **상태**: 초안 — 사용자 설계 승인 대기
- **추적**: GitHub #361 (2026-11-10 자루 회의 액션아이템) · 선행 PR #357 (`packages/paper-trade` 머지 c622828)
- **공수**: Phase 1 1~2일 · Phase 2 1~2일 · Phase 3 0.5~1일

## 1. 배경

2026-11-10 자루 회의에서 AI 트레이더 캐릭터 콘텐츠가 확정됐다(#361): **성향(투자 습관) × 매력(사연) × 무대(자루 세계관)** 조합, 금투협 5단계 성향 기반 **3~4명으로 시작**(안정/중립/공격+감정형, 예시 캐릭터 "소심이"). 콘텐츠 형태는 **주식일기 + AI 판단 로그 공개 + 매매 입증(사고/팔고) 기록 공개**, 목표치는 현금 기준(예: "여행자금까지 230만원").

PR #357 머지로 매매체결 원장(`packages/paper-trade`, quote ZERO·egress 0 순수 원장 상태기계)이 확보됐다. 본 설계는 paper-trade README "다음 단계 후보"의 **AI 트레이더 전략 워커** 자리에 앉는 오케스트레이터를 정의한다: 캐릭터의 매매 루프와, 원장에서 파생되는 **페르소나 메모리**(예: "저번달에 배당금 15만원 받아서 테슬라 FSD 값을 벌었다~!")를 쌓는 파이프라인.

## 2. 핵심 결정 사항

| # | 결정 | 내용 |
|---|---|---|
| D1 | **전역 단일 진실** | 캐릭터 1명 = 계좌 1개 = 메모리 1벌. **모든 유저가 동일한 상태·기록·콘텐츠를 봄** (#361: "모든 유저가 동일한 계좌 상태를 봄"). 개인화 없음 — 인플루언서를 팔로우해 보는 구조. 스키마에 `user_id` 없음, 유저별 분기 없음 |
| D2 | **원장=사실, 메모리=서사** | 기억 라인의 모든 숫자·사건은 원장(orders/ledger) 또는 등록된 사실 소스에서 온다. 라인마다 `source_order_ids`로 역추적 가능 — "소심이가 왜 15만원이라고 했나"에 답할 수 있어야 함 |
| D3 | **LLM 3곳만** | 매매 판단 로그 / 기억 컴파일 / 주식일기 생성. 요청 시점(서빙) 생성 없음 — **AOT(사전 컴파일) 패턴**으로 비용·일관성·검수 확보 |
| D4 | **paper-trade 불변** | quote ZERO·egress 0·시장가만 원칙 유지. 본 설계는 오케스트레이터 계층만 추가 (배당도 원장에 넣지 않고 별도 사실 소스, §6.1) |
| D5 | **서빙 숫자는 fresh** | 일기에 실리는 금액·수익률·목표 진행률은 매번 원장+시세로 계산해 주입. 메모리는 톤·연속성·내러티브만 담당 (스테일 숫자 방지) |
| D6 | **전용 메모리 스토어 (Honcho 기각)** | Supabase 테이블 + memory.md 뷰 렌더링. Honcho는 (a) 앱 사용자 메모리 모델이라 캐릭터=가공 페르소나와 불일치 (b) 3~4캐릭터×수백 줄은 전체 stuffing으로 충분 (c) 파생 메모리가 불투명해 매매 입증 역추적과 어긋남 (d) 자루 self-host 의존 = 프로덕 리스크. 이후 기억 검색 니즈(pgvector/Honcho) 발생 시 테이블 row 이관으로 확장 여지 유지 |
| D7 | **매매 결정=규칙 엔진, 판단 서사=LLM** | 주문 자체는 성향 파라미터 기반 결정론적 규칙이 생성(비용·재현성·입증). LLM은 그 결정의 "왜 샀다" 판단 로그와 서사를 생성 — "AI 판단 로그 공개"는 이 로그로 충족 |

## 3. 전체 구조

```
[매매 루프 — 정기 실행]                    [메모리 컴파일 — 장마감 후 1회]
 페르소나 카드 + 성향 파라미터              ① 원장 diff: GET /orders (watermark 이후)
 + 종목 유니버스                           ② event extractor (순수 코드) → typed events
        │                                  ③ memory compiler (LLM①) → 기억 라인 draft
        ▼                                  ④ compaction (LLM②, 조건부) → 월별 digest
 deepscan에서 현재가 조회 ──┐               ⑤ (검수) 마케터 승인 → published
        │                  │
        ▼                  ▼               [서빙 — 일 1회 생성 후 정적 캐싱]
 POST /orders {priceKrw}  ← quote ZERO      주식일기 (LLM③): 페르소나 + digest + 최근 기억
        │                                  + fresh 실시간 상태 → 캐시 → 모든 유저 동일 노출
        ▼
 paper-trade 원장 (orders/ledger/positions)
```

**paper-trade API ↔ 파이프라인 역할 매핑**

| API | 역할 |
|---|---|
| `POST /v1/accounts` | 캐릭터 생성 — 발급 `accountId`를 `ai_characters.paper_trade_account_id`에 매핑 |
| `POST /accounts/:id/orders` | 매매 루프 — 워커가 deepscan 현재가를 `priceKrw`로 실어 전송 |
| `GET /accounts/:id/orders` | 매매 입증 피드 = 메모리의 사실 소스. `idx_orders(account_id, created_at)`로 watermark diff |
| `GET /accounts/:id/positions` | 수량·평단만 제공 — 워커가 시세와 조합해 평가손익·목표 진행률 계산 (D5 fresh 숫자) |
| `GET /accounts/:id` | 실현손익·수수료 누계 — "골탕" 서사 grounding |
| `GET /accounts/:id/ledger` | 현금 흐름(deposit/buy/sell) — 현금 기준 목표치 마일스톤 계산 |

## 4. 데이터 모델 (Supabase 마이그레이션)

```sql
-- 캐릭터 레지스트리
create table ai_characters (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,              -- 'sosimi'
  display_name text not null,             -- '소심이'
  persona_card jsonb not null,            -- §7.1 구조
  strategy_params jsonb not null,         -- §5 성향 파라미터
  paper_trade_account_id text not null,   -- paper-trade 계좌 매핑
  initial_cash_krw bigint not null,
  cash_goal_krw bigint,                   -- 목표치 (현금 기준, 예: 2_300_000)
  memory_watermark text,                  -- 마지막으로 소비한 orders.created_at (KST ISO)
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 타입화된 사건 (규칙 기반 추출 — LLM 관여 없음)
create table character_events (
  id bigint generated always as identity primary key,
  character_id uuid not null references ai_characters(id),
  event_type text not null,               -- first_trade | trade_win | trade_loss | trade_blot |
                                          -- dividend_in | milestone_cash | drawdown | streak | idle
  occurred_at timestamptz not null,
  fact jsonb not null,                    -- { "amount_krw": 153450, "symbol": "005930", ... } — 숫자는 여기만
  source_order_ids text[] not null default '{}',   -- 매매 입증 역추적 링크 (배당 등 별도 소스는 빈 배열)
  source_kind text not null default 'paper_trade', -- paper_trade | dividend_feed | manual
  unique (character_id, event_type, occurred_at, source_kind)  -- 멱등
);

-- 페르소나 메모리 (memory.md의 물리적 실체)
create table character_memories (
  id bigint generated always as identity primary key,
  character_id uuid not null references ai_characters(id),
  kind text not null check (kind in ('episodic','digest')),  -- 줄 누적 vs 컴팩션
  content text not null,                  -- "(11-02) 배당금 15만원 들어옴 — 테슬라 FSD 값은 벌었다!!"
  event_id bigint references character_events(id),            -- digest는 null
  period text,                            -- digest 전용: '2026-10'
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now()
);
create index idx_memories_character on character_memories(character_id, kind, status, created_at desc);
```

## 5. 매매 루프 워커 (`packages/ai-trader`)

- **스택**: paper-trade와 동일하게 Hono + Bun. 상시 프로세스(내부 스케줄러) — Railway 서비스 1개
- **루프 단계**: 유니버스 후보(관심 종목 풀) → 성향 파라미터 필터/포지션 점검 → deepscan 현재가 → 주문 생성(규칙) → `POST /orders` → 판단 로그 생성(LLM①) → Supabase 저장
- **성향 파라미터** (`strategy_params` 예시 — 규칙 엔진의 입력):

| 파라미터 | 소심이(안정형) 예시 | 의미 |
|---|---|---|
| `maxPositionPct` | 0.10 | 종목당 최대 비중 |
| `maxDrawdownPct` | 0.05 | 손절 기준 |
| `maxSymbols` | 5 | 보유 종목 수 상한 |
| `tradeFrequency` | 'weekly' | 매매 빈도 상한 |
| `buyDipPct` / `takeProfitPct` | -0.03 / +0.08 | 반등 매수·익절 룰 |

- **판단 로그**: 주문(또는 보류)마다 "왜 이 결정인가"를 페르소카 카드 기반 LLM이 2~3문장으로 작성 → `character_events`(`fact.decisionRationale`) 또는 별도 로그 테이블에 저장, 콘텐츠 "AI 판단 로그 공개"의 원재료

## 6. 메모리 컴파일 파이프라인

### 6.1 사실 소스와 event extractor (순수 코드)

- **소스 1 — paper-trade 원장**: `GET /orders`를 `created_at > memory_watermark`로 조회(인덱스 활용). 처리 완료 후 watermark 전진 — 재시작/재시행 시 중복 없음(멱등은 unique 제약이 이중 방어)
- **소스 2 — 배당 피드(별도)**: 원장엔 dividend 타입이 없으므로(D4) 배당 일정 데이터를 워커가 조회해 `dividend_in` 이벤트로 주입. 한국 주식 배당은 연 1회 결산이 대부분이라 월 1회 배치면 충분
- **소스 3 — 파생 마일스톤**: 원장+시세로 계산한 목표 진행률 임계(50%·75%·100%), 최대 낙폭, 연속 손절 등을 `milestone_cash` / `drawdown` / `streak` 이벤트로
- **추출 규칙은 코드로 튜닝**: "무엇이 기억할 만한 사건인가"의 정의를 프롬프트가 아니라 이 계층에서 관리 — 숫자 검증·임계값 조정을 코드 리뷰로

### 6.2 memory compiler (LLM②)

입력: 페르소나 카드 + 최근 기억 30줄 + 신규 `character_events`(fact 포함). 출력: 기억 라인 1~3개 (draft).

프롬프트 규칙:
- 한 줄 = 한 사실 + 페르소나 반응. `(MM-DD)` 날짜 스탬프
- **숫자·종목은 fact JSON에서만** — LLM은 창작하지 않고 말투만 입힘
- **해외 자산·가격은 비유로만** (원장은 한국주식·6자리만: "테슬라 FSD 값"은 환산 비유 프레임으로 허용, 실제 매수 사실로 금지)
- 줄은 자기완결적(컴팩션 안전) — 앞 줄을 암시하지 않음

### 6.3 컴팩션

- 조건: 캐릭터별 published episodic > 60줄 or 월 경계
- 지난 구간 라인들을 LLM이 월별 digest로 압축(3~5줄) → `kind='digest'`, `period='2026-10'`. 원본 라인은 삭제하지 않고 `archived`로 보관(회상·감사 대응)
- 프롬프트 조립 시 digest는 최상단, episodic은 최근순 — Hermes식 2계층 구조

## 7. 서빙 — 주식일기

### 7.1 프롬프트 조립 (memory.md 뷰)

```
[소심이 페르소나 카드 — 성향/말투/집착/목표: 여행자금 230만원]

## 지난 기록 (digest)
2026-10: 배당수입 누계 32만원. 삼성전자 -8% 손절 후 반등 목격. 여행자금 60% 달성.

## 최근 기억 (episodic)
(11-02) 배당금 15만원 들어옴 — 테슬라 FSD 값은 벌었다!! 근데 안 쓴다, 저금한다
(11-05) 삼성전자 10주 매수 — 다들 무섭대? 난 떨리면 산다… 사실 손떨림

## 실시간 상태 (메모리 아님 — 원장+시세에서 방금 계산, D5)
현금 430,000원 · 삼성전자 10주 평가손익 +3.2% · 여행자금 진행률 64%
+ 오늘의 판단 로그 (§5)
```

### 7.2 생성·노출

- **일 1회 생성 후 캐싱**: 모든 유저가 같은 일기를 보므로(D1) 요청별 LLM 호출 0원 — AOT 패턴이 필수 조건이 되는 지점
- 노출: 캐릭터 페이지/피드. 유저별 상태(팔로우·알림)는 캐릭터 상태와 분리된 유저측 레이어(범위 외)

## 8. 구현 단계

| Phase | 범위 | 완료 기준 |
|---|---|---|
| 1 | `packages/ai-trader` 스켈레톤: 계좌 매핑 + 매매 루프(수동 트리거) + 판단 로그 | 캐릭터 1명("소심이")의 주문이 원장에 쌓이고 판단 로그 저장. paper-trade 테스트 27/27 회귀 통과 |
| 2 | Supabase 마이그레이션(§4) + event extractor + memory compiler + compaction | 원장 diff → 기억 라인 draft → published까지 E2E. extractor 순수 함수 테스트 + compiler 산출물 검수 게이트 |
| 3 | 주식일기 생성·캐싱 + 캐릭터 노출 페이지 | 일 1회 생성, 모든 유저 동일 응답 |

## 9. 비용 구조

딥스캔 1회 LLM 원가 10~17원 감각 기준: 캐릭터 4명 × 일 (판단 로그 수 회 + 기억 컴파일 1회 + 일기 1회) ≒ **일 수십~수백 원**. 서빙은 캐싱으로 0원(D1·D3의 직접 이득).

## 10. 범위 외 (후속 과제 기록)

- 지정가 주문(paper-trade 후보에 병행)
- 유저 반응 레이어: 팔로우·알림·댓글 (캐릭터 상태와 분리된 유저측 상태)
- 배당의 원장 반영(필요 시 paper-trade 확장 — 현 설계는 별도 피드 유지)
- 십이지신 등 시즌 이벤트 캐릭터 (#361 회의 분류)
- 기억 검색(pgvector/Honcho 이관) — 캐릭터 수십 명·장기 아카이브 시 재검토
