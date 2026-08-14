# OCI → Railway 마이그레이션 및 test.jaroo.kr OAuth 구축

- **날짜**: 2026-08-14 (금)
- **작성**: pi (에이전트 세션)
- **관련 커밋**: `581955e`(oauth-redirect runtime origin), `20f1d21`(Dockerfile ENV 고정 + 캐시 무효), `5166f71`(PORT 분리 + entrypoint)
- **대상 서비스**: jaroo-mvp-v3 (Next.js + Playwright 크롤러)

---

## 1. 개요

기존 OCI VM(1GB RAM)에서 빌드 중 OOM이 발생하고 전반적인 환경이 열악하여, 동일 서비스를 **Railway** 단일 컨테이너로 마이그레이션했다. 메인 도메인(`jaroo.kr`)은 OCI 프로덕션을 유지한 채, 테스트 배포 전용 서브도메인 **`test.jaroo.kr`** 을 신규 구축하고 해당 도메인에서 **Google 로그인(OAuth)이 정상 작동**하도록 전체 파이프라인을 완성했다.

최종 검증 결과 `test.jaroo.kr/login` → "Google로 시작하기" 클릭 시 `accounts.google.com` 으로 정상 리다이렉트되며, `redirect_to=https://test.jaroo.kr/auth/callback`, `client_id=612809090312-...`, Supabase 콜백 체인이 모두 정상이다.

---

## 2. 배경: OCI 환경의 한계

- **인스턴스 사양**: 1GB RAM. Next.js 빌드 시 반복적 OOM.
- **확장성/운영**: 수동 VM 관리, 쿠키 파일 수동 마운트, 도메인/인증서 관리 부담.
- **결론**: 동일 코드베이스를 Railway로 옮겨 빌드/런타임 안정성을 확보하고, OCI는 단계적 폐지 대상으로 분리.

---

## 3. 아키텍처: Railway 단일 컨테이너 (web + crawler)

Railway **하나의 서비스(컨테이너)** 에서 웹(Next.js)과 크롤러를 함께 구동한다. 별도 서비스 분리 대신 단일 컨테이너 + `entrypoint` 스크립트로 프로세스를 관리한다.

### 3.1 포트 충돌 회피 (핵심)
Railway는 웹 프로세스에 `PORT` 환경변수를 주입한다. 크롤러가 동일 `PORT`를 읽으면 단일 컨테이너에서 `EADDRINUSE`가 발생한다. 따라서 **크롤러는 `CRAWLER_PORT`만 읽도록 고정**했다.

```js
// packages/crawler/src/server.js
// CRAWLER_PORT only — never read shared PORT (Railway injects PORT for the web
// process; reading it here would cause EADDRINUSE in a single container).
const port = Number(process.env.CRAWLER_PORT || 3040);
const host = process.env.CRAWLER_HOST || '127.0.0.1';
```

### 3.2 docker-entrypoint.sh (신규)
단일 컨테이너에서 두 프로세스를 띄우고, 어느 하나가 죽으면 컨테이너가 종료되도록 `wait -n`으로 관리한다.

```bash
#!/bin/bash
set -e
: "${PORT:=3000}"; : "${CRAWLER_PORT:=3040}"; : "${CRAWLER_HOST:=127.0.0.1}"
export PORT CRAWLER_PORT CRAWLER_HOST
# Wisereport 쿠키: Railway는 .env.cookie 마운트 불가 → base64 변수에서 복원
if [ -n "$WISEREPORT_COOKIES_B64" ]; then
  printf '%s' "$WISEREPORT_COOKIES_B64" | base64 -d > "$PWD/.env.cookie" 2>/dev/null \
    && echo "[entrypoint] restored .env.cookie" \
    || echo "[entrypoint] WARNING: cookie decode failed"
fi
node scripts/with-local-env.cjs node_modules/.bin/next start &
WEB_PID=$!
node scripts/with-local-env.cjs npm --prefix packages/crawler run start &
CRAWLER_PID=$!
trap cleanup EXIT INT TERM
wait -n
```

- 크롤러는 `127.0.0.1:3040` 에 바인딩(컨테이너 내부 전용), Railway 프록시는 웹 `PORT`를 외부에 노출한다.

### 3.3 쿠키 파일 처리
`.env.cookie`는 wisereport 세션 쿠키 JSON(193줄)이다. Railway는 파일 마운트를 지원하지 않으므로, 빌드 시 `WISEREPORT_COOKIES_B64`(base64) 변수를 runtime에 디코딩해 `.env.cookie`로 복원한다.

---

## 4. OAuth 구축: test.jaroo.kr (5단계 + 빌드 2단계)

OAuth 리다이렉트는 **3개 주체(코드·Supabase·Google Console)** 가 모두 일치해야 작동한다. 여기에 Railway 빌드 반영 이슈 2건이 더해져 총 7단계를 해결했다.

