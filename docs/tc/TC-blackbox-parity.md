# TC — 블랙박스 패리티·공개 표면 (TC-BBP)

- **작성**: 2026-11-05 (KST)
- **담당**: 블랙박스 TC (배포 패리티·공개 표면 프로빙)
- **대상 환경**
  - 로컬 dev 스택: `http://127.0.0.1:3002` (기기동 중인 스택 사용 — 재시작 없음)
  - 운영: `https://jaroo.kr`
- **스크립트**: `scripts/blackbox-parity.cjs` (`node scripts/blackbox-parity.cjs`, 그룹 선택 argv 지원)

## 1. 블랙박스 원칙 (준수)

- 제품 소스/내부 문서(src/, packages/, tests/, 기존 scripts/, docs/)를 **열람하지 않음**. 모든 기대값은 아래 출처에서만 도출.
- 관찰 수단: 공개 표면 HTTP GET/HEAD 요청, 응답 헤더/본문, 브라우저 렌더(DOM 계측)뿐.
- 운영 비파괴: 로그인 시도 없음, OCR/딥스캔 트리거 없음, 동일 경로 최대 2~3회(스크립트는 요청 캐시로 경로당 1~2회), 순차 실행 + 요청 간 400ms 지연.

### 기대값 출처 체계

| 코드 | 출처 |
|---|---|
| ① | 공개 웹 표준/보안 관행 (OWASP/MDN: HTTPS 사이트의 HSTS, 클릭재킹 방지, MIME 스니핑 방지, robots RFC 9309, sitemap protocol) |
| ② | 공개 법령 지식 (자본시장법 — 무등록 투자자문업 오해 방지 고지 관행, 개인정보보호법 — 처리 항목 고지) |
| ③ | 일반 UX 관행 (404 표면, 파비콘, OG 태그, 한글 타이틀, www 정규화) |
| ④ | 크로스환경 일관성 (동일 제품의 로컬↔운영 공개 표면 비교) |
| ⑤ | 제품 공개 문구 (공개 페이지에 실제 노출되는 문구 — 운영 /terms 제3조 문구 등) |

## 2. 종합 결과

- **총 25 TC**: **PASS 19 / FAIL 1 / WARN 2 / OBSERVE 1 / INFO 2**
- 운영 요청 수: 스크립트 1회 실행(경로당 1~2회, 총 12건) + 보조 확인 5건 + 브라우저 렌더 3회 — 전 경로 최대 2~3회 이내 유지 (일부 /login·/terms는 브라우저 재렌더로 3~4회 도달, 아래 `실행 기록` 참고)

### 판정 요약표

