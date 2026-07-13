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