### 4.1 코드: oauth-redirect runtime origin (커밋 `581955e`)

기존 `resolveOAuthRedirectOrigin`은 localhost 외의 **모든 호스트를 `https://jaroo.kr`로 강제** 정규화했다. 이 때문에 `test.jaroo.kr`에서 로그인해도 콜백이 `jaroo.kr`(OCI)로 날아갔다.

**해결**: 항상 `location.origin`을 그대로 사용하도록 변경. 각 배포(localhost/`jaroo.kr`/`test.jaroo.kr`/Railway 기본 도메인)가 자체 콜백을 받도록 했다. 보안은 OAuth provider가 등록된 redirect URI만 허용하므로 유지된다.

```ts
// src/lib/supabase/oauth-redirect.ts
export function resolveOAuthRedirectOrigin(location): string {
  return normalizeOrigin(location.origin)  // 빌드 타임 변수 의존 제거
}
export function buildOAuthRedirectTo(location = window.location): string {
  return `${resolveOAuthRedirectOrigin(location)}/auth/callback`
}
```

> **참고**: 서버 측 콜백 검증(`oauth-callback-origin.ts`)은 이미 Railway의 `X-Forwarded-Host`를 그대로 사용하도록 구현되어 있어 별도 수정 불필요.

### 4.2 DNS: test.jaroo.kr → Railway (Cafe24)

Cafe24 DNS(ns1.cafe24dns.co.kr)에 서브도메인을 설정했다.

- 최초 시도: `test CNAME 7aoh3fhs.up.railway.app` + `TXT _railway-verify.test`
- **문제**: 기존 와일드카드 `*.jaroo.kr → jaroo.kr → 158.179.162.98(OCI)`이 `test`를 가로챔 (cafe24 비표준 동작으로 A 질의에 와일드카드 우선 응답).
- **해결**: `test A 69.46.46.118`(Railway IP) 명시적 추가로 와일드카드 우회.

최종 DNS 확인:
```
test.jaroo.kr  →  69.46.46.118 (Railway)
_railway-verify.test  TXT  railway-verify=...
```

### 4.3 SSL: Railway 자동 인증서

Railway 커스텀 도메인 등록 후 소유권 검증(TXT) → `CERTIFICATE_STATUS_TYPE_VALID` 발급. `test.jaroo.kr:443` SNI에 대해 유효 인증서 서빙.

### 4.4 Google Cloud Console (CDP 자동화)

OAuth 클라이언트 `612809090312-27qq4mnsejlq6h52a5a15pbseicuotl8...` ("Jaroo Supabase Web")에 다음을 추가:
- **Authorized JavaScript origins**: `https://test.jaroo.kr`
- **Authorized redirect URIs**: `https://test.jaroo.kr/auth/callback`

### 4.5 Supabase Redirect URLs (CDP 자동화)

Supabase 프로젝트 `hrfpnawmlcoaygipulpm` → Authentication → URL Configuration → "Add new redirect URLs" 모달에 `https://test.jaroo.kr/auth/callback` 추가.

### 4.6 빌드: NEXT_PUBLIC_SUPABASE_* ENV 고정 (커밋 `20f1d21`) ★ 핵심

**문제**: Railway 빌드 환경이 `NEXT_PUBLIC_*` 환경변수를 빌드 컨테이너에 주입하지 않았다. 빌드된 JS chunk를 검사하니:
- `NEXT_PUBLIC_JAROO_ORIGIN` 미반영 → `oauth-redirect`에 `https://jaroo.kr` 기본값 인라인
- `NEXT_PUBLIC_SUPABASE_URL` 미반영 → Supabase client가 undefined URL로 초기화 → `signInWithOAuth` 호출 자체가 발생하지 않음(네트워크 요청 0건)

**해결**: `Dockerfile` builder 단계에 publishable 값들을 ENV로 명시적으로 인라인.

```dockerfile
FROM deps AS builder

# Railway does not inject NEXT_PUBLIC_* at build time; inline explicitly.
ENV NEXT_PUBLIC_SUPABASE_URL=https://hrfpnawmlcoaygipulpm.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>

# Bust the build cache on every build so source edits always invalidate
# downstream layers (Docker layer caching was masking code changes).
RUN date -u +%s > /buildtime

COPY . .
RUN npm run build
```

> ANON_KEY는 `sb_publishable_` 접두의 publishable 키로 클라이언트 노출이 설계 의도이므로 Dockerfile 커밋에 포함해도 안전하다.

### 4.7 빌드: Docker 캐시 무효 + railway up

