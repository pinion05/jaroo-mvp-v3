# AI 트레이더 캐릭터 파이프라인 (매매 루프 + 메모리) — 설계 (이슈 #361)

- **작성일**: 2026-11-16 · **개정**: 2026-11-16 (판단 입력 deepscan 전환) · **개정**: 2026-11-19 (**D7·D8·D10 v2 개정** — [다중턴 루프 설계 v2](./2026-11-19-ai-trader-multiturn-loop-design.md) 원본 반영)
- **상태**: 초안 — 사용자 설계 승인 대기
- **추적**: GitHub #361 (2026-11-10 자루 회의 액션아이템) · 선행 PR #357 (`packages/paper-trade` 머지 c622828)
- **공수**: Phase 2.4a 0.5일 · 2.5a/2.5b 1~2일 · Phase 3 1~2일 · Phase 4 0.5~1일

> **제품 정의 (2026-11-16 사용자 지시)**: AI 트레이더는 **jaroo app의 deepscan AI 위원회가 사용자에게 보여주는 것과 동일한 리포트**를 기반으로 판단하고, **성향대로** 거래한다. 이 기능은 **jaroo deepscan을 홍보하기 위한 바이럴 기능**이다 — 캐릭터의 매매 입증이 곧 deepscan 성능의 입증이어야 한다.

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
| D7 | **룰엔진=물리 가드레일 집행만, 결정+서사=⑤ 페르소나 LLM** (2026-11-19 v2 개정) | 룰엔진(코드)은 물리 제약만 집행한다 — 단가=실행 시점 시가 고정, 수량=fit/ratio 치환, 가용잔고·보유수량 상한. **BUY/SELL/HOLD 결정과 서사는 페르소나 LLM이 ⑤ 매매 결정 턴에서 한 몸으로 출력**한다. LLM은 단가·수량 계산에서 완전 배제, LLM 위반 시도는 실행 계층이 거부+로그 |
| D8 | **deepscan = 조언(가중치), 정적 게이트 폐지** (2026-11-19 v2 개정) | 리포트에서 **hero 점수 + 세 팀 요약 3청크**(웹 UI `TEAM_PRESENTATION_ORDER`와 동일 아티팡트 — 팀 요약은 스냅샷에 영속화)를 ⑤ 꼬리에 "조언"으로 실는다 — "이것은 조언이다. 최종 결정은 당신이다". 정적 임계 컷(minHeroScore 게이트 등)은 폐지: hero 점수 ±3 확률성이 임계 컷에서 오실레이션(48사고 44팔고)을 만들기 때문. 위원회 9인 내부 파이프라인은 불투명 함수로 존치, 계약은 경계 덤프(요청 파라미터+응답 스냅샷+scan id)만 |
| D10 | **매매는 LLM 판단에서만 발생, 하드 강제는 물리 제약만** (2026-11-19 v2 개정) | 계좌보호 밴드(손절/익절 강제)·날짜 규칙(당일 재매수 금지 등) 전부 폐지. 시세는 체결가 전달용(quote ZERO 불변)이며, memory-derived 정책(쿨다운·집중도·연속 손실 축소·목표 근접 중단)은 **전부 소프트** — 해당 사실을 ⑤ 꼬리에 주입만 하고 판단은 페르소나 재량. 성향(소심/대담)도 캐릭터 카드의 자기 원칙 문구로 표현(스스로 깰 수도, 그것도 서사) |
| D9 | **입증 체인 = 판단 로그 × deepscan 리포트 × 원장** | 판단 로그 `fact`에 근거 리포트의 추적 키(`metadata.debugId`·`generatedAt`·heroScore·recoveryPct·targetPrice)를 구조적으로 기록. "캐릭터가 왜 샀나" → deepscan 리포트 → paper-trade `orderId` 체인이 바이럴 콘텐츠의 핵심 증거다. v2 확장: `thesis_id`(진입 테제 링크)·`decision_dump_ref`(⑤ 호출 스냅샷 포인터) 추가 |

## 3. 전체 구조

