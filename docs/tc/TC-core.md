# 코어 패키지 TC 목록

- 기준: master @ 3f7276f / 실행일: 2026-11-05
- 실행 명령: `npm run test:instrument-core && npm run test:runtime-core`
- 요약: 기존 42개 (instrument-core 25 + runtime-core 17) / 신규 44개 (TC 5건, 테스트 44개) / **전체 86개 중 85 PASS + 1 의도적 FAIL**

> ⚠️ 의도적 FAIL 1건: TC-CORE-029의 `[버그 후보]` 테스트는 safe-json 자격증명 마스킹 누수 경로(아래 상세 참조)를 증거로 남기기 위한 것으로, 프로덕션 코드 수정 금지 규칙에 따라 FAIL 상태로 보존했다. 이 1건을 제외한 나머지는 전부 PASS.

## 커버리지 요약

| 패키지 | 기존 자동화 테스트 | 신규 TC | 비고 |
|---|---|---|---|
| packages/instrument-core | tests/ko-fuzzy-resolver.test.js (10), tests/ko-fuzzy-http-server.test.js (15) → `node --test`가 `*.test.js` 자동 수집 | TC-CORE-026, 027 (14개 테스트) | `tests/tc-*.test.js` 네이밍으로 러너 자동 수집 확인함 |
| packages/deepscan-runtime-core | test/committee-llm.test.ts (10), test/detect-duplicate-numerics.test.js (6), test/safe-json.test.ts (1) → `tsx --test test/*.test.ts test/*.test.js` | TC-CORE-028, 029, 030 (30개 테스트) | `test/tc-*.test.ts`가 test 스크립트 glob에 자동 포함됨 |
| packages/contracts | 자체 테스트 스크립트 없음. 루트 tests/contracts-deepscan-types.test.ts가 barrel/direct 타입 동일성(`IsExact` 컴파일 타임 단언) + 상수값을 검증하며, `scripts/run-web-ts-tests.cjs`가 tsx --test로 루트 src/tests의 `*.test.ts`를 수집해 `npm run test:web:ts`로 실행 | — (루트 tests/는 tc-web 영역이라 파일 추가 금지) | 커버리지 참고만 기록. 코어 스위트 실행 대상 아님 |

## 기존 TC (파일/기능 단위 그룹핑)