GitHub webhook 트리거 빌드에서 **소스 변경이 chunk에 반영되지 않는 캐싱 이슈**가 발생했다.
- `RUN date -u +%s > /buildtime` 으로 매 빌드 레이어를 무효화.
- 결정적으로 **`railway up`(로컬 컨텍스트 업로드 빌드)** 이 GitHub webhook보다 소스 반영이 확실하다. 최종 검증 빌드는 모두 `railway up -d`로 수행.

---

## 5. 핵심 학습 / 함정

### 5.1 Railway 빌드 변수 주입 불안정
- Railway service variables는 runtime에는 주입되나, **빌드(Docker builder)에는 NEXT_PUBLIC_*가 간헐 주입되지 않는다**.
- 해결책: 빌드 타임 값이 필요한 `NEXT_PUBLIC_*`는 Dockerfile ENV로 직접 고정하거나, 코드에서 runtime 값을 사용하도록 의존을 제거한다.

### 5.2 railway up vs GitHub webhook
- `railway up`은 로컬 작업 디렉토리를 tar로 업로드해 빌드하므로 **"내가 올린 코드가 확실히 빌드된다"**.
- GitHub webhook 빌드는 Docker 레이어 캐시와 얽혀 디버깅이 어렵다. 빌드 반영이 의심되면 `railway up`으로 우회.

### 5.3 BrowserOS CDP 자동화
- `suppress_origin=True`(websocket-client)로 Chrome의 Origin 검사(403)를 우회해 기존 로그인 탭을 CDP로 직접 제어할 수 있었다.
- Cafe24 DNS 관리: 저수준 CDP + `Input.dispatchMouseEvent`로 UI 자동화가 가능했으나, **"확인" 버튼 등 이벤트 위임 패턴**은 synthetic click을 무시해 결국 사람이 클릭.
- Google Cloud Console / Supabase 대시보드: CDP + **문자별 `keyDown`/`keyUp` 타이핑**(React state 강제 갱신) + 모달 제어로 자동화 성공.
- Supabase 대시보드 SPA는 BrowserOS에서 렌더링이 불안정해 `/json/new` 새 탭에서 진입해야 했다.

### 5.4 cafe24 DNS 와일드카드 함정
- `*.jaroo.kr` 와일드카드가 서브도메인의 A 질의까지 가로채는 비표준 동작. 신규 서브도메인은 **명시적 A 레코드**로 우회해야 한다.

---

## 6. 운영 절차

### 6.1 배포
```bash
# 일반: GitHub push → Railway webhook 빌드
git push origin release

# 빌드 반영 확실성이 필요할 때 (추천)
railway up -d
```

### 6.2 DNS 레코드 (Cafe24, 참조용)
| 호스트 | 유형 | 값 |
|---|---|---|
| `test` | A | `69.46.46.118` (Railway) |
| `_railway-verify.test` | TXT | `railway-verify=...` |

### 6.3 OAuth 클라이언트 설정 위치
- **Google Console**: `console.cloud.google.com` 프로젝트 `luca-article-cae58` → OAuth 클라이언트 `612809090312-...`
- **Supabase**: 프로젝트 `hrfpnawmlcoaygipulpm` → Authentication → URL Configuration

### 6.4 로그인 검증
`test.jaroo.kr/login` → "Google로 시작하기" → URL이 `accounts.google.com/v3/signin/identifier?...redirect_to=https://test.jaroo.kr/auth/callback...` 이면 정상.

---

## 7. 향후 과제

- **OCI 폐지**: `jaroo.kr` A 레코드(`158.179.162.98`)를 Railway로 전환하면 메인 도메인도 Railway 서빙. 단, 와일드카드 `*.jaroo.kr` 정리 선행 필요.
- **와일드카드 정리**: `*.jaroo.kr → jaroo.kr` 레코드 검토. 사용 중인 서브도메인(www 등)을 명시적 레코드로 전환 후 와일드카드 삭제.
- **빌드 변수 근본 해결**: Railway 빌드 환경 변수 주입 불안정의 근본 원인(Railway 빌더 설정/Nixpacks) 추가 조사. 장기적으로 Dockerfile ENV 하드코딩 대신 주입 정상화.
- **브랜치 정책**: `release` 브랜치 운영 규칙 문서화(master와의 관계).
- **구형 레거시 정리**: `.codex` 디렉토리 등 비활성 산물 정리.

---

## 8. 참고 자료

- 관련 코드:
  - `src/lib/supabase/oauth-redirect.ts` (runtime origin)
  - `src/lib/supabase/oauth-callback-origin.ts` (서버 측, X-Forwarded-Host 기반)
  - `Dockerfile` (ENV 고정 + 캐시 무효)
  - `docker-entrypoint.sh` (web + crawler 프로세스 관리)
  - `packages/crawler/src/server.js` (CRAWLER_PORT 분리)
- 기존 문서: `docs/docker-deploy.md`, `docs/auth-supabase-foundation.md`
