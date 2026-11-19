# 소스별 AI 트레이더 발굴 파이프라인 (issue #369 멀티소스 v1)

## v2 덤프 빌더 (2.5a — [시안 v2](../../docs/superpowers/specs/2026-11-19-ai-trader-multiturn-loop-design.md) §4)

`dump-builder.mjs`는 ②흥미 선정 턴과 ⑤매매 결정 턴이 **바이트 단위로 공유하는** 반고정층
(소스 블록 + 보유종목 섹션)을 조립한다. 같은 입력 → 항상 같은 바이트(sha256 검증, 골든 테스트).

```bash
node scripts/ai-trader/dump-builder.mjs --self-test                       # 해시 안정성 확인
node --test scripts/ai-trader/test/dump-builder.test.mjs                  # 골든 6종
node scripts/ai-trader/dump-builder.mjs --source chart \
  --source-snapshot output/discovery-source-YYYYMMDD-HHMM.json \
  --holdings holdings.json --as-of 2026-11-19 --out output/dump-chart.md
```

- holdings.json: paper-trade 장부 스냅샷(code/name/quantity/avgPriceKrw/currentPriceKrw/openedAt/thesis.entryReasons)
- 보유종목 오늘 증거는 `withEvidence()`가 이미 수집한 소스 데이터에서 뽑는다(추가 호출 없음):
  [차트] 상위 후보 등장/이탈 · [재무] 랭크/권외 · [뉴스] 언급 N건/언급 없음

---

2026-11-19. 캐릭터 3인이 **각각 다른 데이터 소스만** 보고 종목을 발굴하고, 긍정 픽에
딥스캔을 돌려 성향 게이트로 매수를 판정한다. 기존 뉴스 단일 소스(소심이/돌진이/배당콕)
파이프라인은 그대로 두고, 새 세트가 나란히 돈다.

```
[뉴스콕]  네이버 메인뉴스 50건 (:13020)  ──┐
[차트콕]  차트 패턴 점수 상위 (:13100)    ──┼─→ 페르소나 렌즈 재해석(LLM) ─→ 긍정/부정 픽
[재무콕]  재무 스코어 상위 (:8088)        ──┘         (인사이트 + json)        │
                                                                        딥스캔 (jaroo /api/deepscan)
                                                                                │
                                                            성향 게이트(문턱) → sizing → draft5-source-live.json
```

## 캐릭터

| 캐릭터 | 소스 | 성향 | 게이트 문턱(hero) |
|---|---|---|---|
| 뉴스콕 | `news` — 네이버 메인뉴스 50건 | 속보 중독. 이슈·수급 모멘텀. 뉴스에 없으면 관심 밖 | 45 |
| 차트콕 | `chart` — krchart 상승 25 + 하락 15 후보 | 패턴·추세만 믿음. 그림 지저분하면 상승 후보도 거름 | 50 |
| 재무콕 | `finance` — dart-fs 재무 스코어 상위 30 | 숫자만 믿음. 총점 높아도 구멍(F-Score·성장성) 있으면 경계 | 55 |

"상위 후보를 페르소나 렌즈로 재해석"이 핵심 동작이다 — 순위를 그대로 통과시키지 않는다.
예(재무콕 실측): 총점 98.9 크리에이츠를 "성장성 15로 상위권 최저 — 성장 정체가 총점에 가려진
구멍"으로 부정 분류, 유비쿼스(총점 91)는 "F-Score 8에 건전성 25 — 점수 대비 속이 단단하다"로 긍정.

## 데이터 소스

| 소스 | 엔드포인트 | 비고 |
|---|---|---|
| 뉴스 | `GET :13020/api/news?limit=50&fresh=1` | naver-mainnews-crawler (Rust, systemd `naver-news-demo`) |
| 차트 | `GET :13100/api/screener?top=25&direction=bullish&sort=rank` (+ `bearish`) | krchart — 후보에 `top_score`·패턴·목표/손절 포함 |
| 재무 | `GET :8088/api/scores/rank?top=30` | dart-fs-crawler 커밋 `cd5e68b` — 2,094종목 채점, 첫 요청 ~11s 후 캐시 |

차트·재무 픽은 후보 행에서 종목코드가 확정되어 딥스캔에 직결된다. 뉴스 픽은 기존처럼
`instrument-universe.json` 이름 해석을 거친다.

## 사용

```bash
# 발굴만 (LLM 3회, ~$0.004)
node scripts/ai-trader/discovery.mjs
node scripts/ai-trader/discovery.mjs --only chart            # 단독 실행
node scripts/ai-trader/discovery.mjs --bullish 25 --bearish 15 --finance-top 30

# 풀 파이프라인 (발굴 → 딥스캔 → 게이트 → AI 일기) — web(3002)+crawler(3040) 기동 후
PORT=3002 npm run dev                                        # 별도 터미널
CHAR_SET=source node scripts/ai-trader/run-pipeline.mjs      # → public/ai-trader/draft5-source-live.json
node scripts/ai-trader/run-pipeline.mjs                      # 기존 세트(소심이/돌진이/배당콕) — 그대로
```

산출물:
- `scripts/ai-trader/output/discovery-source-{stamp}.{json,md}` — 발굴 결과(소스 원본 후보 + 3인 인사이트·픽)
- `public/ai-trader/draft5-source-live.json` — 풀 결과(게이트 판정·딥스캔 리포트·일기). 상태는 `draft5-source-live.status.json`

## 구현 메모

- `discovery.mjs` — 소스 어댑터(news/chart/finance) × 캐릭터 프롬프트. jaroo_characters.js와
  같은 기계(system 고정 + 후보 블록 + 꼬리 캐릭터 지시). 차트/재무 픽의 `"이름(코드·시장)"` 통째
  반환에 대비해 3단계(정확명→괄호 제거→코드 추출) 매칭으로 코드를 확정한다.
- 재무 소스는 `/api/scores/rank` 실패 시 `/tmp/all_scores.tsv` 스냅샷으로 폴백한다(휘발성 — API가 정규 경로).
- `run-pipeline.mjs` — `CHAR_SET=source`로 소스 세트 활성화. 딥스캔 대상은 캐릭터 라운드로빈으로
  뽑아 상한(12) 잘림이 특정 캐릭터에 몰리지 않게 한다. 일기 프롬프트는 소스별 근거(뉴스 헤드라인 vs
  패턴/재무 숫자)를 인용하도록 분기한다.
- 게이트/sizing 규칙은 기존과 동일(문턱 +25↑ 큰 비중, +10↑ 중간, 그 외 반 티켓).