| TC ID | 제목 | 분류 | 우선순위 | 자동화(파일) | 결과 |
|---|---|---|---|---|---|
| TC-CORE-001 | ko-fuzzy-resolver 모듈 exports 검증 (createKoFuzzyResolver) | fuzzy-resolver | P1 | tests/ko-fuzzy-resolver.test.js | PASS |
| TC-CORE-002 | 한글 정확 명칭 exact 매칭 및 괄호/공백 ADR 한정자 보존 (팔란티어→PLTR, 바이두(ADR)→BIDU) | fuzzy-resolver | P0 | tests/ko-fuzzy-resolver.test.js | PASS |
| TC-CORE-003 | 한글 오타 퍼지 복원 — top3(파란티어→PLTR) / top5(애프→AAPL, 파라티어→PLTR) | fuzzy-resolver | P0 | tests/ko-fuzzy-resolver.test.js | PASS |
| TC-CORE-004 | 강한 top1 유지(FS→FFIV) 및 하이브리드 후보 복원(넥스테라 에너지→NEE) | fuzzy-resolver | P1 | tests/ko-fuzzy-resolver.test.js | PASS |
| TC-CORE-005 | 무효 topN(NaN, 0) 클램프로 안전 범위 보장 | fuzzy-resolver | P1 | tests/ko-fuzzy-resolver.test.js | PASS |
| TC-CORE-006 | CLI(ko-fuzzy-resolve) JSON 출력 및 플래그 검증 오류 처리(--topN/--ko-map 값 누락) | cli | P1 | tests/ko-fuzzy-resolver.test.js | PASS |
| TC-CORE-007 | HTTP 서버 팩토리 exports 검증 (createTickerSearchServer) | http-server | P1 | tests/ko-fuzzy-http-server.test.js | PASS |
| TC-CORE-008 | /api/ticker-search 해외 한글 오타 쿼리 → 티커 후보 반환 | http-server | P0 | tests/ko-fuzzy-http-server.test.js | PASS |
| TC-CORE-009 | /api/stock-search 한국 주식 exact/compact 통합 매칭 (삼성전자→005930, HPSP→403870, CJCGV→CJ CGV/079160) | http-server | P0 | tests/ko-fuzzy-http-server.test.js | PASS |
| TC-CORE-010 | /api/stock-search 해외 오타 fuzzy 반환 + compact 충돌(S T C) 보수적 미매칭 | http-server | P0 | tests/ko-fuzzy-http-server.test.js | PASS |
| TC-CORE-011 | 잘못된 KR 맵 경로 시 ticker-search 유지 / stock-search 해외 fuzzy degrade | http-server | P0 | tests/ko-fuzzy-http-server.test.js | PASS |
| TC-CORE-012 | 커스텀 엔드포인트 경로(후행 슬래시) 정규화 매칭 | http-server | P2 | tests/ko-fuzzy-http-server.test.js | PASS |
| TC-CORE-013 | HTTP 에러 처리 — 빈 쿼리 400 / malformed URL 400(handler 예외 없음) | http-server | P0 | tests/ko-fuzzy-http-server.test.js | PASS |
| TC-CORE-014 | HTTP 서버 CLI 검증(--port/--kr-stock-map 값 누락) 및 엔드포인트 경로 충돌 기동 차단 | cli | P1 | tests/ko-fuzzy-http-server.test.js | PASS |
| TC-CORE-015 | 위원회 request/retry/success/summary 로그 전체의 중첩 자격증명 마스킹([REDACTED]) | committee-llm | P0 | test/committee-llm.test.ts | PASS |
| TC-CORE-016 | strict OpenRouter json_schema 요청 구성 + 응답 파싱(score 반올림/confidence/warnings) | committee-llm | P0 | test/committee-llm.test.ts | PASS |
| TC-CORE-017 | 업스트림 OpenRouter 에러 전파 및 콘텐츠 검사 거절(DataInspectionFailed) 비재시도 분류 | committee-llm | P0 | test/committee-llm.test.ts | PASS |
| TC-CORE-018 | LLM invalid JSON 리트라이 후 정상 판정 수령(errorKind=llm-invalid-json 기록) | committee-llm | P0 | test/committee-llm.test.ts | PASS |
| TC-CORE-019 | 멤버 병렬 호출 동시성 제한(maxActive=2) 및 summary 로그에 concurrency 기록 | committee-llm | P1 | test/committee-llm.test.ts | PASS |
| TC-CORE-020 | 초기 시도+3회 리트라이 소진 → 구조화 멤버 에러(errorKind=llm-empty-content, attempts=4) | committee-llm | P0 | test/committee-llm.test.ts | PASS |
| TC-CORE-021 | 생성 dump 누락 시 runtime-missing-dump 분류, attempts=0, 비재시도 | committee-llm | P1 | test/committee-llm.test.ts | PASS |
| TC-CORE-022 | progressive soft-deadline 도달 시 partial 반환 + 백그라운드 완료 후 레지스트리 갱신 | committee-llm | P0 | test/committee-llm.test.ts | PASS |
| TC-CORE-023 | progressive 완료 스냅샷 TTL 경과 후 레지스트리 수거(null) | committee-llm | P1 | test/committee-llm.test.ts | PASS |
| TC-CORE-024 | 중복 수치 인용 감지 규칙 — 콤마 정규화, % 구분, 10 미만 정수 노이즈 제외, 연도(1900~2100) 제외, 깨진/빈 reason 무시 | deepscan-metric | P1 | test/detect-duplicate-numerics.test.js | PASS |
| TC-CORE-025 | sanitizeForJson/safeJsonStringify 순환 참조 안전 + 재귀 자격증명/URL 쿼리 마스킹 | safe-json | P0 | test/safe-json.test.ts | PASS |

## 신규 TC 상세

> 신규 테스트는 각 패키지 내부 tests 디렉토리에만 추가했다 (루트 tests/ 침범 없음).
> 커버리지 갭 기준: ① 테스트가 전혀 없던 src 모듈(kr-stock-resolver.js, llm-mock.js) ② 기존 테스트가 다루지 않는 엣지(빈/비정상 입력, 스칼라/특수 값 직렬화, 응답 정규화 계약).

### TC-CORE-026: kr-stock-resolver 단위 계약 (커버리지 갭 — 기존 테스트 전무)

- 자동화: `packages/instrument-core/tests/tc-kr-stock-resolver.test.js` (8 tests)
- 분류: kr-stock-resolver / 우선순위: P0 / 결과: PASS (8/8)
- 사전조건: `data/kr/kr-stock-name-to-code.json` 기본 맵 존재
- 시나리오 및 기대결과:
  1. `DEFAULT_KR_STOCK_MAP_PATH`가 패키지 data 맵을 정확히 가리킨다
  2. 기본 맵으로 exact 매칭 — `삼성전자` → `{code:'005930', matchedBy:'exact'}`
  3. 빈 문자열 쿼리 → 예외 없이 `null`
  4. 공백 전용 쿼리(`'   '`, `\t\n`) → normalizeText로 빈 문자열화 → `null`
  5. 존재하지 않는 종목명 → `null`
  6. compact 고유 매칭 — `CJCGV` → `{name:'CJ CGV', code:'079160', matchedBy:'compact'}`
  7. compact 다중 후보 충돌(`S T C`→`STC`) → 보수적으로 `null` (미매칭)
  8. 진단용 `krNameToCode` 원본 맵 노출