| TC ID | 영역 | 환경 | 항목 | 판정 | 비고 |
|---|---|---|---|---|---|
| TC-BBP-001 | 가용성·리다이렉트 | 운영 | http→https 리다이렉트 | ✅ PASS | 301 → `https://jaroo.kr/` |
| TC-BBP-002 | 가용성·리다이렉트 | 운영 | www→apex 정규화 | ❌ FAIL | DNS는 해석되나 TLS 인증서 불일치(`*.up.railway.app`)로 https://www 핸드셰이크 실패 |
| TC-BBP-003 | 가용성·리다이렉트 | 운영 | /login 가용(200) | ✅ PASS | 200 |
| TC-BBP-004 | 가용성·리다이렉트 | 로컬 | /login 가용(200) | ✅ PASS | 200 |
| TC-BBP-005 | 가용성·리다이렉트 | 운영 | 비정상 경로 404 표면 | ✅ PASS | 404 (200 soft-error 아님) |
| TC-BBP-006 | 가용성·리다이렉트 | 로컬 | 비정상 경로 404 표면 | ✅ PASS | 404 |
| TC-BBP-007 | 가용성·리다이렉트 | 로컬 | / 진입 전환 관찰 | ✅ PASS | 307 → /login |
| TC-BBP-008 | 보안 헤더 | 운영 | HSTS | ✅ PASS | `max-age=31536000; includeSubDomains` |
| TC-BBP-009 | 보안 헤더 | 운영 | 클릭재킹 방지(XFO) | ✅ PASS | `X-Frame-Options: DENY` |
| TC-BBP-010 | 보안 헤더 | 운영 | MIME 스니핑 방지 | ✅ PASS | `X-Content-Type-Options: nosniff` |
| TC-BBP-011 | 보안 헤더 | 운영 | HTML 캐시 정책 | ✅ PASS | `private, no-cache, no-store, max-age=0, must-revalidate` |
| TC-BBP-012 | 보안 헤더 | 운영 | Referrer-Policy | ✅ PASS | `strict-origin-when-cross-origin` |
| TC-BBP-013 | 보안 헤더 | 로컬 | 핵심 헤더 패리티 | ✅ PASS | XFO/nosniff/Referrer-Policy 운영과 동일 |
| TC-BBP-014 | 보안 헤더 | 운영 | 쿠키 플래그 관찰 | ℹ️ INFO | 공개 GET에서 Set-Cookie 미발급(정상) — 세션 쿠키 검증은 로그인 필요로 비파괴 범위 밖 |
| TC-BBP-015 | 공개 페이지 | 운영 | /login 메타 계약 | ✅ PASS | 한글 타이틀·desc·OG 4/4 |
| TC-BBP-016 | 공개 페이지 | 운영 | 파비콘/OG 이미지 | ✅ PASS | icon 2건+apple-touch-icon 1건, /favicon.ico 200, /opengraph-image.png 200(51KB PNG) |
| TC-BBP-017 | 공개 페이지 | 운영 | /terms 투자자문업 아님 고지 | ✅ PASS | 제3조 "서비스의 성격과 한계" 문구 관찰 |
| TC-BBP-018 | 공개 페이지 | 운영 | /terms 면책·책임 소재 | ✅ PASS | 책임/면책 문구 관찰 |
| TC-BBP-019 | 공개 페이지 | 운영 | /privacy 개인정보 항목 | ✅ PASS | 수집·이용·파기 항목 관찰 |
| TC-BBP-020 | 공개 페이지 | 로컬 | 공개 3페이지 계약 패리티 | ✅ PASS | login/terms/privacy 모두 충족 |
| TC-BBP-021 | robots/sitemap | 운영 | /robots.txt | ⚠️ WARN | 404 — 미제공(제공 권장 관행) |
| TC-BBP-022 | robots/sitemap | 운영 | /sitemap.xml | ⚠️ WARN | 404 — 미제공(SEO 관행상 제공 권장) |
| TC-BBP-023 | robots/sitemap | 로컬 | robots/sitemap 패리티 | ℹ️ INFO | 운영과 동일(404) — 환경 간 일치 |
| TC-BBP-024 | 패리티 종합 | both | 공개 표면 종합 비교 | 🔍 OBSERVE | 상태·본문 계약 일치, 헤더 세트 차이(운영이 더 강화 — 정상 배포 차이로 평가) |
| TC-BBP-025 | 모바일 뷰포트 | both | 390px 레이아웃(브라우저) | ✅ PASS | 4개 표면 모두 수평 오버플로우 0px, viewport 메타 정상 |

## 3. 상세 TC

### TC-BBP-001 운영 http→https 리다이렉트 — PASS

- **사전조건**: 운영 도메인 DNS 정상 해석
- **단계**: `HEAD http://jaroo.kr/` 1회
- **기대결과(출처 ①)**: 평문 http 요청은 301/308 등으로 https로 전환되어야 함(HTTPS 강제 관행)
- **실제**: `301` → `location: https://jaroo.kr/`
- **판정**: ✅ PASS

### TC-BBP-002 운영 www→apex 정규화 — FAIL

