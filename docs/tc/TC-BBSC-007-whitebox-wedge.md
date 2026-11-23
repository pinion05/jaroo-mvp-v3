# TC-BBSC-007 화이트박스 규명 — 딥스캔 런 중 새로고침 웨지+메모리 폭발

- 문서 ID: `TC-BBSC-007-whitebox-wedge`
- 작성일: 2026-11-09
- 대상 결함: `TC-blackbox-skeleton` §4 TC-BBSC-007 (블랙박스 근거: PR #351·#353, `docs/tc/skeleton-evidence/f5-midrun-wedge.json`)
- 수정 브랜치: `fix/deepscan-refresh-wedge`

## 1. 결함 요약

딥스캔 런 활성 상태에서 전체 문서 로드(F5·북마크 재진입)를 하면 페이지가 영구 응답
불능이 되고 렌더러 메모리가 폭발한다.

| 지표 | 운영(dev) 실측(순수 CDP) | 로컬 재현(수정 전) | 로컬 수정 후 |
|---|---|---|---|
| 평가(Runtime.evaluate) | 12/12 타임아웃(6s+) | 7/7 타임아웃(6s) | 7/7 응답(**1ms**) |
| 렌더러 RSS | 30초 만에 1.8→3.7GB(비회수, 25분+ 관측) | 70초에 854→**1,876MB** 상승 | **218→247MB 평탄** |
| 렌더러 CPU | 40~70% 지속 | 24→70% | ≤11% → 한 자릿수 |
| 종결 상태 | 탭 영구 웨지 | 탭 웨지(회복 없음) | snapshot-miss 안내 화면으로 정상 종결 |

## 2. 근원 — 하이드레이션 이펙트의 타깃 참조(identity) 무한 교체 루프

코드 경로: `src/app/deepscan/page.tsx` 세션 타깃 하이드레이션 이펙트
(deps `[setDeepScanTarget, target]`) → `useDeepScanStore.setTarget`.

```ts
// 수정 전 (page.tsx 하이드레이션 이펙트)
const shouldApplyHydratedTarget = !target || getDeepScanTargetKey(target) === nextTargetKey
if (shouldApplyHydratedTarget) {
  setDeepScanTarget(nextTarget)   // ← 매번 새 객체
}
```

루프 메커니즘:

1. 런 중 F5 → zustand 스토어는 휘발(메모리 전용), sessionStorage에는 직전 실행의
   타깃이 남는다(`persistDeepScanTarget`). 실행 의도 표식(`deepscan-run-intent`)은
   자동 시작 시점에 이미 소멸(원샷) — 재진입은 **run-readonly(cacheOnly)** 경로.
2. 마운트 시 스토어가 비어 있어(`!target`) 하이드레이션이 세션 타깃을 **시드**한다.
   `buildDeepScanTargetInputFromSession`은 세션을 매번 **새 객체**로 파싱한다.
3. `setTarget`은 같은 종목(키 동일)이어도 `{ target }` 병합으로 **새 참조**를 박는다 →
   `target` 선택자 구독 컴포넌트가 재렌더 → 이펙트 deps `[target]` 변경 → 하이드레이션
   이펙트 재실행 → 다시 시드 조건(`getDeepScanTargetKey(target) === nextTargetKey`,
   같은 세션에서 같은 키) → **다시 새 객체 반영** → 무한 루프.
4. 루프는 이펙트-마이크로태스크 사이클이라 태스크 큐가 굶는다 — CDP 평가·타이머가
   영원히 실행되지 않는다(실측: reload +3초부터 평가 전면 불응, 프로브의
   setTimeout/fetch 카운터도 읽을 수 없음).

첫 방문(홈 핸드오프)·SPA 이탈 후 복귀가 정상인 이유: 스토어에 **홈이 만든 타깃**(실시간
시세 기반, `evaluationAmount`·`currentPrice` 등이 세션 스냅숏과 다름)이 이미 있어
키 비교가 불일치 → 반영 안 함 → 수렴. 신규 탭 재진입이 정상인 이유: sessionStorage가
비어 하이드레이션 자체가 없음. **"런 활성 상태의 전체 문서 로드"만** 스토어-세션 키가
영구히 일치하는 고정점에 도달해 루프가 살아남는다.

## 3. 증폭 — `[target]`/객체 참조 deps 이펙트의 재실행 스톰

루프 각 주기마다 `target`·`requestSeed`(useMemo)·`haltVerdict`(useMemo) 참조가 교체되어:

- 퀵시세 이펙트(`[markDeepScanLoadingSuccess, target, targetKey]`)·브리핑 스냅샷
  이펙트가 매 주기 재실행 — **fetch 스톰**(로컬 재현 25분 관찰:
  `/api/quotes/current` **16,677회** + `/api/deepscan/briefing-snapshot` **4,117회**,
  크롤러 업스트림 지연 5~48s와 만나 응답·프로미스·AbortController가 렌더러에 누적 →
  RSS GB 폭발).
- 정규 요청 이펙트(deps에 `haltVerdict` 객체 포함)는 진행 중 cacheOnly 요청을
  abort→`abandonInFlight`→재시작 반복(서버 도달 전 abort로 `cacheOnly=1` 로그 0건 —
  요청 대부분이 네트워크에 나가기 전 취소됨).

## 4. 수정

1. **근원(원샷 시드)** — `resolveDeepScanHydrationApplication`(신규 순수 함수,
   `src/lib/deepscan-target-hydration.ts`): 하이드레이션 반영은 **스토어가 비어 있을 때
   한 번**만. 메모리 타깃이 있으면(같은 종목이든 다른 종목이든) 덮어쓰지 않고 현재
   타깃 키로 시작 결정 잠금만 해제한다. 루프 고정점 자체를 제거.
2. **증폭 차단** — 정규 요청 이펙트의 게이트를 `haltVerdict` 객체 참조가 아니라 파생
   불리언 `canonicalRequestHalted`로 구독. 판정 객체 갱신이 진행 중 요청을 abort하는
   재발사 사이클을 제거.
3. **TC-BBSC-005(함께 수정)** — 팀 브리지 카드("세 팀이 의견을 정리하는 중…")를
   종결 시 CSS 접힘(max-height/opacity)이 아니라 **언마운트**로 소거. 종결 후
   DOM·페인트에 로딩 문구가 남지 않는다(실측: 종결 후 15초+ 관찰에서
   "세 팀이 의견을 정리하는 중"·"분석가 응답을 기다리는 중"·"곧 결과를 보여드릴게요"
   전부 0표본).

run-readonly(cacheOnly) 폴링 점검 결과: cacheOnly 조회는 1회성(재폴링 없음), 위원회
상태 폴링은 `partial` 동안 2.5s 주기로 서버 상태 전이(complete/error/not_found)에서
종결 — 무한 증식 경로 아님(수정 후 실측: `cacheOnly=1` 요청 정확히 1회, 404 종결).

## 5. 재현·검증 절차 (로컬 스택)

```bash
# 워크트리에서 스택 기동 (LLM 목 — 비용 0)
PORT=3014 CRAWLER_PORT=3045 JAROO_CRAWLER_BASE_URL=http://127.0.0.1:3045 \
  JAROO_LLM_MOCK=1 npm run dev

# 전용 크롬(CDP 9232) + 세션 전이 후 재현 스크립트:
#   딥스캔 시작(홈 종목카드 → '딥스캔 분석') → +8s Page.reload → 70~120s 관찰
#   (eval 지연·렌더러 RSS·CPU 10s 표본)
python3 repro-f5-local.py <out.json>   # /tmp/jaroo-wedge/ 에서 관리
```

증거 파일(재현 세션): `/tmp/jaroo-wedge/f5-local-before.json`(웨지)·
`f5-local-after.json`(정상)·`wedge-profile.json`.

## 6. 회귀 테스트

- `src/lib/deepscan-refresh-wedge.test.ts` — 원샷 시드 계약(시드 1회·재판정 50회 모두
  apply=false로 수렴·시작 결정 3분기).
- `src/components/deepscan-loading-bridge-termination.test.ts` — 브리지 상태 종결
  소거 계약(ready 시 항상 null, 공개 구간에만 상태).
- `tests/deepscan-refresh-wedge-regression.test.mjs` — 페이지 배선 정적 계약(원샷
  판정 함수 위임·haltVerdict 객체 deps 금지·브리지 조건부 렌더).
