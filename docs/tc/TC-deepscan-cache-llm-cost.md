# TC-deepscan-cache-llm-cost — 캐시된 딥스캔 로드 시 LLM 호출 비용 화이트박스 검증

- 일자: 2026-11-13
- 요청(박명철): "캐시된 딥스캔을 불러올 때 LLM 호출 비용이 발생하나? 지금은 비용이 발생하는 것 같음"
- 결론 요약: **의심 사실 확인(부분)** — 9인 위원회 LLM(deepseek/deepseek-v4-flash)은 캐시 로드에서
  재실행되지 않지만(0회), **로딩 화면 팀 요약 LLM(openai/gpt-oss-120b)이 캐시 로드에서도
  매번 3회 호출된다.** 크레딧(10cr)은 들지만 서버 OpenRouter 비용이 발생한다. 수정하지 않음 — 사용자 결정 대기.
- 관련: TC-MASTER.md §9.4, TC-e2e-deepscan.md, deepscan-failure-analysis.md,
  PR #351/#352(유료 재런 버그 수정), PR #354(하이드레이션 원샷 시드),
  tests/deepscan-paid-run-contract.test.mjs(기존 유료 실행 계약)

---

## 1. 경로 분석 — "캐시된 딥스캔 결과를 불러오는" 4경로 call chain

### (a) briefing-snapshot 인메모리 캐시 히트 — LLM 0회 ✅

로딩 브리핑(주가 스냅샷) 경로. LLM과 무관하다.

```
page.tsx 로딩 브리핑 effect
  → buildLoadingBriefingSnapshotUrl()            src/app/deepscan/deepscan-page-fetchers.ts:110-125
  → GET /api/deepscan/briefing-snapshot?code=…
  → handleBriefingSnapshotRequest()              src/app/api/deepscan/briefing-snapshot/route.ts:558
    ├ 캐시 히트(TTL 15s): briefingSnapshotCache.get → 즉시 반환   route.ts:88, 575-578
    └ 미스: fetchDailyRows/fetchStockBasic/fetchIndexSnapshot     route.ts:226-255, 412-417
            업스트림 = https://m.stock.naver.com/api (route.ts:9) — openrouter.ai 부재
```

### (b) Supabase 저장 스냅샷 하이드레이션/재방문 — 위원회 LLM 0회(24h 내) ✅ / 팀 요약 LLM 3회 ❌