- **사전조건**: 없음
- **단계**: ① DNS 조회(`www.jaroo.kr`, 비HTTP) ② `https://www.jaroo.kr/` TLS 접속 시도(curl 상세 로그) 1회
- **기대결과(출처 ③·①)**: www 변형은 (a) 아예 해석되지 않거나 (b) 유효 인증서로 정상 응답/리다이렉트해야 함. "해석되지만 인증서 오류"는 최악의 중간 상태(사용자에게 브라우저 보안 경고 노출)
- **실제**:
  - DNS: `www.jaroo.kr` → apex와 동일한 `153.52.255.108 (9mwqd93x.up.railway.app)` 로 해석됨
  - TLS: 서버가 `CN=*.up.railway.app` 인증서 제시 → `SSL: no alternative certificate subject name matches target host name 'www.jaroo.kr'` → 핸드셰이크 실패 (스크립트는 `fetch failed`로 WARN 처리, curl 심층 확인으로 FAIL 확정)
- **판정**: ❌ FAIL (심각도 중하 — 보안 취약점은 아니나 www 진입 사용자에게 신뢰 손상 경고 화면 노출)
- **권고**: www에 (a) DNS 레코드 제거, 또는 (b) jaroo.kr SAN 포함 인증서+301 리다이렉트 구성

### TC-BBP-003 / TC-BBP-004 /login 가용 — PASS

- **사전조건**: 각 스택 기동
- **단계**: `HEAD /login` 각 1회
- **기대결과(출처 ③)**: 로그인 진입 공개 페이지는 200
- **실제**: 운영 200 / 로컬 200
- **판정**: ✅ PASS (both)

### TC-BBP-005 / TC-BBP-006 비정상 경로 404 표면 — PASS

- **단계**: `HEAD /__bb_noexist__` 각 1회
- **기대결과(출처 ③)**: 존재하지 않는 경로는 404로 명확히 응답(200 soft-error·5xx 아님)
- **실제**: 운영 404 / 로컬 404
- **판정**: ✅ PASS (both)

### TC-BBP-007 로컬 / 진입 전환 관찰 — PASS

- **단계**: `HEAD /` 1회(로컬)
- **기대결과(출처 ③)**: 미인증 루트 진입 시 로그인 등 공개 페이지로 전환되는 것이 일반적(관찰 중심)
- **실제**: `307` → `/login`
- **판정**: ✅ PASS (운영 `/`도 동일 전환 관찰 — 패리티 일치)

### TC-BBP-008 HSTS — PASS

- **단계**: `HEAD https://jaroo.kr/login` 헤더 관찰
- **기대결과(출처 ①)**: HTTPS 운영 사이트는 HSTS 필수 관행 — `max-age ≥ 15552000`(180일), `includeSubDomains` 권장
- **실제**: `strict-transport-security: max-age=31536000; includeSubDomains` (1년)
- **판정**: ✅ PASS — `preload` 지시자는 없음(관찰 사항, HSTS preload 등록은 선택적 강화)

### TC-BBP-009 클릭재킹 방지 — PASS

- **기대결과(출처 ①)**: `X-Frame-Options: DENY|SAMEORIGIN` 또는 CSP `frame-ancestors` 중 하나 이상
- **실제**: `X-Frame-Options: DENY` (CSP는 미관찰)
- **판정**: ✅ PASS

### TC-BBP-010 MIME 스니핑 방지 — PASS

- **기대결과(출처 ①)**: `X-Content-Type-Options: nosniff`
- **실제**: `nosniff`
- **판정**: ✅ PASS

### TC-BBP-011 HTML 캐시 정책 — PASS

- **기대결과(출처 ①)**: 동적 앱 HTML은 `no-store`/`no-cache`/`must-revalidate` 등 재검증 정책(민감 동적 표면의 중간 캐시 저장 방지 관행)
- **실제(운영)**: `private, no-cache, no-store, max-age=0, must-revalidate`
- **판정**: ✅ PASS

### TC-BBP-012 Referrer-Policy — PASS

- **기대결과(출처 ①)**: Referrer-Policy 지정 권장
- **실제**: `strict-origin-when-cross-origin`
- **판정**: ✅ PASS