```
[매매 턴 — v2 통합 파이프라인 (매수 모드 = 보유 0개의 특수사례)]     [메모리 컴파일 — 턴 종료 후]
 [phase=load]    원장·시세·기억·활성 테제 적재 (코드)               ① 원장 diff: GET /orders (watermark)
 [phase=dump]    소스 덤프×3(뉴스/차트/재무) + 보유 섹션             ② event extractor (코드) → typed events
 [phase=interest] ② 흥미 종목 선정 턴 (LLM #1 — 캐릭터당 1회)        ③ memory compiler (LLM) → 기억 라인
                 {신규|보유 재확인|관심 소멸} + 근거                  ④ compaction (조건부) → 월별 digest
 [phase=scan]    스캔 집합 = 흥미 ∪ 보유(전부) → ④ 딥스캔            ⑤ (검수) 마케터 승인 → published
                 불투명 함수 호출 → 조언 생산 (D8)
 [phase=decide]  ⑤ 매매 결정 턴 (LLM #2 — prefix 캐시 재사용)        [서빙 — 일 1회 생성 후 정적 캐싱]
                 같은 [시스템+덤프] prefix + 꼬리(조언·테제·기억·    일기 (LLM #3): 페르소나 + digest + 기억
                 계좌 fact) → BUY/SELL/HOLD + amountKrw + 서사        + 어제 일기 + fresh 상태 → 모든 유저 동일
 [phase=execute] 물리 가드레일 (D7) — 시가 고정·fit/ratio 치환
                 paper-trade POST /orders → 판단 로그(D9 근거)
 [phase=compile] 턴 종료 — 이벤트 추출·기억·일기 → completed
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

## 5. 매매 턴 워커 (`packages/ai-trader`)

- **스택**: paper-trade와 동일한 상시 프로세스 — 런타임은 #368(Node 사이드카) 방향과 정렬해 Node(node:sqlite)로 통일 예정
- **턴 구조**: v2 통합 파이프라인(§3) — `trading_sessions` 상태머신이 phase(load→dump→interest→scan→decide→execute→compile→completed)를 기록하고, 재시작은 미완료 phase부터 재개(멱등). 매수 모드는 보유 0개의 특수사례일 뿐 별도 경로가 아니다. **턴은 호출 1회 = 세션 단위** — '당일' 같은 날짜 판단 규칙은 시스템에 존재하지 않는다(영업일 1회 스케줄은 운영 기본값일 뿐)
- 상세(덤프 명세·프롬프트 레이어링·출력 스키마)는 [v2 설계](./2026-11-19-ai-trader-multiturn-loop-design.md) §3~§5가 원본

### 5.1 deepscan 소비 경로 — 조언(가중치) (D8)

- 소비 경로는 종전과 동일: **캐릭터 전용 서비스 계정(또는 서비스 롤 대리 실행)으로 web `/api/deepscan` 내부 호출**만이 "사용자와 동일한 산출물"을 보장한다(스냅샷·기록 user_id 스코프, RLS deny-all, holding 주입으로 캐릭터 개인화). 매 실행의 `debugId`·스냅샷이 D9 추적 키로 재사용된다
- **역할 변경(2026-11-19)**: ⑤ 꼬리에 실리는 것은 **hero 점수 + 세 팀 요약 3청크**뿐 — 웹 UI 로딩 화면의 세 팀 카드와 문장 단위 동일한 아티팩트(팀 요약 스냅샷 영속화 재사용). **페르소나가 보는 조언 = 사용자가 웹에서 보는 조언**. 전문 리포트는 경계 덤프(요청 파라미터+응답 스냅샷+scan id)로 저장만 하고 ⑤에는 슬림 뷰만

### 5.2 성향 — 캐릭터 카드의 자기 원칙 문구 (2026-11-19 폐지 확정)

정적 성향 파라미터 필터(minHeroScore·entrySizingPct·손절/익절 밴드 등)는 **전부 폐지**되었다. 성향(소심/대담)은 캐릭터 카드의 **자기 원칙 문구**로 표현되며 — 소프트다: 페르소나가 자기 원칙을 스스로 깰 수도 있고, 그것도 서사다. memory-derived 사실(연속 손실·보유 종목 수·현금 비율·목표 진행률 등)은 ⑤ 꼬리에 **사실로만 주입**되고 buy/sell/hold·amountKrw 판단은 전적으로 페르소나 LLM 재량이다. 판단 로그에 주입된 기억 중 참조한 항목을 기록(관측 전용) — 반복 병리가 통계로 확인되면 특정 규칙만 사후 승격 검토

### 5.3 실행 계층 — 물리 가드레일만 (D7·D10)

- **LLM은 금액 의사(`amountKrw`)만 출력** — 단가·수량 계산에서 완전 배제. 실행 계층이 단가를 실행 시점 시가로 고정하고 수량을 치환한다
- **paper-trade `fit` 모드(§6 v2)**: `qty = max q s.t. debit(q) ≤ min(amountKrw, cashKrw)` — 수수료 포함, 엔진 트랜잭션 안에서 원자 처리(잔고 읽기→수량 계산→체결, TOCTOU 제거). `qty ≥ 1`이면 체결, `qty = 0`이면 `unaffordable` 에러. 매도는 `ratio` 모드(`qty = floor(보유수량 × ratio)`)
- LLM 위반 시도(잔고 초과·보유수량 초과 매도 등 물리 제약)는 실행 계층이 거부+로그. **밴드 강제 매도·날짜 규칙 같은 판단성 강제는 존재하지 않는다**

### 5.4 Phase 1 임시 시세 규칙 — 폐기 완료 (2026-11-19)

PR #367 초안의 규칙 엔진(dip 매수·손절/익절 밴드·빈도 게이트·포지션 cap)은 루프 골격 검증용 임시 판단 소스였으며, **C1 정리에서 코드에서도 제거된다**. 생존 자산(paper-trade 클라이언트·계좌 부트스트랩·저널 스토어·판단 로그 골격·수동 트리거)만 남는다.

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
[소심이 페르소나 카드 — 성향/말투/집착/목표 + 자기 원칙 문구(§5.2)]

## 지난 기록 (digest — 컴팩션)
2026-11 상반: 쐐기 2승 1패. 평균 손실 -3.1%로 얕았다.

## 최근 기억 (episodic)
(11-19) 케이아이엔엑스 쐐기 실패 — 규칙대로 컷. -4.2%
(11-21) 계룡건설 삼각형 확정 진입 — target 33,142까지 3개 남아

## 어제까지 일기 (최근 3~5건 — 문체·다짐 회상용, v2 §8)
(11-21) "이번 쐐기는 그림이 깨끗하니 stop만 지키면 이긴다."

## 오늘의 사실 (fresh — 원장+시세에서 방금 계산, D5)
보유 3종목 평가손익 +2.1% · 현금 830,000원 · 목표 진행률 64%
오늘 결정: [sell 0.5] 케이아이엔엑스 — 위원회 강세지만 소스 이탈 겹침 · [hold] 계룡건설

→ 2문단 일기. 없는 사실 금지(기존 규칙 승계).
```

