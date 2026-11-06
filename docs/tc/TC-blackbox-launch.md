# TC — jaroo 블랙박스 출시 체크리스트 (TC-BBL)

- **문서**: `docs/tc/TC-blackbox-launch.md` · **스크립트**: `scripts/blackbox-launch-check.cjs`
- **체크 ID 범위**: TC-BBL-001 ~ TC-BBL-024
- **최종 실시**: 2026-11-06 (Asia/Seoul) · 대상: 운영 `https://jaroo.kr` (게스트 표면), 필요시 로컬 `http://127.0.0.1:3002`
- **브라우저**: `agent-browser` (세션 `jaroo-bb-launch`, 종료 시 close)

---

## 1. 블랙박스 원칙 (최우선)

1. **제품 소스/내부 문서 열람 금지** — `src/`, `packages/`, `tests/`, 기존 `scripts/`, `docs/` 는 열람하지 않는다.
   기대값은 아래 세 출처에서만 도출하고, 모든 TC에 출처를 명시한다.
   - ① **공개 관행**: Web 성능 상식(web.dev), WCAG 2.1/2.2, 전자상거래·이커머스 관행, 반응형/터치 타깃 관행(Apple HIG)
   - ② **공개 법령**: 전자상거래법 등에서의 소비자보호에 관한 법률(가격 표시·청약철회 고지 관행)
   - ③ **크로스환경 일관성**: 동일 경로 반복 응답 일관성, 뷰포트 간 동작 일관성
2. **게스트 표면만 관찰** — 운영 로그인 시도 금지, 가입/결제 실행 금지, **결제 버튼 절대 클릭 금지**
   (스크립트는 `click`/`type`/`fill` 을 호출하지 않도록 설계됨. 키보드는 `Tab`(포커스 관찰)만 사용)
3. **운영 예의** — 순차 요청, 요청 간 최소 500ms(`GAP_MS`), 페이지당 최대 3 샘플(`SAMPLES=3` 고정), 부하 금지.

## 2. 성능 예산 (정의·출처)

| 항목 | 예산 | 출처(공개 관행) |
| --- | --- | --- |
| TTFB (중앙값) | ≤ 800ms | web.dev "TTFB" Good 기준(≤ 0.8s) |
| 로드완료 `loadEventEnd` (중앙값) | ≤ 3,000ms | "3초 초과 시 이탈 급증" 모바일 속도 통계 관행(Google/SOASTA) |
| 존재하지 않는 경로 | HTTP 404 로 응답 | HTTP 시맨틱/SEO 공개 관행 (200 폴백은 중복콘텐츠 위험) |
| 측정법 | 브라우저 Navigation Timing 3샘플 중앙값 | 운영 HTML 응답이 `cache-control: no-store` 로 매 요청 실측됨을 확인(운영 관찰) |

## 3. 그 외 기대값·판정 기준 요약

| 영역 | 기대값 | 출처 |
| --- | --- | --- |
| 언어 | `html lang="ko"` | WCAG 2.1 SC 3.1.1 (A) |
| 이미지 대체텍스트 | 정보성 `img`에 `alt` 존재 (장식 SVG는 `aria-hidden` 처리 관행) | WCAG 2.1 SC 1.1.1 (A) |
| 페이지 구조 | 페이지별 `h1` 1개 | HTML/접근성 공개 관행 |
| 포커스 가시성 | Tab 정차 요소마다 outline/box-shadow/underline 표시 | WCAG 2.1 SC 2.4.7 (AA) |
| 폼 라벨 | 로그인 동의 체크박스가 label과 연결(암묵 래핑 포함) | WCAG 2.1 SC 1.3.1/3.3.2 (A) |
| 색 대비 | 주요 텍스트 ≥ 4.5:1 (비활성 UI 컴포넌트 텍스트는 1.4.3 예외, 별도 기록) | WCAG 2.1 SC 1.4.3 (AA) |
| 결제 표시 | 게스트 도달 시: 상품명·원화 가격·부가세(포함/별도) 표기·구독(주기·갱신·해지) 안내. 도달 불가 시 "로그인 게이트 뒤" 기록 | 전자상거래법 가격표시 관행·이커머스 공개 관행 (표시만 검사, 실행 금지) |
| 뷰포트 | 320/390/768/1024px에서 가로 스크롤 없음·텍스트 잘림 없음 | 반응형 공개 관행 |
| 터치 타깃 | 최소 24px(WCAG 2.5.8 AA) 통과 필수, 44px(Apple HIG/WCAG 2.5.5 참고) 권장 — 문장 내 인라인 링크·비활성 제외, label 래핑 입력은 라벨 히트영역 통합 | WCAG 2.2 SC 2.5.8 / Apple HIG |
| SEO 메타 | 고유 title·description, canonical, og:title/description/image, 파비콘 200 | 검색엔진 공개 가이드·Open Graph 프로토콜 관행 |
| 안정성 | `/api/health` 200 JSON, 동일 경로 2회 상태·유형·길이 일치(본문 해시는 관찰 기록) | 헬스체크·멱등성 공개 관행 |