재방문 계약(PR #352 run-intent + PR #354 원샷 시드)은 정상 작동한다:

```
/deepscan 마운트
  → readDeepScanRunIntent() (30s 표식)            src/app/deepscan/page.tsx:96
  → resolveDeepScanStartAfterHydration()          src/lib/deepscan-target-hydration.ts:144-154
      명시적 클릭 → 'run-explicit' / 그 외 → 'run-readonly'
  → page.tsx:419-438 — run-explicit만 유료 자동 실행(startRequest 후 return),
      나머지는 폴스루로 pendingCacheOnlyRef.current = true (page.tsx:436)
  → fetchDeepScanCanonicalPayload({cacheOnly:true})  src/lib/deepscan-canonical.ts:325-336
  → GET /api/deepscan?…&cacheOnly=1
      ├ 스냅샷 히트(24h TTL): 캐시 payload 반환, builder 미호출
      │    src/app/api/deepscan/route.ts:118, 125-159 (cacheOnly 게이트)
      │    route.ts:165-187 (plain 재방문 스냅샷 캐시 블록)
      │    src/lib/deepscan-snapshot-policy.ts:13, 34-38 (TTL 24h)
      └ 미스: snapshot-miss 404로 종결(과금 파이프라인 진입 금지)  route.ts:146-158
```

위원회 LLM이 도는 유료 경로는 게이트 이후에만 존재한다(정상 설계):

```
route.ts:191 이후(과금 게이트/무과금 직행) → createDeepScanCanonicalResponse (route.ts:237-242)
  → buildDeepScanPayloadFromSearchParams            src/lib/deepscan-runtime/build-payload.ts:826, 1005
  → crawler /api/source/…/deepscan/canonical       packages/crawler/src/server.js:3005-3008
  → buildJarooDeepScanPayload                      packages/crawler/src/services/deepscan-payload.js:2567
  → (llmAttempted 판정 L2595) scoreDeepScanKrCommitteeFromDump  deepscan-payload.js:2599
  → scoreCommitteeMembersProgressive               packages/deepscan-runtime-core/src/committee-llm.js:702
  → scoreCommitteeMember × 9                       committee-llm.js:739
  → fetch('https://openrouter.ai/api/v1/chat/completions')  committee-llm.js:374  ← 유일한 위원회 LLM HTTP 경계
```

**그러나** 캐시 히트로 payload를 받아도 페이지는 항상 로딩 화면을 렌더하고(page.tsx:1036-1037),
로딩 화면의 팀 요약 effect는 캐시 게이트 없이 발사된다(§3 버그 참조).

### (c) history 탭 revisit — 위원회 LLM 0회 ✅ / 팀 요약 LLM 3회 ❌

```
mypage/history openRow                           src/app/mypage/history/page.tsx:131-160
  → clearDeepScanRunIntent() (page.tsx:138) — 자동 유료 실행 차단
  → GET /api/deepscan/history/{id}               src/app/api/deepscan/history/[id]/route.ts (저장 payload)
  → finishSuccess(buildSnapshotCacheAnnotatedPayload(...))  history/page.tsx:149-153 — 런 없이 스토어 시딩
  → router.push('/deepscan') — 렌더만 수행
```

`/api/deepscan`(런) 호출 자체가 없다. 단 (b)와 동일하게 렌더 시 팀 요약 LLM 3회 발사.

### (d) crawler 내부 캐시 — 데이터 캐시만 존재, 위원회 LLM 결과 캐시 없음

```
readThroughCrawlerCache (wisereport slim 등 데이터 소스)   packages/crawler/src/services/supabase-crawler-cache.js:471
  fresh 히트 → loader(크롤) 미호출 — 크롤 비용 절감용, LLM 무관
위원회 LLM 결과 캐시: 딥스캔 정규 경로(deepscan-payload.js:2599)엔 없음 — 매 런 9회 재계산.
  (ETF 페이지 위원회 /etf만 Supabase 캐시 존재: deepscan-payload.js:2970 buildEtfMarketCommitteeSnapshot,
   2987-2992 fresh 히트 조기 반환)
```

즉 crawler에 캐시가 있어도 그것은 "크롤 데이터" 캐시이며, 웹이 캐시된 스냅샷을 주는 것과 무관하다.

---

## 2. LLM HTTP 경계 목록 (전수)

| # | 호출점 | 모델 | 트리거 |
|---|--------|------|--------|
| L1 | `committee-llm.js:374 fetch(OPENROUTER_URL)` | deepseek/deepseek-v4-flash (기본) | 유료 런(또는 무과금 직행) 시 9회 |
| L2 | `deepscan-payload.js:2120 fetch(OPENROUTER_CHAT_COMPLETIONS_URL)` 실적 댓글 요약 | deepseek 계열 | 런 중 실적코멘트 텍스트 있을 때 1회 |
| L3 | `team-summary/route.ts callOpenRouterTeamSummary → fetch(OPENROUTER_URL)` | openai/gpt-oss-120b | **로딩 화면 마운트마다 팀당 1회 × 3팀 — 캐시 로드 포함** |

JAROO_LLM_MOCK=1이면 L1~L3 전부 결정적 모의로 대체된다(committee-llm.js:368, deepscan-payload.js:2110, team-summary/route.ts mock 분기). 본 TC는 전 경로에서 mock이 꺼진 실경로를 가정한다(스텁으로 실호출 차단).

---

## 3. 확정 버그 — 캐시된 딥스캔 로드 시 팀 요약 LLM 3회

### Call chain (근거)

```
/deepscan 렌더(캐시 히트·history 시딩·하이드레이션 복원 모두 동일)
  page.tsx:1036-1037  <DeepScanLoadingScreen … committeeAxes={payload?.committee.axes} />
                      (캐시 히트여도 로딩 화면이 곧 결과 화면 — snapshotCacheInfo는 표시 바용 props)
  loading-screen.tsx:182-192  loadingStages = buildLoadingStages({committeeAxes, …})
  loading-utils.ts:448-475    summarizable = readyCount>0 && readyCount+errorCount===members.length
                              → 완성(9멤버 success) 캐시 payload면 3팀 전부 참 + body는 캐시된 reason으로 충만
  loading-screen.tsx:199-218  teamSummaryRequests = summarizable && body.trim() 카드만 추출
                              — 스냅샷 캐시 여부는 조건에 없음
  loading-screen.tsx:329-379  effect → POST /api/deepscan/team-summary × 3팀
                              (snapshotCacheHit 게이트 부재 — 문구 분기 L445에만 사용)
  team-summary/route.ts       createDeepScanTeamSummaryResponse → callOpenRouterTeamSummary
                              → fetch(openrouter.ai) × 3 — 요청간 캐시·영속화 없음
```

### 재현 조건

1. 로그인 상태(POST 게이트는 로그인만 검사 — 크레딧 차감 없음)
2. 해당 종목의 **완성(9멤버 전원 success) 딥스캔 스냅샷** 보유(24h TTL 내)
3. 아무 캐시 로드 경로로 /deepscan 진입: 재방문(cacheOnly 히트) / history 탭 "다시 보기" / F5 하이드레이션 복원(PR #354)
4. → 로딩 화면 마운트마다 **gpt-oss-120b 3회 호출**(세션 내 중복은 코디네이터가 막지만, 리마운트=재방문마다 재발사)

### 예상 비용

- 재방문 1회당 gpt-oss-120b 3회 (max_tokens 1000/호출). 사용자 크레딧(10cr)은 미차감 — **서버 OpenRouter 비용만** 발생.
- 위원회 9회(deepseek-v4-flash) ≈ ₩7.13 기준일 때, gpt-oss-120b 단가에 따라 재방문당 수십 원~수백 원 수준이 반복 적립됨(정확 단가는 OpenRouter 청구 확인 필요).
- 첫 유료 런에서도 동일 3회가 붙는 것은 로딩 연출 설계(의도된 비용). 문제는 **"캐시=무료" 기대를 깨는 재방문 반복 비용**이다.

### 정상 작동 확인(의심 중 무죄 부분)

- 캐시 로드 시 위원회 9회 재런: 없음(TC-DLLM-1/2, TC-GATE-1으로 게이트·순서 검증)
- 캐시 로드 시 크레딧 차감: 없음(cacheOnly 미스는 404 종결)
- briefing-snapshot: LLM 무관(TC-BRF-1/2)
- crawler 캐시: 데이터 전용(TC-DLLM-4)

---

## 4. 화이트박스 TC — 목록 및 결과

LLM HTTP 층은 전부 스텁/DI로 가로챈다(실제 OpenRouter 호출·API 키 사용 0건).
실행 커맨드와 결과는 §5.

| TC ID | 단언 | 파일 | 결과 |
|-------|------|------|------|
| TC-DLLM-1 | 캐시 미스 신규 런 = 위원회 LLM **정확히 9회**(global fetch 스텁 카운트, 모델·Bearer 검증) | tests/deepscan-cache-llm-cost-crawler.test.mjs | ✅ pass |
| TC-DLLM-2 | crawler 재호출 = 9회 추가(누적 18) — 위원회 LLM 결과 캐시 부재 | 〃 | ✅ pass |
| TC-DLLM-3 | committeeLlm=off = LLM 0회 | 〃 | ✅ pass |
| TC-DLLM-4 | crawler 캐시 fresh 히트 = loader(크롤) 0회 — 데이터 캐시 계약 | 〃 | ✅ pass |
| TC-BRF-1 | briefing-snapshot 업스트림 = Naver만, openrouter.ai 0회 | src/app/api/deepscan/briefing-snapshot/route.cache-llm-cost.test.ts | ✅ pass |
| TC-BRF-2 | 인메모리 캐시 히트 재요청 = 업스트림 fetch 0회 | 〃 | ✅ pass |
| TC-TSM-1 | 팀 요약 1요청 = LLM 1회, 3팀 = 3회(requester DI 카운트) | src/app/api/deepscan/team-summary/route.cache-llm-cost.test.ts | ✅ pass |
| TC-TSM-2 | 같은 입력 재요청(재방문 재현)도 LLM 재호출(누적 2) — 라우트 캐시 부재 [버그 고정] | 〃 | ✅ pass |
| TC-TSM-3 | 입력 검증 400은 requester 미호출 | 〃 | ✅ pass |
| TC-COORD-1 | 세션 내 같은 requestKey 재발사 0건(중복 방지 계약) | src/lib/deepscan-team-summary-fetch.cache-llm-cost.test.ts | ✅ pass |
| TC-COORD-2 | 재방문(코디네이터 재생성=리마운트) → 동일 3요청 재클레임 [버그 고정] | 〃 | ✅ pass |
| TC-GATE-1 | cacheOnly 종결·스냅샷 캐시 반환 모두 builder(LLM 런) 이전 배치(순서 단언) | tests/deepscan-cache-llm-cost-contract.test.mjs | ✅ pass |
| TC-GATE-2 | /deepscan 재방문 = run-explicit 폴스루 후 cacheOnly 조회 | 〃 | ✅ pass |
| TC-GATE-3 | history 열람 = 저장 payload 시딩 + 런 없음 + 표식 소거 | 〃 | ✅ pass |
| TC-BUG-1 | 팀 요약 fetch effect에 snapshotCacheHit/deepScanCache/resultsReady 게이트 부재 [버그 고정] | 〃 | ✅ pass |
| TC-BUG-2 | 캐시된 완성 axes → 3팀 summarizable 트리거 체인(summarizable 식·reason 바디·요청 필터) | 〃 | ✅ pass |
| TC-LLM-1 | LLM HTTP 경계 목록(L1~L3) + JAROO_LLM_MOCK 게이트 존재 | 〃 | ✅ pass |

TC-BUG-1/2, TC-TSM-2, TC-COORD-2는 "수정 전 상태를 고정"하는 버그 문서화 TC다.
버그를 수정하면 이 4개는 의도적으로 실패하도록 뒤집어야 한다(문서 업데이트 필요).

## 5. 실행 결과 (2026-11-13)

```
$ node --test tests/deepscan-cache-llm-cost-crawler.test.mjs
# tests 4  # pass 4  # fail 0

$ node --test tests/deepscan-cache-llm-cost-contract.test.mjs
# tests 6  # pass 6  # fail 0

$ npx tsx --test src/app/api/deepscan/briefing-snapshot/route.cache-llm-cost.test.ts \
    src/app/api/deepscan/team-summary/route.cache-llm-cost.test.ts \
    src/lib/deepscan-team-summary-fetch.cache-llm-cost.test.ts
# tests 7  # pass 7  # fail 0

회귀(신규 파일 포함 전체 스위트):
$ node --test tests/deepscan-*.test.mjs          # tests 47  # pass 47  # fail 0
$ npm run test:web:ts                            # tests 718 # pass 718 # fail 0
```

## 6. 생성 파일 (모두 신규 — 기존 파일 수정 없음, 커밋/PR 없음)

- docs/tc/TC-deepscan-cache-llm-cost.md (본 문서)
- tests/deepscan-cache-llm-cost-crawler.test.mjs
- tests/deepscan-cache-llm-cost-contract.test.mjs
- src/app/api/deepscan/briefing-snapshot/route.cache-llm-cost.test.ts
- src/app/api/deepscan/team-summary/route.cache-llm-cost.test.ts
- src/lib/deepscan-team-summary-fetch.cache-llm-cost.test.ts

## 7. 후보 수정 방향 (참고만 — 수정하지 않음, 사용자 결정 대기)

1. 팀 요약 결과를 스냅샷 payload에 영속화하고 캐시 로드 시 재사용(재방문 비용 0)
2. 캐시 히트 마운트 시 팀 요약 발사 스킵(`snapshotCacheHit` 게이트 — TC-BUG-1이 지목하는 지점)
3. 세션 스토리지 수준 캐시(inputKey → summary)로 브라우저 재시작 전 재사용
4. 현상 유지(재방문 3회 비용 수용) — 연출 품질 유지, 비용만 수용

## §8. 수정 이력 (2026-11-13)

**버그 수정 반영**: `fix/deepscan-team-summary-persist` — 팀 요약 영속화.

- 런 중 로딩 화면이 받은 팀별 최종 문장을 `POST /api/deepscan/team-summaries-persist`로 스냅샷·기록 payload의 `teamSummaries`(jsonb, DDL 불필요)에 병합 저장(멱등).
- 재방문(캐시 로드)은 로딩 화면 씨드 게이트(`pickSeededTeamSummaries` — 팀+inputKey 일치)가 저장 문장을 그대로 심고 발사를 건너뛴다 → **재방문 LLM 0회**.
- 구형 스냅샷(필드 없음): 첫 재방문 1회 재생성 → 병합 저장 → 이후 0회로 수렴.
- 본문 변경(inputKey 불일치)은 안전 폴백으로 재생성.
- TC 반전: TC-BUG-1/2 → 수정 반영 계약(씨드 게이트·page 배선 고정). TC-TSM-2·TC-COORD-2는 라우트/코디네이터 무상태 계약으로 재프레이밍(동작 불변). 신규: TS-STORE-1~3, TS-PERSIST-1~5.
