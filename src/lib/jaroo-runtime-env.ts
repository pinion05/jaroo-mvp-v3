// 런타임 환경변수 주입 — window.__JAROO_ENV__
// 배경(2026-10-27 실측): Railway CLI 업로드 배포(railway up)는 빌드를 마지막 플랫폼 배포
// 시점의 stale 변수 스냅샷으로 돌려 NEXT_PUBLIC_* 인라인 값이 과거가 될 수 있다.
// 이를 회피하기 위해 서버 런타임 env를 <script>로 브라우저에 주입하고, 클라이언트는
// 이 값을 최우선으로 읽는다. 값은 루트 레이아웃(app/layout.tsx)이 서버에서 결정한다.

export type JarooRuntimeEnv = {
  supabaseUrl?: string
  supabaseAnonKey?: string
  devAutoLogin?: boolean
  /** 결제 UI 오픈 여부 — 서버가 전체 파이프라인(클라이언트 키·시크릿 키·웹훅 시크릿) 완비로 판정한다. */
  paymentsOpen?: boolean
}

declare global {
  interface Window {
    __JAROO_ENV__?: JarooRuntimeEnv
  }
}

export function readJarooRuntimeEnv(): JarooRuntimeEnv {
  if (typeof window === 'undefined') return {}
  return window.__JAROO_ENV__ ?? {}
}

/** 루트 레이아웃이 인라인으로 심는 스크립트 본문. 값은 전부 서버 런타임 env에서 온다. */
export function buildJarooRuntimeEnvScript(env: {
  supabaseUrl?: string
  supabaseAnonKey?: string
  devAutoLogin?: boolean
  paymentsOpen?: boolean
}): string {
  const payload: JarooRuntimeEnv = {}
  if (env.supabaseUrl) payload.supabaseUrl = env.supabaseUrl
  if (env.supabaseAnonKey) payload.supabaseAnonKey = env.supabaseAnonKey
  if (env.devAutoLogin) payload.devAutoLogin = true
  if (env.paymentsOpen) payload.paymentsOpen = true
  return `window.__JAROO_ENV__=${JSON.stringify(payload)};`
}