- 검증방법: `npm run test:instrument-core` (node --test 자동 수집)
- 비고: 기존에는 HTTP 통합 엔드포인트 테스트를 통해서만 간접 검증됐던 모듈

### TC-CORE-027: ko-fuzzy-resolver 비정상 입력 경계 (커버리지 갭)

- 자동화: `packages/instrument-core/tests/tc-ko-fuzzy-resolver-edge.test.js` (6 tests)
- 분류: fuzzy-resolver / 우선순위: P1 / 결과: PASS (6/6)
- 사전조건: US 커버리지 100 맵 2종 존재
- 시나리오 및 기대결과:
  1. `resolve('')` → 예외 없이 `[]` 반환
  2. `resolve('   ')` 공백 전용 → `[]`
  3. `resolve(null)` → 예외 없이 `[]` (String(null ?? '') 경로)
  4. 음수 topN(-7) → 결과를 비우지 않고 최소 1개 보장, top1 PLTR/score 1
  5. topN 미지정 → 기본 5 이하 후보, PLTR 포함
  6. exact 쿼리 + topN=1 → 정확히 1개, via='exact', score=1
- 검증방법: `npm run test:instrument-core`
- 비고: 비정상 입력에서도 throw 없이 빈 배열로 수렴하는 "안전 수렴" 계약을 고정

### TC-CORE-028: llm-mock dev 게이트 및 결정론 헬퍼 (커버리지 갭 — 기존 테스트 전무)

- 자동화: `packages/deepscan-runtime-core/test/tc-llm-mock.test.ts` (13 tests)
- 분류: llm-mock / 우선순위: P0 / 결과: PASS (13/13)
- 사전조건: `JAROO_LLM_MOCK` 환경변수는 테스트 내 저장/복원으로 격리. 외부 호출 없음(타이머 0~30ms 고정)
- 시나리오 및 기대결과:
  1. 게이트 허용값 `'1'/'true'/'TRUE'/'On '/'yes'` → true (trim+lowercase 관례)
  2. 게이트 거부값 `'0'/'false'/''/`미설정`/null/숫자 1` → false (프로덕션 불변 규칙: 미설정 시 항상 false)
  3. `llmMockDateToken` → UTC YYYY-MM-DD 슬라이스
  4. 같은 시드 PRNG → 동일 수열, 값은 [0,1) 범위
  5. 다른 시드 → 다른 수열, null 시드도 number 반환 (예외 없음)
  6. `pickLlmMockItem` — 빈/null 리스트 → `''`, random=0 → 첫 원소, random≈1 → 마지막 원소
  7. `llmMockIntInRange` — 역전된 min/max 스왑, min==max 고정, 다중 시드에서 [min,max] 경계값 포함
  8. `llmMockLatencyMs` — `'0'`→0, `'1000'`→1000, `'123.7'`→124(반올림)
  9. 비숫자/음수(`'-5','abc','NaN','1e999'`) → 결정론적 200~800ms fallback
  10. `''` → `Number('')===0` 특성으로 0(무지연) 고정 — 경계 동작 문서화 (fallback 아님)
  11. `sleepLlmMockLatency` — 0ms 즉시 귀환 / 30ms 고정 시 ≥25ms 대기 (unref 타이머라 테스트는 keepalive interval 사용)
- 검증방법: `npm run test:runtime-core`

### TC-CORE-029: safe-json 스칼라/특수 값 직렬화 경계 및 문자열 내 자격증명 마스킹

- 자동화: `packages/deepscan-runtime-core/test/tc-safe-json-edge.test.ts` (11 tests)
- 분류: safe-json / 우선순위: P0 / 결과: **PASS 10 / FAIL 1(버그 후보 — 아래 참조)**
- 사전조건: 없음 (순수 함수, 외부 호출 없음)
- 시나리오 및 기대결과 (PASS 부분):
  1. 최상위 `null`/`undefined` → `null`, plain 문자열 보존
  2. NaN/±Infinity → `'NaN'/'±Infinity'` 문자열 치환으로 JSON 유효성 유지
  3. Date → ISO 8601, Invalid Date → `'Invalid Date'`
  4. Symbol → `[Symbol:tag]`/`[Symbol]`, 함수 → `[Function:name]` (tsx 환경의 익명 화살표 name 차이는 정규식 완화 매칭)
  5. 배열 경유 순환 참조 → `[Circular]` + stringify 예외 없음
  6. `options.secrets` 명시 시크릿이 임의 문자열 값에서 치환됨
  7. 4자 미만 시크릿은 치환하지 않는 가드(`secret.length >= 4`) — 과도한 마스킹 방지 의도로 현재 계약 고정
  8. plain 문자열 내 `api_key=...` 대입 패턴, `Set-Cookie: session=...` 마스킹 (단, 키 이름이 'cookie' 등 sensitive하면 값 전체가 수집되어 전체 [REDACTED] — 키 명명 주의점 문서화)
  9. 접두사 없는 `Bearer <token>` → `Bearer [REDACTED]`
  10. 트리 전역 sensitive 키(`password`) → `[REDACTED]`