## 4. 실행 방법

```bash
# 전체(운영 기본)
node scripts/blackbox-launch-check.cjs
# 그룹 선택: perf | a11y | payment | viewport | seo | stability | all
node scripts/blackbox-launch-check.cjs perf a11y
# 로컬 대상 / 병행
TARGET=local node scripts/blackbox-launch-check.cjs all
TARGET=both node scripts/blackbox-launch-check.cjs all
# 환경변수: PROD_URL(기본 https://jaroo.kr) · BASE_URL(기본 http://127.0.0.1:3002)
#          TARGET(prod|local|both) · GAP_MS(500) · BROWSER_SESSION(jaroo-bb-launch)
```

- 종료 코드: `0` FAIL 없음 · `1` FAIL 존재 · `2` 셋업 오류
- 브라우저 그룹은 agent-browser 세션 `jaroo-bb-launch` 를 재사용하고 종료 시 close 한다.

---

## 5. TC 명세

### A. 성능 스모크 (perf)

| ID | 대상 | 절차 | 기대값(출처) | 판정 기준 |
| --- | --- | --- | --- | --- |
| TC-BBL-001 | `/` | 상태 1회 관찰 + 브라우저 3샘플 내비게이션(중앙값) | TTFB ≤800ms·로드 ≤3000ms (web.dev·3초 관행). 게스트 `/`는 307→`/login` 리다이렉트가 관찰됨(운영 동작 기록) | 예산 내 & 2xx/3xx |
| TC-BBL-002 | `/login` | 위와 동일 | 위와 동일 | 위와 동일 |
| TC-BBL-003 | `/terms` | 위와 동일 | 위와 동일 | 위와 동일 |
| TC-BBL-004 | `/privacy` | 위와 동일 | 위와 동일 | 위와 동일 |
| TC-BBL-005 | `/tc-bbl-nonexistent-404` | 위와 동일 + 상태코드 확인 | **HTTP 404** (HTTP/SEO 관행) + 예산 내 | 404 & 예산 내 |

### B. 접근성 기본 (a11y)

| ID | 대상 | 절차 | 기대값(출처) | 판정 기준 |
| --- | --- | --- | --- | --- |
| TC-BBL-006 | /login·/terms·/privacy·/home | `documentElement.lang` 확인 | `lang="ko"` (WCAG 3.1.1 A) | 전체 페이지 ko |
| TC-BBL-007 | 위와 동일 | `img` alt·SVG 라벨 상태 수집 | 정보성 img alt 존재 (WCAG 1.1.1 A). 장식 SVG `aria-hidden` 관행, 라벨 없는 SVG는 관찰 기록 | alt 누락 0 |
| TC-BBL-008 | 위와 동일 | h1 개수 확인 | 페이지별 h1 1개 (공개 관행) | 각 페이지 h1 ≥ 1 |
| TC-BBL-009 | /login | Tab 4회 이동, activeElement 포커스 표시 확인 | 정차 요소마다 포커스 표시 (WCAG 2.4.7 AA) | 4/4 가시 |
| TC-BBL-010 | /login | 동의 체크박스 label 연결 확인 | label 연결(암묵 래핑 포함) (WCAG 1.3.1/3.3.2 A) | 연결 확인 |
| TC-BBL-011 | /login·/terms | 텍스트 노드 최대 14개 샘플 WCAG 계산식 대비 산출 | ≥ 4.5:1 (WCAG 1.4.3 AA). 비활성 컴포넌트 내 텍스트는 예외로 별도 기록 | 미달 0 (활성 기준) |

### C. 결제·플랜 표시 계약 — 표시만 (payment)

> **게스트 관찰 경로만 사용. 결제/구독/업그레이드 버튼 클릭 금지. 로그인 시도 금지.**