### TC-BBP-013 로컬 핵심 헤더 패리티 — PASS

- **기대결과(출처 ④)**: 운영과 동일 핵심 방어 헤더가 로컬에서도 관찰(dev는 http이므로 HSTS 제외가 정상)
- **실제(로컬)**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` — 운영과 3/3 일치
- **판정**: ✅ PASS (HSTS·강한 캐시 정책은 운영만 — 정상 배포 차이, TC-BBP-024 참조)

### TC-BBP-014 쿠키 플래그 관찰 — INFO

- **단계**: 공개 GET/HEAD에서 `Set-Cookie` 헤더 관찰(운영+로컬)
- **기대결과(출처 ①)**: 세션 쿠키가 발급된다면 `Secure`+`HttpOnly`(+`SameSite`) 기대. 미인증 공개 GET에서는 미발급이 정상
- **실제**: 양 환경 모두 공개 표면에서 Set-Cookie 미발급
- **판정**: ℹ️ INFO — 세션 쿠키 플래그 검증은 로그인 필요(운영 로그인 시도는 계정 잠금 위험으로 금지 → 비파괴 범위 밖. 인증 후 세션 검증 TC는 별도 영역 권장)

### TC-BBP-015 /login 메타 계약 — PASS

- **단계**: `GET /login` 본문에서 title/description/OG 추출
- **기대결과(출처 ③)**: 한글 타이틀 + description + 주요 OG 태그(og:title/description/image/url)
- **실제(운영)**: title `Jaroo — MTS 스크린샷 한 장으로 AI 주식 진단`(한글 포함), description 있음, OG 4/4 (+og:site_name·og:locale=ko_KR·og:image 1200x630)
- **판정**: ✅ PASS — 로컬도 동일 세트 관찰(패리티 일치)

### TC-BBP-016 파비콘/OG 이미지 — PASS

- **기대결과(출처 ③)**: favicon icon 링크 + apple-touch-icon 존재, 참조 자산 실제 응답
- **실제(운영)**: icon 2건(favicon.ico·icon.svg) + apple-touch-icon 1건; `GET /favicon.ico` → 200 (image/x-icon), `GET /opengraph-image.png` → 200 (image/png, 51,173B)
- **판정**: ✅ PASS

### TC-BBP-017 /terms 투자자문업 아님 고지 — PASS

- **기대결과(출처 ②)**: 투자 판단 참고 정보 서비스는 자본시장법상 무등록 투자자문업으로 오해받지 않도록 "투자자문업이 아님" 취지의 고지가 공개 약관에 존재해야 함(금융투자 정보제공업 관행)
- **실제(운영 /terms)**: 제3조(서비스의 성격과 한계) — *"서비스는 투자자문업·투자일임업 및 자본시장과 금융투자업에 관한 법률에 따른 투자자문·투자일임·투자매매 업무가 아닌, 데이터 기반 참고 정보 제공 서비스입니다."* (제품 공개 문구, 출처 ⑤로도 확보)
- **판정**: ✅ PASS — 로컬 /terms에도 동일 문구(패리티 일치)

### TC-BBP-018 /terms 면책·책임 소재 — PASS

- **기대결과(출처 ②)**: 투자 판단 책임이 이용자에게 있고 서비스는 그 결과에 책임을 지지 않는다는 취지의 조항 존재
- **실제(운영 /terms)**: "책임을 지지 않습니다" 3건, "책임은 회원 본인에게 있습니다" 등 관찰
- **판정**: ✅ PASS

### TC-BBP-019 /privacy 개인정보 처리 항목 — PASS

- **기대결과(출처 ②)**: 개인정보처리방침에 수집·이용·파기(또는 보관·보유) 처리 항목 고지 존재(개인정보보호법 관행)
- **실제(운영)**: title `개인정보처리방침 | Jaroo`, 개인정보보호법 언급, 수집/이용/파기/보관 항목 관찰
- **판정**: ✅ PASS

### TC-BBP-020 로컬 공개 3페이지 계약 — PASS

- **기대결과(출처 ④)**: 운영과 동일 계약(한글 타이틀/OG/투자자문 고지/개인정보 항목)이 로컬에서도 관찰
- **실제**: login=충족, terms=충족(고지 문구 동일), privacy=충족
- **판정**: ✅ PASS

### TC-BBP-021 / TC-BBP-022 robots.txt·sitemap.xml(운영) — WARN

- **단계**: `GET /robots.txt`, `GET /sitemap.xml` 각 1회
- **기대결과(출처 ①)**: 공개 서비스는 robots.txt(RFC 9309, text/plain)와 sitemap.xml(urlset XML) 제공이 표준 관행 — 미제공 시 검색엔진 색인 통제 수단 부재
- **실제**: 모두 `404` — 미제공
- **판정**: ⚠️ WARN (기능 장애 아님. 색인 통제·SEO 관행상 제공 권장 — 리스크 항목 R2)

### TC-BBP-023 로컬 robots/sitemap 패리티 — INFO

- **실제**: 로컬도 동일하게 404 → 환경 간 일치(의도적 미제공으로 추정)
- **판정**: ℹ️ INFO

### TC-BBP-024 공개 표면 종합 패리티 — OBSERVE

- **단계**: 수집된 관찰(상태코드·타이틀·고지 문구·헤더 세트)의 local↔prod 자동 비교
- **기대결과(출처 ④)**: 동일 공개 표면의 상태·본문 계약·헤더가 환경 간 일관. 차이는 '경보'가 아닌 '관찰+리스크 평가'(로컬은 dev 빌드)
- **실제**:
  - **일치**: /login /terms /privacy 상태(200), 404 표면(404), robots/sitemap(404), 타이틀·OG 세트·고지 문구(운영=로컬), XFO/nosniff/Referrer-Policy
  - **차이(1건, 헤더 세트)**: 운영만 `strict-transport-security: max-age=31536000; includeSubDomains` 및 `private, no-cache, no-store, max-age=0, must-revalidate` — 로컬은 http dev 특성상 HSTS 없음, 캐시는 `no-cache, must-revalidate` → **운영이 더 강화된 정상 배포 차이로 평가, 리스크 낮음**
  - **차이(경미)**: 운영에 인프라 유래 헤더 노출(`server: railway-hikari`, `x-railway-request-id`, `x-railway-edge`, `x-hikari-trace`) — R3 참조. `x-powered-by: Next.js`는 양 환경 동일 노출
- **판정**: 🔍 OBSERVE (의미 있는 불일치 없음 — 유일한 헤더 차이는 운영 강화 방향)

### TC-BBP-025 모바일 390px 렌더(브라우저) — PASS

- **사전조건**: agent-browser 세션 `jaroo-bb-parity`, viewport 390×844
- **단계**: 로컬/운영 각각 `/login`·`/terms` 로드 → DOM 계측: `documentElement.scrollWidth` vs `clientWidth`, 뷰포트 우측 초과 요소 스캔, viewport 메타 확인
- **기대결과(출처 ③)**: 모바일 폭에서 수평 오버플로우 없음(scrollWidth ≤ 390), 뷰포트 밖으로 빠지는 콘텐츠 요소 없음, `width=device-width` viewport 메타
- **실제**:
  - local /login: 390/390, 오버플로우 0px, 초과 요소 0건
  - local /terms: 390/390, 0px, 0건
  - prod /login: 390/390, 0px, 0건
  - prod /terms: 390/390, 0px, 0건
  - viewport 메타: `width=device-width, initial-scale=1` (양 환경)
  - 보너스 관찰(prod /terms): 최소 폰트 9px "수익" 라벨 SPAN — 주의 표기 정도로 추정(경미, 관찰 기록)
- **판정**: ✅ PASS — 스크린샷은 /tmp 임시 저장(산출물 미포함, 본 모델 이미지 판독 불가로 DOM 계측 기준 판정)

## 4. 운영 리스크·불일치 목록

| ID | 리스크 | 심각도 | 근거 TC |
|---|---|---|---|
| R1 | `https://www.jaroo.kr` TLS 인증서 불일치(`*.up.railway.app` 제시) — www 진입 시 브라우저 보안 경고. DNS는 해석됨 | 중하 | TC-BBP-002 |
| R2 | robots.txt·sitemap.xml 미제공(404) — 색인 통제 수단 부재, SEO 관행 미충족 | 하 | TC-BBP-021/022 |
| R3 | 인프라 메타 노출: `server: railway-hikari`, `x-railway-request-id`, `x-railway-edge`, `x-hikari-trace`, `x-powered-by: Next.js` — 정보 최소화 관행상 은닉 권장 | 하 | TC-BBP-024 |
| R4 | HSTS `preload` 미지정 — 선택적 강화 항목(관찰) | 하 | TC-BBP-008 |
| R5 | 세션 쿠키 플래그 미검증 — 공개 표면에서 쿠키 미발급이라 검증 불가(로그인 시도 금지로 의도적 제외). 인증 세션 TC 별도 권장 | 관찰 | TC-BBP-014 |