- 검증방법: `npm run test:runtime-core`

**🚨 버그 후보 (FAIL 유지 중 — 프로덕션 수정 금지 규칙)**

- 테스트명: `[버그 후보] Authorization 접두어 뒤 Bearer 토큰 값은 마스킹되지 않고 남는다 (의도적 FAIL)`
- 재현: `safeJsonStringify({ k: 'Authorization: Bearer sk-or-v1-tokenvalue' })` → 결과 문자열에 `sk-or-v1-tokenvalue` **생존**
- 원인 추정: `redactString`의 치환 순서가 QUERY → ASSIGNMENT → BEARER인데, `SENSITIVE_ASSIGNMENT_PATTERN`의 `authorization` 키워드가 `Authorization: ` 뒤 첫 토큰인 **'Bearer'라는 단어를 값으로 소비**해 버린다. 이후 실행되는 `BEARER_PATTERN`은 남은 'Bearer'를 찾지 못해 실제 토큰 값이 그대로 남는다.
- 왜 기존 테스트에서 못 잡았나: 기존 테스트는 동일 시크릿이 sensitive **키**(ApiKey 등)에도 존재해 `collectSecrets`가 전역 split-join 치환으로 지워줬음. plain 문자열에만 토큰이 있는 입력에서 누수.
- 영향: 로그용 자격증명 마스킹 모듈의 목적상 `Authorization: Bearer <token>` 형태(가장 흔한 형식)의 토큰이 로그에 남을 수 있음. 권장 수정: BEARER 패턴을 ASSIGNMENT보다 먼저 적용하거나, ASSIGNMENT 값 소비 시 뒤따르는 Bearer 접두어 처리 — 단, 본 임무 규칙상 프로덕션 수정은 하지 않았음.

### TC-CORE-030: committee-llm 응답 정규화 계약 (clamp/신뢰도 별칭/wrapper/warnings) 및 빈 입력 경계

- 자동화: `packages/deepscan-runtime-core/test/tc-committee-result-normalization.test.ts` (6 tests)
- 분류: committee-llm / 우선순위: P0 / 결과: PASS (6/6)
- 사전조건: `global.fetch`를 mock으로 교체(기존 테스트와 동일 패턴, 외부 호출 없음), logDir은 temp 디렉터리 생성 후 삭제
- 시나리오 및 기대결과:
  1. 점수 clamp — 250 → 100, -20 → 0 (0~100 강제)
  2. wrapper 언랩 — `{result:{score:'76.5', reason}}` → 77(반올림), confidence 미기재 시 'medium' 기본값
  3. confidence 별칭 정규화 — STRONG→high, mid→medium, weak→low, 미지값('meh')→medium
  4. warnings 필터 — 빈 문자열/공백/숫자/null 제거 후 유효 문자열만 유지
  5. `getCommitteeProgress` — 미지 requestId/빈 문자열/undefined → null (예외 없음)
  6. `detectDuplicateNumericCitations` — null/undefined/빈 객체 → `[]`, 숫자 reason 무시, 정상 중복 토큰만 보고
- 검증방법: `npm run test:runtime-core`

## 실행 결과 (2026-11-05, master @ 3f7276f 워킹트리 기준)

```
npm run test:instrument-core   → tests 39 / pass 39 / fail 0
npm run test:runtime-core      → tests 47 / pass 46 / fail 1 (TC-CORE-029 버그 후보 증거 테스트, 의도적 FAIL)
합계: 기존 42 + 신규 44 = 86개 중 85 PASS
```

- 전체 `npm test`는 Lead 최종 실행 대상이라 수행하지 않음 (루트 tests/, crawler 스위트 미실행)
- 신규 파일은 각 패키지 test 스크립트의 수집 규칙(`node --test`의 `*.test.js` 스캔, `tsx --test test/*.test.ts test/*.test.js` glob)에 자동 포함됨을 실행으로 확인