| ID | 대상 | 절차 | 기대값(출처) | 판정 기준 |
| --- | --- | --- | --- | --- |
| TC-BBL-012 | 게스트 표면 전체 | 게스트 페이지(//,/login,/home,/terms) 원문·링크·대표 결제 경로(pricing/plans/subscribe) 상태 관찰 + 게스트 /home 화면 텍스트 관찰 | 게스트 도달 가능 결제 표면 존재 여부 기록 (전자상거래 관행) | 도달 시 PASS + 하위 TC 실측 / 불가 시 INFO "로그인 게이트 뒤" |
| TC-BBL-013 | 도달 표면 | 상품명·플랜명 표시 확인(표시만) | 상품명·플랜명 명시 (전자상거래 관행) | 표면 도달 시: 표시 있으면 PASS |
| TC-BBL-014 | 도달 표면 | 원화 가격·부가세 표기 확인(표시만) | 원화(₩/원) + 부가세 포함/별도 명시 (전자상거래법 가격표시 관행) | 표면 도달 시: 둘 다 표시 시 PASS |
| TC-BBL-015 | 도달 표면 | 구독 안내 확인(표시만) | 결제 주기·자동 갱신·해지 안내 (정기결제 공개 관행) | 표면 도달 시: 안내 있으면 PASS |

### D. 크로스 뷰포트 (viewport)

| ID | 대상 | 절차 | 기대값(출처) | 판정 기준 |
| --- | --- | --- | --- | --- |
| TC-BBL-016 | /·/login·/terms @ 320/390/768/1024 | 첫 폭은 로드 전 뷰포트 설정 후 로드, 이후 폭은 리사이즈로 측정(재요청 없음) | 가로 스크롤 없음 (반응형 관행) | 12개 조합 모두 `scrollWidth ≤ clientWidth+1` |
| TC-BBL-017 | 위와 동일 | 텍스트 잘림(overflow hidden + scrollWidth>clientWidth) 샘플 | 잘림 없음 (반응형 관행) | 잘림 요소 0 |
| TC-BBL-018 | 위와 동일 | 인터랙티브 요소 박스 크기 샘플 | 최소 24px(WCAG 2.5.8 AA), 권장 44px(Apple HIG). label 래핑 입력은 라벨 히트영역 통합, 인라인 링크·비활성 제외 | 24px 미만 0 (44px 미달은 주석 기록) |

### E. SEO/메타 (seo)

| ID | 대상 | 절차 | 기대값(출처) | 판정 기준 |
| --- | --- | --- | --- | --- |
| TC-BBL-019 | /·/login·/terms·/privacy | HTML 메타 파싱 | 고유 title·description (검색엔진 공개 가이드) | 전체 페이지 존재 |
| TC-BBL-020 | 위와 동일 | `<link rel=canonical>` 확인 | 페이지별 고유 canonical (공개 가이드 관행) | 전체 페이지 존재 |
| TC-BBL-021 | 위와 동일 | OG 태그 확인 | og:title·og:description·og:image (OG 프로토콜 관행) | 전체 페이지 존재 |
| TC-BBL-022 | 파비콘·OG 이미지 | 실제 로드 요청 1회 | 200 + image/* (관행) | 둘 다 200·image |

### F. 운영 안정성 관찰 (stability)

| ID | 대상 | 절차 | 기대값(출처) | 판정 기준 |
| --- | --- | --- | --- | --- |
| TC-BBL-023 | `/api/health` | 2회 GET(500ms 간격) | 200 + JSON (헬스 엔드포인트 관행) | 2회 모두 200·동일 유형 |
| TC-BBL-024 | `/terms`·`/login` | 각 2회 GET, 상태·유형·길이·본문 해시 비교 | 동일 경로 응답 일관성 (멱등성 관행) | 형태(상태·유형·길이) 불일치=FAIL, 해시만 불일치(길이 동일)=INFO 관찰 기록 |

---

## 6. 실측 결과 — 운영(https://jaroo.kr) 게스트 표면

> `node scripts/blackbox-launch-check.cjs all` 공식 실행(2026-11-06, 세션 `jaroo-bb-launch`, 요청 간 500ms, 페이지당 3샘플).
> **총 24 TC · PASS 17 · FAIL 3 · INFO 4** (종료 코드 1)

### 6-1. 성능 예산 대비 (전 페이지 예산 내 통과)

| 페이지 | 상태 | TTFB 중앙값 (≤800ms) | 로드완료 중앙값 (≤3000ms) | 판정 |
| --- | --- | --- | --- | --- |
| `/` | 307 → /login | **165ms** (샘플 451/163/165) | **245ms** (895/245/209) | PASS · TC-BBL-001 |
| `/login` | 200 | **85ms** | **131ms** | PASS · TC-BBL-002 |
| `/terms` | 200 | **83ms** | **109ms** | PASS · TC-BBL-003 |
| `/privacy` | 200 | **83ms** | **113ms** | PASS · TC-BBL-004 |
| `/tc-bbl-nonexistent-404` | **404** | **82ms** | **110ms** | PASS · TC-BBL-005 |

- 예산 대비 여유: TTFB 최대 165ms (예산의 21%), 로드완료 최대 245ms (예산의 8%).
- `/` 첫 샘플(TTFB 451ms/로드 895ms)은 브라우저 세션 워밍업(콜드 커넥션) 영향 추정 — 중앙값 기준 판정.

### 6-2. TC 판정 요약

| ID | 판정 | 실측 요약 |
| --- | --- | --- |
| TC-BBL-001 | **PASS** | `/` 307→/login 리다이렉트 확인 · TTFB 165ms/로드 245ms |
| TC-BBL-002 | **PASS** | /login 200 · 85ms/131ms |
| TC-BBL-003 | **PASS** | /terms 200 · 83ms/109ms |
| TC-BBL-004 | **PASS** | /privacy 200 · 83ms/113ms |
| TC-BBL-005 | **PASS** | 존재하지 않는 경로 HTTP 404 · 82ms/110ms |
| TC-BBL-006 | **PASS** | 4개 게스트 페이지 모두 `lang="ko"` (WCAG 3.1.1) |
| TC-BBL-007 | **PASS** | img alt 누락 0 · 장식 SVG aria-hidden 6개, 라벨 없는 SVG 1개(관찰 기록) |
| TC-BBL-008 | **FAIL** | /login·/terms·/privacy·/home 모두 **h1 0개** (/login은 헤딩 자체가 없음) |
| TC-BBL-009 | **PASS** | Tab 4회 정차 요소 전부 가시 — 뒤로→체크박스→약관→개인정보 (UA outline) |
| TC-BBL-010 | **PASS** | 동의 체크박스 label 연결(래핑) + `aria-required="true"` |
| TC-BBL-011 | **FAIL** | 24샘플 중 1개 미달 — **"준비 중" rgb(151,160,174) 2.64:1 (10.5px)**, 버튼 밖 구분선 텍스트라 1.4.3 비활성 예외 미적용 · 비활성 버튼 내부 4건은 예외 기록(예: Apple 버튼 18.51:1) |
| TC-BBL-012 | **INFO** | **게스트 결제 표면 도달 불가 — 로그인 게이트 뒤**: /·/login·/home 원문·화면에 가격/플랜/결제성 요소 0건, /pricing·/plans·/subscribe 모두 404 |
| TC-BBL-013 | **INFO** | 게이트 뒤 · 공개 약관 제6조에 상품(크레딧·정기 구독 "Jaroo Pro") 및 "종류·가격·이용 조건은 서비스 내 결제 화면에 표시" 규정 존재 |
| TC-BBL-014 | **INFO** | 게이트 뒤 · 가격 원화·부가세 표기는 게스트 관찰 불가(표시 주체: 결제 화면 — 약관 근거 동일) |
| TC-BBL-015 | **INFO** | 게이트 뒤 · 구독 주기·갱신·해지 안내 게스트 관찰 불가. 약관: 미사용 크레딧 환불, 디지털 콘텐츠 청약철회 제한(전자상거래법 §17②⑤) 결제 화면 고지 규정 존재 |
| TC-BBL-016 | **PASS** | /·/login·/terms × 320/390/768/1024px 12조합 가로 스크롤 0건 |
| TC-BBL-017 | **PASS** | 12조합 텍스트 잘림 요소 0건 |
| TC-BBL-018 | **PASS** | 24px 미만 0개(최소 타깃 28×28 "뒤로") · 44px 관행 미달 20개 관찰 기록(예: 뒤로 28×28, 동의 라벨 높이 35px) — 주요 CTA(시작하기 버튼 272×44~51)는 44px+ 충족 |
| TC-BBL-019 | **PASS** | 4페이지 모두 title·description 존재 (단, description은 전 페이지 동일 문구 79자 — 관찰 기록) |
| TC-BBL-020 | **FAIL** | **4페이지 모두 canonical 없음** |
| TC-BBL-021 | **PASS** | og:title·og:description·og:image 전 페이지 존재 (단, OG 문구도 메인과 동일 — 관찰 기록) |
| TC-BBL-022 | **PASS** | /favicon.ico 200(image/x-icon, 20,070B) · og:image 200(image/png, 48,276B) |
| TC-BBL-023 | **PASS** | /api/health 2회 200 (79ms/80ms) · `{"ok":true,"service":"jaroo-v3-web","runtime":"next"}` |
| TC-BBL-024 | **PASS** | /terms·/login 2회씩 상태·유형·길이·본문 해시 완전 일치 (운영은 해시까지 일치 — 로컬 dev만 빌드 ID 토큰 차이 INFO 관찰) |

### 6-3. 필수 관찰 기록 (수동 관찰 포함)

- **게스트 `/`는 307 → `/login` 리다이렉트**: 게스트 첫 진입이 로그인 게이트. 퍼블릭 랜딩(서비스 소개·가격 안내) 부재.
- **결제 표면(재확인)**: 게스트 도달 불가. 공개 약관 제6조가 표시 주체를 "서비스 내 결제 화면"으로 명시하고,
  청약철회 제한 고지(전자상거래법 §17 제2항 제5호 인용)를 결제 화면에 하기로 규정 — 실제 결제 화면 표시 준수 여부는 게이트 안쪽 점검(별도 TC) 대상.
- **404 페이지**: Next.js 기본 안내("404 — This page could not be found.")로 **영어 표기** — ko 서비스 언어 일관성 관점 기록. h1은 존재(유일하게 h1 있는 페이지).
- **robots.txt 404** — SEO 관찰 기록(체크리스트 예산 외 항목).
- **메타 description·OG 태그가 /terms·/privacy에서도 메인 문구와 동일** — 페이지별 고유성 관찰 기록.
- **뷰포트 측정법**: 첫 폭(320px)은 로드 전 뷰포트 설정 후 측정, 이후 폭(390/768/1024)은 리사이즈로 측정(운영 요청 절약). 반응형 CSS는 리사이즈에 즉시 반영되므로 유효.

### 6-4. 로컬(http://127.0.0.1:3002) 검증 실행

- `TARGET=local`(전체 그룹): 24 TC 중 PASS 15·FAIL 3·INFO 4 — FAIL는 h1·대비("준비 중")·canonical으로 운영과 동일 항목(터치타깃 TC는 라벨 히트영역 통합 보정 전 측정치였음. 보정 후 viewport 그룹 재실행 PASS 3/3).
- 로컬 dev 특이사항: 동일 경로 2회 본문 해시 불일치(빌드/HMR 세션 ID 토큰 차이, 길이 동일) → INFO 관찰. 운영은 해시까지 일치.

---

## 7. 출시 전 수정 권고 (우선순위)

1. **[중간] 페이지별 h1 부재 (TC-BBL-008, FAIL)** — /login(헤딩 없음)·/terms·/privacy·/home 모두 h1 0개. 스크린리더·SEO 내비게이션 모두 영향. 각 페이지에 콘텐츠를 요약하는 h1 1개 추가(예: 로그인 "Jaroo 로그인", 게스트 홈 "포트폴리오 준비"를 h2→h1 승격 검토).
2. **[중간] canonical 태그 전면 부재 (TC-BBL-020, FAIL)** — 4개 게스트 페이지 모두 없음. `/`→`/login` 307 리다이렉트 구조에서 URL 정규화(중복 수집 방지) 관점 더 중요. 페이지별 자기 참조 canonical 추가 권고.
3. **[낮음] 저대비 텍스트 1건 (TC-BBL-011, FAIL)** — 로그인 화면 "준비 중" 배지 rgb(151,160,174) **2.64:1**(10.5px). 버튼 밖 구분선 텍스트라 WCAG 1.4.3 비활성 예외 미적용. 4.5:1 이상 색으로 조정(예: 회색 계열 진하게).
4. **[낮음] 게스트 가격 정보 부재 (TC-BBL-012~015, INFO)** — 게이트 뒤 구조는 약관상 합법적 표시 위임(결제 화면 표시)이나, 로그인 전 플랜·가격·"부가세 포함" 안내가 없으면 가입 전환·신뢰 관점 손실. 퍼블릭 요금 안내(또는 FAQ 링크) 제공 검토 권고.
5. **[참고] 관찰 기록** — 404 안내 영어 표기(ko 일관성), robots.txt 부재, 페이지별 고유 description 미사용, 보조 터치 타깃 44px 미달 20개(24px 기준은 통과 — 우선순위 낮음).

> 결론: **성능·뷰포트·SEO 기본(파비콘·OG)·헬스·응답 일관성은 출시 수준 통과.** 차단(Blocker)급 FAIL은 없으나,
> 위 1~3(접근성 h1·canonical·대비 1건)은 출시 전 저비용 수정 권고. 결제 표시 계약은 게이트 뒤이므로 로그인 상태 점검 TC(별도)에서 계속.
