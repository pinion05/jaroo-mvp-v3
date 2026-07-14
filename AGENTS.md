<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Jaroo runtime rule

When starting the Jaroo development runtime, always run the web app and crawler sidecar together. Prefer the root stack command:

```bash
npm run dev
```

Do not run only `npm run dev:web` unless the user explicitly asks for web-only debugging. The app expects the crawler API to be available alongside Next.js.

# Orca 브라우저에서 Jaroo 로그인 (세션 전이)

Orca 의 임베디드 브라우저는 **웹뷰** 기반이라 구글이 "안전하지 않은 클라이언트"로 간주해 Google OAuth 를 차단한다("로그인할 수 없음 - 브라우저 또는 앱이 안전하지 않을 수 있습니다"). UA spoofing 으로는 우회되지 않는다. 대신 **신뢰받는 브라우저(BrowserOS)에서 OAuth 로그인한 세션을 토큰 단위로 Orca 로 전이**한다.

## 원인

- Orca 탭 = Chromium 웹뷰. 구글이 웹뷰/Electron/자동화 클라이언트 신호를 잡아 OAuth consent 진입 단계(`accounts.google.com/v3/signin/rejected`)에서 차단한다.
- BrowserOS(`--cdp-port=9018`)는 일반 Chromium 빌드라 차단 없이 통과하며, 사용자 구글 세션이 있으면 계정 선택 → 자동 consent → 콜백까지 원클릭으로 흘러간다.

## 전이 매커니즘 (이미 구현됨)

세션 전이용 dev 라우트가 있다. 둘 다 `NODE_ENV === 'production'` 이면 404 로 비활성화되므로 운영 빌드엔 영향이 없다.

- `src/app/api/auth/dev-tokens/route.ts` — 현재 로그인된 세션의 `access_token` / `refresh_token` 을 JSON 으로 반환한다 (서버 `createSupabaseServerClient().auth.getSession()`).
- `src/app/auth/dev-set-session/route.ts` — 쿼리로 받은 두 토큰으로 서버 `auth.setSession()` 을 호출해 **httpOnly Supabase 세션 쿠키**를 설정한 뒤 `/home` 로 리다이렉트한다.

인증은 Supabase SSR + PKCE. 세션의 진실 소스는 `sb-<project-ref>-auth-token` 계열 httpOnly 쿠키이며, `setSession` 이 그 쿠키를 쓴다. 이후 `/api/auth/me`, `/api/portfolio` 등이 쿠키로 인증된다.

## 로그인 절차 (Orca 세션 만료 시 재사용)

전제: `npm run dev` 로 웹(3000) + 크롤러(3040)가 떠 있고, BrowserOS 가 실행 중이며(`curl http://127.0.0.1:9018/json/version` 응답), Orca 가 jaroo-mvp-v3 worktree 에 연결돼 있다(`orca status` ready).

1. **BrowserOS 에서 Google OAuth 로그인** (CDP 9018 로 제어):
   ```bash
   agent-browser --cdp 9018 open "http://localhost:3000/login"
   agent-browser --cdp 9018 snapshot -i            # "Google로 시작하기" 버튼 ref 확인 (예: @e11)
   agent-browser --cdp 9018 click @e11
   # accountchooser 페이지에서 계정 선택 (예: @e2)
   agent-browser --cdp 9018 click @e2
   # /home 로 떨어지면 성공. 드물게 첫 콜백이 code_verifier race 로 실패(→ /login?error=oauth)할 수 있는데, 같은 흐름을 다시 시작하면 통과한다.
   ```
2. **토큰 추출 → Orca 주입** (한 번에):
   ```bash
   TOKENS="$(agent-browser --cdp 9018 eval \
     "(async()=>{const j=await (await fetch('/api/auth/dev-tokens')).json();return btoa(JSON.stringify({a:j.access_token,r:j.refresh_token}))})()" \
     | tr -d '"')"
   QS="$(python3 -c "import base64,json,urllib.parse; d=json.loads(base64.b64decode('$TOKENS')); print(urllib.parse.urlencode({'access_token':d['a'],'refresh_token':d['r']}))")"
   orca goto --url "http://localhost:3000/auth/dev-set-session?$QS"
   ```
3. **검증**:
   ```bash
   orca reload
   orca eval --expression "(async()=>(await fetch('/api/auth/me')).json())"   # authScope == "authenticated"
   orca eval --expression "(async()=>(await fetch('/api/portfolio')).status)"   # 200
   ```

## 주의사항

- 토큰은 민감 정보. 전이 직후 임시 파일/셸 변수를 지운다(`rm -f /tmp/*tokens*`). 셸 히스토리에 남지 않게 주의.
- `access_token` 은 ~1시간 뒤 만료되지만 `refresh_token` 이 살아있는 한 Supabase 가 자동 갱신하므로 Orca 에서는 쿠키가 유지되는 동안 계속 인증된다. 완전히 만료/로그아웃되면 위 절차를 처음부터 반복한다.
- BrowserOS 가 없거나 연결이 안 되면, 일반 Chrome(메인 프로필, 구글 세션 있음)에서 `localhost:3000/login` → Google 로그인 후 `/api/auth/dev-tokens`(콘솔 fetch)로 토큰을 직접 뽑아 `orca goto` 로 주입하는 fallback 이 가능하다.
- dev 라우트는 운영 빌드에서 비활성화되지만, 본 워크플로우는 Jaroo **개발 환경 전용**이다.

# Issue / PR 작성 가이드 (한국어 필수)

모든 GitHub Issue와 Pull Request는 **한국어로 자세하게 작성**한다.

## Issue 작성 규칙
- **제목**: 한국어로 명확하게 작성한다. (예: "로그인 페이지 모바일에서 버튼 깨짐 현상")
- **본문**: 아래 항목을 한국어로 상세히 기술한다.
  - **문제/요청 개요 (배경)**: 왜 이 이슈가 필요한지 맥락을 설명한다.
  - **재현 방법 / 현재 동작**: 버그라면 재현 절차를 단계별로 적는다.
  - **기대 동작**: 원하는 결과를 구체적으로 적는다.
  - **영향 범위**: 관련 컴포넌트, 페이지, API, DB 등을 명시한다.
  - **참고 자료**: 스크린샷, 로그, 관련 이슈/PR 링크를 첨부한다.
- **라벨 / 담당자**: 가능하면 지정한다.
- 영어 용어(Jargon)는 괜찮지만, 설명 문장은 반드시 한국어로 작성한다.

## Pull Request 작성 규칙
- **제목**: 한국어로 변경 내용 요약 (Conventional Commits 접두어는 유지 가능, 예: `fix: 로그인 토큰 갱신 누락 수정`).
- **본문**: 아래 항목을 한국어로 상세히 기술한다.
  - **변경 요약**: 무엇을 바꿨는지 핵심 요약.
  - **변경 배경 / 동기**: 왜 이 변경이 필요한지 (관련 이슈 링크 포함, `Resolves #N`).
  - **주요 변경점**: 기능 추가/수정/삭제를 불릿으로 정리.
  - **테스트 방법**: 어떻게 검증했는지 재현 절차를 적는다.
  - **체크리스트**: 스크린샷, 테스트 결과, breaking change 여부 등.
  - **리뷰어 참고사항**: 집중 리뷰가 필요한 부분이 있으면 명시.
- 코드 주석은 영어/한국어 무관하되, PR 설명은 반드시 한국어로 작성한다.