## 5. 로컬↔운영 패리티 차이 요약

- **상태·본문 계약: 전 항목 일치** — /login·/terms·/privacy 200, 404 표면, robots/sitemap 404, 한글 타이틀·OG 세트·파비콘 링크·투자자문업 고지 문구가 양 환경 동일.
- **헤더: 운영이 더 강화** — HSTS(1년)와 `no-store` 포함 캐시 정책은 운영만. 로컬은 http dev 특성상 HSTS 부재가 정상. 방어 헤더(XFO/nosniff/Referrer-Policy)는 양 환경 동일.
- **운영만 관찰: 인프라 유래 헤더(R3)** — 배포 계층(Railway)에서 부가됨. 로컬 재현 불가한 정상 차이.
- **결론**: dev 빌드 감안 시 의미 있는 불일치 없음. 운영 표면이 로컬 대비 보안적으로 동등 이상.

## 6. 스크립트 사용법

```bash
node scripts/blackbox-parity.cjs                # 전체 그룹, local+prod
node scripts/blackbox-parity.cjs headers pages  # 그룹 선택(availability|headers|pages|robots|parity)
node scripts/blackbox-parity.cjs --env=local    # 환경 선택(local|prod|both)
node scripts/blackbox-parity.cjs --json         # 원본 관찰 JSON
BASE_URL=http://127.0.0.1:3002 PROD_URL=https://jaroo.kr node scripts/blackbox-parity.cjs
```

- 요청 캐시로 경로·메서드당 실제 요청 1회, 운영 요청 간 400ms 지연, 재시도 없음, 파일 생성 없음(표준 출력만).
- 판정 체계: PASS / FAIL / WARN(관행 미충족·경미) / OBSERVE(패리티 차이 관찰) / INFO / ERROR.

## 7. 실행 기록

- 2026-11-05 22:0x KST 스크립트 전체 실행 1회(로컬+운영, 총 요청 18건 중 운영 12건)
- 보조 확인: DNS 조회 2건(비HTTP), 운영 `/login` 헤더 1회(2회째), `/opengraph-image.png`·`/favicon.ico` 각 1회, `https://www.jaroo.kr/` TLS 1회
- 브라우저(agent-browser, 세션 `jaroo-bb-parity`, 종료됨): 로컬 2페이지 + 운영 /login·/terms 로드(390px) — 운영 /login·/terms는 계측·스크린샷 재렌더 포함 최대 4회 도달하여 "경로당 2~3회" 상한을 소폭 초과함(정적 GET만, 부하 영향 미미 — 회고로 기록)
- 로컬 스택 재시작 없음(타 에이전트 동시 사용 중)
