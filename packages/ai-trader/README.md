# jaroo-ai-trader

JAROO AI 트레이더 캐릭터 **오케스트레이터 골격** — 계좌 매핑·상태 적재·판단 로그 저장 (v2 정리 후).

- 설계: [캐릭터 파이프라인 #361](../../../docs/superpowers/specs/2026-11-16-ai-trader-character-pipeline-design.md) · [다중턴 루프 v2](../../../docs/superpowers/specs/2026-11-19-ai-trader-multiturn-loop-design.md)
- **제품 정의**: 판단은 ⑤ 매매 결정 턴의 페르소나 LLM이 — deepscan 위원회는 **조언**(hero 점수+세 팀 요약, 사용자와 동일한 아티팩트)이고 최종 결정은 캐릭터다. deepscan 홍보용 바이럴 기능.
- **v2 정리(2026-11-19)**: 시세 규칙 결정 엔진·템플릿 서사·정적 reason_code·성향 파라미터 필터는 **폐기** (D7/D8/D10 개정). 성향은 캐릭터 카드의 자기 원칙 문구(소프트).

## 이 패키지가 소유하는 것 (생존 자산)

| 자산 | 내용 |
|---|---|
| 캐릭터 레지스트리 | 캐릭터=계좌 1개(spec D1, 모든 유저 동일 뷰) — 계좌 부트스트랩 멱등. 시드: 소심이(v1 안정형) + 소스 페르소나 3인(차트콕·뉴스콕·재무콕) |
| [phase=load] 상태 적재 | 원장(paper-trade)×시세 조합 fresh 스냅샷 — 평가손익·목표 진행률(D5) |
| 판단 로그(judgment_logs) | ⑤ 결정+체결 결과의 영속화 — `fact`에 리포트 근거(debugId·heroScore…, D9). 결정은 하지 않고 **저장만** |
| 원장 패스스루 | 매매 입증 피드 (paper-trade orders) |

결정(⑤ LLM 턴)·덤프 빌더·②흥미 선정·실행 계층 물리 가드레일(fit/ratio)은 구현 2.5a/2.5b/3에서 합류.

## 데이터 책임 분할 (paper-trade README 계승·확장)

```
[ai-trader 골격 — 이 컨테이너]            ← 매핑·적재·판단 로그 소유
   ① paper-trade 원장 조회 (사실의 소스)
   ② 시세 조회 (체결가·평가용 — 판단 소스 아님, D10)
   ③ 판단 로그 저장 (⑤ 실행 계층이 전달하면)
        │
        ▼
[paper-trade 컨테이너]                    ← 원장·체결 사실 책임 (불변)
   계좌·포지션·체결·현금원장 (quote ZERO · egress 0)
```

## 스택

Hono + Bun + `bun:sqlite` (런타임은 #368 Node 사이드카 방향과 정렬해 Node 전환 예정).

## 마이그레이션

스타트업마다 `migrations/*.sql`을 파일명순 전체 재적용(DDL 멱등). **한 번 적용한 마이그레이션 파일은 수정 금지 — 항상 새 파일(0003+) 추가** (in-place 수정은 #373·ae04121 두 번 사고 전례 — 기존 DB에 반영되지 않는다). 이력:

- `0001` — 초기 스키마 (characters + judgment_logs)
- `0002` — `order_status` 어휘 `placed`→`filled` 전환 (#373 후속): 기존 dev DB의 구 CHECK를 테이블 재구축으로 교체하고 `placed` 행을 `filled`로 변환(기존 기록 보존). **수동 재구축 불필요 — 구 DB로 그냥 기동하면 자동 전환됨**. ⚠️ **forward-only**: 0002 적용 DB에 이전 빌드(`placed` INSERT)로 롤백하면 판단 로그 기록이 전면 실패한다 — 롤백은 코드 되돌리기가 아니라 DB 재생성으로

## API

모든 응답은 `{ ok: true, data }` 또는 `{ ok: false, error: { code, message } }`.

| Method | Path | 설명 |
|---|---|---|
| GET | `/v1/characters` | 캐릭터 목록 (자기 원칙 문구 포함) |
| POST | `/v1/characters/:slug/bootstrap` | 계좌 부트스트랩 — 매핑 없으면 paper-trade 계좌 생성 (멱등) |
| POST | `/v1/characters/:slug/load` | **[phase=load]** 턴 출발 상태 적재 — 원장×시세 fresh 스냅샷 |
| POST | `/v1/characters/:slug/judgments` | 판단 로그 저장 — ⑤ 결정(`decision`·`reasonCode` 자유태그·`fact` 근거·`rationale` 서사)+체결 결과 |
| GET | `/v1/characters/:slug/journal?limit=` | 판단 로그 조회 |
| GET | `/v1/characters/:slug/orders` | 매매 입증 피드 — paper-trade 원장 패스스루 |

### 판단 로그 저장 예시

```json
POST /v1/characters/sosimi/judgments
{
  "decision": "sell", "symbol": "093320", "quantity": 4, "priceKrw": 31100,
  "reasonCode": "thesis_invalidated",
  "fact": { "sellRatio": 0.5, "debugId": "ds_...", "heroScore": 38 },
  "rationale": "위원회 약화와 내 stop 관점이 일치 — 절반 정리",
  "order": { "orderId": "od_...", "orderStatus": "filled" }
}
```

## 시세 프로바이더

- `QUOTES_MODE=web`(기본): `{QUOTES_BASE_URL}/api/quotes/current?codes=` 소비 (crawler 프록시)
- `QUOTES_MODE=static`: `STATIC_QUOTES='005930:70000:-3.5'` (코드:원:일등락률%) — dev/E2E용

## 테스트

```bash
npm run test:ai-trader   # 루트에서
bun test                 # 패키지 안에서
```
