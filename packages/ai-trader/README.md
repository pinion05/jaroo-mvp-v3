# jaroo-ai-trader

JAROO AI 트레이더 캐릭터 **오케스트레이터** — 성향 규칙 매매 루프 + 판단 로그(Phase 1 스켈레톤).

- 설계 문서: `docs/superpowers/specs/2026-11-16-ai-trader-character-pipeline-design.md` (이슈 #361, 2026-11-10 자루 회의)
- Phase 1 완료 기준: 캐릭터 1명("소심이")의 주문이 paper-trade 원장에 쌓이고 판단 로그가 저장됨
- 에이전트가 아니라 **LLM 절차가 포함된 워크플로우**다 — 매매 결정은 결정론적 규칙 엔진(spec D7), Phase 2에서 서사(판단 로그 고도화·기억 컴파일·주식일기)에 LLM이 합류

## 데이터 책임 분할 (paper-trade README 계승·확장)

```
[ai-trader 워커 — 이 컨테이너]              ← 판단·서사 책임
   ① 시세 조회: web/crawler API (시세 소유자)     ← quote는 여기서만 등장
   ② 규칙 엔진 판단 (순수 함수, 결정론)
   ③ POST /orders {.., priceKrw} — 가격을 실어 보냄
   ④ 판단 로그 저장 (SQLite journal)
        │
        ▼
[paper-trade 컨테이너]                       ← 원장·체결 사실 책임 (불변)
   계좌·포지션·체결·현금원장 (quote ZERO · egress 0)
```

- **캐릭터 = 계좌 1개** (spec D1): 모든 자루 유저가 동일한 상태·기록을 봄 — 개인화 없음, `user_id` 없음
- **원장=사실, 서사=판단 로그** (spec D2): 판단 로그의 모든 숫자는 원장/시세에서 온 `fact`로 기록 — 역추적 가능
- 판단 로그는 매수/매도/**관망** 전부 기록한다 ("AI 판단 로그 공개" 원재료, 회의 #361)

## 스택

Hono + Bun + `bun:sqlite` (paper-trade와 동일 — 의존성 hono 하나).

## 성향 규칙 엔진 (`src/strategy.ts`)

순수 함수 `synthesizeDecisions({ params, watchlist, snapshot, quotes, nowMs })` — I/O 없음, 같은 입력에 같은 출력.

| 규칙 | 내용 | 우선순위 |
|---|---|---|
| 손절 | 평단 대비 `-maxDrawdownPct` 도달 시 전량 매도 | 1 (빈도 게이트 무시 — 리스크 관리는 대기하지 않는다) |
| 익절 | 평단 대비 `+takeProfitPct` 도달 시 전량 매도 | 1 |
| 빈도 게이트 | 마지막 체결로부터 `tradeFrequency`(daily/weekly) 창 미경과 시 신규 매수 보류 | 2 |
| 배분 매수 | 종목당 `maxPositionPct` 한도, `maxSymbols` 상한, dip 조건(`buyDipPct` 이하일 때만, 등락률 미제공 시 생략) | 3 |

소심이(안정형) 기본값: `maxPositionPct=0.10, maxDrawdownPct=0.05, takeProfitPct=0.08, maxSymbols=5, tradeFrequency=weekly, buyDipPct=-0.03` — 초기자본 100만원, 목표치(현금 기준) 230만원.

## API

모든 응답은 `{ ok: true, data }` 또는 `{ ok: false, error: { code, message } }` (paper-trade 계승).

| Method | Path | 설명 |
|---|---|---|
| GET | `/v1/characters` | 캐릭터 목록 (레지스트리 + 계좌 매핑 상태) |
| POST | `/v1/characters/:slug/bootstrap` | 계좌 부트스트랩 — 매핑 없으면 paper-trade 계좌 생성 (멱등) |
| POST | `/v1/characters/:slug/loop` | **매매 루프 1회 수동 실행** (Phase 1: 수동 트리거만) |
| GET | `/v1/characters/:slug/journal?limit=` | 판단 로그 (매수/매도/관망 전부) |
| GET | `/v1/characters/:slug/orders` | 매매 입증 피드 — paper-trade 원장 패스스루 |

### 실행 예시

```bash
# ① paper-trade 기동 (원장)
npm run start:paper-trade

# ② ai-trader 기동 — dev/E2E는 static 시세(코드:원:일등락률%)
QUOTES_MODE=static STATIC_QUOTES='005930:70000:-3.5,000660:180000:1' npm run dev:ai-trader

# ③ 부트스트랩 + 루프 수동 실행
curl -s -X POST http://localhost:3042/v1/characters/sosimi/bootstrap
curl -s -X POST http://localhost:3042/v1/characters/sosimi/loop | jq

# ④ 판단 로그 / 원장 입증
curl -s 'http://localhost:3042/v1/characters/sosimi/journal?limit=10' | jq
curl -s http://localhost:3042/v1/characters/sosimi/orders | jq
```

운영(`QUOTES_MODE=web`)은 `QUOTES_BASE_URL`(기본 `http://localhost:3000`)의 `/api/quotes/current?codes=` 를 조회한다. 현재 시세 소스는 등락률을 제공하지 않아 dip 게이트가 생략되고 배분 매수만 동작한다 — 등락률 공급 시 자동으로 dip 게이트가 활성화된다.

## 판단 로그 (judgment_logs)

| 컬럼 | 의미 |
|---|---|
| `decision` | buy / sell / hold |
| `reason_code` | stop_loss · take_profit · dip_buy · allocation_buy · frequency_gate · position_cap · cap_below_minimum · insufficient_cash · no_signal · quote_missing |
| `fact` | 근거 숫자(JSON) — 서사가 참조할 수 있는 유일한 숫자 원천 (spec D2) |
| `rationale` | 템플릿 서사 — Phase 2에서 LLM①이 페르소나 카드 기반으로 대체 |
| `order_id` | paper-trade 체결 시 연결 (입증) |

## 다음 단계 (Phase 2+ — spec §8)

- Supabase 이관: `ai_characters` / `character_events` / `character_memories` (메모리 파이프라인)
- LLM 판단 로그(페르소나 목소리) + 기억 컴파일러 + 컴팩션
- 정기 실행 스케줄러(장마감 후) + 캐릭터 3~4명 확장
- Phase 3: 주식일기 서빙(일 1회 생성·캐싱 — 모든 유저 동일)

## 테스트

```bash
npm run test:ai-trader   # 루트에서
bun test                 # 패키지 안에서
```