### 7.2 생성·노출

- **일 1회 생성 후 캐싱**: 모든 유저가 같은 일기를 보므로(D1) 요청별 LLM 호출 0원 — AOT 패턴이 필수 조건이 되는 지점
- 노출: 캐릭터 페이지/피드. 유저별 상태(팔로우·알림)는 캐릭터 상태와 분리된 유저측 레이어(범위 외)

## 8. 구현 단계 (2026-11-19 v2 개정)

| Phase | 범위 | 완료 기준 |
|---|---|---|
| 1 (PR #367 — C1 정리) | 스켈레톤: 계좌 매핑 + 수동 트리거 + 판단 로그 골격. **임시 시세 규칙 엔진은 C1에서 제거됨** | 생존 자산만으로 테스트 통과 |
| **2.4a** (선행) | **paper-trade `fit` 모드**(amountKrw→수량 원자 치환, 수수료 포함) + `ratio` 매도 | 잔고 30만원·amountKrw 100만원·시가 31,100 → **9주 체결** 단위 테스트. quote ZERO 무결 확인 |
| **2.5a** | `position_theses` + `trading_sessions`(v2 phase) 마이그레이션 0003, 통합 턴 골격, 덤프 빌더(소스×3+보유 섹션) 골든 테스트 | 수동 턴 1회 = load→compile 재개 가능. 덤프 바이트 재현 |
| **2.5b** | ②흥미 턴 3상태(신규/재확인/소멸) + ⑤ 결정 턴(prefix 캐시 재사용 검증) + 조언 블록(팀 요약 재사용) | 동일 턴 ②→⑤ 캐시 hit 확인. 결정·서사 동시 출력 |
| **3 개정** | 실행 계층 물리 가드레일(시가 고정·fit·ratio) + ⑤ 꼬리 fact 주입 + 메모리 파이프라인 + `diary_entries` | 물리 제약 위반 거부 로그 1건 이상. 일기 2일 연속 회상 |
| **3.5 (#378, 2026-11-23 배치)** | **ai-trader Bun→Node 사이드카 전환**(node:http·node:sqlite, 런타임 의존성 0) + entrypoint 4번째 프로세스 편입 + #375 입력 검증·#376 read 방어·#377 CI 편입 동반 | prod 컨테이너에서 ai-trader 상시 기동, `/api/ai-trader/ledger` prod 정상화. v2 시안 §10 상호 참조 |
| **4 개정** | 턴 자동화(영업일 스케줄) + 캐릭터 노출 | 무인 2주 운영, 재시작 0건 유실 |

**Phase 2.4a가 선행하는 이유**: ⑤ LLM이 `amountKrw` 의사만 출력하는 v2 계약(D7)의 실행 착점이 paper-trade fit 모드다 — 없으면 2.5b 결정 턴을 실행까지 검증할 수 없다.

## 9. 비용 구조 (v2 §13 반영)

- **deepscan 실행**: 스캔 집합 = 흥미 ∪ 보유 전부(매턴) — 3캐릭터 × (흥미+보유) × 15영업일 × 10크레딧(prod). dev 무과금. 스냅샷 캐시로 종목 중복 절감
- **LLM**: 캐릭터당 턴 4호출 — ②흥미(덤프 대량·캐시 흡수) + ⑤결정(덤프 prefix 캐시 hit, 꼬리만 과금) + 기억 컴파일 + 일기. **일 수십~수백 원/캐릭터** (기존 추정 유지). 서빙은 캐싱으로 0원(D1·D3)

## 10. 범위 외 (후속 과제 기록)

- **watchlist 발굴의 deepscan 기반 전환**(§5.1 연장 — 상위 score 종목 자동 후보화): Phase 2에서 시드 watchlist 유지 후 별도 결정
- 지정가 주문(paper-trade 후보에 병행)
- 유저 반응 레이어: 팔로우·알림·댓글 (캐릭터 상태와 분리된 유저측 상태)
- 배당의 원장 반영(필요 시 paper-trade 확장 — 현 설계는 별도 피드 유지)
- 십이지신 등 시즌 이벤트 캐릭터 (#361 회의 분류)
- 기억 검색(pgvector/Honcho 이관) — 캐릭터 수십 명·장기 아카이브 시 재검토
